const mongoose = require('mongoose');

// One document per password-reset challenge. Only hashes are stored —
// plaintext OTPs and reset tokens never touch the database.
const passwordResetSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254, index: true },
    otpHash: { type: String, required: true, select: false },
    resetTokenHash: { type: String, default: null, select: false },
    purpose: { type: String, default: 'password-reset', immutable: true },
    status: { type: String, enum: ['pending', 'verified', 'consumed', 'superseded'], default: 'pending', index: true },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 5 },
    otpExpiresAt: { type: Date, required: true },
    resetExpiresAt: { type: Date, default: null },
  },
  { timestamps: true }
);

passwordResetSchema.index({ userId: 1, status: 1 });
passwordResetSchema.index({ otpExpiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('PasswordReset', passwordResetSchema);
