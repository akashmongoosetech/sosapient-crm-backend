class ApiError extends Error {
  constructor(statusCode, message, errors = []) {
    super(message);
    this.statusCode = statusCode;
    this.errors = errors;
  }
  static badRequest(msg = 'Invalid request', errors = []) { return new ApiError(400, msg, errors); }
  static unauthorized(msg = 'Authentication required') { return new ApiError(401, msg); }
  static forbidden(msg = 'You do not have permission') { return new ApiError(403, msg); }
  static conflict(msg = 'Resource conflict', errors = []) { return new ApiError(409, msg, errors); }
  static unprocessable(msg = 'Validation failed', errors = []) { return new ApiError(422, msg, errors); }
}

module.exports = ApiError;
