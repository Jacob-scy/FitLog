import crypto from 'crypto';
import { getRedisClient } from '../lib/redis/redis.client.js';

/**
 * HTTP 请求级限流中间件（登录 / 注册等敏感端点专用）
 *
 * 与 lib/rate-limit/* 的区别：
 * - lib/rate-limit 是「业务限流」(短信配额 / 账号锁定)，由 service 显式调用；
 * - 本文件是「传输层限流」，挂在路由上，对所有请求生效（含非法报文）。
 *
 * 存储策略：
 * - 配置 REDIS_URL 时优先使用 Redis 固定窗口计数（Lua 原子 INCR + PEXPIRE，带 TTL）；
 * - 未配置或 Redis 抛错时使用进程内计数，但必须带容量上限与过期淘汰，避免内存泄漏。
 */

// Lua：原子自增；首次自增时设置毫秒级 TTL；返回 [当前计数, 剩余 TTL(ms)]
const FIXED_WINDOW_LUA = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
    redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[1]))
end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then ttl = tonumber(ARGV[1]) end
return {current, ttl}
`;

// 私有 / 环回网段：反向代理写入 X-Forwarded-For 的跳数地址，不能当作客户端 IP
const PRIVATE_IPV4 = /^(?:10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|0\.)/;
const PRIVATE_IPV6 = /^(?:::1$|[Ff][Cc]|[Ff][Dd]|[Ff][Ee][89ABab])/;

function isProxyHopAddress(ip) {
  if (!ip) return true;
  const v4Mapped = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  if (PRIVATE_IPV4.test(v4Mapped)) return true;
  if (ip.includes(':')) return PRIVATE_IPV6.test(ip) || v4Mapped !== ip;
  return false;
}

/**
 * 解析可信客户端 IP。
 *
 * 信任假设（必须与部署拓扑一致，改动前请同时确认 nginx / Cloudflare Tunnel 配置）：
 * 1. 只有当应用显式开启 trust proxy（app.set('trust proxy', ...)）时，才采信
 *    X-Forwarded-For；否则一律使用 TCP 对端地址。因为未开启 trust proxy 时任何人
 *    都能自己伪造 X-Forwarded-For 头来绕过限流。
 * 2. 采信 X-Forwarded-For 时也不盲信整串：客户端可以在左侧追加任意内容，但右侧的
 *    每一段只能由我们的反向代理追加。因此从最右侧向左遍历，跳过代理自身的
 *    私有/环回段，取第一个公网地址 —— 即「最右侧非可信段」。
 * 3. X-Forwarded-For 全为私有地址（例如内网直连）时退化为最右一段，
 *    再退化到 req.ip / socket 地址。
 * 4. CF-Connecting-IP 由 Cloudflare 边缘写入，但只有在请求确实经过 Cloudflare 时
 *    才可信；直接暴露端口时客户端可伪造。故默认不采信，需显式设置
 *    TRUST_CF_CONNECTING_IP=true 才启用。
 */
export function resolveClientIp(req) {
  const trustProxy = !!req.app?.get?.('trust proxy');

  if (process.env.TRUST_CF_CONNECTING_IP === 'true') {
    const cfIp = req.headers?.['cf-connecting-ip'];
    if (typeof cfIp === 'string' && cfIp.trim()) {
      return cfIp.trim().split(',')[0].trim();
    }
  }

  if (trustProxy) {
    const raw = req.headers?.['x-forwarded-for'];
    if (typeof raw === 'string' && raw.trim()) {
      const hops = raw.split(',').map((s) => s.trim()).filter(Boolean);
      for (let i = hops.length - 1; i >= 0; i -= 1) {
        if (!isProxyHopAddress(hops[i])) return hops[i];
      }
      if (hops.length > 0) return hops[hops.length - 1];
    }
  }

  return req.ip || req.socket?.remoteAddress || 'unknown';
}

/** 进程内固定窗口计数：容量上限 + 惰性过期 + 定时清扫，杜绝无界增长 */
class MemoryCounterStore {
  constructor({ maxEntries = 10000, sweepIntervalMs = 60000 } = {}) {
    this.maxEntries = maxEntries;
    this.entries = new Map();
    this.sweepIntervalMs = sweepIntervalMs;
    this.timer = null;
  }

  ensureSweeper() {
    if (this.timer || this.sweepIntervalMs <= 0) return;
    this.timer = setInterval(() => this.sweep(), this.sweepIntervalMs);
    // 不阻止进程退出
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  sweep(now = Date.now()) {
    for (const [key, entry] of this.entries) {
      if (entry.resetAt <= now) this.entries.delete(key);
    }
  }

  /** 容量上限：按插入顺序淘汰最旧条目（Map 保持插入序） */
  evictIfNeeded() {
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  async hit(key, windowMs) {
    this.ensureSweeper();
    const now = Date.now();
    let entry = this.entries.get(key);

    if (!entry || entry.resetAt <= now) {
      this.evictIfNeeded();
      entry = { count: 0, resetAt: now + windowMs };
      this.entries.set(key, entry);
    }

    entry.count += 1;
    return { count: entry.count, ttlMs: Math.max(0, entry.resetAt - now) };
  }

  clear() {
    this.entries.clear();
  }
}

const memoryStore = new MemoryCounterStore();

async function countWithRedis(redis, key, windowMs) {
  const res = await redis.eval(FIXED_WINDOW_LUA, 1, key, windowMs);
  const count = Array.isArray(res) ? Number(res[0]) : Number(res);
  const ttlMs = Array.isArray(res) && res[1] != null ? Number(res[1]) : windowMs;
  return { count, ttlMs };
}

/**
 * 计数入口：Redis 优先，异常/未配置时降级到进程内计数。
 * Redis 故障时不直接放行（否则限流被整体绕过），而是退化为单进程计数并记录告警。
 */
async function hit(key, windowMs) {
  const redis = getRedisClient();
  if (redis) {
    try {
      return await countWithRedis(redis, key, windowMs);
    } catch (err) {
      console.warn(`[RATE_LIMIT] Redis 计数失败，降级进程内计数: ${err?.message || err}`);
    }
  }
  return memoryStore.hit(key, windowMs);
}

/** 账号标识做哈希，避免把原始邮箱/手机号写进 Redis 键名 */
export function hashAccount(value) {
  if (typeof value !== 'string' || !value) return 'anonymous';
  return crypto.createHash('sha256').update(value.trim().toLowerCase()).digest('hex').slice(0, 32);
}

/** 从请求体中安全提取账号标识（可能未通过 schema 校验，故需类型收敛与长度截断） */
function extractAccount(req) {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const raw = typeof body.email === 'string' ? body.email
    : typeof body.phone === 'string' ? body.phone
      : '';
  return raw.slice(0, 128);
}

/**
 * 创建请求级限流中间件。
 * @param {object} opts
 * @param {string} opts.name      限流器名称（用于 Redis 键前缀与日志）
 * @param {number} opts.windowMs  固定窗口长度（毫秒）
 * @param {number} opts.max       窗口内允许的最大请求数
 * @param {string} [opts.message] 429 响应文案
 * @param {(req: object, ctx: { ip: string, accountHash: string }) => string} [opts.keyGenerator]
 */
export function createRateLimiter({
  name,
  windowMs,
  max,
  message = '请求过于频繁，请稍后再试',
  keyGenerator,
}) {
  const prefix = `rl:${name}`;

  return async function rateLimitMiddleware(req, res, next) {
    try {
      const ip = resolveClientIp(req);
      const accountHash = hashAccount(extractAccount(req));
      const discriminator = keyGenerator
        ? keyGenerator(req, { ip, accountHash })
        : `${ip}:${accountHash}`;
      const key = `${prefix}:${discriminator}`;

      const { count, ttlMs } = await hit(key, windowMs);

      if (count > max) {
        const retryAfterSec = Math.max(1, Math.ceil(ttlMs / 1000));
        res.setHeader('Retry-After', String(retryAfterSec));
        return res.status(429).json({
          code: 429,
          message,
          error: 'RATE_LIMIT_EXCEEDED',
          data: null,
        });
      }

      return next();
    } catch (err) {
      // 限流组件本身异常不应吞掉业务：记录告警后放行
      console.warn(`[RATE_LIMIT] ${name} 限流异常，本次放行: ${err?.message || err}`);
      return next();
    }
  };
}

/** 登录类端点：按 IP + 账号双维度计数 */
export const loginRateLimiter = createRateLimiter({
  name: 'auth-login',
  windowMs: 5 * 60 * 1000,
  max: 10,
  message: '登录尝试过于频繁，请 5 分钟后再试',
  keyGenerator: (_req, { ip, accountHash }) => `${ip}:${accountHash}`,
});

/** 注册类端点：按 IP 计数（注册请求不含稳定的账号维度） */
export const registerRateLimiter = createRateLimiter({
  name: 'auth-register',
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: '注册请求过于频繁，请 1 小时后再试',
  keyGenerator: (_req, { ip }) => `${ip}`,
});

/** 测试/开发环境清理：重置进程内计数与清扫器 */
export function resetRequestRateLimiters() {
  memoryStore.clear();
}

export default createRateLimiter;
