import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';

// Prisma 替身：不连真实数据库
vi.mock('../src/lib/prisma.js', async () => {
  const mod = await import('./helpers/fake-prisma.js');
  return { default: mod.fakePrisma };
});

// Redis 替身：未提供 REDIS_URL 时本就返回 null，此处显式桩化，杜绝用例触网
vi.mock('../src/lib/redis/redis.client.js', () => ({
  getRedisClient: () => null,
  setRedisClient: () => {},
  isRedisHealthy: async () => false,
  closeRedisClient: async () => {},
  maskRedisUrl: () => 'none',
}));

const { fakePrisma, resetFakePrisma } = await import('./helpers/fake-prisma.js');
const app = (await import('../src/app.js')).default;
const { rateLimiter } = await import('../src/lib/rate-limit/memory-rate-limiter.js');
const { resetRequestRateLimiters, resolveClientIp, hashAccount } = await import('../src/middleware/rateLimiter.js');

const PHONE = '13800138000';
const NORMALIZED_PHONE = '+8613800138000';
const PASSWORD = 'Passw0rd1';
let passwordHash;

beforeEach(async () => {
  resetFakePrisma();
  resetRequestRateLimiters();
  rateLimiter.clear();
  if (!passwordHash) passwordHash = await bcrypt.hash(PASSWORD, 10);
  fakePrisma._state.User.push({
    id: 'u1',
    phone: NORMALIZED_PHONE,
    email: null,
    nickname: '健身健儿',
    avatarUrl: null,
    passwordHash,
    phoneVerifiedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
});

describe('auth 登录（手机号 + 密码）', () => {
  it('密码正确时返回 200 与 accessToken，并下发 refreshToken Cookie', async () => {
    const res = await request(app)
      .post('/api/v1/auth/phone-password/login')
      .send({ phone: PHONE, password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.code).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.user.phone).toBe(NORMALIZED_PHONE);
    expect(res.body.data.user.passwordHash).toBeUndefined();

    const cookies = res.headers['set-cookie'] || [];
    expect(cookies.some((c) => c.startsWith('refreshToken='))).toBe(true);
  });

  it('密码错误时返回 401 INVALID_CREDENTIALS', async () => {
    const res = await request(app)
      .post('/api/v1/auth/phone-password/login')
      .send({ phone: PHONE, password: 'WrongPass1' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('INVALID_CREDENTIALS');
  });

  it('手机号不存在时同样返回 401，不泄露账号是否存在', async () => {
    const res = await request(app)
      .post('/api/v1/auth/phone-password/login')
      .send({ phone: '13900139000', password: PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('INVALID_CREDENTIALS');
  });

  it('登录成功后库内只保存 refresh token 的 sha256 哈希', async () => {
    await request(app)
      .post('/api/v1/auth/phone-password/login')
      .send({ phone: PHONE, password: PASSWORD });

    const rows = fakePrisma._state.RefreshToken;
    expect(rows).toHaveLength(1);
    // sha256 十六进制固定 64 位，且不应是 JWT（含点号）
    expect(rows[0].token).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].token).not.toContain('.');
  });
});

describe('auth 端点请求级限流', () => {
  it('登录端点超过配额返回 429，并带 Retry-After 头', async () => {
    const max = 10;
    for (let i = 0; i < max; i += 1) {
      const res = await request(app)
        .post('/api/v1/auth/phone-password/login')
        .send({ phone: PHONE, password: 'WrongPass1' });
      expect(res.body.error).not.toBe('RATE_LIMIT_EXCEEDED');
    }

    const blocked = await request(app)
      .post('/api/v1/auth/phone-password/login')
      .send({ phone: PHONE, password: 'WrongPass1' });

    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBe('RATE_LIMIT_EXCEEDED');
    expect(blocked.body.message).toBeTruthy();
    expect(blocked.headers['retry-after']).toBeTruthy();
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('登录限流按 IP + 账号维度计数，换账号不受同一配额影响', async () => {
    const hit = async (phone) => request(app)
      .post('/api/v1/auth/phone-password/login')
      .send({ phone, password: 'WrongPass1' });

    for (let i = 0; i < 10; i += 1) {
      await hit(PHONE);
    }
    const blocked = await hit(PHONE);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBe('RATE_LIMIT_EXCEEDED');

    // 另一个手机号是独立配额
    const other = await hit('13900139000');
    expect(other.body.error).not.toBe('RATE_LIMIT_EXCEEDED');
  });

  it('注册端点超过配额返回 429（按 IP 计数）', async () => {
    for (let i = 0; i < 5; i += 1) {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({ phone: `138001380${i}0`, password: PASSWORD });
      expect(res.body.error).not.toBe('RATE_LIMIT_EXCEEDED');
    }

    const blocked = await request(app)
      .post('/api/v1/auth/register')
      .send({ phone: PHONE, password: PASSWORD });

    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBe('RATE_LIMIT_EXCEEDED');
    expect(blocked.headers['retry-after']).toBeTruthy();
  });
});

describe('resolveClientIp 可信 IP 解析', () => {
  const makeReq = (headers, trustProxy, ip = '127.0.0.1') => ({
    headers,
    ip,
    socket: { remoteAddress: '127.0.0.1' },
    app: { get: (key) => (key === 'trust proxy' ? trustProxy : undefined) },
  });

  it('未开启 trust proxy 时不采信客户端自填的 X-Forwarded-For', () => {
    const req = makeReq({ 'x-forwarded-for': '9.9.9.9' }, false);
    expect(resolveClientIp(req)).toBe('127.0.0.1');
  });

  it('开启 trust proxy 时取最右侧非私有段，忽略客户端追加的左侧段', () => {
    const req = makeReq({ 'x-forwarded-for': '9.9.9.9, 203.0.113.7, 127.0.0.1' }, 1);
    expect(resolveClientIp(req)).toBe('203.0.113.7');
  });

  it('X-Forwarded-For 全为内网段时退化为最右一段', () => {
    const req = makeReq({ 'x-forwarded-for': '10.0.0.1, 192.168.1.1' }, 1);
    expect(resolveClientIp(req)).toBe('192.168.1.1');
  });

  it('账号标识经哈希后不落明文', () => {
    expect(hashAccount('user@example.com')).not.toContain('user@example.com');
    expect(hashAccount('user@example.com')).toBe(hashAccount('USER@example.com'));
  });
});
