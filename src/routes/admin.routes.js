const express = require('express');
const adminCtrl = require('../controllers/admin.controller');
const authenticate = require('../middleware/authenticate');
const { authorizeRoles, requireActiveUser } = require('../middleware/authorize');
const validate = require('../middleware/validate');
const { adminCreateSchema, adminPatchSchema } = require('../validators/auth.validator');

const router = express.Router();
router.use(authenticate, requireActiveUser, authorizeRoles('admin'));

router.get('/users', adminCtrl.list);
router.get('/users/:id', adminCtrl.getOne);
router.post('/users', validate(adminCreateSchema), adminCtrl.create);
router.patch('/users/:id', validate(adminPatchSchema), adminCtrl.patch);
router.patch('/users/:id/status', adminCtrl.setStatus);
router.patch('/users/:id/role', adminCtrl.setRole);

module.exports = router;
