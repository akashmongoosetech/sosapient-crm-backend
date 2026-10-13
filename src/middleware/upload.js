const multer = require('multer');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');

// Memory storage: files are validated (magic bytes, SVG sanitize) before
// anything touches disk. Multer-level checks are a prefilter only.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.MAX_UPLOAD_MB * 1024 * 1024,
    files: env.MAX_FILES_PER_ENTRY,
  },
  fileFilter: (_req, file, cb) => {
    const ok = /\.(jpe?g|png|webp|svg)$/i.test(file.originalname || '');
    if (!ok) return cb(ApiError.unprocessable('Unsupported file format', [{ field: 'attachments', message: `${file.originalname}: allowed formats are JPG, PNG, WEBP, SVG` }]));
    return cb(null, true);
  },
});

module.exports = upload;
