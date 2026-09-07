/**
 * Seed admin accounts for roles that can't be created via the public
 * /register flow. Idempotent — re-running upserts. Password is `admin123`
 * for all (dev convenience; rotate per-account before any deployment).
 *
 * Run:  node scripts/seedAdmins.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');

const PASSWORD = 'admin123';

const ADMINS = [
  { email: 'kam@maildrop.cc',    name: 'KAM Admin',         role: 'KAM' },
  { email: 'cad@maildrop.cc',    name: 'CAD Admin',         role: 'CAD' },
  { email: 'cro@maildrop.cc',    name: 'CRO Admin',         role: 'CRO' },
  { email: 'cfo@maildrop.cc',    name: 'CFO Admin',         role: 'CFO' },
  { email: 'legal@maildrop.cc',  name: 'Legal Admin',       role: 'LEGAL_ADMIN' },
  { email: 'viewer@maildrop.cc', name: 'View-Only Admin',   role: 'VIEW_ONLY_ADMIN' },
];

async function upsertAdmin({ email, name, role, passwordHash }) {
  const existing = await User.findOne({ email });
  if (existing) {
    existing.name = name;
    existing.role = role;
    existing.passwordHash = passwordHash;
    existing.isActive = true;
    await existing.save();
    return { email, role, action: 'updated' };
  }
  // The User pre-save hook auto-generates apiKey on isNew.
  const u = new User({
    email,
    name,
    role,
    passwordHash,
    companyName: 'PayMate Internal',
  });
  await u.save();
  return { email, role, action: 'created' };
}

async function main() {
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI not set; check server/.env');
  }
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`Connected to ${mongoose.connection.name}`);

  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  const results = [];
  for (const a of ADMINS) {
    try {
      results.push(await upsertAdmin({ ...a, passwordHash }));
    } catch (e) {
      results.push({ email: a.email, role: a.role, action: 'error', error: e.message });
    }
  }

  console.log('\nSeeded admin accounts (password: admin123)');
  console.log('─'.repeat(72));
  for (const r of results) {
    const tag = r.action === 'error' ? '✗' : r.action === 'created' ? '+' : '↻';
    console.log(`  ${tag} ${r.role.padEnd(16)} ${r.email}${r.error ? '  → ' + r.error : ''}`);
  }
  console.log('─'.repeat(72));

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
