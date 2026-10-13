const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { verifyAccessToken, verifyFileToken } = require('../utils/token');
const { requireActiveUser } = require('../middleware/authorize');
const { User } = require('../models/User');
const { Deal } = require('../models/Deal');
const { uploadRoot } = require('../services/fileStorage.service');
const ApiError = require('../utils/ApiError');

const INLINE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']);

// File auth: prefers the Authorization Bearer header (API clients), falls
// back to the signed ?token= query param (plain <img> tags cannot send
// headers). Query tokens are deal-scoped: a token minted for deal A is
// rejected when used to fetch deal B's files.
async function authenticateFile(req, _res, next) {
  try {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');
    if (scheme === 'Bearer' && token) {
      let payload;
      try {
        payload = verifyAccessToken(token);
      } catch {
        throw ApiError.unauthorized();
      }
      const user = await User.findById(payload.sub);
      if (!user || !user.isActive) throw ApiError.unauthorized();
      req.user = user;
      return next();
    }
    const qtoken = req.query && req.query.token;
    if (typeof qtoken === 'string' && qtoken) {
      let payload;
      try {
        payload = verifyFileToken(qtoken);
      } catch {
        throw ApiError.unauthorized();
      }
      if (payload.deal !== req.params.dealId) throw ApiError.unauthorized();
      const user = await User.findById(payload.sub);
      if (!user || !user.isActive) throw ApiError.unauthorized();
      req.user = user;
      return next();
    }
    throw ApiError.unauthorized();
  } catch (err) {
    next(err);
  }
}
async function serveFile(req, res, next) {
  try {
    const { dealId, name } = req.params;
    if (!mongoose.Types.ObjectId.isValid(dealId)) throw ApiError.badRequest('Invalid deal id');
    const safe = path.basename(String(name || ''));
    if (!safe || safe !== name || safe.includes('..')) throw ApiError.badRequest('Invalid file reference');
    const deal = await Deal.findById(dealId);
    if (!deal) throw new ApiError(404, 'Deal not found');

    const dir = path.resolve(path.join(uploadRoot(), dealId.replace(/[^a-fA-F0-9]/g, '')));
    const root = path.resolve(uploadRoot());
    if (!dir.startsWith(`${root}${path.sep}`)) throw ApiError.badRequest('Invalid file reference');
    const full = path.join(dir, safe);
    if (!path.resolve(full).startsWith(`${dir}${path.sep}`)) throw ApiError.badRequest('Invalid file reference');
    if (!fs.existsSync(full)) throw new ApiError(404, 'File not found');

    const ext = safe.split('.').pop().toLowerCase();
    const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    if (!INLINE_MIME.has(mime)) throw new ApiError(404, 'File not found');
    res.setHeader('Content-Type', mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Override Helmet's global `same-origin` policy: the SPA is served from
    // a different origin (e.g. :5173 vs :5000), and browsers refuse to render
    // cross-origin <img> responses carrying `same-origin`. Access stays gated
    // by Bearer-or-signed-token auth above, so `cross-origin` is safe here.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    // Sandboxed: even a missed SVG payload cannot execute script in this context.
    if (mime === 'image/svg+xml') res.setHeader('Content-Security-Policy', 'sandbox');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.sendFile(full);
  } catch (err) {
    next(err);
  }
}

function fileRoutes(app) {
  app.get('/api/files/:dealId/:name', authenticateFile, requireActiveUser, serveFile);
}

module.exports = { fileRoutes, serveFile };
