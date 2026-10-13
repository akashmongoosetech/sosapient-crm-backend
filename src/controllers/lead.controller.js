const mongoose = require('mongoose');
const leadService = require('../services/lead.service');
const importService = require('../services/leadImport.service');
const ApiError = require('../utils/ApiError');

function badId(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) throw ApiError.badRequest('Invalid lead id');
}

async function list(req, res, next) {
  try {
    const data = await leadService.listLeads(req.query);
    res.json({ success: true, message: 'Leads', data });
  } catch (err) { next(err); }
}

async function filters(req, res, next) {
  try {
    const data = await leadService.filterOptions();
    res.json({ success: true, message: 'Lead filter options', data });
  } catch (err) { next(err); }
}

async function getOne(req, res, next) {
  try {
    badId(req.params.id);
    const lead = await leadService.getLead(req.params.id);
    res.json({ success: true, message: 'Lead', data: { lead: lead.toSafeJSON() } });
  } catch (err) { next(err); }
}

async function create(req, res, next) {
  try {
    const lead = await leadService.createLead(req.body);
    res.status(201).json({ success: true, message: 'Lead created', data: { lead: lead.toSafeJSON() } });
  } catch (err) { next(err); }
}

async function update(req, res, next) {
  try {
    badId(req.params.id);
    const result = await leadService.updateLead(req.params.id, req.body, req.user);
    // Conversion returns { deal, alreadyConverted } instead of a lead.
    if (result && result.deal) {
      return res.json({ success: true, message: 'Lead converted to deal', data: { converted: true, deal: result.deal.toSafeJSON() } });
    }
    res.json({ success: true, message: 'Lead updated', data: { lead: result.toSafeJSON() } });
  } catch (err) { next(err); }
}

async function remove(req, res, next) {
  try {
    badId(req.params.id);
    await leadService.deleteLead(req.params.id);
    res.json({ success: true, message: 'Lead deleted', data: {} });
  } catch (err) { next(err); }
}

async function importPreview(req, res, next) {
  try {
    const data = await importService.previewImport(req.body.records);
    res.json({ success: true, message: 'Import preview', data });
  } catch (err) { next(err); }
}

async function importConfirm(req, res, next) {
  try {
    const data = await importService.confirmImport(req.body.records);
    res.json({ success: true, message: `Imported ${data.imported} of ${data.total} records`, data });
  } catch (err) { next(err); }
}

module.exports = { list, filters, getOne, create, update, remove, importPreview, importConfirm };
