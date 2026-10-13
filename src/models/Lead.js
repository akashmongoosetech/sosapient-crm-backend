const mongoose = require('mongoose');

const LEAD_STATUSES = ['New', 'Whatsapp', 'Message', 'Call', 'Converted'];

// Internal fields that imported source data must never override.
const RESERVED_KEYS = new Set(['_id', '__v', 'id', 'createdAt', 'updatedAt']);

const leadSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, minlength: 1, maxlength: 200 },
    categoryName: { type: String, default: '', trim: true, maxlength: 200 },
    address: { type: String, default: '', trim: true, maxlength: 1000 },
    city: { type: String, default: '', trim: true, maxlength: 120, index: true },
    state: { type: String, default: '', trim: true, maxlength: 120 },
    website: { type: String, default: '', trim: true, maxlength: 2048 },
    // Stored as strings to preserve leading zeros, prefixes, and formatting.
    phone: { type: String, default: '', trim: true, maxlength: 40 },
    phoneUnformatted: { type: String, default: '', trim: true, maxlength: 40 },
    status: { type: String, enum: LEAD_STATUSES, default: 'New', index: true },
    // Mirrored top-level copy of the source placeId for indexed duplicate detection.
    placeId: { type: String, default: '', trim: true, maxlength: 300 },
    // Flexible preservation of every extra source property (nested objects,
    // arrays, booleans, numbers, nulls). Never client-writable via PUT.
    source: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

leadSchema.index({ categoryName: 1 });
// Partial unique index: only non-empty placeIds are indexed, so records
// without one never collide (a sparse index would still collide on '').
leadSchema.index({ placeId: 1 }, { unique: true, partialFilterExpression: { placeId: { $gt: '' } }, name: 'placeId_unique_nonempty' });
leadSchema.index({ createdAt: -1 });

leadSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: String(this._id),
    title: this.title,
    categoryName: this.categoryName || '',
    address: this.address || '',
    city: this.city || '',
    state: this.state || '',
    website: this.website || '',
    phone: this.phone || '',
    phoneUnformatted: this.phoneUnformatted || '',
    status: this.status,
    placeId: this.placeId || '',
    source: this.source && typeof this.source === 'object' ? this.source : {},
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

/**
 * Split an arbitrary imported record into core CRM fields + preserved extras.
 * Reserved DB keys in the source are dropped, never applied.
 */
function splitRecord(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
  for (const k of RESERVED_KEYS) delete src[k];
  const pick = (v) => (v === null || v === undefined ? '' : String(v));
  const core = {
    title: String(src.title ?? '').trim(),
    categoryName: pick(src.categoryName).trim(),
    address: pick(src.address).trim(),
    city: pick(src.city).trim(),
    state: pick(src.state).trim(),
    website: pick(src.website).trim(),
    phone: pick(src.phone).trim(),
    phoneUnformatted: pick(src.phoneUnformatted).trim(),
    status: typeof src.status === 'string' && LEAD_STATUSES.includes(src.status) ? src.status : 'New',
    placeId: pick(src.placeId).trim(),
  };
  const CORE_KEYS = new Set(['title', 'categoryName', 'address', 'city', 'state', 'website', 'phone', 'phoneUnformatted', 'status', 'placeId']);
  const source = {};
  for (const [k, v] of Object.entries(src)) {
    if (!CORE_KEYS.has(k)) source[k] = v;
  }
  return { core, source };
}

module.exports = { Lead: mongoose.model('Lead', leadSchema), LEAD_STATUSES, splitRecord };
