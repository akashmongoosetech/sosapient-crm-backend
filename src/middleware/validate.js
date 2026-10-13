const validate = (schema) => (req, _res, next) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    const errors = result.error.issues.map((i) => ({ field: i.path.join('.') || 'body', message: i.message }));
    return next(Object.assign(new Error('Validation failed'), { statusCode: 422, errors }));
  }
  req.body = result.data;
  return next();
};

module.exports = validate;
