const env = require('../config/env');
const { cookieOptions } = require('../config/security');

function setRefreshCookie(res, token, rememberMe) {
  res.cookie(env.COOKIE_NAME, token, cookieOptions(rememberMe));
}

function clearRefreshCookie(res) {
  res.clearCookie(env.COOKIE_NAME, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAME_SITE,
    domain: env.COOKIE_DOMAIN,
    path: env.COOKIE_PATH,
  });
}

function getRefreshCookie(req) {
  return req.cookies ? req.cookies[env.COOKIE_NAME] : undefined;
}

module.exports = { setRefreshCookie, clearRefreshCookie, getRefreshCookie };
