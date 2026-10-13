require('./setup');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const createApp = require('../src/app');
const { User } = require('../src/models/User');

const app = createApp();

let managerToken;
let adminToken;

beforeEach(async () => {
  const mk = async (role, tag) => User.create({
    firstName: 'T', lastName: tag, email: `${tag}${Date.now()}@x.com`,
    mobileNumber: `+1415555${String(Math.floor(1000 + Math.random() * 8999))}`,
    username: `${tag}${Date.now()}`, profilePicUrl: '',
    passwordHash: await bcrypt.hash('Str0ng!Pass123', 4), role, isActive: true,
  });
  const mgr = await mk('manager', 'leadmgr');
  const adm = await mk('admin', 'leadadm');
  const login = async (email) => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ identifier: email, password: 'Str0ng!Pass123' });
    const r = await agent.post('/api/auth/refresh');
    return r.body.data.accessToken;
  };
  managerToken = await login(mgr.email);
  adminToken = await login(adm.email);
});

const auth = (t) => ({ Authorization: `Bearer ${t}` });
const base = { title: 'Visualeyes Hospital', categoryName: 'Ophthalmology clinic', address: 'Ujjain, MP', city: 'Ujjain', state: 'Madhya Pradesh', website: 'https://visualeyes-hospital.com/', phone: '+91 89820 66690', phoneUnformatted: '+918982066690' };

describe('leads CRUD', () => {
  test('create with all fields + get by id', async () => {
    const c = await request(app).post('/api/leads').set(auth(managerToken)).send(base);
    expect(c.status).toBe(201);
    expect(c.body.data.lead.status).toBe('New');
    const g = await request(app).get(`/api/leads/${c.body.data.lead.id}`).set(auth(managerToken));
    expect(g.status).toBe(200);
    expect(g.body.data.lead.title).toBe(base.title);
  });

  test('create with only title (optionals missing)', async () => {
    const c = await request(app).post('/api/leads').set(auth(adminToken)).send({ title: 'Bare Lead' });
    expect(c.status).toBe(201);
    expect(c.body.data.lead.phone).toBe('');
  });

  test('create with extra fields preserves them in source', async () => {
    const c = await request(app).post('/api/leads').set(auth(managerToken)).send({ title: 'Rich', totalScore: 4.7, location: { lat: 1 } });
    expect(c.status).toBe(201);
    expect(c.body.data.lead.source.totalScore).toBe(4.7);
    expect(c.body.data.lead.source.location).toEqual({ lat: 1 });
  });

  test('direct creation as Converted is rejected (convert via PUT instead)', async () => {
    const r = await request(app).post('/api/leads').set(auth(managerToken)).send({ title: 'Sneaky Convert', status: 'Converted' });
    expect(r.status).toBe(422);
  });

  test('invalid status rejected; bad id 400; missing id 404', async () => {
    expect((await request(app).post('/api/leads').set(auth(managerToken)).send({ title: 'X', status: 'Bogus' })).status).toBe(422);
    expect((await request(app).get('/api/leads/abc').set(auth(managerToken))).status).toBe(400);
    expect((await request(app).get('/api/leads/000000000000000000000000').set(auth(managerToken))).status).toBe(404);
    expect((await request(app).post('/api/leads').set(auth(managerToken)).send({})).status).toBe(422);
  });

  test('edit preserves source extras', async () => {
    const pv = await request(app).post('/api/leads/import/confirm').set(auth(adminToken)).send({ records: [{ ...base, placeId: 'ChIJ1', totalScore: 4.7, openingHours: [{ day: 'Mon' }], permanentlyClosed: false, reviewsCount: null }] });
    expect(pv.body.data.imported).toBe(1);
    const id = (await request(app).get('/api/leads').set(auth(adminToken))).body.data.leads[0].id;
    const u = await request(app).put(`/api/leads/${id}`).set(auth(adminToken)).send({ title: 'Renamed', status: 'Call' });
    expect(u.status).toBe(200);
    expect(u.body.data.lead.title).toBe('Renamed');
    expect(u.body.data.lead.source.totalScore).toBe(4.7);
    expect(u.body.data.lead.source.openingHours).toEqual([{ day: 'Mon' }]);
    expect(u.body.data.lead.source.reviewsCount).toBeNull();
  });

  test('delete removes lead; second delete 404', async () => {
    const c = await request(app).post('/api/leads').set(auth(managerToken)).send({ title: 'Gone' });
    const id = c.body.data.lead.id;
    expect((await request(app).delete(`/api/leads/${id}`).set(auth(managerToken))).status).toBe(200);
    expect((await request(app).delete(`/api/leads/${id}`).set(auth(managerToken))).status).toBe(404);
  });

  test('unauthenticated rejected; manager and admin both allowed', async () => {
    expect((await request(app).get('/api/leads')).status).toBe(401);
    expect((await request(app).get('/api/leads').set(auth(managerToken))).status).toBe(200);
    expect((await request(app).get('/api/leads').set(auth(adminToken))).status).toBe(200);
  });
});

describe('leads import', () => {
  const rec = (over = {}) => ({ ...base, ...over });

  test('preview detects db + in-file duplicates; confirm inserts only new with reconciling counts', async () => {
    await request(app).post('/api/leads').set(auth(managerToken)).send(rec({ placeId: 'PID-1' }));
    const file = [
      rec({ title: 'Dup By Place', placeId: 'PID-1' }),
      rec({ title: 'Dup In File', placeId: 'PID-2', phoneUnformatted: '' }),
      rec({ title: 'Dup In File Copy', placeId: 'PID-2', phoneUnformatted: '' }),
      rec({ title: 'Fresh One', placeId: 'PID-3', phoneUnformatted: '+911234567890' }),
      { nonsense: true },
    ];
    const p = await request(app).post('/api/leads/import/preview').set(auth(managerToken)).send({ records: file });
    expect(p.status).toBe(200);
    expect(p.body.data).toMatchObject({ total: 5, new: 2, dbDuplicates: 1, fileDuplicates: 1, invalid: 1 });
    const c = await request(app).post('/api/leads/import/confirm').set(auth(managerToken)).send({ records: file });
    expect(c.body.data).toMatchObject({ total: 5, imported: 2, skippedDuplicates: 2, invalid: 1 });
    const all = await request(app).get('/api/leads').set(auth(managerToken));
    expect(all.body.data.total).toBe(3); // 1 seed + 2 imported
  });

  test('bulk import up to 5000 records; 5001 rejected', async () => {
    const big = Array.from({ length: 2500 }, (_, i) => ({ title: `Bulk ${i}`, placeId: `BULK-${i}` }));
    const c = await request(app).post('/api/leads/import/confirm').set(auth(managerToken)).send({ records: big });
    expect(c.status).toBe(200);
    expect(c.body.data).toMatchObject({ total: 2500, imported: 2500, skippedDuplicates: 0, invalid: 0 });
    const over = Array.from({ length: 5001 }, (_, i) => ({ title: `Over ${i}` }));
    expect((await request(app).post('/api/leads/import/preview').set(auth(managerToken)).send({ records: over })).status).toBe(422);
  });

  test('single object rejected as records (must be array); malformed root rejected', async () => {
    expect((await request(app).post('/api/leads/import/preview').set(auth(managerToken)).send({ records: { a: 1 } })).status).toBe(422);
    expect((await request(app).post('/api/leads/import/preview').set(auth(managerToken)).send({ nope: [] })).status).toBe(422);
  });

  test('empty phones do not false-match; website/phone/title rules work', async () => {
    await request(app).post('/api/leads').set(auth(managerToken)).send({ title: 'No Phone A' });
    await request(app).post('/api/leads').set(auth(managerToken)).send({ title: 'No Phone B' });
    const p = await request(app).post('/api/leads/import/preview').set(auth(managerToken)).send({ records: [{ title: 'No Phone C' }] });
    expect(p.body.data.dbDuplicates).toBe(0);
    // website match ignoring protocol/case/trailing slash
    await request(app).post('/api/leads').set(auth(managerToken)).send({ title: 'Site', website: 'https://Example.com/' });
    const p2 = await request(app).post('/api/leads/import/preview').set(auth(managerToken)).send({ records: [{ title: 'Other', website: 'http://www.example.com' }] });
    expect(p2.body.data.dbDuplicates).toBe(1);
    // phone digit normalization
    const p3 = await request(app).post('/api/leads/import/preview').set(auth(managerToken)).send({ records: [{ title: 'Ph', phone: '(898) 206-6690', phoneUnformatted: '' }] });
    // '+91 89820 66690' seed not present here; create then match formatted variant
    await request(app).post('/api/leads').set(auth(managerToken)).send({ title: 'Seed Ph', phoneUnformatted: '+918982066690' });
    const p4 = await request(app).post('/api/leads/import/preview').set(auth(managerToken)).send({ records: [{ title: 'Ph2', phone: '+91-89820-66690' }] });
    expect(p4.body.data.dbDuplicates).toBe(1);
    void p3;
  });

  test('reserved _id in source cannot override; nested data preserved', async () => {
    const c = await request(app).post('/api/leads/import/confirm').set(auth(adminToken)).send({
      records: [{ title: 'Sneaky', _id: '000000000000000000000001', __v: 99, location: { lat: 1, lng: 2 }, tags: ['a', 'b'], n: null }],
    });
    expect(c.body.data.imported).toBe(1);
    const list = await request(app).get('/api/leads').set(auth(adminToken));
    const lead = list.body.data.leads.find((l) => l.title === 'Sneaky');
    expect(lead.id).not.toBe('000000000000000000000001');
    expect(lead.source.location).toEqual({ lat: 1, lng: 2 });
    expect(lead.source.tags).toEqual(['a', 'b']);
  });
});

describe('leads search & filters', () => {
  beforeEach(async () => {
    const seeds = [
      { title: 'City Hospital', categoryName: 'Hospital', city: 'Ujjain', state: 'MP', phone: '123', website: 'https://cityhosp.com', status: 'New' },
      { title: 'Smile Dental', categoryName: 'Dental', city: 'Indore', state: 'MP', phone: '', website: '', status: 'Call' },
      { title: 'Web Only Co', categoryName: 'Clinic', city: 'Ujjain', state: 'MP', phone: '', website: 'https://webonly.com', status: 'Whatsapp' },
      { title: 'Phone Only Co', categoryName: 'Clinic', city: 'Bhopal', state: 'MP', phone: '999', website: '', status: 'Message' },
    ];
    for (const s of seeds) await request(app).post('/api/leads').set(auth(adminToken)).send(s);
  });

  test('search, category, city, status, contact filters + combos + pagination', async () => {
    const q = (qs) => request(app).get(`/api/leads?${qs}`).set(auth(managerToken));
    expect((await q('q=hospital')).body.data.total).toBe(1);
    expect((await q('category=Clinic')).body.data.total).toBe(2);
    expect((await q('city=Ujjain')).body.data.total).toBe(2);
    expect((await q('status=Call')).body.data.total).toBe(1);
    expect((await q('contact=phone')).body.data.total).toBe(2);
    expect((await q('contact=website')).body.data.total).toBe(2);
    expect((await q('contact=both')).body.data.total).toBe(1);
    expect((await q('contact=neither')).body.data.total).toBe(1);
    expect((await q('q=co&city=Ujjain&category=Clinic&contact=website')).body.data.total).toBe(1);
    const pg = await q('limit=2&page=2');
    expect(pg.body.data.leads.length).toBe(2);
    expect(pg.body.data.total).toBe(4);
    const f = await request(app).get('/api/leads/filters').set(auth(managerToken));
    expect(f.body.data.categories).toEqual(expect.arrayContaining(['Clinic', 'Dental', 'Hospital']));
    expect(f.body.data.cities).toEqual(expect.arrayContaining(['Bhopal', 'Indore', 'Ujjain']));
  });

  test('mobileOnly / websiteOnly filters incl. edge cases, combos, pagination', async () => {
    const extra = [
      // empty phone + valid phoneUnformatted, no website → mobileOnly
      { title: 'Alt Phone Co', categoryName: 'Clinic', city: 'Ujjain', phone: '', phoneUnformatted: '+911234567890', website: '', status: 'New' },
      // whitespace-only phones + website → websiteOnly
      { title: 'Space Phone Co', categoryName: 'Hospital', city: 'Indore', phone: '   ', phoneUnformatted: ' ', website: 'https://space.com', status: 'Message' },
      // missing fields entirely → neither
      { title: 'Null Fields Co' },
    ];
    for (const s of extra) await request(app).post('/api/leads').set(auth(adminToken)).send(s);
    const q = (qs) => request(app).get(`/api/leads?${qs}`).set(auth(managerToken));
    // Matrix (4 seeds + 3 extra = 7 total)
    expect((await q('contact=mobileOnly')).body.data.total).toBe(2); // Phone Only Co + Alt Phone Co
    expect((await q('contact=websiteOnly')).body.data.total).toBe(2); // Web Only Co + Space Phone Co
    expect((await q('contact=both')).body.data.total).toBe(1);
    expect((await q('contact=neither')).body.data.total).toBe(2); // Smile Dental + Null Fields Co
    expect((await q('contact=phone')).body.data.total).toBe(3);
    expect((await q('contact=website')).body.data.total).toBe(3);
    // Titles resolve to the right buckets
    const titles = async (qs) => (await q(qs)).body.data.leads.map((l) => l.title).sort();
    expect(await titles('contact=mobileOnly')).toEqual(['Alt Phone Co', 'Phone Only Co']);
    expect(await titles('contact=websiteOnly')).toEqual(['Space Phone Co', 'Web Only Co']);
    // Combos: search + category + city + status
    expect((await q('q=co&contact=mobileOnly')).body.data.total).toBe(2);
    expect((await q('category=Clinic&contact=websiteOnly')).body.data.total).toBe(1);
    expect((await q('city=Indore&contact=websiteOnly')).body.data.total).toBe(1);
    expect((await q('status=Message&contact=websiteOnly')).body.data.total).toBe(1);
    expect((await q('status=New&contact=mobileOnly')).body.data.total).toBe(1);
    // Pagination metadata stays accurate under the new filters
    const pg = await q('contact=mobileOnly&limit=1&page=2');
    expect(pg.body.data.total).toBe(2);
    expect(pg.body.data.leads.length).toBe(1);
    expect(pg.body.data.page).toBe(2);
  });
});
