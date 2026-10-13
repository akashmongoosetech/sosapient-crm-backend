const authService = require('../services/auth.service');
const { setRefreshCookie, clearRefreshCookie, getRefreshCookie } = require('../utils/cookies');
const ApiError = require('../utils/ApiError');

function ua(req) {
  return req.headers['user-agent'] || '';
}

async function register(req, res, next) {
  try {
    // confirmPassword/acceptTerms already validated; never persisted (allowlist in service).
    const user = await authService.register(req.body);
    const { accessToken, refreshToken } = await authService.createSession(user, { userAgent: ua(req), rememberMe: false });
    setRefreshCookie(res, refreshToken, false);
    res.status(201).json({ success: true, message: 'Account created successfully', data: { user: user.toSafeJSON(), accessToken } });
  } catch (err) {
    next(err);
  }
}

async function login(req, res, next) {
  try {
    const { identifier, password, rememberMe } = req.body;
    const user = await authService.login({ identifier, userAgent: ua(req) });
    await authService.verifyPassword(user, password);
    const { accessToken, refreshToken } = await authService.createSession(user, { userAgent: ua(req), rememberMe });
    setRefreshCookie(res, refreshToken, rememberMe);
    res.json({ success: true, message: 'Signed in successfully', data: { user: user.toSafeJSON(), accessToken } });
  } catch (err) {
    next(err);
  }
}

async function refresh(req, res, next) {
  try {
    const raw = getRefreshCookie(req);
    const { user, accessToken, refreshToken } = await authService.rotateSession(raw);
    // Preserve rememberMe duration via session record; cookie maxAge refreshed generically.
    setRefreshCookie(res, refreshToken, true);
    res.json({ success: true, message: 'Session refreshed', data: { user: user.toSafeJSON(), accessToken } });
  } catch (err) {
    clearRefreshCookie(res);
    next(err);
  }
}

async function logout(req, res, next) {
  try {
    await authService.revokeSession(getRefreshCookie(req));
    clearRefreshCookie(res);
    res.json({ success: true, message: 'Signed out successfully', data: {} });
  } catch (err) {
    next(err);
  }
}

async function logoutAll(req, res, next) {
  try {
    await authService.revokeSession(getRefreshCookie(req));
    if (req.user) await authService.revokeAllForUser(req.user._id);
    clearRefreshCookie(res);
    res.json({ success: true, message: 'Signed out of all sessions', data: {} });
  } catch (err) {
    next(err);
  }
}

async function me(req, res, next) {
  try {
    if (!req.user) throw ApiError.unauthorized();
    res.json({ success: true, message: 'Current user', data: { user: req.user.toSafeJSON() } });
  } catch (err) {
    next(err);
  }
}

module.exports = { register, login, refresh, logout, logoutAll, me };
