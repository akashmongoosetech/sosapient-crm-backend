const env = require('../config/env');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, _req, res, _next) {
  const status = err.statusCode || 500;
  const errors = err.errors || [];
  const payload = {
    success: false,
    message:
      status < 500 ? (err.message || 'Request failed')
      : env.NODE_ENV === 'production' ? 'The request could not be completed'
      : (err.message || 'Internal error'),
    errors,
    ...(typeof err.retryAfter === 'number' ? { retryAfter: err.retryAfter } : {}),
  };
  if (env.NODE_ENV !== 'production' && status >= 500 && err.stack) {
    payload.stack = String(err.stack).split('\n').slice(0, 5);
  }
  // Never leak stacks/secrets in production.
  res.status(status).json(payload);
}

module.exports = errorHandler;
