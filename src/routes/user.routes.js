const express = require('express');
const userCtrl = require('../controllers/user.controller');
const authenticate = require('../middleware/authenticate');
const { requireActiveUser } = require('../middleware/authorize');
const validate = require('../middleware/validate');
const { patchMeSchema, changePasswordSchema } = require('../validators/auth.validator');

const router = express.Router();
router.use(authenticate, requireActiveUser);
router.get('/me', userCtrl.getMe);
router.patch('/me', validate(patchMeSchema), userCtrl.patchMe);
router.patch('/me/password', validate(changePasswordSchema), userCtrl.changePassword);

module.exports = router;
