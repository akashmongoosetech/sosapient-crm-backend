/* eslint-disable no-console */
// Seeds a fixed admin account for local development.
// The password is NEVER committed: it comes only from SEED_PASSWORD in the
// local gitignored .env. Usage:
//   npm run seed-user -- --secret $ADMIN_BOOTSTRAP_SECRET
require('dotenv').config();
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

// Fixed profile. No secrets here — password is supplied via SEED_PASSWORD.
const PROFILE = {
  firstName: 'Akash',
  lastName: 'Raikwar',
  email: 'info@akashraikwar.in',
  mobile: '+919171606807',
  username: 'akashraikwar007',
  role: 'admin',
};

async function main() {
  const secret = arg('secret') || process.env.ADMIN_BOOTSTRAP_SECRET;
  if (!process.env.ADMIN_BOOTSTRAP_SECRET || secret !== process.env.ADMIN_BOOTSTRAP_SECRET) {
    console.error('Invalid bootstrap secret.');
    process.exit(1);
  }
  const password = process.env.SEED_PASSWORD || '';
  if (!password) {
    console.error('SEED_PASSWORD is not set. Add it to your local (gitignored) .env — never commit it.');
    process.exit(1);
  }
  const { User, normalizeEmail, normalizeMobile } = require('../models/User');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`Connected database: ${mongoose.connection.name}`);
  try {
    const email = normalizeEmail(PROFILE.email);
    const username = PROFILE.username.trim().toLowerCase();
    let mobileNumber;
    try {
      mobileNumber = normalizeMobile(PROFILE.mobile);
    } catch {
      console.error('Seed mobile number is invalid.');
      process.exitCode = 1;
      return;
    }
    const existing = await User.findOne({
      $or: [{ email }, { username }, { mobileNumber }],
    });
    if (existing) {
      console.log(`Already seeded: ${email} (matched existing account, no changes made).`);
      return;
    }
    const passwordHash = await bcrypt.hash(password, 12);
    await User.create({
      firstName: PROFILE.firstName,
      lastName: PROFILE.lastName,
      email,
      mobileNumber,
      username,
      profilePicUrl: '',
      passwordHash,
      role: 'admin',
      isActive: true,
      emailVerified: true,
    });
    console.log(`Admin seeded: ${email}`);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
