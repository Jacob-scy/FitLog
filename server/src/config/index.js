import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

const nodeEnv = process.env.NODE_ENV || 'development';

// 生产环境安全凭据 Fail-Fast 校验 (仅在 production 模式生效，不干扰 dev/test)
if (nodeEnv === 'production') {
  const weakOrPlaceholderSecrets = new Set([
    'dev-access-secret',
    'dev-refresh-secret',
    'default_jwt_access_secret_for_dev_only_change_in_prod',
    'default_jwt_refresh_secret_for_dev_only_change_in_prod',
    'replace_with_a_very_long_secure_random_string_32_chars_min',
    'replace_with_another_very_long_secure_random_string_32_chars',
    'secret',
    '123456',
    'password',
  ]);

  const missingOrInvalid = [];

  if (!process.env.DATABASE_URL || process.env.DATABASE_URL.trim() === '') {
    missingOrInvalid.push('DATABASE_URL is missing or empty');
  }

  if (!process.env.REDIS_URL || process.env.REDIS_URL.trim() === '') {
    missingOrInvalid.push('REDIS_URL is missing or empty');
  }

  const accessSecret = process.env.JWT_ACCESS_SECRET;
  if (!accessSecret || weakOrPlaceholderSecrets.has(accessSecret) || accessSecret.length < 32) {
    missingOrInvalid.push('JWT_ACCESS_SECRET is missing, too short (<32 chars), or using insecure default/placeholder');
  }

  const refreshSecret = process.env.JWT_REFRESH_SECRET;
  if (!refreshSecret || weakOrPlaceholderSecrets.has(refreshSecret) || refreshSecret.length < 32) {
    missingOrInvalid.push('JWT_REFRESH_SECRET is missing, too short (<32 chars), or using insecure default/placeholder');
  }

  if (missingOrInvalid.length > 0) {
    console.error('\n======================================================');
    console.error('[FATAL CONFIG ERROR] Production environment validation failed:');
    missingOrInvalid.forEach(err => console.error(`  - ${err}`));
    console.error('======================================================\n');
    throw new Error(`Production startup aborted due to configuration errors: ${missingOrInvalid.join('; ')}`);
  }
}

const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv,
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET || 'dev-access-secret',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret',
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  },
  emailMode: process.env.EMAIL_MODE || 'dev',
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '465', 10),
    secure: process.env.SMTP_SECURE === 'true' || process.env.SMTP_PORT === '465',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || process.env.SMTP_USER || 'FitLog <noreply@fitlog.com>',
  },
};

export default config;
