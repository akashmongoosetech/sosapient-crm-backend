const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const fs = require('fs');
const os = require('os');
const path = require('path');

let mongo; // mongodb-memory-server handle (only when local MongoDB is unavailable)

// Isolate test uploads in the OS temp dir (set at require time so env.js
// picks it up when the app modules load). Never touches backend/uploads/.
const testUploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-test-uploads-'));
process.env.UPLOAD_DIR = testUploadDir;
// Dummy Brevo key so the email service is "configured" in tests; all sends
// are intercepted by fetch mocks. Never a real credential.
if (!process.env.BREVO_API_KEY) process.env.BREVO_API_KEY = 'test-brevo-key-not-a-secret';

// Local-first strategy:
// - Uses local MongoDB (TEST_MONGODB_URI or 127.0.0.1:27017) when reachable,
//   with an isolated `crm_test_<pid>_<ts>` database per run (dropped afterwards).
// - Falls back to mongodb-memory-server otherwise (e.g. CI without MongoDB).
// - Set TEST_USE_MEMORY=1 to force the memory server.
const useMemory = process.env.TEST_USE_MEMORY === '1';
const localBase = (process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017').replace(/\/$/, '');
const dbName = `crm_test_${process.pid}_${Date.now()}`;

async function localReachable() {
  const probe = new mongoose.Mongoose();
  try {
    await probe.connect(`${localBase}/crm_test_probe`, { serverSelectionTimeoutMS: 2000 });
    await probe.disconnect();
    return true;
  } catch {
    try { await probe.disconnect(); } catch { /* ignore */ }
    return false;
  }
}

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.MONGODB_URI = 'mongodb://test/test';
  process.env.JWT_ACCESS_SECRET = 'test-access-secret-min-32-chars-123456';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-min-32-chars-1234';
  process.env.JWT_ISSUER = 'crm-api';
  process.env.JWT_AUDIENCE = 'crm-client';
  process.env.COOKIE_NAME = 'crm_refresh';
  if (!useMemory && (await localReachable())) {
    await mongoose.connect(`${localBase}/${dbName}`);
    // eslint-disable-next-line no-console
    console.log(`[tests] using local MongoDB database: ${dbName}`);
  } else {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    // eslint-disable-next-line no-console
    console.log('[tests] using mongodb-memory-server');
  }
}, 120000);

afterEach(async () => {
  const cols = mongoose.connection.collections;
  for (const c of Object.values(cols)) await c.deleteMany({});
});

afterAll(async () => {
  try {
    if (mongoose.connection.db) await mongoose.connection.db.dropDatabase();
  } catch { /* ignore cleanup errors */ }
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
  try {
    fs.rmSync(testUploadDir, { recursive: true, force: true });
  } catch { /* ignore cleanup errors */ }
});
