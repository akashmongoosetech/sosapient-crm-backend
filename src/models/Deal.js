const mongoose = require('mongoose');

const DEAL_STATUSES = ['Converted'];

// Lead → Deal field mapping (documented, explicit — never blind spread).
// sourceLeadId: unique conversion reference (duplicate-prevention anchor).
const dealSchema = new mongoose.Schema(
  {
    sourceLeadId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    categoryName: { type: String, default: '', trim: true, maxlength: 200 },
    address: { type: String, default: '', trim: true, maxlength: 1000 },
    city: { type: String, default: '', trim: true, maxlength: 120, index: true },
    state: { type: String, default: '', trim: true, maxlength: 120 },
    website: { type: String, default: '', trim: true, maxlength: 2048 },
    phone: { type: String, default: '', trim: true, maxlength: 40 },
    phoneUnformatted: { type: String, default: '', trim: true, maxlength: 40 },
    placeId: { type: String, default: '', trim: true, maxlength: 300 },
    // Full preserved lead extras (source.*) carried over at conversion.
    source: { type: mongoose.Schema.Types.Mixed, default: {} },
    // System-controlled and immutable: no write path ever changes this.
    status: { type: String, enum: DEAL_STATUSES, default: 'Converted', immutable: true },
    convertedAt: { type: Date, default: Date.now },
    convertedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

dealSchema.index({ createdAt: -1 });

dealSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: String(this._id),
    sourceLeadId: String(this.sourceLeadId),
    title: this.title,
    categoryName: this.categoryName || '',
    address: this.address || '',
    city: this.city || '',
    state: this.state || '',
    website: this.website || '',
    phone: this.phone || '',
    phoneUnformatted: this.phoneUnformatted || '',
    placeId: this.placeId || '',
    source: this.source && typeof this.source === 'object' ? this.source : {},
    status: this.status,
    convertedAt: this.convertedAt,
    convertedBy: this.convertedBy ? String(this.convertedBy) : null,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

module.exports = { Deal: mongoose.model('Deal', dealSchema), DEAL_STATUSES };
