const mongoose = require('mongoose');

const ENTRY_KINDS = ['requirement', 'progress'];

function makeEntryModel(name, collection) {
  const schema = new mongoose.Schema(
    {
      dealId: { type: mongoose.Schema.Types.ObjectId, ref: 'Deal', required: true, index: true },
      description: { type: String, required: true, trim: true, minlength: 1, maxlength: 5000 },
      // Normalized to UTC midnight by the service; one logical "day" per entry.
      entryDate: { type: Date, required: true, index: true },
      attachments: {
        type: [{
          _id: false,
          filename: { type: String, required: true },   // original client filename (display only)
          storedName: { type: String, required: true }, // random server filename
          mime: { type: String, required: true },
          size: { type: Number, required: true },
          url: { type: String, required: true },        // API reference, never a filesystem path
        }],
        default: [],
        validate: {
          validator(v) { return v.length <= (parseInt(process.env.MAX_FILES_PER_ENTRY || '6', 10)); },
          message: 'Too many attachments for one entry',
        },
      },
      createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    },
    { timestamps: true }
  );
  schema.index({ dealId: 1, entryDate: -1 });
  schema.methods.toSafeJSON = function toSafeJSON() {
    // createdBy is populated (firstName/lastName/profilePicUrl/role) by the
    // service on read paths; legacy/dangling refs serialize as null and the
    // frontend renders an "Unknown User" fallback. Only display-safe fields.
    const cb = this.createdBy;
    const creator = cb && typeof cb === 'object' && !(cb instanceof mongoose.Types.ObjectId)
      ? {
          firstName: cb.firstName || '',
          lastName: cb.lastName || '',
          profilePicUrl: cb.profilePicUrl || '',
          role: cb.role === 'admin' ? 'admin' : 'manager',
        }
      : null;
    return {
      id: String(this._id),
      dealId: String(this.dealId),
      description: this.description,
      entryDate: this.entryDate,
      attachments: (this.attachments || []).map((a) => ({
        filename: a.filename, mime: a.mime, size: a.size, url: a.url,
      })),
      createdBy: cb ? String(cb._id || cb) : null,
      creator,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  };
  return mongoose.model(name, schema, collection);
}

module.exports = {
  ENTRY_KINDS,
  ClientRequirement: makeEntryModel('ClientRequirement', 'clientrequirements'),
  ProjectProgress: makeEntryModel('ProjectProgress', 'projectprogress'),
};
