/* eslint-disable no-console */
// Usage: npm run create-admin -- --email a@x.com --password 'Str0ng!...' --username admin --firstName A --lastName B --mobile +14155550100 --secret <ADMIN_BOOTSTRAP_SECRET>
require('dotenv').config();
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const secret = arg('secret') || process.env.ADMIN_BOOTSTRAP_SECRET;
  if (!process.env.ADMIN_BOOTSTRAP_SECRET || secret !== process.env.ADMIN_BOOTSTRAP_SECRET) {
    console.error('Invalid bootstrap secret.');
    process.exit(1);
  }
  const { User, normalizeEmail, normalizeMobile } = require('../models/User');
  await mongoose.connect(process.env.MONGODB_URI);
  const existing = await User.countDocuments({ role: 'admin' });
  if (existing > 0) {
    console.error('An admin already exists. Bootstrap is disabled.');
    await mongoose.disconnect();
    process.exit(1);
  }
  const email = normalizeEmail(arg('email') || '');
  const username = String(arg('username') || '').trim().toLowerCase();
  const mobileNumber = normalizeMobile(arg('mobile') || '');
  const password = arg('password') || '';
  if (password.length < 10) { console.error('Password too weak (min 10 chars).'); process.exit(1); }
  const passwordHash = await bcrypt.hash(password, 12);
  await User.create({
    firstName: arg('firstName') || 'Admin', lastName: arg('lastName') || 'User',
    email, mobileNumber, username, profilePicUrl: '', passwordHash, role: 'admin', isActive: true,
    emailVerified: true,
  });
  console.log(`Admin created: ${email}`);
  await mongoose.disconnect();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
