import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import prisma from '../../lib/prisma.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../lib/jwt.js';
import config from '../../config/index.js';
import { normalizePhone } from '../../lib/phone/normalize.js';
import {
  generateVerificationCode,
  storeVerificationCode,
  consumeVerificationCode,
} from '../../lib/verification/verification-code.service.js';
import { rateLimiter } from '../../lib/rate-limit/memory-rate-limiter.js';
import { getSmsProvider } from '../../lib/sms/index.js';
import { getEmailProvider } from '../../lib/email/index.js';

// --- In-memory verification code store (dev: replaces Redis/email service) ---
const codeStore = new Map(); // email → { code, expiresAt, attempts }

// Rate limit tracking
const emailRateMap = new Map();  // email → { count, resetAt }
const ipRateMap = new Map();     // ip → { count, resetAt }

function checkRateLimit(map, key, max, windowMs) {
  const now = Date.now();
  let entry = map.get(key);
  if (!entry || now > entry.resetAt) {
    entry = { count: 1, resetAt: now + windowMs };
    map.set(key, entry);
    return true;
  }
  if (entry.count >= max) return false;
  entry.count++;
  return true;
}

function generateCode() {
  return crypto.randomInt(100000, 999999).toString();
}

export async function sendVerificationCode(email, clientIp) {
  // Dev-only admin bypass: admin@admin 直接返回成功（不发送验证码），生产环境严格禁用
  if (process.env.NODE_ENV !== 'production' && email === 'admin@admin') {
    return { success: true, mode: 'dev' };
  }

  // Rate limits
  if (!checkRateLimit(emailRateMap, email, 5, 60 * 60 * 1000)) {
    const err = new Error('Too many requests for this email. Try again in 1 hour.');
    err.statusCode = 429;
    err.errorCode = 'EMAIL_RATE_LIMITED';
    throw err;
  }

  if (!checkRateLimit(ipRateMap, clientIp, 10, 60 * 60 * 1000)) {
    const err = new Error('Too many requests from this IP. Try again in 1 hour.');
    err.statusCode = 429;
    err.errorCode = 'IP_RATE_LIMITED';
    throw err;
  }

  const code = generateCode();
  codeStore.set(email, {
    code,
    expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
    attempts: 0,
  });

  const emailProvider = getEmailProvider();
  const sendResult = await emailProvider.sendVerificationEmail(email, code, { clientIp });

  if (!sendResult.success) {
    console.warn(`[FitLog] 邮件发送驱动告警: ${sendResult.error}`);
  }

  return {
    success: true,
    mode: config.emailMode === 'production' ? 'smtp' : 'console',
  };
}

export async function loginWithCode(email, code) {
  // Dev-only admin bypass: admin@admin + 123456 直接签发 token，生产环境严格禁用
  // 生产环境下该组合走入正常验证码流程（无验证码记录 → NO_CODE_FOUND）
  if (process.env.NODE_ENV !== 'production' && email === 'admin@admin' && code === '123456') {
    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      user = await prisma.user.create({ data: { email, nickname: 'Admin' } });
    }
    const tokenPayload = { sub: user.id, email: user.email };
    const accessToken = signAccessToken(tokenPayload);
    const refreshTokenValue = signRefreshToken(tokenPayload);
    const decoded = verifyRefreshToken(refreshTokenValue);
    const expiresAt = new Date(decoded.exp * 1000);
    await prisma.refreshToken.create({
      data: { token: refreshTokenValue, userId: user.id, expiresAt },
    });
    return {
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone || null,
        nickname: user.nickname,
        avatarUrl: user.avatarUrl,
      },
      accessToken,
      refreshToken: refreshTokenValue,
      refreshExpiresAt: expiresAt,
    };
  }

  // 检查账号是否因连续输错被临时锁定
  const attemptCheck = await rateLimiter.canAttempt(email);
  if (!attemptCheck.allowed) {
    const err = new Error(attemptCheck.error || 'Account temporarily locked due to too many failed attempts.');
    err.statusCode = 429;
    err.errorCode = attemptCheck.reason || 'ACCOUNT_LOCKED';
    throw err;
  }

  const stored = codeStore.get(email);

  if (!stored) {
    const err = new Error('No verification code found. Please request a new one.');
    err.statusCode = 400;
    err.errorCode = 'NO_CODE_FOUND';
    throw err;
  }

  if (Date.now() > stored.expiresAt) {
    codeStore.delete(email);
    const err = new Error('Verification code has expired. Please request a new one.');
    err.statusCode = 400;
    err.errorCode = 'CODE_EXPIRED';
    throw err;
  }

  if (stored.code !== code) {
    await rateLimiter.recordAttempt(email, false);
    stored.attempts++;
    if (stored.attempts >= 5) {
      codeStore.delete(email);
      const err = new Error('Too many failed attempts. Please request a new code.');
      err.statusCode = 400;
      err.errorCode = 'MAX_ATTEMPTS';
      throw err;
    }
    const err = new Error('Invalid verification code.');
    err.statusCode = 400;
    err.errorCode = 'INVALID_CODE';
    throw err;
  }

  // 验证通过 — 重置失败计数并清除当次验证码
  await rateLimiter.recordAttempt(email, true);
  codeStore.delete(email);

  // Find or create user (auto-register)
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({ data: { email } });
  }

  // Generate tokens
  const tokenPayload = { sub: user.id, email: user.email, phone: user.phone };
  const accessToken = signAccessToken(tokenPayload);
  const refreshTokenValue = signRefreshToken(tokenPayload);

  // Decode refresh token to get actual expiry
  const decoded = verifyRefreshToken(refreshTokenValue);
  const expiresAt = new Date(decoded.exp * 1000);

  // Store refresh token in DB
  await prisma.refreshToken.create({
    data: {
      token: refreshTokenValue,
      userId: user.id,
      expiresAt,
    },
  });

  return {
    user: {
      id: user.id,
      email: user.email,
      phone: user.phone || null,
      nickname: user.nickname,
      avatarUrl: user.avatarUrl,
    },
    accessToken,
    refreshToken: refreshTokenValue,
    refreshExpiresAt: expiresAt,
  };
}

export async function refreshAccessToken(tokenValue) {
  let payload;
  try {
    payload = verifyRefreshToken(tokenValue);
  } catch (err) {
    const e = new Error('Invalid or expired refresh token.');
    e.statusCode = 401;
    e.errorCode = 'INVALID_REFRESH_TOKEN';
    throw e;
  }

  // Verify token exists in DB and not revoked
  const stored = await prisma.refreshToken.findUnique({ where: { token: tokenValue } });
  if (!stored || stored.revokedAt) {
    // Token revoked — revoke all tokens for safety
    if (stored) {
      await prisma.refreshToken.updateMany({
        where: { userId: stored.userId },
        data: { revokedAt: new Date() },
      });
    }
    const e = new Error('Refresh token has been revoked.');
    e.statusCode = 401;
    e.errorCode = 'TOKEN_REVOKED';
    throw e;
  }

  if (new Date() > stored.expiresAt) {
    const e = new Error('Refresh token has expired.');
    e.statusCode = 401;
    e.errorCode = 'TOKEN_EXPIRED';
    throw e;
  }

  // Revoke old token (rotation)
  await prisma.refreshToken.update({
    where: { id: stored.id },
    data: { revokedAt: new Date() },
  });

  // Issue new tokens
  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, email: true, phone: true, nickname: true, avatarUrl: true },
  });

  const tokenPayload = {
    sub: payload.sub,
    email: user?.email || payload.email,
    phone: user?.phone || payload.phone,
  };
  const newAccessToken = signAccessToken(tokenPayload);
  const newRefreshTokenValue = signRefreshToken(tokenPayload);

  const decoded = verifyRefreshToken(newRefreshTokenValue);
  const expiresAt = new Date(decoded.exp * 1000);

  await prisma.refreshToken.create({
    data: {
      token: newRefreshTokenValue,
      userId: payload.sub,
      expiresAt,
    },
  });

  return {
    user: user || { id: payload.sub, email: payload.email, phone: payload.phone },
    accessToken: newAccessToken,
    refreshToken: newRefreshTokenValue,
    refreshExpiresAt: expiresAt,
  };
}

export async function logout(refreshTokenValue) {
  if (!refreshTokenValue) return;

  const stored = await prisma.refreshToken.findUnique({ where: { token: refreshTokenValue } });
  if (stored && !stored.revokedAt) {
    await prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });
  }
}

/**
 * 发送手机短信验证码
 * @param {string} phone 原始手机号
 * @param {string} clientIp 客户端 IP
 * @returns {Promise<{ success: boolean, message: string, cooldownSec: number, expiresInSec: number }>}
 */
export async function sendPhoneVerificationCode(phone, clientIp) {
  // 1. 中国大陆手机号严格规范化为 +86138xxxxxxxx
  const normalizedPhone = normalizePhone(phone);

  // 2. IP 防刷限流 (单 IP 每小时 10 次)
  const ipCheck = await rateLimiter.checkIpLimit(clientIp);
  if (!ipCheck.allowed) {
    const err = new Error(ipCheck.error || 'Too many requests from this IP.');
    err.statusCode = 429;
    err.errorCode = ipCheck.reason || 'IP_RATE_LIMITED';
    throw err;
  }

  // 3. 手机号限流 (单号 60 秒冷却，24 小时 10 次配额)
  const sendCheck = await rateLimiter.canSend(normalizedPhone);
  if (!sendCheck.allowed) {
    const err = new Error(sendCheck.error || 'Too many SMS requests.');
    err.statusCode = 429;
    err.errorCode = sendCheck.reason || 'RATE_LIMITED';
    err.waitSec = sendCheck.waitSec;
    throw err;
  }

  // 4. 生成 6 位纯数字密码学安全随机码
  const code = generateVerificationCode();

  // 5. 存储验证码 (默认 300 秒)
  await storeVerificationCode(normalizedPhone, code);

  // 6. 调用 SMS Provider 投递
  const provider = getSmsProvider();
  const sendResult = await provider.sendVerificationCode(normalizedPhone, code);
  if (!sendResult.success) {
    const err = new Error(sendResult.error || 'Failed to deliver SMS verification code.');
    err.statusCode = 502;
    err.errorCode = 'SMS_DELIVERY_FAILED';
    throw err;
  }

  // 7. 记录发送状态
  await rateLimiter.recordSend(normalizedPhone);

  // 8. 严格按要求只返回安全元数据，绝不暴露 code, hash, key
  return {
    success: true,
    message: 'Verification code sent.',
    cooldownSec: 60,
    expiresInSec: 300,
  };
}

/**
 * 手机号 + 密码注册 (全新主认证流程)
 * @param {object} param0
 * @param {string} param0.phone 手机号
 * @param {string} param0.password 密码 (至少8位且含字母和数字)
 * @returns {Promise<{ user: object, accessToken: string, refreshToken: string, refreshExpiresAt: Date }>}
 */
export async function registerWithPhonePassword({ phone, password }) {
  // 1. 规范化手机号
  const normalizedPhone = normalizePhone(phone);

  // 2. 检查手机号是否已被占用
  const existingUser = await prisma.user.findUnique({
    where: { phone: normalizedPhone },
  });
  if (existingUser) {
    const err = new Error('该手机号已被注册');
    err.statusCode = 409;
    err.errorCode = 'PHONE_ALREADY_REGISTERED';
    throw err;
  }

  // 3. 安全加盐哈希密码 (bcryptjs)
  const passwordHash = await bcrypt.hash(password, 10);

  // 4. 创建新用户 (phoneVerifiedAt 保持 null，不设默认密码，不使用后四位)
  const user = await prisma.user.create({
    data: {
      phone: normalizedPhone,
      passwordHash,
      phoneVerifiedAt: null,
      nickname: '健身健儿',
      email: null,
    },
  });

  // 5. 签发 Access Token 与 Refresh Token (sub 永远为 user.id)
  const tokenPayload = { sub: user.id, phone: user.phone, email: user.email };
  const accessToken = signAccessToken(tokenPayload);
  const refreshTokenValue = signRefreshToken(tokenPayload);

  const decoded = verifyRefreshToken(refreshTokenValue);
  const expiresAt = new Date(decoded.exp * 1000);

  await prisma.refreshToken.create({
    data: {
      token: refreshTokenValue,
      userId: user.id,
      expiresAt,
    },
  });

  // 6. 返回脱敏后的安全用户信息 (绝不包含 passwordHash)
  return {
    user: {
      id: user.id,
      phone: user.phone,
      email: user.email,
      nickname: user.nickname,
      avatarUrl: user.avatarUrl,
      phoneVerifiedAt: user.phoneVerifiedAt,
    },
    accessToken,
    refreshToken: refreshTokenValue,
    refreshExpiresAt: expiresAt,
  };
}

/**
 * 手机号 + 密码登录 (全新主认证流程)
 * @param {object} param0
 * @param {string} param0.phone 手机号
 * @param {string} param0.password 密码
 * @returns {Promise<{ user: object, accessToken: string, refreshToken: string, refreshExpiresAt: Date }>}
 */
export async function loginWithPhonePassword({ phone, password }) {
  // 1. 规范化手机号
  const normalizedPhone = normalizePhone(phone);

  // 2. 暴力破解防御：检查是否因连续输错被临时锁定 (15分钟)
  const attemptCheck = await rateLimiter.canAttempt(normalizedPhone);
  if (!attemptCheck.allowed) {
    const err = new Error(attemptCheck.error || '登录失败次数过多，账号已临时锁定，请 15 分钟后再试');
    err.statusCode = 429;
    err.errorCode = attemptCheck.reason || 'ACCOUNT_LOCKED';
    throw err;
  }

  // 3. 查询用户
  const user = await prisma.user.findUnique({
    where: { phone: normalizedPhone },
  });

  // 4. 比对密码哈希 (用户不存在或密码不匹配均返回统一报错，防止探测账号存在性)
  const isMatch = user && user.passwordHash ? await bcrypt.compare(password, user.passwordHash) : false;
  if (!isMatch) {
    await rateLimiter.recordAttempt(normalizedPhone, false);
    const err = new Error('手机号或密码错误');
    err.statusCode = 401;
    err.errorCode = 'INVALID_CREDENTIALS';
    throw err;
  }

  // 5. 校验通过，清除失败尝试计数
  await rateLimiter.recordAttempt(normalizedPhone, true);

  // 6. 签发 Access Token 与 Refresh Token (sub 永远为 user.id)
  const tokenPayload = { sub: user.id, phone: user.phone, email: user.email };
  const accessToken = signAccessToken(tokenPayload);
  const refreshTokenValue = signRefreshToken(tokenPayload);

  const decoded = verifyRefreshToken(refreshTokenValue);
  const expiresAt = new Date(decoded.exp * 1000);

  await prisma.refreshToken.create({
    data: {
      token: refreshTokenValue,
      userId: user.id,
      expiresAt,
    },
  });

  // 7. 返回安全用户信息 (绝不包含 passwordHash)
  return {
    user: {
      id: user.id,
      phone: user.phone,
      email: user.email,
      nickname: user.nickname,
      avatarUrl: user.avatarUrl,
      phoneVerifiedAt: user.phoneVerifiedAt,
    },
    accessToken,
    refreshToken: refreshTokenValue,
    refreshExpiresAt: expiresAt,
  };
}

/**
 * 手机号验证码登录 (兼容保留接口，彻底移除后四位与自动创建密码逻辑)
 */
export async function loginWithPhone(phone, code) {
  const normalizedPhone = normalizePhone(phone);

  const attemptCheck = await rateLimiter.canAttempt(normalizedPhone);
  if (!attemptCheck.allowed) {
    const err = new Error(attemptCheck.error || 'Account temporarily locked due to too many failed attempts.');
    err.statusCode = 429;
    err.errorCode = attemptCheck.reason || 'ACCOUNT_LOCKED';
    throw err;
  }

  const verifyResult = await consumeVerificationCode(normalizedPhone, code);
  if (!verifyResult.valid) {
    await rateLimiter.recordAttempt(normalizedPhone, false);
    const err = new Error(verifyResult.error || 'Invalid verification code.');
    err.statusCode = 400;
    err.errorCode = verifyResult.errorCode || 'INVALID_CODE';
    throw err;
  }

  await rateLimiter.recordAttempt(normalizedPhone, true);

  let user = await prisma.user.findUnique({
    where: { phone: normalizedPhone },
  });

  if (!user) {
    user = await prisma.user.create({
      data: {
        phone: normalizedPhone,
        phoneVerifiedAt: null,
        nickname: '健身健儿',
        email: null,
      },
    });
  }

  const tokenPayload = { sub: user.id, phone: user.phone, email: user.email };
  const accessToken = signAccessToken(tokenPayload);
  const refreshTokenValue = signRefreshToken(tokenPayload);

  const decoded = verifyRefreshToken(refreshTokenValue);
  const expiresAt = new Date(decoded.exp * 1000);

  await prisma.refreshToken.create({
    data: {
      token: refreshTokenValue,
      userId: user.id,
      expiresAt,
    },
  });

  return {
    user: {
      id: user.id,
      phone: user.phone,
      email: user.email,
      nickname: user.nickname,
      avatarUrl: user.avatarUrl,
    },
    accessToken,
    refreshToken: refreshTokenValue,
    refreshExpiresAt: expiresAt,
  };
}
