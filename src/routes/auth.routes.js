const express = require('express');
const authCtrl = require('../controllers/auth.controller');
const resetCtrl = require('../controllers/passwordReset.controller');
const authenticate = require('../middleware/authenticate');
const validate = require('../middleware/validate');
const { authLimiter, otpLimiter } = require('../middleware/rateLimiter');
const { registerSchema, loginSchema, forgotPasswordSchema, verifyResetOtpSchema, resendResetOtpSchema, resetPasswordSchema } = require('../validators/auth.validator');

const router = express.Router();

router.post('/register', authLimiter, validate(registerSchema), authCtrl.register);
router.post('/login', authLimiter, validate(loginSchema), authCtrl.login);
router.post('/refresh', authCtrl.refresh);
router.post('/logout', authCtrl.logout);
// logout-all requires auth (revokes all sessions for the user identified by access token)
router.post('/logout-all', authenticate, authCtrl.logoutAll);
router.get('/me', authenticate, authCtrl.me);

// Password reset via email OTP. Public endpoints, per-IP+per-email limited.
router.post('/forgot-password', otpLimiter, validate(forgotPasswordSchema), resetCtrl.forgotPassword);
router.post('/verify-reset-otp', otpLimiter, validate(verifyResetOtpSchema), resetCtrl.verifyResetOtp);
router.post('/resend-reset-otp', otpLimiter, validate(resendResetOtpSchema), resetCtrl.resendResetOtp);
router.post('/reset-password', otpLimiter, validate(resetPasswordSchema), resetCtrl.resetPassword);

module.exports = router;
