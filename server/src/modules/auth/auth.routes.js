import { Router } from 'express';
import * as ctrl from './auth.controller.js';
import validate from '../../middleware/validate.js';
import {
  sendCodeSchema,
  loginSchema,
  sendPhoneCodeSchema,
  phoneLoginSchema,
  registerSchema,
  phonePasswordLoginSchema,
} from './auth.validator.js';
import auth from '../../middleware/auth.js';

import { rateLimiter } from '../../lib/rate-limit/memory-rate-limiter.js';
import {
  loginRateLimiter,
  registerRateLimiter,
  resetRequestRateLimiters,
} from '../../middleware/rateLimiter.js';

const router = Router();

// --- FITLOG AUTH V2: 手机号 + 密码全新主认证流程 ---
// 限流器置于 validate 之前：非法报文同样计入配额，避免绕过校验的低成本刷量
router.post('/register', registerRateLimiter, validate(registerSchema), ctrl.register);
router.post('/phone-password/login', loginRateLimiter, validate(phonePasswordLoginSchema), ctrl.phonePasswordLogin);

// --- 既有 Email 登录路由 (次级备用兼容) ---
router.post('/send-code', validate(sendCodeSchema), ctrl.sendCode);
router.post('/login', loginRateLimiter, validate(loginSchema), ctrl.login);
router.post('/refresh', ctrl.refresh);
router.post('/logout', auth, ctrl.logout);

// --- 兼容旧短信路由 ---
router.post('/phone/send-code', validate(sendPhoneCodeSchema), ctrl.sendPhoneCode);
router.post('/phone/login', loginRateLimiter, validate(phoneLoginSchema), ctrl.phoneLogin);

// --- 自动化测试专用清理端点 (生产环境严格禁用) ---
if (process.env.NODE_ENV !== 'production') {
  router.post('/test/clear-rate-limit', (_req, res) => {
    rateLimiter.clear();
    resetRequestRateLimiters();
    res.json({ ok: true });
  });
}

export default router;
