const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const FileType = require('file-type');
const sanitizeHtml = require('sanitize-html');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');

// Allowed image formats. Extension and browser MIME are hints only —
// the actual byte signature (magic bytes) is authoritative.
const ALLOWED = {
  jpg: ['image/jpeg'],
  jpeg: ['image/jpeg'],
  png: ['image/png'],
  webp: ['image/webp'],
  svg: ['image/svg+xml'],
};

function uploadRoot() {
  const dir = path.isAbsolute(env.UPLOAD_DIR)
    ? env.UPLOAD_DIR
    : path.join(__dirname, '..', '..', env.UPLOAD_DIR);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function safeDealDir(dealId) {
  const id = String(dealId).replace(/[^a-fA-F0-9]/g, '');
  if (!/^[a-fA-F0-9]{24}$/.test(id)) throw ApiError.badRequest('Invalid deal id');
  const dir = path.join(uploadRoot(), id);
  const resolved = path.resolve(dir);
  if (!resolved.startsWith(`${path.resolve(uploadRoot())}${path.sep}`)) {
    throw ApiError.badRequest('Invalid storage path');
  }
  fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}

function extOf(filename) {
  return String(filename || '').split('.').pop().toLowerCase();
}

async function detectKind(buffer) {
  return FileType.fromBuffer(buffer); // undefined when unrecognized
}

function sanitizeSvgContent(text) {
  return sanitizeHtml(text, {
    allowedTags: ['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'defs', 'use', 'clipPath', 'mask', 'linearGradient', 'radialGradient', 'stop', 'pattern', 'image', 'title', 'desc'],
    allowedAttributes: {
      '*': ['fill', 'stroke', 'stroke-width', 'opacity', 'transform', 'd', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'viewBox', 'points', 'offset', 'stop-color', 'stop-opacity', 'font-size', 'font-family', 'text-anchor', 'clip-path', 'mask', 'gradientUnits', 'gradientTransform', 'xlink:href', 'href', 'preserveAspectRatio'],
    },
    allowedSchemes: ['data'],
    allowVulnerableTags: false,
    // No script/style/event-handler tags or attributes survive: they are not allowlisted.
  });
}

/**
 * Validate + persist one uploaded file. Returns attachment metadata.
 * Throws ApiError(422/413) on any validation failure — nothing is written then.
 */
async function storeFile(dealId, file) {
  const maxBytes = env.MAX_UPLOAD_MB * 1024 * 1024;
  if (!file || !file.buffer || file.buffer.length === 0) {
    throw ApiError.unprocessable('Empty file upload', [{ field: 'attachments', message: 'One of the files is empty' }]);
  }
  if (file.buffer.length > maxBytes) {
    throw ApiError.unprocessable(`File exceeds the ${env.MAX_UPLOAD_MB}MB limit`, [{ field: 'attachments', message: `${file.originalname}: too large` }]);
  }
  const ext = extOf(file.originalname);
  if (!ALLOWED[ext]) {
    throw ApiError.unprocessable('Unsupported file format', [{ field: 'attachments', message: `${file.originalname}: allowed formats are JPG, PNG, WEBP, SVG` }]);
  }

  let buffer = file.buffer;
  let mime = ALLOWED[ext][0];

  if (ext === 'svg') {
    // SVG has no reliable magic bytes: verify XML shape, then sanitize.
    const text = buffer.toString('utf8');
    if (text.length > maxBytes || !/<svg[\s>]/i.test(text)) {
      throw ApiError.unprocessable('Invalid SVG file', [{ field: 'attachments', message: `${file.originalname}: not a valid SVG document` }]);
    }
    const clean = sanitizeSvgContent(text);
    if (!/<svg[\s>]/i.test(clean)) {
      throw ApiError.unprocessable('SVG rejected by sanitizer', [{ field: 'attachments', message: `${file.originalname}: unsafe or corrupt SVG content` }]);
    }
    buffer = Buffer.from(clean, 'utf8');
  } else {
    const detected = await detectKind(buffer);
    if (!detected || detected.ext !== ext || !ALLOWED[ext].includes(detected.mime)) {
      throw ApiError.unprocessable('File content does not match its extension', [{ field: 'attachments', message: `${file.originalname}: content rejected` }]);
    }
    mime = detected.mime;
  }

  const storedName = `${crypto.randomUUID()}.${ext}`;
  await fs.promises.writeFile(path.join(safeDealDir(dealId), storedName), buffer);
  return {
    filename: path.basename(String(file.originalname)).slice(0, 200),
    storedName,
    mime,
    size: buffer.length,
    url: `/api/files/${String(dealId)}/${storedName}`,
  };
}

async function removeStoredFile(dealId, storedName) {
  const safe = path.basename(String(storedName || ''));
  if (!safe || safe !== storedName) return; // refuse traversal attempts silently
  try {
    await fs.promises.unlink(path.join(safeDealDir(dealId), safe));
  } catch (err) {
    if (err && err.code !== 'ENOENT') throw err;
  }
}

module.exports = { storeFile, removeStoredFile, ALLOWED, uploadRoot };
