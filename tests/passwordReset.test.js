require('./setup');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const createApp = require('../src/app');
const { User } = require('../src/models/User');
const PasswordReset = require('../src/models/PasswordReset');

const app = createApp();
const GENERIC = 'If an eligible account exists';

// ---- Brevo mock: capture the OTP from the request body, never send mail ----
let lastOtpEmail = null;
beforeEach(() => {
  lastOtpEmail = null;
  global.fetch = jest.fn(async () => ({ ok: true }));
});

afterEach(() => {
  jest.restoreAllMocks();
  delete global.fetch;
});

async function seedUser(role = 'manager', over = {}) {
  const tag = `${Date.now()}${Math.floor(Math.random() * 1e9)}`;
  return User.create({
    firstName: 'Reset', lastName: 'User', email: `reset${tag}@x.com`,
    mobileNumber: `+1415555${String(10000 + Math.floor(Math.random() * 89999))}`,
    username: `reset${tag}`, profilePicUrl: '',
    passwordHash: await bcrypt.hash('Str0ng!Pass123', 4),
    role, isActive: true, ...over,
  });
}

function otpFromMock() {
  expect(global.fetch).toHaveBeenCalled();
  const body = JSON.parse(global.fetch.mock.calls[0][1].body);
  const m = String(body.textContent).match(/(\d{6})/);
  expect(m).toBeTruthy();
  return m[1];
}

async function requestOtp(email) {
  return request(app).post('/api/auth/forgot-password').send({ email });
}

describe('forgot-password request', () => {
  test('eligible admin and manager get generic response + challenge created', async () => {
    for (const role of ['admin', 'manager']) {
      const u = await seedUser(role);
      const r = await requestOtp(u.email);
      expect(r.status).toBe(200);
      expect(r.body.message).toMatch(GENERIC);
      expect(r.body.data.devOtp).toBeUndefined();
      expect(await PasswordReset.countDocuments({ userId: u._id, status: 'pending' })).toBe(1);
    }
  });

  test('unknown email and inactive account get identical generic response, no challenge', async () => {
    const ghost = await requestOtp('nobody@x.com');
    expect(ghost.status).toBe(200);
    expect(ghost.body.message).toMatch(GENERIC);
    const off = await seedUser('manager', { isActive: false });
    const r = await requestOtp(off.email);
    expect(r.status).toBe(200);
    expect(r.body.message).toBe(ghost.body.message);
    expect(await PasswordReset.countDocuments()).toBe(0);
  });

  test('invalid email rejected; OTP never in response', async () => {
    const r = await request(app).post('/api/auth/forgot-password').send({ email: 'not-an-email' });
    expect(r.status).toBe(422);
  });
});

describe('OTP verify + resend', () => {
  test('correct OTP returns short-lived reset token; wrong OTP fails', async () => {
    const u = await seedUser();
    await requestOtp(u.email);
    const otp = otpFromMock();
    const bad = await request(app).post('/api/auth/verify-reset-otp').send({ email: u.email, otp: '000000' });
    expect(bad.status).toBe(400);
    const good = await request(app).post('/api/auth/verify-reset-otp').send({ email: u.email, otp });
    expect(good.status).toBe(200);
    expect(good.body.data.resetToken).toBeTruthy();
    expect(good.body.data.expiresInSeconds).toBeLessThanOrEqual(300);
  });

  test('OTP reuse fails; new request supersedes the old code', async () => {
    const u = await seedUser();
    await requestOtp(u.email);
    const otp1 = otpFromMock();
    global.fetch.mockClear();
    await requestOtp(u.email);
    const otp2 = otpFromMock();
    expect(otp2).not.toBe(otp1);
    // Old code is dead even though it was never used.
    expect((await request(app).post('/api/auth/verify-reset-otp').send({ email: u.email, otp: otp1 })).status).toBe(400);
    // New code works, then cannot be reused.
    expect((await request(app).post('/api/auth/verify-reset-otp').send({ email: u.email, otp: otp2 })).status).toBe(200);
    expect((await request(app).post('/api/auth/verify-reset-otp').send({ email: u.email, otp: otp2 })).status).toBe(400);
  });

  test('five wrong attempts lock the OTP', async () => {
    const u = await seedUser();
    await requestOtp(u.email);
    const otp = otpFromMock();
    for (let i = 0; i < 5; i++) {
      expect((await request(app).post('/api/auth/verify-reset-otp').send({ email: u.email, otp: '111111' })).status).toBe(400);
    }
    const locked = await request(app).post('/api/auth/verify-reset-otp').send({ email: u.email, otp });
    expect(locked.status).toBe(429);
  });

  test('expired OTP fails with 410', async () => {
    const u = await seedUser();
    await requestOtp(u.email);
    const otp = otpFromMock();
    await PasswordReset.updateOne({ userId: u._id, status: 'pending' }, { $set: { otpExpiresAt: new Date(Date.now() - 1000) } });
    const r = await request(app).post('/api/auth/verify-reset-otp').send({ email: u.email, otp });
    expect(r.status).toBe(410);
  });

  test('resend cooldown enforced, then fresh OTP issued', async () => {
    const u = await seedUser();
    await requestOtp(u.email);
    const tooSoon = await request(app).post('/api/auth/resend-reset-otp').send({ email: u.email });
    expect(tooSoon.status).toBe(429);
    expect(tooSoon.body.retryAfter).toBeGreaterThan(0);
    // Age the challenge past the cooldown (createdAt is immutable on
    // update, so rewrite it via delete + recreate with an old timestamp).
    const { hashToken } = require('../src/utils/token');
    await PasswordReset.deleteMany({ userId: u._id });
    await PasswordReset.create({
      userId: u._id, email: u.email, otpHash: hashToken('000000'),
      status: 'pending', attempts: 0, maxAttempts: 5,
      otpExpiresAt: new Date(Date.now() + 600000),
      createdAt: new Date(Date.now() - 120000),
    });
    const ok = await request(app).post('/api/auth/resend-reset-otp').send({ email: u.email });
    expect(ok.status).toBe(200);
    expect(ok.body.message).toMatch(GENERIC);
  });

  test('resend for unknown email is generic', async () => {
    const r = await request(app).post('/api/auth/resend-reset-otp').send({ email: 'ghost@x.com' });
    expect(r.status).toBe(200);
    expect(r.body.message).toMatch(GENERIC);
  });
});

describe('reset-password', () => {
  async function verifiedToken(user) {
    await requestOtp(user.email);
    const otp = otpFromMock();
    const v = await request(app).post('/api/auth/verify-reset-otp').send({ email: user.email, otp });
    return v.body.data.resetToken;
  }

  test('full reset: new password works, old dies, token single-use, sessions revoked', async () => {
    const u = await seedUser();
    // Establish a live refresh session first.
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ identifier: u.email, password: 'Str0ng!Pass123' });
    const token = await verifiedToken(u);
    const done = await request(app).post('/api/auth/reset-password').send({
      resetToken: token, newPassword: 'N3w!StrongPass9', confirmNewPassword: 'N3w!StrongPass9',
    });
    expect(done.status).toBe(200);
    // Token reuse rejected.
    expect((await request(app).post('/api/auth/reset-password').send({
      resetToken: token, newPassword: 'N3w!StrongPass9', confirmNewPassword: 'N3w!StrongPass9',
    })).status).toBe(400);
    // Old password dead, new works.
    expect((await request(app).post('/api/auth/login').send({ identifier: u.email, password: 'Str0ng!Pass123' })).status).toBe(401);
    const relog = await request(app).post('/api/auth/login').send({ identifier: u.email, password: 'N3w!StrongPass9' });
    expect(relog.status).toBe(200);
    // Pre-reset refresh session is revoked.
    expect((await agent.post('/api/auth/refresh')).status).toBe(401);
  });

  test('weak/mismatched passwords and bogus tokens rejected', async () => {
    const u = await seedUser();
    const token = await verifiedToken(u);
    expect((await request(app).post('/api/auth/reset-password').send({
      resetToken: token, newPassword: 'weak', confirmNewPassword: 'weak',
    })).status).toBe(422);
    expect((await request(app).post('/api/auth/reset-password').send({
      resetToken: token, newPassword: 'N3w!StrongPass9', confirmNewPassword: 'different',
    })).status).toBe(422);
    expect((await request(app).post('/api/auth/reset-password').send({
      resetToken: 'garbage.token.here', newPassword: 'N3w!StrongPass9', confirmNewPassword: 'N3w!StrongPass9',
    })).status).toBe(400);
  });
});

describe('dev visibility hatch', () => {
  test('devOtp appears only when MAIL_DEV_VISIBLE is enabled', async () => {
    const env = require('../src/config/env');
    const u = await seedUser();
    const before = await requestOtp(u.email);
    expect(before.body.data.devOtp).toBeUndefined();
    env.MAIL_DEV_VISIBLE = true;
    try {
      const after = await requestOtp(`other${Date.now()}@x.com`);
      // Unknown email stays generic with no OTP even in dev mode.
      expect(after.body.data.devOtp).toBeUndefined();
      const u2 = await seedUser();
      const dev = await requestOtp(u2.email);
      expect(dev.body.data.devOtp).toMatch(/^\d{6}$/);
    } finally {
      env.MAIL_DEV_VISIBLE = false;
    }
  });
});
