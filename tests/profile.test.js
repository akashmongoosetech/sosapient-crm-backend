require('./setup');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const createApp = require('../src/app');
const { User } = require('../src/models/User');

const app = createApp();

async function seed(role, over = {}) {
  return User.create({
    firstName: 'T', lastName: 'U', email: `${role}${Date.now()}${Math.random()}@x.com`,
    mobileNumber: `+1415555${String(Math.floor(1000 + Math.random() * 8999))}`,
    username: `${role}${Date.now()}${Math.floor(Math.random() * 9999)}`,
    profilePicUrl: '', passwordHash: await bcrypt.hash('Str0ng!Pass123', 4),
    role, isActive: true, ...over,
  });
}

async function loginAs(user, password = 'Str0ng!Pass123') {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ identifier: user.email, password });
  const r = await agent.post('/api/auth/refresh');
  return { agent, token: r.body.data.accessToken, user };
}

test('manager updates all profile fields; avatar + names persist', async () => {
  const mgr = await seed('manager');
  const m = await loginAs(mgr);
  const auth = { Authorization: `Bearer ${m.token}` };
  const r = await request(app).patch('/api/users/me').set(auth).send({
    firstName: 'Priya', lastName: 'Verma',
    email: 'priya.verma@example.com',
    mobileNumber: '+14155550101',
    profilePicUrl: 'https://example.com/priya.png',
  });
  expect(r.status).toBe(200);
  expect(r.body.data.user).toMatchObject({
    firstName: 'Priya', lastName: 'Verma', email: 'priya.verma@example.com',
    profilePicUrl: 'https://example.com/priya.png',
  });
  expect(r.body.data.user.passwordHash).toBeUndefined();
  // email change resets verification
  expect(r.body.data.user.emailVerified).toBe(false);
});

test('email conflict / invalid email / invalid phone rejected', async () => {
  const a = await seed('manager');
  const b = await seed('manager');
  const m = await loginAs(a);
  const auth = { Authorization: `Bearer ${m.token}` };
  const dup = await request(app).patch('/api/users/me').set(auth).send({ email: b.email });
  expect(dup.status).toBe(409);
  expect(dup.body.errors[0].field).toBe('email');
  expect((await request(app).patch('/api/users/me').set(auth).send({ email: 'not-an-email' })).status).toBe(422);
  expect((await request(app).patch('/api/users/me').set(auth).send({ mobileNumber: 'abc' })).status).toBeGreaterThanOrEqual(400);
});

test('role/isActive/username cannot be changed via profile; strict schema 422', async () => {
  const mgr = await seed('manager');
  const m = await loginAs(mgr);
  const auth = { Authorization: `Bearer ${m.token}` };
  expect((await request(app).patch('/api/users/me').set(auth).send({ role: 'admin' })).status).toBe(422);
  expect((await request(app).patch('/api/users/me').set(auth).send({ isActive: false })).status).toBe(422);
  const after = await User.findById(mgr._id);
  expect(after.role).toBe('manager');
  expect(after.isActive).toBe(true);
});

test('password change: success, login with new, wrong current, weak, mismatch', async () => {
  const mgr = await seed('manager');
  const m = await loginAs(mgr);
  const auth = { Authorization: `Bearer ${m.token}` };
  const ok = await request(app).patch('/api/users/me/password').set(auth).send({
    currentPassword: 'Str0ng!Pass123', newPassword: 'N3w!StrongPass1', confirmNewPassword: 'N3w!StrongPass1',
  });
  expect(ok.status).toBe(200);
  // new password works, old does not
  const relog = await loginAs(mgr, 'N3w!StrongPass1');
  expect(relog.token).toBeTruthy();
  expect((await request(app).post('/api/auth/login').send({ identifier: mgr.email, password: 'Str0ng!Pass123' })).status).toBe(401);
  // wrong current
  expect((await request(app).patch('/api/users/me/password').set(auth).send({
    currentPassword: 'Wrong!123456', newPassword: 'N3w!StrongPass2', confirmNewPassword: 'N3w!StrongPass2',
  })).status).toBe(422);
  // weak + mismatch
  expect((await request(app).patch('/api/users/me/password').set(auth).send({
    currentPassword: 'N3w!StrongPass1', newPassword: 'weak', confirmNewPassword: 'weak',
  })).status).toBe(422);
  expect((await request(app).patch('/api/users/me/password').set(auth).send({
    currentPassword: 'N3w!StrongPass1', newPassword: 'N3w!StrongPass2', confirmNewPassword: 'different',
  })).status).toBe(422);
});

test('profile endpoints require auth', async () => {
  expect((await request(app).patch('/api/users/me').send({ firstName: 'X' })).status).toBe(401);
  expect((await request(app).patch('/api/users/me/password').send({})).status).toBe(401);
});
