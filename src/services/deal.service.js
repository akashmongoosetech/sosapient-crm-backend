const mongoose = require('mongoose');
const { Deal } = require('../models/Deal');
const { ClientRequirement, ProjectProgress } = require('../models/DealEntry');
const { storeFile, removeStoredFile } = require('./fileStorage.service');
const ApiError = require('../utils/ApiError');
const env = require('../config/env');

function badId(id, label = 'id') {
  if (!mongoose.Types.ObjectId.isValid(id)) throw ApiError.badRequest(`Invalid ${label}`);
}

// Display-safe creator fields only — never passwordHash, tokens, or metadata.
const CREATOR_FIELDS = 'firstName lastName profilePicUrl role';

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toUtcMidnight(d) {
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) throw ApiError.unprocessable('Validation failed', [{ field: 'entryDate', message: 'Enter a valid date' }]);
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
}

function modelFor(kind) {
  if (kind === 'requirement') return ClientRequirement;
  if (kind === 'progress') return ProjectProgress;
  throw ApiError.badRequest('Invalid entry kind');
}

async function getDeal(id) {
  badId(id, 'deal id');
  const deal = await Deal.findById(id);
  if (!deal) throw new ApiError(404, 'Deal not found');
  return deal;
}

async function listDeals({ q, page, limit }) {
  const filter = {};
  if (q) {
    const rx = new RegExp(escapeRegExp(q), 'i');
    filter.$or = [{ title: rx }, { categoryName: rx }, { city: rx }, { state: rx }, { phone: rx }, { phoneUnformatted: rx }];
  }
  const [items, total] = await Promise.all([
    Deal.find(filter).sort({ convertedAt: -1 }).skip((page - 1) * limit).limit(limit),
    Deal.countDocuments(filter),
  ]);
  // Entry counts per deal (two grouped aggregations, not N+1).
  const ids = items.map((d) => d._id);
  const counts = {};
  if (ids.length) {
    const [req, prog] = await Promise.all([
      ClientRequirement.aggregate([{ $match: { dealId: { $in: ids } } }, { $group: { _id: '$dealId', n: { $sum: 1 } } }]),
      ProjectProgress.aggregate([{ $match: { dealId: { $in: ids } } }, { $group: { _id: '$dealId', n: { $sum: 1 } } }]),
    ]);
    for (const d of items) counts[String(d._id)] = { requirements: 0, progress: 0 };
    for (const r of req) counts[String(r._id)].requirements = r.n;
    for (const r of prog) counts[String(r._id)].progress = r.n;
  }
  return {
    deals: items.map((d) => ({ ...d.toSafeJSON(), entryCounts: counts[String(d._id)] || { requirements: 0, progress: 0 } })),
    page, limit, total,
  };
}

async function listEntries(kind, dealId, { page, limit }) {
  await getDeal(dealId); // verifies the deal exists first
  const Model = modelFor(kind);
  const filter = { dealId: new mongoose.Types.ObjectId(dealId) };
  const [items, total] = await Promise.all([
    Model.find(filter).sort({ entryDate: -1, createdAt: -1 }).skip((page - 1) * limit).limit(limit).populate('createdBy', CREATOR_FIELDS),
    Model.countDocuments(filter),
  ]);
  return { entries: items.map((e) => e.toSafeJSON()), page, limit, total };
}

async function createEntry(kind, dealId, { description, entryDate }, files, userId) {
  const deal = await getDeal(dealId);
  const Model = modelFor(kind);
  const stored = [];
  try {
    for (const f of files || []) {
      if (stored.length >= env.MAX_FILES_PER_ENTRY) {
        throw ApiError.unprocessable('Too many attachments', [{ field: 'attachments', message: `Maximum ${env.MAX_FILES_PER_ENTRY} images per entry` }]);
      }
      stored.push(await storeFile(deal._id, f));
    }
    const entry = await Model.create({
      dealId: deal._id,
      description: String(description).trim(),
      entryDate: toUtcMidnight(entryDate),
      attachments: stored,
      createdBy: userId,
    });
    await entry.populate('createdBy', CREATOR_FIELDS);
    return entry;
  } catch (err) {
    // Roll back any files already written: no orphaned uploads.
    for (const a of stored) {
      try { await removeStoredFile(deal._id, a.storedName); } catch { /* ignore */ }
    }
    throw err;
  }
}

async function getEntry(kind, dealId, entryId) {
  await getDeal(dealId);
  badId(entryId, 'entry id');
  const Model = modelFor(kind);
  const entry = await Model.findOne({ _id: entryId, dealId }).populate('createdBy', CREATOR_FIELDS);
  if (!entry) throw new ApiError(404, 'Entry not found');
  return entry;
}

async function updateEntry(kind, dealId, entryId, { description, entryDate, keepAttachments }) {
  const entry = await getEntry(kind, dealId, entryId);
  if (description !== undefined) entry.description = String(description).trim();
  if (entryDate !== undefined) entry.entryDate = toUtcMidnight(entryDate);
  if (keepAttachments !== undefined) {
    const keep = new Set(keepAttachments);
    const dropped = (entry.attachments || []).filter((a) => !keep.has(a.storedName));
    entry.attachments = (entry.attachments || []).filter((a) => keep.has(a.storedName));
    for (const a of dropped) {
      try { await removeStoredFile(entry.dealId, a.storedName); } catch { /* ignore */ }
    }
  }
  await entry.save();
  return entry;
}

async function deleteEntry(kind, dealId, entryId) {
  const entry = await getEntry(kind, dealId, entryId);
  const files = [...(entry.attachments || [])];
  await entry.deleteOne();
  for (const a of files) {
    try { await removeStoredFile(entry.dealId, a.storedName); } catch { /* ignore */ }
  }
}

module.exports = { getDeal, listDeals, listEntries, createEntry, getEntry, updateEntry, deleteEntry, modelFor, toUtcMidnight };
