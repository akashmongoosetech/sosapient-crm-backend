const express = require('express');
const leadCtrl = require('../controllers/lead.controller');
const authenticate = require('../middleware/authenticate');
const { requireActiveUser } = require('../middleware/authorize');
const validate = require('../middleware/validate');
const validateQuery = require('../middleware/validateQuery');
const { leadCreateSchema, leadUpdateSchema, leadQuerySchema, importSchema } = require('../validators/lead.validator');

const router = express.Router();
// Both admin and manager manage leads (mirrors sidebar visibility).
router.use(authenticate, requireActiveUser);

router.get('/', validateQuery(leadQuerySchema), leadCtrl.list);
router.get('/filters', leadCtrl.filters);
router.post('/import/preview', validate(importSchema), leadCtrl.importPreview);
router.post('/import/confirm', validate(importSchema), leadCtrl.importConfirm);
router.get('/:id', leadCtrl.getOne);
router.post('/', validate(leadCreateSchema), leadCtrl.create);
router.put('/:id', validate(leadUpdateSchema), leadCtrl.update);
router.delete('/:id', leadCtrl.remove);

module.exports = router;
