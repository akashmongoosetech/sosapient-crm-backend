const resetService = require('../services/passwordReset.service');

async function forgotPassword(req, res, next) {
  try {
    const data = await resetService.requestReset(req.body.email);
    res.json({ success: true, message: data.message, data });
  } catch (err) {
    next(err);
  }
}

async function verifyResetOtp(req, res, next) {
  try {
    const data = await resetService.verifyOtp(req.body.email, req.body.otp);
    res.json({ success: true, message: 'Code verified — choose a new password', data });
  } catch (err) {
    next(err);
  }
}

async function resendResetOtp(req, res, next) {
  try {
    const data = await resetService.resendOtp(req.body.email);
    res.json({ success: true, message: data.message, data });
  } catch (err) {
    next(err);
  }
}

async function resetPassword(req, res, next) {
  try {
    await resetService.resetPassword(req.body.resetToken, req.body.newPassword);
    res.json({ success: true, message: 'Your password has been changed — please sign in', data: {} });
  } catch (err) {
    next(err);
  }
}

module.exports = { forgotPassword, verifyResetOtp, resendResetOtp, resetPassword };
