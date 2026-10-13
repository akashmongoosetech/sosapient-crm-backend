const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { User, normalizeEmail } = require('../models/User');
const PasswordReset = require('../models/PasswordReset');
const { hashToken } = require('../utils/token');
const { revokeAllForUser } = require('./auth.service');
const { sendResetOtp } = require('./email.service');
const ApiError = require('../utils/ApiError');
const env = require('../config/env');

const GENERIC_RESPONSE = 'If an eligible account exists for this email address, you will receive a password reset code shortly.';
const ELIGIBLE_ROLES = ['admin', 'manager'];

function newOtp() {
  return String(crypto.randomInt(100000, 1000000));
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

async function eligibleUser(email) {
  const user = await User.findOne({ email: normalizeEmail(email) });
  if (!user || !user.isActive || !ELIGIBLE_ROLES.includes(user.role)) return null;
  return user;
}

async function supersedePending(userId) {
  await PasswordReset.updateMany(
    { userId, status: 'pending' },
    { $set: { status: 'superseded' } }
  );
}

function displayName(user) {
  return `${user.firstName} ${user.lastName}`.trim() || user.email;
}

async function issueChallenge(user) {
  await supersedePending(user._id);
  const otp = newOtp();
  const doc = await PasswordReset.create({
    userId: user._id,
    email: user.email,
    otpHash: hashToken(otp),
    status: 'pending',
    attempts: 0,
    maxAttempts: env.OTP_MAX_ATTEMPTS,
    otpExpiresAt: new Date(Date.now() + env.OTP_EXPIRY_MINUTES * 60 * 1000),
  });
  try {
    await sendResetOtp({ toEmail: user.email, toName: displayName(user), otp });
  } catch (err) {
    // Never leave a challenge the user can't complete; never leak the OTP.
    await PasswordReset.deleteOne({ _id: doc._id });
    throw err;
  }
  return { doc, otp };
}

function devPayload(otp) {
  // Local-only escape hatch (env-guarded, boot-forbidden in production).
  return env.MAIL_DEV_VISIBLE ? { devOtp: otp } : {};
}

async function requestReset(rawEmail) {
  const email = normalizeEmail(rawEmail);
  const user = await eligibleUser(email);
  if (!user) return { message: GENERIC_RESPONSE };
  const { otp } = await issueChallenge(user);
  return { message: GENERIC_RESPONSE, ...devPayload(otp) };
}

async function latestPending(email) {
  return PasswordReset.findOne({ email: normalizeEmail(email), status: 'pending' })
    .sort({ createdAt: -1 })
    .select('+otpHash');
}

async function verifyOtp(rawEmail, otp) {
  const email = normalizeEmail(rawEmail);
  const challenge = await latestPending(email);
  if (!challenge) {
    throw ApiError.badRequest('Invalid or expired code');
  }
  if (challenge.otpExpiresAt < new Date()) {
    challenge.status = 'consumed';
    await challenge.save();
    const err = new Error('This code has expired — request a new one');
    err.statusCode = 410;
    throw err;
  }
  if (challenge.attempts >= challenge.maxAttempts) {
    const err = new Error('Too many incorrect attempts — request a new code');
    err.statusCode = 429;
    throw err;
  }
  challenge.attempts += 1;
  await challenge.save();
  if (!safeEqual(hashToken(otp), challenge.otpHash)) {
    throw ApiError.badRequest('Incorrect code — please try again');
  }
  // Atomic single-use transition: concurrent verifies race here, one wins.
  const claimed = await PasswordReset.findOneAndUpdate(
    { _id: challenge._id, status: 'pending' },
    {
      $set: {
        status: 'verified',
        resetExpiresAt: new Date(Date.now() + parseTtlMs(env.RESET_TOKEN_TTL)),
      },
    },
    { new: true }
  );
  if (!claimed) {
    throw ApiError.badRequest('This code has already been used');
  }
  const resetToken = jwt.sign(
    { sub: String(claimed.userId), purpose: 'password-reset' },
    env.JWT_ACCESS_SECRET,
    { expiresIn: env.RESET_TOKEN_TTL, issuer: env.JWT_ISSUER, audience: 'crm-password-reset', algorithm: 'HS256' }
  );
  claimed.resetTokenHash = hashToken(resetToken);
  await claimed.save();
  return { resetToken, expiresInSeconds: Math.floor(parseTtlMs(env.RESET_TOKEN_TTL) / 1000) };
}

function parseTtlMs(ttl) {
  const m = String(ttl).trim().match(/^(\d+)\s*([smh])?$/i);
  if (!m) return 5 * 60 * 1000;
  const n = parseInt(m[1], 10);
  const unit = (m[2] || 's').toLowerCase();
  return unit === 'h' ? n * 3600000 : unit === 'm' ? n * 60000 : n * 1000;
}

async function resendOtp(rawEmail) {
  const email = normalizeEmail(rawEmail);
  const last = await PasswordReset.findOne({ email }).sort({ createdAt: -1 });
  if (last) {
    const elapsed = (Date.now() - new Date(last.createdAt).getTime()) / 1000;
    const remaining = Math.ceil(env.OTP_RESEND_COOLDOWN_SECONDS - elapsed);
    if (remaining > 0) {
      const err = new Error(`Please wait ${remaining} seconds before requesting a new code`);
      err.statusCode = 429;
      err.retryAfter = remaining;
      throw err;
    }
  }
  const user = await eligibleUser(email);
  if (!user) return { message: GENERIC_RESPONSE };
  const { otp } = await issueChallenge(user);
  return { message: GENERIC_RESPONSE, ...devPayload(otp) };
}

async function resetPassword(resetToken, newPassword) {
  let payload;
  try {
    payload = jwt.verify(resetToken, env.JWT_ACCESS_SECRET, {
      algorithms: ['HS256'],
      issuer: env.JWT_ISSUER,
      audience: 'crm-password-reset',
    });
  } catch {
    throw ApiError.badRequest('Reset session expired — request a new code');
  }
  if (!payload || payload.purpose !== 'password-reset' || !payload.sub) {
    throw ApiError.badRequest('Reset session expired — request a new code');
  }
  // Atomic single-use consumption: concurrent resets race here, one wins.
  const challenge = await PasswordReset.findOneAndUpdate(
    { userId: payload.sub, resetTokenHash: hashToken(resetToken), status: 'verified' },
    { $set: { status: 'consumed' } },
    { new: true }
  );
  if (!challenge) {
    throw ApiError.badRequest('Reset session expired — request a new code');
  }
  if (challenge.resetExpiresAt && challenge.resetExpiresAt < new Date()) {
    const err = new Error('Reset session expired — request a new code');
    err.statusCode = 410;
    throw err;
  }
  const user = await User.findById(payload.sub);
  if (!user || !user.isActive) {
    throw ApiError.badRequest('Reset session expired — request a new code');
  }
  user.passwordHash = await bcrypt.hash(newPassword, 12);
  await user.save();
  // Invalidate all other challenges + every existing session/refresh token.
  await PasswordReset.updateMany(
    { userId: user._id, status: { $in: ['pending', 'verified'] } },
    { $set: { status: 'consumed' } }
  );
  await revokeAllForUser(user._id);
  return user;
}

module.exports = { requestReset, verifyOtp, resendOtp, resetPassword, GENERIC_RESPONSE, parseTtlMs };
