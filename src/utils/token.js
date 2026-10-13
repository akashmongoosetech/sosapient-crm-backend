const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const env = require('../config/env');

function signAccessToken(user) {
  return jwt.sign(
    { sub: String(user._id), role: user.role },
    env.JWT_ACCESS_SECRET,
    {
      expiresIn: env.ACCESS_TOKEN_TTL,
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      algorithm: 'HS256',
    }
  );
}

function verifyAccessToken(token) {
  return jwt.verify(token, env.JWT_ACCESS_SECRET, {
    algorithms: ['HS256'],
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
  });
}

function newRefreshToken() {
  return crypto.randomBytes(48).toString('hex'); // 96 hex chars
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Short-lived signed tokens appended to file URLs (?token=...) so plain
// <img> tags — which cannot send the in-memory Bearer token — can load
// attachments. Scoped to one deal; verified on every file request.
function signFileToken(userId, dealId) {
  return jwt.sign(
    { sub: String(userId), deal: String(dealId), purpose: 'file' },
    env.JWT_ACCESS_SECRET,
    {
      expiresIn: env.FILE_TOKEN_TTL,
      issuer: env.JWT_ISSUER,
      audience: 'crm-files',
      algorithm: 'HS256',
    }
  );
}

function verifyFileToken(token) {
  const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, {
    algorithms: ['HS256'],
    issuer: env.JWT_ISSUER,
    audience: 'crm-files',
  });
  if (!payload || payload.purpose !== 'file' || !payload.deal) {
    throw new Error('Invalid file token');
  }
  return payload;
}

// Attach a fresh signed token to an API-relative attachment URL.
function appendFileToken(url, userId, dealId) {
  const sep = String(url).includes('?') ? '&' : '?';
  return `${url}${sep}token=${encodeURIComponent(signFileToken(userId, dealId))}`;
}

module.exports = { signAccessToken, verifyAccessToken, newRefreshToken, hashToken, signFileToken, verifyFileToken, appendFileToken };
