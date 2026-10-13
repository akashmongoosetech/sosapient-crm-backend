const mongoose = require('mongoose');
const { parsePhoneNumberWithError } = require('libphonenumber-js');

const SAFE_URL_RE = /^https:\/\/[^\s/$.?#].[^\s]*$/i;

function isSafeProfileUrl(v) {
  if (!v) return true;
  if (typeof v !== 'string' || v.length > 2048) return false;
  const lower = v.trim().toLowerCase();
  if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('file:')) return false;
  return SAFE_URL_RE.test(v.trim());
}

const userSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true, trim: true, minlength: 1, maxlength: 50, match: /^[^\p{Cc}]+$/u },
    lastName: { type: String, required: true, trim: true, minlength: 1, maxlength: 50, match: /^[^\p{Cc}]+$/u },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    mobileNumber: { type: String, required: true, trim: true },
    username: { type: String, required: true, trim: true, minlength: 3, maxlength: 30, match: /^[a-zA-Z0-9_.]+$/ },
    profilePicUrl: {
      type: String,
      default: '',
      validate: { validator: isSafeProfileUrl, message: 'Profile picture must be a valid HTTPS URL' },
    },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ['admin', 'manager'], default: 'manager', index: true },
    isActive: { type: Boolean, default: true, index: true },
    emailVerified: { type: Boolean, default: false },
    mobileVerified: { type: Boolean, default: false },
    lastLoginAt: { type: Date },
  },
  { timestamps: true }
);

userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ username: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });
userSchema.index({ mobileNumber: 1 }, { unique: true });

userSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: String(this._id),
    firstName: this.firstName,
    lastName: this.lastName,
    email: this.email,
    mobileNumber: this.mobileNumber,
    username: this.username,
    profilePicUrl: this.profilePicUrl || '',
    role: this.role,
    isActive: this.isActive,
    emailVerified: this.emailVerified,
    mobileVerified: this.mobileVerified,
    lastLoginAt: this.lastLoginAt || null,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

function normalizeEmail(email) {
  return String(email).trim().toLowerCase();
}

function normalizeUsername(username) {
  return String(username).trim().toLowerCase();
}

function normalizeMobile(raw) {
  const parsed = parsePhoneNumberWithError(String(raw).trim());
  if (!parsed || !parsed.isValid()) throw new Error('Invalid phone number');
  return parsed.number; // E.164
}

module.exports = { User: mongoose.model('User', userSchema), normalizeEmail, normalizeUsername, normalizeMobile, isSafeProfileUrl };
