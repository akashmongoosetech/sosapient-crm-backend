// Validates req.query (validate.js targets req.body).
const validateQuery = (schema) => (req, _res, next) => {
  const result = schema.safeParse(req.query);
  if (!result.success) {
    const errors = result.error.issues.map((i) => ({ field: i.path.join('.') || 'query', message: i.message }));
    return next(Object.assign(new Error('Invalid query parameters'), { statusCode: 400, errors }));
  }
  req.query = result.data;
  return next();
};

module.exports = validateQuery;
