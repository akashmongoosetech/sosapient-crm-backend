const { Lead, splitRecord } = require('../models/Lead');
const { extractKey } = require('./leadKeys');

const DETAIL_CAP = 50;

// Batch existence checks: at most 4 queries regardless of file size.
async function findDbKeySets(records) {
  const buckets = { placeId: new Set(), phoneUnformatted: new Set(), phone: new Set(), website: new Set(), titleAddress: new Set() };
  const keys = records.map((r) => extractKey(r.core));
  for (const k of keys) if (k) buckets[k.kind].add(k.value);

  const sets = { placeId: new Set(), phoneUnformatted: new Set(), phone: new Set(), website: new Set(), titleAddress: new Set() };
  const { normPhone, normSite, normText } = require('./leadKeys');

  if (buckets.placeId.size) {
    const docs = await Lead.find({ placeId: { $in: [...buckets.placeId] } }).select('placeId').lean();
    for (const d of docs) if (d.placeId) sets.placeId.add(d.placeId);
  }
  // Phones/websites are stored raw; compare against normalized values in JS
  // using batched candidate fetches (only docs having any phone/website).
  if (buckets.phoneUnformatted.size || buckets.phone.size) {
    const docs = await Lead.find({ $or: [{ phone: { $regex: /\S/ } }, { phoneUnformatted: { $regex: /\S/ } }] })
      .select('phone phoneUnformatted').lean();
    const have = new Set();
    for (const d of docs) {
      const a = normPhone(d.phoneUnformatted); if (a) have.add(`u:${a}`);
      const b = normPhone(d.phone); if (b) have.add(`p:${b}`);
    }
    for (const v of buckets.phoneUnformatted) if (have.has(`u:${v}`) || have.has(`p:${v}`)) sets.phoneUnformatted.add(v);
    for (const v of buckets.phone) if (have.has(`u:${v}`) || have.has(`p:${v}`)) sets.phone.add(v);
  }
  if (buckets.website.size) {
    const docs = await Lead.find({ website: { $regex: /\S/ } }).select('website').lean();
    const have = new Set(docs.map((d) => normSite(d.website)).filter(Boolean));
    for (const v of buckets.website) if (have.has(v)) sets.website.add(v);
  }
  if (buckets.titleAddress.size) {
    const docs = await Lead.find({}).select('title address').lean();
    const have = new Set(docs.map((d) => { const t = normText(d.title); const a = normText(d.address); return t && a ? `${t}||${a}` : ''; }).filter(Boolean));
    for (const v of buckets.titleAddress) if (have.has(v)) sets.titleAddress.add(v);
  }
  return sets;
}

function analyzeRecords(rawRecords) {
  // Returns per-record analysis: { index, core, source, valid, invalidReason, key }
  return rawRecords.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { index, core: null, source: {}, valid: false, invalidReason: 'Record must be an object', key: null };
    }
    const { core, source } = splitRecord(raw);
    if (!core.title) return { index, core, source, valid: false, invalidReason: 'Missing required field: title', key: null };
    return { index, core, source, valid: true, invalidReason: '', key: extractKey(core) };
  });
}

async function previewImport(rawRecords) {
  const analyzed = analyzeRecords(rawRecords);
  const valid = analyzed.filter((a) => a.valid);
  const sets = await findDbKeySets(valid);

  const seen = new Set();
  let dbDuplicates = 0; let fileDuplicates = 0;
  const duplicatesByRule = { placeId: 0, phoneUnformatted: 0, phone: 0, website: 0, titleAddress: 0 };
  const dupDetails = [];
  const newOnes = [];

  for (const a of valid) {
    const k = a.key;
    const idStr = k ? `${k.kind}:${k.value}` : '';
    if (k && sets[k.kind].has(k.value)) {
      dbDuplicates += 1;
      duplicatesByRule[k.kind] += 1;
      if (dupDetails.length < DETAIL_CAP) dupDetails.push({ index: a.index, title: a.core.title, rule: k.kind, scope: 'database' });
    } else if (k && seen.has(idStr)) {
      fileDuplicates += 1;
      duplicatesByRule[k.kind] += 1;
      if (dupDetails.length < DETAIL_CAP) dupDetails.push({ index: a.index, title: a.core.title, rule: k.kind, scope: 'file' });
    } else {
      if (k) seen.add(idStr);
      newOnes.push(a);
    }
  }

  const invalid = analyzed.filter((a) => !a.valid);
  return {
    total: rawRecords.length,
    new: newOnes.length,
    dbDuplicates,
    fileDuplicates,
    invalid: invalid.length,
    duplicatesByRule,
    duplicateDetails: dupDetails,
    invalidDetails: invalid.slice(0, DETAIL_CAP).map((a) => ({ index: a.index, reason: a.invalidReason })),
    truncated: dupDetails.length === DETAIL_CAP || invalid.length > DETAIL_CAP,
  };
}

async function confirmImport(rawRecords) {
  const analyzed = analyzeRecords(rawRecords);
  const valid = analyzed.filter((a) => a.valid);
  const invalid = analyzed.length - valid.length;
  const sets = await findDbKeySets(valid);

  const seen = new Set();
  const docs = [];
  let skippedDuplicates = 0;
  for (const a of valid) {
    const k = a.key;
    const idStr = k ? `${k.kind}:${k.value}` : '';
    if ((k && sets[k.kind].has(k.value)) || (k && seen.has(idStr))) {
      skippedDuplicates += 1;
      continue;
    }
    if (k) seen.add(idStr);
    docs.push({ ...a.core, source: a.source });
  }

  let imported = 0;
  const errors = [];
  if (docs.length) {
    try {
      const res = await Lead.insertMany(docs, { ordered: false });
      imported = res.length;
    } catch (e) {
      // ordered:false → partial success; count real writes only.
      const inserted = (e && e.insertedDocs && e.insertedDocs.length) || 0;
      imported = inserted;
      skippedDuplicates += docs.length - inserted;
      errors.push({ reason: 'Some records failed to insert (likely duplicate identifiers raced in)', count: docs.length - inserted });
    }
  }
  return {
    total: rawRecords.length,
    imported,
    skippedDuplicates,
    invalid,
    errors,
  };
}

module.exports = { previewImport, confirmImport, analyzeRecords };
