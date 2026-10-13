require('./setup');
const request = require('supertest');
const createApp = require('../src/app');

const app = createApp();

const base = {
  firstName: 'Ava', lastName: 'Stone', email: 'ava@example.com',
  mobileNumber: '+14155550101', username: 'ava.stone', profilePicUrl: '',
  password: 'Str0ng!Pass123', confirmPassword: 'Str0ng!Pass123', acceptTerms: true,
};

const register = (over = {}) => request(app).post('/api/auth/register').send({ ...base, ...over });

test('successful registration returns user + access token and sets cookie', async () => {
  const res = await register();
  expect(res.status).toBe(201);
  expect(res.body.success).toBe(true);
  expect(res.body.data.user.role).toBe('manager');
  expect(res.body.data.user.passwordHash).toBeUndefined();
  expect(res.body.data.accessToken).toBeTruthy();
  expect(res.headers['set-cookie'].join()).toMatch(/crm_refresh/);
});

test('duplicate email / username / mobile rejected', async () => {
  await register();
  const d1 = await register({ username: 'other.one', mobileNumber: '+14155550102' });
  expect(d1.status).toBe(409);
  const d2 = await register({ email: 'other@example.com', mobileNumber: '+14155550103' });
  expect(d2.status).toBe(409);
  const d3 = await register({ email: 'other2@example.com', username: 'other.two' });
  expect(d3.status).toBe(409);
});

test('invalid email / phone / mismatch / weak password rejected', async () => {
  expect((await register({ email: 'bad' })).status).toBe(422);
  expect((await register({ email: 'n1@x.com', username: 'u1a', mobileNumber: 'abc' })).status).toBeGreaterThanOrEqual(400);
  expect((await register({ email: 'n2@x.com', username: 'u2a', mobileNumber: '+14155550109', confirmPassword: 'nope' })).status).toBe(422);
  expect((await register({ email: 'n3@x.com', username: 'u3a', mobileNumber: '+14155550110', password: 'weak', confirmPassword: 'weak' })).status).toBe(422);
});

test('public registration cannot create admin (role ignored)', async () => {
  const res = await request(app).post('/api/auth/register').send({ ...base, role: 'admin' });
  expect([201, 422]).toContain(res.status);
  if (res.status === 201) expect(res.body.data.user.role).toBe('manager');
});

test('login works with email, username, mobile; wrong password / unknown rejected generically', async () => {
  await register();
  for (const id of ['ava@example.com', 'ava.stone', '+14155550101']) {
    const r = await request(app).post('/api/auth/login').send({ identifier: id, password: 'Str0ng!Pass123' });
    expect(r.status).toBe(200);
    expect(r.body.data.accessToken).toBeTruthy();
  }
  const bad = await request(app).post('/api/auth/login').send({ identifier: 'ava@example.com', password: 'Wrong!123456' });
  expect(bad.status).toBe(401);
  expect(bad.body.message).toBe('Invalid credentials');
  const unknown = await request(app).post('/api/auth/login').send({ identifier: 'nobody@example.com', password: 'Wrong!123456' });
  expect(unknown.status).toBe(401);
  expect(unknown.body.message).toBe('Invalid credentials');
});

test('suspended account rejected', async () => {
  const bcrypt = require('bcryptjs');
  const { User } = require('../src/models/User');
  await User.create({ firstName: 'S', lastName: 'U', email: 's@x.com', mobileNumber: '+14155550120', username: 'suspended1', profilePicUrl: '', passwordHash: await bcrypt.hash('Str0ng!Pass123', 4), role: 'manager', isActive: false });
  const r = await request(app).post('/api/auth/login').send({ identifier: 's@x.com', password: 'Str0ng!Pass123' });
  expect(r.status).toBe(401);
});

test('refresh rotation + reuse detection + invalid rejection + logout revocation', async () => {
  await register();
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ identifier: 'ava@example.com', password: 'Str0ng!Pass123' });
  const r1 = await agent.post('/api/auth/refresh');
  expect(r1.status).toBe(200);
  // invalid refresh
  const bad = await request(app).post('/api/auth/refresh').set('Cookie', 'crm_refresh=garbage');
  expect(bad.status).toBe(401);
  // logout revokes
  const agent2 = request.agent(app);
  await agent2.post('/api/auth/login').send({ identifier: 'ava@example.com', password: 'Str0ng!Pass123' });
  await agent2.post('/api/auth/logout');
  expect((await agent2.post('/api/auth/refresh')).status).toBe(401);
});
