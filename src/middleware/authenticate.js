const { verifyAccessToken } = require('../utils/token');
const { User } = require('../models/User');
const ApiError = require('../utils/ApiError');

async function authenticate(req, _res, next) {
  try {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) throw ApiError.unauthorized();
    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch {
      throw ApiError.unauthorized();
    }
    const user = await User.findById(payload.sub);
    if (!user || !user.isActive) throw ApiError.unauthorized(user && !user.isActive ? 'Account is disabled' : undefined);
    req.user = user;
    req.authRole = payload.role;
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = authenticate;
