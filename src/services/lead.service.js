const { Lead, splitRecord } = require('../models/Lead');
const { extractKey, normPhone, normSite } = require('./leadKeys');
const ApiError = require('../utils/ApiError');

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasMeaningful(v) {
  return v !== null && v !== undefined && String(v).trim() !== '';
}

function buildLeadFilter({ q, category, city, status, contact }) {
  const filter = {};
  if (q) {
    const rx = new RegExp(escapeRegExp(q), 'i');
    filter.$or = [
      { title: rx }, { categoryName: rx }, { address: rx }, { city: rx },
      { state: rx }, { website: rx }, { phone: rx }, { phoneUnformatted: rx },
    ];
  }
  if (category) filter.categoryName = category;
  if (city) filter.city = city;
  if (status) {
    const { LEAD_STATUSES } = require('../models/Lead');
    if (!LEAD_STATUSES.includes(status)) throw ApiError.badRequest('Invalid status filter');
    filter.status = status;
  }
  // Contact-availability filter. "Meaningful" = non-empty after trim.
  // Phone counts if phone OR phoneUnformatted is meaningful.
  // Missing/null/empty/whitespace-only values never count as available:
  // /\S/ requires a non-whitespace char; $not inverts it (missing fields match $not).
  const phoneOr = [{ phone: { $regex: /\S/ } }, { phoneUnformatted: { $regex: /\S/ } }];
  const noPhone = [{ phone: { $not: /\S/ } }, { phoneUnformatted: { $not: /\S/ } }];
  const siteCond = { website: { $regex: /\S/ } };
  const noSite = { website: { $not: /\S/ } };
  if (contact === 'phone') filter.$and = [...(filter.$and || []), { $or: phoneOr }];
  else if (contact === 'website') filter.$and = [...(filter.$and || []), siteCond];
  else if (contact === 'both') filter.$and = [...(filter.$and || []), { $or: phoneOr }, siteCond];
  else if (contact === 'mobileOnly') filter.$and = [...(filter.$and || []), { $or: phoneOr }, noSite];
  else if (contact === 'websiteOnly') filter.$and = [...(filter.$and || []), siteCond, ...noPhone];
  else if (contact === 'neither') {
    filter.$and = [...(filter.$and || []), ...noPhone, noSite];
  }
  return filter;
}

async function listLeads(params) {
  const filter = buildLeadFilter(params);
  const { page, limit } = params;
  const [items, total] = await Promise.all([
    Lead.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Lead.countDocuments(filter),
  ]);
  return { leads: items.map((l) => l.toSafeJSON()), page, limit, total };
}

async function getLead(id) {
  const lead = await Lead.findById(id);
  if (!lead) throw new ApiError(404, 'Lead not found');
  return lead;
}

async function createLead(body) {
  // Conversion is only possible via PUT (status → Converted); direct
  // creation as Converted is rejected so deals can't be forged this way.
  if (body && body.status === 'Converted') {
    throw ApiError.unprocessable('Validation failed', [{ field: 'status', message: 'Leads cannot be created as Converted — convert an existing lead instead' }]);
  }
  // Extra supplied properties are preserved into `source`, never set as DB fields.
  const { core, source } = splitRecord(body || {});
  const lead = await Lead.create({ ...core, source });
  return lead;
}

// Mass-assignment-safe: only core allowlist fields; `source` is preserved untouched.
const UPDATE_FIELDS = ['title', 'categoryName', 'address', 'city', 'state', 'website', 'phone', 'phoneUnformatted', 'status', 'placeId'];

async function updateLead(id, body, user) {
  const lead = await getLead(id);
  // Status transition to Converted triggers automatic conversion instead
  // of an ordinary update. The lead is removed; a deal is created.
  if (body.status === 'Converted' && lead.status !== 'Converted') {
    const { convertLead } = require('./leadConversion.service');
    return convertLead(id, user);
  }
  for (const k of UPDATE_FIELDS) {
    if (body[k] !== undefined) lead[k] = body[k];
  }
  await lead.save();
  return lead;
}

async function deleteLead(id) {
  const lead = await getLead(id);
  await lead.deleteOne();
}

async function filterOptions() {
  const [categories, cities] = await Promise.all([
    Lead.distinct('categoryName'),
    Lead.distinct('city'),
  ]);
  const clean = (arr) => [...new Set(arr.map((v) => String(v || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return { categories: clean(categories), cities: clean(cities) };
}

module.exports = { buildLeadFilter, listLeads, getLead, createLead, updateLead, deleteLead, filterOptions, hasMeaningful, splitRecord, normPhone, normSite };
