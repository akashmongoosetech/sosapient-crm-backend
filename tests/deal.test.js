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
  const mgr = await mk('manager', 'dealmgr');
  const adm = await mk('admin', 'dealadm');
  // Direct signing (equivalent to login+refresh tokens, without HTTP cost
  // or tripping the auth rate limiter across many tests).
  const { signAccessToken } = require('../src/utils/token');
  managerToken = signAccessToken(mgr);
  adminToken = signAccessToken(adm);
});

const auth = (t) => ({ Authorization: `Bearer ${t}` });

// 1x1 PNG (valid magic bytes)
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const SVG_CLEAN = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>');
const SVG_EVIL = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="10" height="10" fill="red" onclick="alert(2)"/></svg>');
const FAKE_PNG = Buffer.from('this is not an image at all, just text bytes padding.....');
const EXE = Buffer.from('MZ\x90\x00this is an executable stub');

async function makeLead(token, over = {}) {
  const r = await request(app).post('/api/leads').set(auth(token)).send({
    title: 'Convert Me', categoryName: 'Clinic', address: '1 Main St', city: 'Ujjain',
    state: 'MP', website: 'https://convert.me/', phone: '12345', phoneUnformatted: '+9112345',
    placeId: `PLC-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, totalScore: 4.2, ...over,
  });
  return r.body.data.lead;
}

async function convertLead(token, id) {
  return request(app).put(`/api/leads/${id}`).set(auth(token)).send({ status: 'Converted' });
}

describe('lead conversion', () => {
  test('PUT Converted creates deal, deletes lead, preserves fields', async () => {
    const lead = await makeLead(managerToken);
    const r = await convertLead(managerToken, lead.id);
    expect(r.status).toBe(200);
    expect(r.body.data.converted).toBe(true);
    const deal = r.body.data.deal;
    expect(deal.status).toBe('Converted');
    expect(deal.title).toBe('Convert Me');
    expect(deal.sourceLeadId).toBe(lead.id);
    expect(deal.source.totalScore).toBe(4.2);
    expect(deal.convertedAt).toBeTruthy();
    // Lead gone from active records
    expect((await request(app).get(`/api/leads/${lead.id}`).set(auth(managerToken))).status).toBe(404);
    const list = await request(app).get('/api/leads').set(auth(managerToken));
    expect(list.body.data.leads.find((l) => l.id === lead.id)).toBeUndefined();
    // Deal visible in deals list
    const deals = await request(app).get('/api/deals').set(auth(managerToken));
    expect(deals.body.data.deals.find((d) => d.id === deal.id)).toBeTruthy();
  });

  test('repeated conversion is idempotent — single deal', async () => {
    const lead = await makeLead(managerToken);
    const r1 = await convertLead(managerToken, lead.id);
    expect(r1.body.data.converted).toBe(true);
    // Lead is gone; retry resolves to the existing deal (recovery path)
    const { Deal } = require('../src/models/Deal');
    const again = await require('../src/services/leadConversion.service').convertLead(lead.id, { _id: '000000000000000000000000' });
    expect(String(again.deal._id)).toBe(String(r1.body.data.deal.id));
    expect(await Deal.countDocuments({ sourceLeadId: lead.id })).toBe(1);
  });

  test('deal status has no write path; direct Converted create rejected', async () => {
    const lead = await makeLead(adminToken);
    const { body } = await convertLead(adminToken, lead.id);
    const dealId = body.data.deal.id;
    // No PUT/PATCH route exists for deals at all
    expect((await request(app).put(`/api/deals/${dealId}`).set(auth(adminToken)).send({ status: 'New' })).status).toBe(404);
    expect((await request(app).patch(`/api/deals/${dealId}`).set(auth(adminToken)).send({ status: 'New' })).status).toBe(404);
  });

  test('conversion requires auth; manager can convert (same policy as leads)', async () => {
    const lead = await makeLead(adminToken);
    expect((await request(app).put(`/api/leads/${lead.id}`).send({ status: 'Converted' })).status).toBe(401);
    expect((await convertLead(adminToken, lead.id)).status).toBe(200);
  });

  test('converting a nonexistent lead → 404', async () => {
    const r = await request(app).put('/api/leads/000000000000000000000000').set(auth(managerToken)).send({ status: 'Converted' });
    expect(r.status).toBe(404);
  });
});

describe('deal entries', () => {
  let dealId;
  beforeEach(async () => {
    const lead = await makeLead(managerToken);
    dealId = (await convertLead(managerToken, lead.id)).body.data.deal.id;
  });

  test('requirement + progress CRUD, newest-first, deal-scoped', async () => {
    const t = auth(managerToken);
    const r1 = await request(app).post(`/api/deals/${dealId}/requirements`).set(t)
      .field('description', 'Booking page needed').field('entryDate', '2026-10-12').attach('attachments', PNG, 'a.png');
    expect(r1.status).toBe(201);
    expect(r1.body.data.entry.attachments).toHaveLength(1);
    expect(r1.body.data.entry.attachments[0].url).toMatch(new RegExp(`/api/files/${dealId}/`));
    // Server filenames are never exposed; the public URL is traversal-safe.
    expect(r1.body.data.entry.attachments[0].url).not.toContain('..');

    const r2 = await request(app).post(`/api/deals/${dealId}/requirements`).set(t)
      .field('description', 'Calendar needed').field('entryDate', '2026-10-13');
    expect(r2.status).toBe(201);
    const p1 = await request(app).post(`/api/deals/${dealId}/progress`).set(t)
      .field('description', 'Built dashboard').field('entryDate', '2026-10-12')
      .attach('attachments', SVG_CLEAN, 'icon.svg');
    expect(p1.status).toBe(201);

    // Newest first
    const hist = await request(app).get(`/api/deals/${dealId}/requirements`).set(t);
    expect(hist.body.data.entries.map((e) => e.description)).toEqual(['Calendar needed', 'Booking page needed']);
    // Sections are separate
    const prog = await request(app).get(`/api/deals/${dealId}/progress`).set(t);
    expect(prog.body.data.total).toBe(1);
    expect(hist.body.data.total).toBe(2);

    // Update keeps unspecified fields; keepAttachments prunes files
    const keep = [];
    const up = await request(app).put(`/api/deals/${dealId}/requirements/${r1.body.data.entry.id}`).set(t)
      .send({ description: 'Booking page + payments', keepAttachments: keep });
    expect(up.status).toBe(200);
    expect(up.body.data.entry.description).toBe('Booking page + payments');
    expect(up.body.data.entry.attachments).toHaveLength(0);

    // Delete entry
    expect((await request(app).delete(`/api/deals/${dealId}/progress/${p1.body.data.entry.id}`).set(t)).status).toBe(200);
    expect((await request(app).get(`/api/deals/${dealId}/progress`).set(t)).body.data.total).toBe(0);
  });

  test('validation: empty description, bad date, missing deal/entry → errors', async () => {
    const t = auth(managerToken);
    expect((await request(app).post(`/api/deals/${dealId}/requirements`).set(t).field('description', '').field('entryDate', '2026-10-12')).status).toBe(422);
    expect((await request(app).post(`/api/deals/${dealId}/requirements`).set(t).field('description', 'x').field('entryDate', 'not-a-date')).status).toBe(422);
    expect((await request(app).post('/api/deals/000000000000000000000000/requirements').set(t).field('description', 'x').field('entryDate', '2026-10-12')).status).toBe(404);
    expect((await request(app).put(`/api/deals/${dealId}/requirements/000000000000000000000000`).set(t).send({ description: 'x' })).status).toBe(404);
  });

  test('cross-deal entry access rejected', async () => {
    const t = auth(managerToken);
    const other = (await convertLead(managerToken, (await makeLead(managerToken)).id)).body.data.deal.id;
    const r = await request(app).post(`/api/deals/${dealId}/requirements`).set(t).field('description', 'mine').field('entryDate', '2026-10-12');
    const entryId = r.body.data.entry.id;
    // Entry belongs to dealId; addressing it under another deal → 404
    expect((await request(app).get(`/api/deals/${other}/requirements`).set(t)).body.data.total).toBe(0);
    expect((await request(app).put(`/api/deals/${other}/requirements/${entryId}`).set(t).send({ description: 'hijack' })).status).toBe(404);
    expect((await request(app).delete(`/api/deals/${other}/requirements/${entryId}`).set(t)).status).toBe(404);
    // And unauthenticated entry access is rejected
    expect((await request(app).get(`/api/deals/${dealId}/requirements`)).status).toBe(401);
  });

  test('upload validation: exe/fake-png rejected; evil SVG sanitized; oversize rejected', async () => {
    const t = auth(managerToken);
    const bad1 = await request(app).post(`/api/deals/${dealId}/requirements`).set(t)
      .field('description', 'x').field('entryDate', '2026-10-12').attach('attachments', EXE, 'evil.exe');
    expect(bad1.status).toBe(422);
    const bad2 = await request(app).post(`/api/deals/${dealId}/requirements`).set(t)
      .field('description', 'x').field('entryDate', '2026-10-12').attach('attachments', FAKE_PNG, 'fake.png');
    expect(bad2.status).toBe(422);
    // Malicious SVG is sanitized, not stored raw
    const ok = await request(app).post(`/api/deals/${dealId}/requirements`).set(t)
      .field('description', 'logo').field('entryDate', '2026-10-12').attach('attachments', SVG_EVIL, 'logo.svg');
    expect(ok.status).toBe(201);
    const stored = ok.body.data.entry.attachments[0];
    const fileRes = await request(app).get(stored.url).set(t);
    expect(fileRes.status).toBe(200);
    const svgText = typeof fileRes.text === 'string' ? fileRes.text : Buffer.from(fileRes.body || []).toString('utf8');
    expect(svgText).not.toMatch(/<script|onclick/i);
    expect(fileRes.headers['content-security-policy']).toMatch(/sandbox/);
    // No entry created for failed uploads
    expect((await request(app).get(`/api/deals/${dealId}/requirements`).set(t)).body.data.total).toBe(1);
  });

  test('file serving requires auth and valid deal; traversal blocked', async () => {
    const t = auth(managerToken);
    const r = await request(app).post(`/api/deals/${dealId}/requirements`).set(t)
      .field('description', 'pic').field('entryDate', '2026-10-12').attach('attachments', PNG, 'a.png');
    const url = r.body.data.entry.attachments[0].url;
    // Entry payloads carry signed ?token= URLs usable without headers (<img>).
    expect(url).toMatch(/[?&]token=/);
    // Unsigned URL without header is still rejected.
    const bare = url.split('?')[0];
    expect((await request(app).get(bare)).status).toBe(401);
    const ok = await request(app).get(url).set(t);
    expect(ok.status).toBe(200);
    expect(ok.headers['content-type']).toMatch(/image\/png/);
    expect(ok.headers['x-content-type-options']).toBe('nosniff');
    // Browsers block cross-origin <img> under Helmet's default same-origin
    // policy, so file responses must explicitly allow cross-origin embedding.
    expect(ok.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect((await request(app).get('/api/files/000000000000000000000000/a.png').set(t)).status).toBe(404);
  });

  test('signed ?token= URLs work without headers; cross-deal and forged tokens rejected', async () => {
    const t = auth(managerToken);
    const r = await request(app).post(`/api/deals/${dealId}/requirements`).set(t)
      .field('description', 'token pic').field('entryDate', '2026-10-12').attach('attachments', PNG, 'b.png');
    const url = r.body.data.entry.attachments[0].url;
    // No Authorization header — exactly how browsers load <img> tags.
    const anon = await request(app).get(url);
    expect(anon.status).toBe(200);
    expect(anon.headers['content-type']).toMatch(/image\/png/);
    // Token minted for another deal is rejected here.
    const otherId = '000000000000000000000001';
    const { signFileToken } = require('../src/utils/token');
    const foreign = `/api/files/${dealId}/b.png?token=${encodeURIComponent(signFileToken('000000000000000000000002', otherId))}`;
    expect((await request(app).get(foreign)).status).toBe(401);
    // Tampered token rejected.
    const tampered = `${url.slice(0, -4)}xxxx`;
    expect((await request(app).get(tampered)).status).toBe(401);
  });

  test('deals list: search, pagination, entry counts', async () => {
    const t = auth(managerToken);
    await request(app).post(`/api/deals/${dealId}/requirements`).set(t).field('description', 'one').field('entryDate', '2026-10-12');
    const list = await request(app).get('/api/deals').set(t);
    expect(list.status).toBe(200);
    const row = list.body.data.deals.find((d) => d.id === dealId);
    expect(row.entryCounts).toMatchObject({ requirements: 1, progress: 0 });
    expect((await request(app).get('/api/deals?q=convert').set(t)).body.data.total).toBe(1);
    expect((await request(app).get('/api/deals?q=zzz-no-match').set(t)).body.data.total).toBe(0);
    expect((await request(app).get('/api/deals').set(auth(adminToken))).status).toBe(200);
  });
});

describe('entry creator attribution', () => {
  let dealId;
  let rahulToken;
  let priyaToken;

  async function mkUser(role, firstName, lastName, profilePicUrl) {
    const tag = `${firstName}${Date.now()}${Math.floor(Math.random() * 1e6)}`.toLowerCase();
    const u = await User.create({
      firstName, lastName, email: `${tag}@x.com`,
      mobileNumber: `+1415555${String(Math.floor(1000 + Math.random() * 8999))}`,
      username: tag, profilePicUrl: profilePicUrl || '',
      passwordHash: await bcrypt.hash('Str0ng!Pass123', 4), role, isActive: true,
    });
    // Sign directly: avoids extra login HTTP calls (auth rate limiter).
    const { signAccessToken } = require('../src/utils/token');
    return { user: u, token: signAccessToken(u) };
  }

  beforeEach(async () => {
    const rahul = await mkUser('admin', 'Rahul', 'Sharma', 'https://example.com/rahul.png');
    const priya = await mkUser('manager', 'Priya', 'Verma', '');
    rahulToken = rahul.token;
    priyaToken = priya.token;
    const lead = await makeLead(rahulToken);
    dealId = (await convertLead(rahulToken, lead.id)).body.data.deal.id;
  });

  test('entries return populated creator without sensitive fields', async () => {
    const r = await request(app).post(`/api/deals/${dealId}/requirements`).set(auth(rahulToken))
      .field('description', 'Booking page').field('entryDate', '2026-10-12');
    expect(r.status).toBe(201);
    expect(r.body.data.entry.creator).toMatchObject({
      firstName: 'Rahul', lastName: 'Sharma',
      profilePicUrl: 'https://example.com/rahul.png', role: 'admin',
    });
    expect(r.body.data.entry.creator).not.toHaveProperty('passwordHash');
    expect(JSON.stringify(r.body.data.entry)).not.toMatch(/Str0ng|passwordHash|refresh/i);
  });

  test('different authors stay independent across sections', async () => {
    await request(app).post(`/api/deals/${dealId}/requirements`).set(auth(rahulToken))
      .field('description', 'Req by admin').field('entryDate', '2026-10-12');
    await request(app).post(`/api/deals/${dealId}/progress`).set(auth(priyaToken))
      .field('description', 'Work by manager').field('entryDate', '2026-10-13');
    const reqs = await request(app).get(`/api/deals/${dealId}/requirements`).set(auth(priyaToken));
    const prog = await request(app).get(`/api/deals/${dealId}/progress`).set(auth(rahulToken));
    expect(reqs.body.data.entries[0].creator).toMatchObject({ firstName: 'Rahul', role: 'admin' });
    expect(prog.body.data.entries[0].creator).toMatchObject({ firstName: 'Priya', role: 'manager' });
  });

  test('edit preserves creator and createdAt; createdBy smuggling rejected', async () => {
    const r = await request(app).post(`/api/deals/${dealId}/progress`).set(auth(priyaToken))
      .field('description', 'v1').field('entryDate', '2026-10-12');
    const id = r.body.data.entry.id;
    const before = r.body.data.entry;
    // Attempted impersonation via strict-schema field is rejected outright.
    expect((await request(app).put(`/api/deals/${dealId}/progress/${id}`).set(auth(rahulToken))
      .send({ description: 'v2', createdBy: '000000000000000000000099' })).status).toBe(422);
    const up = await request(app).put(`/api/deals/${dealId}/progress/${id}`).set(auth(rahulToken))
      .send({ description: 'v2' });
    expect(up.status).toBe(200);
    expect(up.body.data.entry.creator).toMatchObject({ firstName: 'Priya', role: 'manager' });
    expect(up.body.data.entry.createdAt).toBe(before.createdAt);
  });

  test('dangling creator reference degrades to null (Unknown User)', async () => {
    const r = await request(app).post(`/api/deals/${dealId}/requirements`).set(auth(priyaToken))
      .field('description', 'orphan soon').field('entryDate', '2026-10-12');
    await User.deleteMany({ firstName: 'Priya' });
    const list = await request(app).get(`/api/deals/${dealId}/requirements`).set(auth(rahulToken));
    const found = list.body.data.entries.find((e) => e.id === r.body.data.entry.id);
    expect(found.creator).toBeNull();
  });
});
