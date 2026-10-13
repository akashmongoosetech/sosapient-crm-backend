const ApiError = require('../utils/ApiError');

function authorizeRoles(...allowed) {
  return (req, _res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    // Always trust DB role, never client-supplied values.
    if (!allowed.includes(req.user.role)) return next(ApiError.forbidden('Admin access required'));
    return next();
  };
}

function requireActiveUser(req, _res, next) {
  if (!req.user) return next(ApiError.unauthorized());
  if (!req.user.isActive) return next(ApiError.unauthorized('Account is disabled'));
  return next();
}

module.exports = { authorizeRoles, requireActiveUser };
