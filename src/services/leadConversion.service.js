const { Lead } = require('../models/Lead');
const { Deal } = require('../models/Deal');
const ApiError = require('../utils/ApiError');

// Audit log (same convention as admin.controller.js).
function audit(action, actor, target, detail = '') {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ type: 'lead-conversion', at: new Date().toISOString(), action, actor: actor ? String(actor._id) : null, target: target ? String(target._id || target) : null, detail }));
}

// Explicit Lead → Deal field mapping. Internal Deal fields (status,
// convertedAt, convertedBy, sourceLeadId) are system-set, never copied.
function mapLeadToDeal(lead, userId) {
  return {
    sourceLeadId: lead._id,
    title: lead.title,
    categoryName: lead.categoryName || '',
    address: lead.address || '',
    city: lead.city || '',
    state: lead.state || '',
    website: lead.website || '',
    phone: lead.phone || '',
    phoneUnformatted: lead.phoneUnformatted || '',
    placeId: lead.placeId || '',
    source: lead.source && typeof lead.source === 'object' ? lead.source : {},
    status: 'Converted',
    convertedAt: new Date(),
    convertedBy: userId,
  };
}

/**
 * Convert a lead into a deal. Idempotent and safe without multi-doc
 * transactions (standalone topology): the Deal is created FIRST under the
 * unique sourceLeadId anchor, verified by re-read, and only then is the
 * Lead deleted. A crash between the two is recovered by retrying: the
 * unique index turns the duplicate create into a known state, and the
 * orphaned-delete step completes.
 *
 * Returns { deal, alreadyConverted }.
 */
async function convertLead(leadId, user) {
  const lead = await Lead.findById(leadId);
  if (!lead) {
    // Lead gone: either never existed, or a previous conversion deleted it.
    // Recovery path — return the existing deal instead of failing.
    const existing = await Deal.findOne({ sourceLeadId: leadId });
    if (existing) return { deal: existing, alreadyConverted: true };
    throw new ApiError(404, 'Lead not found');
  }

  let deal;
  try {
    deal = await Deal.create(mapLeadToDeal(lead, user._id));
  } catch (err) {
    if (err && err.code === 11000) {
      // Lost race / retry: the deal already exists — recover idempotently.
      const existing = await Deal.findOne({ sourceLeadId: lead._id });
      if (existing) {
        await lead.deleteOne();
        audit('lead.converted-recovered', user, existing, `lead=${lead._id}`);
        return { deal: existing, alreadyConverted: true };
      }
    }
    throw err;
  }

  // Verify before deleting: never remove the lead until the deal is durable.
  const verified = await Deal.findById(deal._id);
  if (!verified) throw new ApiError(500, 'Conversion failed — lead was preserved');
  await lead.deleteOne();
  audit('lead.converted', user, verified, `lead=${leadId}`);
  return { deal: verified, alreadyConverted: false };
}

module.exports = { convertLead, mapLeadToDeal };
