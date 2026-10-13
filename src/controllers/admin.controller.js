const bcrypt = require('bcryptjs');
const { User, normalizeEmail, normalizeMobile } = require('../models/User');
const RefreshSession = require('../models/RefreshSession');
const ApiError = require('../utils/ApiError');

// Audit log: production would persist; here structured console log (no secrets).
function audit(action, actor, target, detail = '') {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ type: 'admin-audit', at: new Date().toISOString(), action, actor: actor ? String(actor._id) : null, target: target ? String(target._id || target) : null, detail }));
}

async function list(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || '20', 10)));
    const filter = {};
    if (req.query.role && ['admin', 'manager'].includes(req.query.role)) filter.role = req.query.role;
    if (req.query.q) {
      const q = String(req.query.q).slice(0, 100);
      filter.$or = [{ email: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }, { username: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }];
    }
    const [items, total] = await Promise.all([
      User.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
      User.countDocuments(filter),
    ]);
    res.json({ success: true, message: 'Users', data: { users: items.map((u) => u.toSafeJSON()), page, limit, total } });
  } catch (err) { next(err); }
}

async function getOne(req, res, next) {
  try {
    const u = await User.findById(req.params.id);
    if (!u) throw new ApiError(404, 'User not found');
    res.json({ success: true, message: 'User', data: { user: u.toSafeJSON() } });
  } catch (err) { next(err); }
}

async function create(req, res, next) {
  try {
    const b = req.body;
    const email = normalizeEmail(b.email);
    let mobileNumber;
    try { mobileNumber = normalizeMobile(b.mobileNumber); } catch { throw ApiError.unprocessable('Validation failed', [{ field: 'mobileNumber', message: 'Enter a valid phone number' }]); }
    const passwordHash = await bcrypt.hash(b.password, 12);
    const user = await User.create({
      firstName: String(b.firstName).trim(), lastName: String(b.lastName).trim(),
      email, mobileNumber, username: String(b.username).trim().toLowerCase(),
      profilePicUrl: b.profilePicUrl || '', passwordHash,
      role: b.role === 'admin' ? 'admin' : 'manager', isActive: true,
    });
    audit('admin.create-user', req.user, user, `role=${user.role}`);
    res.status(201).json({ success: true, message: 'User created', data: { user: user.toSafeJSON() } });
  } catch (err) {
    if (err && err.code === 11000) {
      const fields = Object.keys(err.keyPattern || {});
      return next(ApiError.conflict('Duplicate identifier', fields.map((f) => ({ field: f, message: `${f} is already registered` }))));
    }
    return next(err);
  }
}

async function patch(req, res, next) {
  try {
    const u = await User.findById(req.params.id);
    if (!u) throw new ApiError(404, 'User not found');
    const allowed = {};
    for (const k of ['firstName', 'lastName', 'profilePicUrl', 'mobileNumber']) if (req.body[k] !== undefined) allowed[k] = req.body[k];
    if (allowed.mobileNumber) {
      try { allowed.mobileNumber = normalizeMobile(allowed.mobileNumber); } catch { throw ApiError.unprocessable('Validation failed', [{ field: 'mobileNumber', message: 'Enter a valid phone number' }]); }
    }
    Object.assign(u, allowed);
    await u.save();
    audit('admin.update-user', req.user, u);
    res.json({ success: true, message: 'User updated', data: { user: u.toSafeJSON() } });
  } catch (err) { next(err); }
}

async function setStatus(req, res, next) {
  try {
    const u = await User.findById(req.params.id);
    if (!u) throw new ApiError(404, 'User not found');
    if (String(u._id) === String(req.user._id)) throw ApiError.forbidden('You cannot deactivate your own account');
    const { isActive } = req.body;
    if (typeof isActive !== 'boolean') throw ApiError.badRequest('isActive must be boolean');
    u.isActive = isActive;
    await u.save();
    if (!isActive) await RefreshSession.updateMany({ userId: u._id }, { $set: { revoked: true, revokedReason: 'deactivated' } });
    audit('admin.set-status', req.user, u, `isActive=${isActive}`);
    res.json({ success: true, message: isActive ? 'Account activated' : 'Account deactivated', data: { user: u.toSafeJSON() } });
  } catch (err) { next(err); }
}

async function setRole(req, res, next) {
  try {
    const u = await User.findById(req.params.id);
    if (!u) throw new ApiError(404, 'User not found');
    const { role } = req.body;
    if (!['admin', 'manager'].includes(role)) throw ApiError.badRequest('role must be admin or manager');
    if (String(u._id) === String(req.user._id) && role !== 'admin') throw ApiError.forbidden('You cannot demote yourself');
    u.role = role;
    await u.save();
    audit('admin.set-role', req.user, u, `role=${role}`);
    res.json({ success: true, message: `Role updated to ${role}`, data: { user: u.toSafeJSON() } });
  } catch (err) { next(err); }
}

module.exports = { list, getOne, create, patch, setStatus, setRole };
