require('dotenv').config();

function required(name) {
  const v = process.env[name];
  if (!v) {
    // Test-safe defaults: jest imports app before setup.js sets env.
    if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) {
      if (name === 'MONGODB_URI') return 'mongodb://127.0.0.1:27017/crm-test';
      if (name === 'JWT_ACCESS_SECRET') return 'test-access-secret-min-32-chars-123456';
    }
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '5000', 10),
  MONGODB_URI: required('MONGODB_URI'),
  FRONTEND_ORIGIN: process.env.FRONTEND_ORIGIN || 'http://localhost:5173',
  JWT_ACCESS_SECRET: required('JWT_ACCESS_SECRET'),
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || process.env.JWT_ACCESS_SECRET,
  JWT_ISSUER: process.env.JWT_ISSUER || 'crm-api',
  JWT_AUDIENCE: process.env.JWT_AUDIENCE || 'crm-client',
  ACCESS_TOKEN_TTL: process.env.ACCESS_TOKEN_TTL || '10m',
  REFRESH_TOKEN_TTL: process.env.REFRESH_TOKEN_TTL || '7d',
  REFRESH_TOKEN_TTL_MS: parseInt(process.env.REFRESH_TOKEN_TTL_MS || '604800000', 10),
  COOKIE_NAME: process.env.COOKIE_NAME || 'crm_refresh',
  COOKIE_SECURE: process.env.COOKIE_SECURE === 'true',
  COOKIE_SAME_SITE: (process.env.COOKIE_SAME_SITE || 'lax').toLowerCase(),
  COOKIE_DOMAIN: process.env.COOKIE_DOMAIN || undefined,
  COOKIE_PATH: process.env.COOKIE_PATH || '/',
  ADMIN_BOOTSTRAP_SECRET: process.env.ADMIN_BOOTSTRAP_SECRET || '',
  // --- Password-reset via email OTP (Brevo) ---
  BREVO_API_KEY: process.env.BREVO_API_KEY || '',
  EMAIL_FROM: process.env.EMAIL_FROM || 'info@akashraikwar.in',
  EMAIL_FROM_NAME: process.env.EMAIL_FROM_NAME || 'Sosapient CRM',
  APP_BASE_URL: process.env.APP_BASE_URL || 'http://localhost:5173',
  OTP_EXPIRY_MINUTES: parseInt(process.env.OTP_EXPIRY_MINUTES || '10', 10),
  OTP_RESEND_COOLDOWN_SECONDS: parseInt(process.env.OTP_RESEND_COOLDOWN_SECONDS || '60', 10),
  OTP_MAX_ATTEMPTS: parseInt(process.env.OTP_MAX_ATTEMPTS || '5', 10),
  RESET_TOKEN_TTL: process.env.RESET_TOKEN_TTL || '5m',
  // Local-only escape hatch for testing without Brevo credentials.
  // NEVER enable in production: it returns the OTP in the API response.
  MAIL_DEV_VISIBLE: process.env.MAIL_DEV_VISIBLE === 'true',
  FILE_TOKEN_TTL: process.env.FILE_TOKEN_TTL || '12h',
  UPLOAD_DIR: process.env.UPLOAD_DIR || 'uploads',
  MAX_UPLOAD_MB: parseInt(process.env.MAX_UPLOAD_MB || '5', 10),
  MAX_FILES_PER_ENTRY: parseInt(process.env.MAX_FILES_PER_ENTRY || '6', 10),
};

if (env.JWT_ACCESS_SECRET.length < 32) {
  throw new Error('JWT_ACCESS_SECRET must be at least 32 characters');
}
if (!['lax', 'strict', 'none'].includes(env.COOKIE_SAME_SITE)) {
  throw new Error('COOKIE_SAME_SITE must be lax, strict, or none');
}
if (env.NODE_ENV === 'production' && env.MAIL_DEV_VISIBLE) {
  throw new Error('MAIL_DEV_VISIBLE must never be enabled in production — it exposes password-reset OTPs.');
}
if (env.NODE_ENV === 'production' && !env.COOKIE_SECURE) {
  // Fail-safe: warn loudly; operator must set COOKIE_SECURE=true behind HTTPS.
  // eslint-disable-next-line no-console
  console.warn('[security] COOKIE_SECURE=false in production — refresh cookie will not have Secure flag. Set COOKIE_SECURE=true.');
}

module.exports = env;
