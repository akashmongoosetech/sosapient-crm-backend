const rateLimit = require('express-rate-limit');

// Strict for login/register: brute-force / credential-stuffing mitigation.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many attempts. Please try again later.', errors: [] },
});

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

// OTP endpoints: limited per IP *and* per normalized email identifier so one
// actor cannot rotate emails to dodge the cap, nor hammer a single address
// from many IPs beyond the shared per-email budget.
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const email = req.body && typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    return `${req.ip}:${email}`;
  },
  message: { success: false, message: 'Too many attempts. Please try again later.', errors: [] },
});

module.exports = { authLimiter, generalLimiter, otpLimiter };
