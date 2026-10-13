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
  // fetch access token via refresh to get a fresh access token deterministically
  const r = await agent.post('/api/auth/refresh');
  return { agent, token: r.body.data.accessToken, user };
}

test('unauthenticated request to protected endpoint → 401', async () => {
  expect((await request(app).get('/api/auth/me')).status).toBe(401);
  expect((await request(app).get('/api/admin/users')).status).toBe(401);
});

test('manager cannot access admin endpoint → 403; admin can → 200', async () => {
  const mgr = await seed('manager');
  const adm = await seed('admin');
  const m = await loginAs(mgr);
  expect((await request(app).get('/api/admin/users').set('Authorization', `Bearer ${m.token}`)).status).toBe(403);
  const a = await loginAs(adm);
  expect((await request(app).get('/api/admin/users').set('Authorization', `Bearer ${a.token}`)).status).toBe(200);
});

test('manager cannot self-promote or edit others; deactivation blocks session', async () => {
  const mgr = await seed('manager');
  const m = await loginAs(mgr);
  const auth = { Authorization: `Bearer ${m.token}` };
  // self-promote via /users/me with role field → strict schema rejects / ignores
  expect((await request(app).patch('/api/users/me').set(auth).send({ role: 'admin' })).status).toBe(422);
  const other = await seed('manager');
  // manager has no route to patch others → 404
  expect((await request(app).patch(`/api/admin/users/${other._id}`).set(auth).send({ firstName: 'X' })).status).toBe(403);
  // admin deactivates manager → subsequent /me fails
  const adm = await seed('admin');
  const a = await loginAs(adm);
  await request(app).patch(`/api/admin/users/${mgr._id}/status`).set({ Authorization: `Bearer ${a.token}` }).send({ isActive: false });
  expect((await request(app).get('/api/auth/me').set(auth)).status).toBe(401);
});

test('invalid/expired JWT → 401', async () => {
  expect((await request(app).get('/api/auth/me').set('Authorization', 'Bearer garbage')).status).toBe(401);
});
