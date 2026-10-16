import { describe, it, expect, beforeEach, vi } from 'vitest';

// Prisma 替身：不连真实数据库
vi.mock('../src/lib/prisma.js', async () => {
  const mod = await import('./helpers/fake-prisma.js');
  return { default: mod.fakePrisma };
});

// Redis 替身：杜绝用例触网
vi.mock('../src/lib/redis/redis.client.js', () => ({
  getRedisClient: () => null,
  setRedisClient: () => {},
  isRedisHealthy: async () => false,
  closeRedisClient: async () => {},
  maskRedisUrl: () => 'none',
}));

const { fakePrisma, resetFakePrisma } = await import('./helpers/fake-prisma.js');
const { refreshAccessToken, logout, hashRefreshToken } = await import('../src/modules/auth/auth.service.js');
const { signRefreshToken, verifyRefreshToken } = await import('../src/lib/jwt.js');

const USER_ID = 'u1';
const GRACE_MS = 10 * 1000;

function seedRefreshToken({ tokenValue, overrides = {} } = {}) {
  const value = tokenValue ?? signRefreshToken({ sub: USER_ID, phone: '+8613800138000', email: null });
  const row = {
    id: 'rt_seed',
    token: hashRefreshToken(value),
    userId: USER_ID,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    revokedAt: null,
    rotatedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
  fakePrisma._state.RefreshToken.push(row);
  return { value, row };
}

beforeEach(() => {
  resetFakePrisma();
  fakePrisma._state.User.push({
    id: USER_ID,
    phone: '+8613800138000',
    email: null,
    nickname: '健身健儿',
    avatarUrl: null,
    passwordHash: null,
    phoneVerifiedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
});

describe('refresh token 轮换', () => {
  it('轮换成功：旧记录被标记为已轮换，新记录以哈希入库', async () => {
    const { value, row } = seedRefreshToken();
    const out = await refreshAccessToken(value);

    expect(out.accessToken).toBeTruthy();
    expect(out.refreshToken).toBeTruthy();
    expect(out.refreshToken).not.toBe(value);

    expect(row.revokedAt).toBeInstanceOf(Date);
    expect(row.rotatedAt).toBeInstanceOf(Date);

    const stored = fakePrisma._state.RefreshToken;
    expect(stored.some((r) => r.token === hashRefreshToken(out.refreshToken))).toBe(true);
    // 库中不得出现任何明文 JWT
    expect(stored.every((r) => !r.token.includes('.'))).toBe(true);
  });

  it('宽限期内并发复用旧 token 放行，不误杀正常并发', async () => {
    const { value } = seedRefreshToken();
    const first = await refreshAccessToken(value);
    const second = await refreshAccessToken(value);

    expect(second.accessToken).toBeTruthy();
    expect(second.refreshToken).toBeTruthy();
    expect(first.refreshToken).not.toBe(second.refreshToken);
    // 两次签发的 token 都有效，任一方都不会被登出
    expect(() => verifyRefreshToken(first.refreshToken)).not.toThrow();
    expect(() => verifyRefreshToken(second.refreshToken)).not.toThrow();
  });

  it('超出宽限期复用旧 token 判定为重放，并失效该用户整条 refresh 链', async () => {
    const { value } = seedRefreshToken();
    await refreshAccessToken(value);

    // 模拟首次轮换已过去 20 秒（> 10 秒宽限期）
    const seeded = fakePrisma._state.RefreshToken.find((r) => r.id === 'rt_seed');
    seeded.rotatedAt = new Date(Date.now() - GRACE_MS * 2);

    // 再插入一条同用户的有效 token，用于验证「整条链」被失效
    const otherToken = signRefreshToken({ sub: USER_ID, phone: '+8613800138000', email: null });
    fakePrisma._state.RefreshToken.push({
      id: 'rt_other',
      token: hashRefreshToken(otherToken),
      userId: USER_ID,
      expiresAt: new Date(Date.now() + 86400000),
      revokedAt: null,
      rotatedAt: null,
      createdAt: new Date(),
    });

    await expect(refreshAccessToken(value)).rejects.toMatchObject({
      statusCode: 401,
      errorCode: 'TOKEN_REPLAYED',
    });
    expect(fakePrisma._state.RefreshToken.filter((r) => r.userId === USER_ID)).toHaveLength(0);
  });

  it('登出后复用的 token 返回 TOKEN_REVOKED，不触发整链失效', async () => {
    const { value, row } = seedRefreshToken();
    await logout(value);
    expect(row.revokedAt).toBeInstanceOf(Date);

    await expect(refreshAccessToken(value)).rejects.toMatchObject({
      statusCode: 401,
      errorCode: 'TOKEN_REVOKED',
    });
    expect(fakePrisma._state.RefreshToken.length).toBeGreaterThan(0);
  });

  it('过期 token 返回 TOKEN_EXPIRED', async () => {
    const { value } = seedRefreshToken({
      overrides: { expiresAt: new Date(Date.now() - 1000) },
    });

    await expect(refreshAccessToken(value)).rejects.toMatchObject({
      statusCode: 401,
      errorCode: 'TOKEN_EXPIRED',
    });
  });

  it('未知 token 返回 TOKEN_REVOKED', async () => {
    const unknown = signRefreshToken({ sub: 'not-exist', email: null, phone: null });
    await expect(refreshAccessToken(unknown)).rejects.toMatchObject({
      statusCode: 401,
      errorCode: 'TOKEN_REVOKED',
    });
  });

  it('存量明文记录在首次轮换时就地升级为哈希', async () => {
    const value = signRefreshToken({ sub: USER_ID, phone: '+8613800138000', email: null });
    const row = {
      id: 'rt_legacy',
      token: value, // 切换哈希存储前写入的明文
      userId: USER_ID,
      expiresAt: new Date(Date.now() + 86400000),
      revokedAt: null,
      rotatedAt: null,
      createdAt: new Date(),
    };
    fakePrisma._state.RefreshToken.push(row);

    const out = await refreshAccessToken(value);
    expect(out.refreshToken).toBeTruthy();
    expect(row.token).toBe(hashRefreshToken(value));
    expect(fakePrisma._state.RefreshToken.every((r) => !r.token.includes('.'))).toBe(true);
  });
});
