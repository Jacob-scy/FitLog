import { z } from 'zod';

// 仅开发环境放行 admin@admin 测试账号（生产环境必须通过 email 格式校验，否则 400）
const isDevAdminBypass = (v) =>
  process.env.NODE_ENV !== 'production' && v === 'admin@admin';

export const sendCodeSchema = z.object({
  email: z.string().refine(
    (v) => isDevAdminBypass(v) || z.string().email().safeParse(v).success,
    'Invalid email address'
  ),
});

export const loginSchema = z.object({
  email: z.string().refine(
    (v) => isDevAdminBypass(v) || z.string().email().safeParse(v).success,
    'Invalid email address'
  ),
  code: z.string().length(6, 'Verification code must be 6 digits'),
});

export const sendPhoneCodeSchema = z.object({
  phone: z.string().min(1, 'Phone is required'),
});

export const phoneLoginSchema = z.object({
  phone: z.string().min(1, 'Phone is required'),
  code: z.string().length(6, 'Verification code must be 6 digits'),
});

const COMMON_WEAK_PASSWORDS = new Set([
  '12345678',
  '87654321',
  'password',
  'password123',
  'admin123',
  'fitlog123',
  'qwerty123',
  '11111111',
  '00000000',
]);

export const registerSchema = z.object({
  phone: z.string().min(1, '手机号不能为空'),
  password: z
    .string()
    .min(8, '密码长度至少为 8 位')
    .max(100, '密码过长')
    .regex(/^(?=.*[a-zA-Z])(?=.*\d)/, '密码必须同时包含字母和数字'),
  confirmPassword: z.string().min(1, '确认密码不能为空'),
}).refine((data) => data.password === data.confirmPassword, {
  message: '两次输入的密码不一致',
  path: ['confirmPassword'],
}).refine((data) => !COMMON_WEAK_PASSWORDS.has(data.password.toLowerCase()), {
  message: '密码过于简单，请使用更复杂的密码组合',
  path: ['password'],
}).refine((data) => {
  const cleanPhone = data.phone.replace(/\D/g, '');
  if (cleanPhone.length >= 8 && data.password.includes(cleanPhone)) {
    return false;
  }
  if (cleanPhone.length >= 4) {
    const last4 = cleanPhone.slice(-4);
    if (data.password === last4 || data.password.includes(last4)) {
      return false;
    }
  }
  return true;
}, {
  message: '密码不得包含手机号码或手机号后四位',
  path: ['password'],
});

export const phonePasswordLoginSchema = z.object({
  phone: z.string().min(1, '手机号不能为空'),
  password: z.string().min(1, '密码不能为空'),
});
