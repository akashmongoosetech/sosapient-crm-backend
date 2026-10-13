const mongoose = require('mongoose');
const dealService = require('../services/deal.service');
const { appendFileToken } = require('../utils/token');
const ApiError = require('../utils/ApiError');

function badId(id, label = 'id') {
  if (!mongoose.Types.ObjectId.isValid(id)) throw ApiError.badRequest(`Invalid ${label}`);
}

// Every entry payload leaves the API with freshly signed file URLs so
// plain <img> tags can render attachments without an Authorization header.
function withSignedUrls(entryJson, userId) {
  return {
    ...entryJson,
    attachments: (entryJson.attachments || []).map((a) => ({
      ...a,
      url: appendFileToken(a.url, userId, entryJson.dealId),
    })),
  };
}

function withSignedList(data, userId) {
  return { ...data, entries: data.entries.map((e) => withSignedUrls(e, userId)) };
}

async function list(req, res, next) {
  try {
    const data = await dealService.listDeals(req.query);
    res.json({ success: true, message: 'Deals', data });
  } catch (err) { next(err); }
}

async function getOne(req, res, next) {
  try {
    const deal = await dealService.getDeal(req.params.id);
    res.json({ success: true, message: 'Deal', data: { deal: deal.toSafeJSON() } });
  } catch (err) { next(err); }
}

async function listEntries(req, res, next) {
  try {
    const data = await dealService.listEntries(req.entryKind, req.params.id, req.query);
    res.json({ success: true, message: 'Entries', data: withSignedList(data, req.user._id) });
  } catch (err) { next(err); }
}

async function createEntry(req, res, next) {
  try {
    const entry = await dealService.createEntry(
      req.entryKind, req.params.id, req.body, req.files || [], req.user._id
    );
    res.status(201).json({ success: true, message: 'Entry saved', data: { entry: withSignedUrls(entry.toSafeJSON(), req.user._id) } });
  } catch (err) { next(err); }
}

async function updateEntry(req, res, next) {
  try {
    badId(req.params.entryId, 'entry id');
    const entry = await dealService.updateEntry(req.entryKind, req.params.id, req.params.entryId, req.body);
    res.json({ success: true, message: 'Entry updated', data: { entry: withSignedUrls(entry.toSafeJSON(), req.user._id) } });
  } catch (err) { next(err); }
}

async function deleteEntry(req, res, next) {
  try {
    badId(req.params.entryId, 'entry id');
    await dealService.deleteEntry(req.entryKind, req.params.id, req.params.entryId);
    res.json({ success: true, message: 'Entry deleted', data: {} });
  } catch (err) { next(err); }
}

module.exports = { list, getOne, listEntries, createEntry, updateEntry, deleteEntry };
