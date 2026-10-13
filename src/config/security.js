const helmet = require('helmet');
const cors = require('cors');
const mongoSanitize = require('express-mongo-sanitize');
const env = require('./env');

function allowedOrigins() {
  return (env.FRONTEND_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
}

function applySecurity(app) {
  app.set('trust proxy', 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-origin' } }));
  app.use(cors({
    origin(origin, cb) {
      const allow = allowedOrigins();
      if (!origin) return cb(null, true); // non-browser / tests
      if (allow.includes(origin)) return cb(null, true);
      return cb(new Error('CORS origin not allowed'));
    },
    credentials: true,
  }));
  app.use(mongoSanitize());
}

function cookieOptions(rememberMe) {
  const maxAge = rememberMe ? env.REFRESH_TOKEN_TTL_MS : 24 * 60 * 60 * 1000; // session-ish default 1d
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAME_SITE,
    domain: env.COOKIE_DOMAIN,
    path: env.COOKIE_PATH,
    maxAge,
  };
}

module.exports = { applySecurity, allowedOrigins, cookieOptions };
