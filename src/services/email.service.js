const env = require('../config/env');

const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';

function otpHtml({ appName, otp, expiryMinutes }) {
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;background:#F8FAFC;padding:24px;">
<div style="max-width:480px;margin:0 auto;background:#FFFFFF;border:1px solid #E5E7EB;border-radius:12px;padding:32px;">
<h2 style="color:#111827;margin:0 0 8px;">Your Password Reset Verification Code</h2>
<p style="color:#6B7280;font-size:14px;">You requested a password reset for <strong>${appName}</strong>. Use this code:</p>
<p style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#5727B2;text-align:center;margin:24px 0;">${otp}</p>
<p style="color:#6B7280;font-size:14px;">This code expires in ${expiryMinutes} minutes. Never share it with anyone — our team will never ask for it.</p>
<p style="color:#6B7280;font-size:12px;">If you did not request this, you can safely ignore this email.</p>
</div></body></html>`;
}

function otpText({ appName, otp, expiryMinutes }) {
  return [
    'Your Password Reset Verification Code',
    '',
    `You requested a password reset for ${appName}. Use this code:`,
    '',
    otp,
    '',
    `This code expires in ${expiryMinutes} minutes. Never share it with anyone.`,
    'If you did not request this, you can safely ignore this email.',
  ].join('\n');
}

/**
 * Sends the password-reset OTP via Brevo transactional email.
 * Resolves { sent: true } only when Brevo accepts the request (2xx).
 * Never logs the OTP, the API key, or message contents.
 */
async function sendResetOtp({ toEmail, toName, otp }) {
  if (!env.BREVO_API_KEY) {
    if (env.MAIL_DEV_VISIBLE) {
      // Local-only testing without Brevo credentials: skip the network send.
      // The OTP itself is returned in the API response (dev hatch) and is
      // NEVER written to logs here.
      // eslint-disable-next-line no-console
      console.log(`[dev-mail] skipped Brevo send for password-reset OTP to ${toEmail}`);
      return { sent: false, devSkipped: true };
    }
    const err = new Error('Email service is not configured');
    err.statusCode = 503;
    throw err;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(BREVO_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'api-key': env.BREVO_API_KEY,
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { email: env.EMAIL_FROM, name: env.EMAIL_FROM_NAME },
        to: [{ email: toEmail, name: toName || toEmail }],
        subject: 'Your Password Reset Verification Code',
        htmlContent: otpHtml({ appName: env.EMAIL_FROM_NAME, otp, expiryMinutes: env.OTP_EXPIRY_MINUTES }),
        textContent: otpText({ appName: env.EMAIL_FROM_NAME, otp, expiryMinutes: env.OTP_EXPIRY_MINUTES }),
      }),
    });
    if (!res.ok) {
      // Log only the HTTP status for ops debugging — never the key, OTP, or body.
      // eslint-disable-next-line no-console
      console.warn(`[email] Brevo rejected send request (status ${res.status})`);
      const err = new Error('Could not send the verification email — please try again shortly');
      err.statusCode = 503;
      throw err;
    }
    return { sent: true };
  } catch (err) {
    if (err && err.statusCode) throw err;
    const wrapped = new Error('Could not send the verification email — please try again shortly');
    wrapped.statusCode = 503;
    throw wrapped;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { sendResetOtp };
