/**
 * Legacy v2 auth shim — hosts the endpoint contract defa_v2_mainnet
 * (prod) expects, backed by Colosseum's data model.
 *
 * Three endpoints:
 *
 *   POST /users/login-user        { email, password }
 *     Validates against Lender.passwordHash. Returns { token, data:lender }
 *     matching v2's response shape (v2 reads res.token and res.data).
 *
 *   POST /users/apply-referral    { refercode }
 *     Cheap access-code precheck for the GrantAccessPage — verifies the
 *     code exists, isn't expired, and isn't consumed. Does NOT consume it.
 *     Consumption happens on /users/create-user (atomic with signup).
 *
 *   POST /users/create-user       { userName, email, password, refercode }
 *     Atomic: verify code + create Lender + consume code + issue JWT.
 *     Returns { token, data:lender } same shape as login.
 *
 * JWT payload uses the same shape as walletAuth.js so downstream
 * authMiddleware works without change:
 *   { kind: 'lender', lenderId, wallet: '' }
 */

'use strict';

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const Lender = require('../models/Lender');
const AccessCode = require('../models/AccessCode');

const JWT_TTL = '7d';

function issueLenderToken(lender) {
  // `userId` is a duplicate of `lenderId` so the v2 client's AuthProtection
  // (which decodes the JWT and reads `userId`) works. Keeping both fields
  // means the shared authMiddleware — which reads `lenderId` — also still
  // resolves the Lender record. Do not drop either.
  return jwt.sign(
    {
      kind: 'lender',
      lenderId: lender._id.toString(),
      userId:   lender._id.toString(),
      wallet:   lender.wallet || '',
    },
    process.env.JWT_SECRET,
    { expiresIn: JWT_TTL }
  );
}

function shapeLender(lender) {
  return {
    _id:          lender._id,
    id:           lender._id,
    email:        lender.email,
    userName:     lender.userName,
    displayName:  lender.displayName || lender.userName || '',
    wallet:       lender.wallet || '',
    contactEmail: lender.contactEmail || lender.email || '',
    referredByCode: lender.referredByCode || '',
  };
}

// ── POST /users/login-user ─────────────────────────────────────────────

router.post('/login-user', async (req, res) => {
  try {
    const email = (req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!email || !password) {
      return res.status(400).json({ message: 'email and password required' });
    }

    const lender = await Lender.findOne({ email });
    if (!lender || !lender.passwordHash) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }
    const ok = await bcrypt.compare(password, lender.passwordHash);
    if (!ok) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    lender.lastLoginAt = new Date();
    lender.loginCount = (lender.loginCount || 0) + 1;
    await lender.save();

    const token = issueLenderToken(lender);
    res.json({ token, data: shapeLender(lender) });
  } catch (err) {
    console.error('[/users/login-user] error:', err);
    res.status(500).json({ message: 'Login failed' });
  }
});

// ── GET /users/get-user/:id ────────────────────────────────────────────
// The v2 client's AuthProtection calls this on mount to hydrate the Redux
// store from the JWT-decoded userId. Returns the same shape as login.

router.get('/get-user/:id', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id.match(/^[a-f0-9]{24}$/i)) {
      return res.status(400).json({ message: 'invalid id' });
    }
    const lender = await Lender.findById(id);
    if (!lender) return res.status(404).json({ message: 'Lender not found' });
    res.json({ data: shapeLender(lender) });
  } catch (err) {
    console.error('[/users/get-user] error:', err);
    res.status(500).json({ message: 'Fetch failed' });
  }
});

// ── POST /users/apply-referral (code precheck) ─────────────────────────

router.post('/apply-referral', async (req, res) => {
  try {
    const refercode = String(req.body?.refercode || '').trim();
    if (!refercode) return res.status(400).json({ message: 'refercode required' });

    const now = new Date();
    const code = await AccessCode.findOne({
      code: refercode,
      usedAt: null,
      $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
    });
    if (!code) return res.status(400).json({ message: 'Invalid or expired code' });

    // Precheck only — do NOT consume. Consumption is atomic with signup.
    res.json({ valid: true, refercode });
  } catch (err) {
    console.error('[/users/apply-referral] error:', err);
    res.status(500).json({ message: 'Referral check failed' });
  }
});

// ── POST /users/create-user (atomic signup) ────────────────────────────

router.post('/create-user', async (req, res) => {
  try {
    const userName = (req.body?.userName || '').trim();
    const email = (req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const refercode = String(req.body?.refercode || '').trim();

    if (!userName || !email || !password || !refercode) {
      return res.status(400).json({ message: 'userName, email, password, refercode all required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters' });
    }

    // Reject if email already taken. Prevents duplicate accounts with the
    // same email under different access codes.
    const existing = await Lender.findOne({ email });
    if (existing) {
      return res.status(409).json({ message: 'Email already registered' });
    }

    // Atomic code claim — same shape as /access-code/redeem's claim.
    const now = new Date();
    const claimed = await AccessCode.findOneAndUpdate(
      {
        code: refercode,
        usedAt: null,
        $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
      },
      { $set: { usedAt: now, usedByEmail: email } },
      { new: false }
    );
    if (!claimed) {
      return res.status(400).json({ message: 'Access code invalid, expired, or already used' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const lender = await Lender.create({
      email,
      passwordHash,
      userName,
      displayName: userName,
      referredByCode: refercode,
      lastLoginAt: now,
      loginCount: 1,
    });

    const token = issueLenderToken(lender);
    res.json({ token, data: shapeLender(lender) });
  } catch (err) {
    // Duplicate-key errors from Mongo bubble up cleanly here.
    if (err.code === 11000) {
      return res.status(409).json({ message: 'Email already registered' });
    }
    console.error('[/users/create-user] error:', err);
    res.status(500).json({ message: 'Signup failed' });
  }
});

module.exports = router;
