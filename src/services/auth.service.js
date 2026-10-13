const bcrypt = require('bcryptjs');
const { User, normalizeEmail, normalizeMobile } = require('../models/User');
const RefreshSession = require('../models/RefreshSession');
const { signAccessToken, newRefreshToken, hashToken } = require('../utils/token');
const ApiError = require('../utils/ApiError');
const env = require('../config/env');

const GENERIC_AUTH_FAILURE = 'Invalid credentials';

function detectIdentifierKind(raw) {
  const v = String(raw).trim();
  if (v.includes('@')) return 'email';
  if (/^[+]?[\d\s().-]{4,20}$/.test(v)) return 'mobile';
  return 'username';
}

async function findUserByIdentifier(raw) {
  const kind = detectIdentifierKind(raw);
  try {
    if (kind === 'email') return await User.findOne({ email: normalizeEmail(raw) }).select('+passwordHash');
    if (kind === 'mobile') {
      try {
        return await User.findOne({ mobileNumber: normalizeMobile(raw) }).select('+passwordHash');
      } catch {
        return null;
      }
    }
    return await User.findOne({ username: String(raw).trim().toLowerCase() }).select('+passwordHash');
  } catch {
    return null;
  }
}

function dupErrorToApiError(err) {
  if (err && err.code === 11000) {
    const fields = Object.keys(err.keyPattern || err.keyValue || {});
    const errors = fields.map((f) => ({ field: f, message: `${f} is already registered` }));
    return ApiError.conflict('An account with these details already exists', errors.length ? errors : [{ field: 'account', message: 'Duplicate identifier' }]);
  }
  return err;
}

async function register(data) {
  const email = normalizeEmail(data.email);
  let mobileNumber;
  try {
    mobileNumber = normalizeMobile(data.mobileNumber);
  } catch {
    throw ApiError.unprocessable('Validation failed', [{ field: 'mobileNumber', message: 'Enter a valid phone number' }]);
  }
  const username = String(data.username).trim().toLowerCase();
  // SECURITY: role forced to manager; isActive/verified flags never from client.
  const passwordHash = await bcrypt.hash(data.password, 12);
  try {
    const user = await User.create({
      firstName: String(data.firstName).trim(),
      lastName: String(data.lastName).trim(),
      email,
      mobileNumber,
      username,
      profilePicUrl: data.profilePicUrl || '',
      passwordHash,
      role: 'manager',
      isActive: true,
    });
    return user;
  } catch (err) {
    throw dupErrorToApiError(err);
  }
}

async function login({ identifier, userAgent }) {
  const user = await findUserByIdentifier(identifier);
  // Generic failure: do not reveal whether identifier exists.
  if (!user) throw new ApiError(401, GENERIC_AUTH_FAILURE);
  if (!user.isActive) throw new ApiError(401, 'Account is disabled');
  return user;
}

async function verifyPassword(user, password) {
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) throw new ApiError(401, GENERIC_AUTH_FAILURE);
}

async function createSession(user, { userAgent, rememberMe }) {
  const raw = newRefreshToken();
  const ttl = rememberMe ? env.REFRESH_TOKEN_TTL_MS : 24 * 60 * 60 * 1000;
  await RefreshSession.create({
    userId: user._id,
    tokenHash: hashToken(raw),
    expiresAt: new Date(Date.now() + ttl),
    userAgent: String(userAgent || '').slice(0, 300),
    rememberMe: Boolean(rememberMe),
  });
  user.lastLoginAt = new Date();
  await user.save();
  return { accessToken: signAccessToken(user), refreshToken: raw };
}

async function rotateSession(rawToken) {
  if (!rawToken) throw ApiError.unauthorized();
  const presented = hashToken(rawToken);
  const session = await RefreshSession.findOne({ tokenHash: presented });
  if (!session || session.revoked || session.expiresAt < new Date()) {
    // Reuse detection: presented token matches a revoked session → compromise → revoke all user sessions.
    const compromised = await RefreshSession.findOne({ tokenHash: presented });
    if (compromised && compromised.revoked) {
      await RefreshSession.updateMany({ userId: compromised.userId }, { $set: { revoked: true, revokedReason: 'reuse-detected' } });
    }
    throw ApiError.unauthorized();
  }
  const user = await User.findById(session.userId);
  if (!user || !user.isActive) {
    session.revoked = true;
    session.revokedReason = 'user-inactive';
    await session.save();
    throw ApiError.unauthorized('Account is disabled');
  }
  // Rotate: revoke old, issue new.
  session.revoked = true;
  session.revokedReason = 'rotated';
  await session.save();
  const raw = newRefreshToken();
  await RefreshSession.create({
    userId: user._id,
    tokenHash: hashToken(raw),
    expiresAt: new Date(Date.now() + (session.rememberMe ? env.REFRESH_TOKEN_TTL_MS : 24 * 60 * 60 * 1000)),
    userAgent: session.userAgent,
    rememberMe: session.rememberMe,
  });
  return { user, accessToken: signAccessToken(user), refreshToken: raw };
}

async function revokeSession(rawToken) {
  if (!rawToken) return;
  await RefreshSession.updateOne({ tokenHash: hashToken(rawToken) }, { $set: { revoked: true, revokedReason: 'logout' } });
}

async function revokeAllForUser(userId) {
  await RefreshSession.updateMany({ userId, revoked: false }, { $set: { revoked: true, revokedReason: 'logout-all' } });
}

module.exports = { register, login, verifyPassword, createSession, rotateSession, revokeSession, revokeAllForUser, detectIdentifierKind, GENERIC_AUTH_FAILURE };
