const bcrypt = require('bcryptjs');
const { User, normalizeEmail, normalizeMobile } = require('../models/User');
const ApiError = require('../utils/ApiError');

async function getMe(req, res, next) {
  try {
    res.json({ success: true, message: 'Profile', data: { user: req.user.toSafeJSON() } });
  } catch (err) { next(err); }
}

function dupToConflict(err) {
  if (err && err.code === 11000) {
    const fields = Object.keys(err.keyPattern || err.keyValue || {});
    const field = fields.includes('email') ? 'email' : fields.includes('mobileNumber') ? 'mobileNumber' : (fields[0] || 'account');
    const label = field === 'email' ? 'Email address is already registered' : 'Mobile number is already registered';
    return ApiError.conflict(label, [{ field, message: label }]);
  }
  return err;
}

async function patchMe(req, res, next) {
  try {
    // Strict allowlist: role, isActive, username, verification flags can
    // never be changed here (schema is .strict() and these keys are dropped).
    const allowed = {};
    for (const k of ['firstName', 'lastName', 'email', 'profilePicUrl', 'mobileNumber']) {
      if (req.body[k] !== undefined) allowed[k] = req.body[k];
    }
    if (allowed.email !== undefined) {
      allowed.email = normalizeEmail(allowed.email);
      if (allowed.email !== req.user.email) {
        // New address must be re-verified; never trust the old flag.
        allowed.emailVerified = false;
      } else {
        delete allowed.email;
      }
    }
    if (allowed.mobileNumber) {
      try {
        allowed.mobileNumber = normalizeMobile(allowed.mobileNumber);
      } catch {
        throw ApiError.unprocessable('Validation failed', [{ field: 'mobileNumber', message: 'Enter a valid phone number' }]);
      }
    }
    Object.assign(req.user, allowed);
    await req.user.save();
    res.json({ success: true, message: 'Profile updated', data: { user: req.user.toSafeJSON() } });
  } catch (err) {
    return next(dupToConflict(err));
  }
}

async function changePassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user._id).select('+passwordHash');
    if (!user) throw ApiError.unauthorized();
    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) {
      throw ApiError.unprocessable('Validation failed', [{ field: 'currentPassword', message: 'Current password is incorrect' }]);
    }
    user.passwordHash = await bcrypt.hash(newPassword, 12);
    await user.save();
    res.json({ success: true, message: 'Password changed successfully', data: {} });
  } catch (err) {
    return next(err);
  }
}

module.exports = { getMe, patchMe, changePassword };
