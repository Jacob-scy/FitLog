import { BaseRateLimiter } from './rate-limiter.interface.js';

/**
 * 内存限流器实现
 *
 * 规则：
 * 1. 单手机号 60 秒发送冷却时间 (Cooldown)
 * 2. 单手机号 24 小时内最多发送 10 次短信 (Daily Quota)
 * 3. 单 IP 1 小时内最多发送 10 次短信 (Hourly IP Quota)
 * 4. 连续登录尝试失败锁定：10 分钟内连续失败 5 次，锁定 15 分钟
 *
 * 内存约束（无 Redis 时长期驻留内存，必须有界）：
 * - 每个 Map 设置容量上限，写满后按插入顺序淘汰最旧条目（Map 保持插入序）
 * - 惰性清扫 + 定期清扫双管齐下，回收已过期条目，避免只增不减导致内存泄漏
 */
const MAX_ENTRIES = 10000;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const ATTEMPT_IDLE_TTL_MS = 10 * 60 * 1000; // 无锁定且 10 分钟无新失败 → 可回收
const SEND_HISTORY_TTL_MS = 24 * 60 * 60 * 1000;

export class MemoryRateLimiter extends BaseRateLimiter {
  constructor() {
    super();
    this.sendHistory = new Map();     // phone -> { lastSendAt, dailyCount, dailyResetAt }
    this.ipHistory = new Map();       // ip -> { count, resetAt }
    this.attemptHistory = new Map();  // phone -> { failedAttempts, lockedUntil, updatedAt }
    this.lastSweepAt = Date.now();
  }

  /** 容量上限：按插入顺序淘汰最旧条目 */
  _ensureCapacity(map) {
    while (map.size >= MAX_ENTRIES) {
      const oldest = map.keys().next();
      if (oldest.done) break;
      map.delete(oldest.value);
    }
  }

  /** 定期清扫过期条目；由写路径惰性触发，避免常驻定时器 */
  _sweep(now = Date.now()) {
    if (now - this.lastSweepAt < SWEEP_INTERVAL_MS) return;
    this.lastSweepAt = now;

    for (const [phone, entry] of this.sendHistory) {
      if (now > entry.dailyResetAt && now - entry.lastSendAt > SEND_HISTORY_TTL_MS) {
        this.sendHistory.delete(phone);
      }
    }
    for (const [ip, entry] of this.ipHistory) {
      if (now > entry.resetAt) this.ipHistory.delete(ip);
    }
    for (const [phone, entry] of this.attemptHistory) {
      const lockActive = entry.lockedUntil && now < entry.lockedUntil;
      if (!lockActive && now - (entry.updatedAt || 0) > ATTEMPT_IDLE_TTL_MS) {
        this.attemptHistory.delete(phone);
      }
    }
  }

  async canSend(phone) {
    const now = Date.now();
    this._sweep(now);
    const entry = this.sendHistory.get(phone);

    if (!entry) {
      return { allowed: true };
    }

    // 1. 检查 60 秒冷却
    if (now - entry.lastSendAt < 60 * 1000) {
      const waitSec = Math.ceil((60 * 1000 - (now - entry.lastSendAt)) / 1000);
      return {
        allowed: false,
        reason: 'COOLDOWN',
        waitSec,
        error: `请求过于频繁，请等待 ${waitSec} 秒后再试`,
      };
    }

    // 2. 检查单日配额 (24小时)
    if (now > entry.dailyResetAt) {
      entry.dailyCount = 0;
      entry.dailyResetAt = now + 24 * 60 * 60 * 1000;
    }

    if (entry.dailyCount >= 10) {
      return {
        allowed: false,
        reason: 'DAILY_QUOTA_EXCEEDED',
        error: '该手机号今日短信发送次数已达上限，请明日再试',
      };
    }

    return { allowed: true };
  }

  async recordSend(phone) {
    const now = Date.now();
    this._sweep(now);
    this._ensureCapacity(this.sendHistory);
    let entry = this.sendHistory.get(phone);

    if (!entry) {
      entry = {
        lastSendAt: now,
        dailyCount: 1,
        dailyResetAt: now + 24 * 60 * 60 * 1000,
      };
    } else {
      if (now > entry.dailyResetAt) {
        entry.dailyCount = 1;
        entry.dailyResetAt = now + 24 * 60 * 60 * 1000;
      } else {
        entry.dailyCount += 1;
      }
      entry.lastSendAt = now;
    }

    this.sendHistory.set(phone, entry);
  }

  async checkIpLimit(ip) {
    if (!ip || ip === 'unknown') return { allowed: true };

    const now = Date.now();
    this._sweep(now);
    let entry = this.ipHistory.get(ip);

    if (!entry || now > entry.resetAt) {
      this._ensureCapacity(this.ipHistory);
      entry = { count: 1, resetAt: now + 60 * 60 * 1000 };
      this.ipHistory.set(ip, entry);
      return { allowed: true };
    }

    if (entry.count >= 10) {
      return {
        allowed: false,
        reason: 'IP_RATE_LIMITED',
        error: '当前网络环境请求过于频繁，请稍后再试',
      };
    }

    entry.count += 1;
    this.ipHistory.set(ip, entry);
    return { allowed: true };
  }

  async canAttempt(phone) {
    const now = Date.now();
    this._sweep(now);
    const entry = this.attemptHistory.get(phone);

    if (entry && entry.lockedUntil && now < entry.lockedUntil) {
      const waitMinutes = Math.ceil((entry.lockedUntil - now) / (60 * 1000));
      return {
        allowed: false,
        reason: 'ACCOUNT_LOCKED',
        waitMinutes,
        error: `登录尝试失败次数过多，账号已临时锁定，请 ${waitMinutes} 分钟后再试`,
      };
    }

    return { allowed: true };
  }

  async recordAttempt(phone, success) {
    const now = Date.now();
    this._sweep(now);

    if (success) {
      this.attemptHistory.delete(phone);
      return;
    }

    this._ensureCapacity(this.attemptHistory);
    let entry = this.attemptHistory.get(phone);

    if (!entry) {
      entry = { failedAttempts: 1, lockedUntil: null, updatedAt: now };
    } else {
      entry.failedAttempts += 1;
      entry.updatedAt = now;
      if (entry.failedAttempts >= 5) {
        entry.lockedUntil = now + 15 * 60 * 1000; // 锁定 15 分钟
        entry.failedAttempts = 0; // 重置计数
      }
    }

    this.attemptHistory.set(phone, entry);
  }

  clear() {
    this.sendHistory.clear();
    this.ipHistory.clear();
    this.attemptHistory.clear();
  }
}

let _activeRateLimiter = new MemoryRateLimiter();

/**
 * 设置当前全局生效的限流器 (支持注入 RedisRateLimiter)
 * @param {import('./rate-limiter.interface.js').BaseRateLimiter} limiter
 */
export function setRateLimiter(limiter) {
  _activeRateLimiter = limiter;
}

/**
 * 获取当前全局生效的限流器实例
 * @returns {import('./rate-limiter.interface.js').BaseRateLimiter}
 */
export function getRateLimiter() {
  return _activeRateLimiter;
}

/**
 * 统一代理对象：透明转发至当前激活的限流器实例
 */
export const rateLimiter = {
  canSend: (...args) => _activeRateLimiter.canSend(...args),
  recordSend: (...args) => _activeRateLimiter.recordSend(...args),
  checkIpLimit: (...args) => _activeRateLimiter.checkIpLimit(...args),
  canAttempt: (...args) => _activeRateLimiter.canAttempt(...args),
  recordAttempt: (...args) => _activeRateLimiter.recordAttempt(...args),
  clear: (...args) => _activeRateLimiter.clear(...args),
};
