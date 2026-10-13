const express = require('express');
const dealCtrl = require('../controllers/deal.controller');
const authenticate = require('../middleware/authenticate');
const { requireActiveUser } = require('../middleware/authorize');
const validate = require('../middleware/validate');
const validateQuery = require('../middleware/validateQuery');
const upload = require('../middleware/upload');
const { entryCreateSchema, entryUpdateSchema, dealQuerySchema, historyQuerySchema } = require('../validators/deal.validator');

const router = express.Router();
// Both admin and manager manage deals (same policy as leads).
router.use(authenticate, requireActiveUser);

function kind(kindName) {
  return (_req, _res, next) => { _req.entryKind = kindName; next(); };
}

// Multipart text fields are strings: validate after multer populates req.body.
router.get('/', validateQuery(dealQuerySchema), dealCtrl.list);
router.get('/:id', dealCtrl.getOne);

for (const [path, kindName] of [['requirements', 'requirement'], ['progress', 'progress']]) {
  router.get(`/:id/${path}`, kind(kindName), validateQuery(historyQuerySchema), dealCtrl.listEntries);
  router.post(
    `/:id/${path}`, kind(kindName),
    upload.array('attachments', parseInt(process.env.MAX_FILES_PER_ENTRY || '6', 10)),
    validate(entryCreateSchema),
    dealCtrl.createEntry
  );
  router.put(`/:id/${path}/:entryId`, kind(kindName), validate(entryUpdateSchema), dealCtrl.updateEntry);
  router.delete(`/:id/${path}/:entryId`, kind(kindName), dealCtrl.deleteEntry);
}

module.exports = router;
