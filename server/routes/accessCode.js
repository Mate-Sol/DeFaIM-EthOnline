const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const router = express.Router();

const { authMiddleware, authorizeRoles } = require('../middleware/auth');
const { verifySignature } = require('../services/walletAuthEvm');
const AccessCode = require('../models/AccessCode');
const Lender = require('../models/Lender');

// Format: 4 + 4 + 4 chars, e.g. "DEFA-XK29-7P3M". Avoids visually
// ambiguous characters (0/O/1/I) so phone-share doesn't go wrong.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateCode() {
  const groups = [4, 4, 4].map(() => {
    let s = '';
    for (let i = 0; i < 4; i++) {
      s += ALPHABET[crypto.randomInt(0, ALPHABET.length)];
    }
    return s;
  });
  return groups.join('-');
}

// =====================================================================
// Admin endpoints — on-chain admin only
// =====================================================================

router.post('/access-code/create', authMiddleware, authorizeRoles('ONCHAIN_ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const count = Math.max(1, Math.min(50, Number(req.body?.count) || 1));
    const label = (req.body?.label || '').trim();
    const expiresAt = req.body?.expiresAt ? new Date(req.body.expiresAt) : null;

    const docs = [];
    for (let i = 0; i < count; i++) {
      // Retry on the rare collision.
      let code;
      for (let attempt = 0; attempt < 5; attempt++) {
        code = generateCode();
        const exists = await AccessCode.exists({ code });
        if (!exists) break;
      }
      docs.push({
        code,
        label,
        expiresAt,
        createdBy: req.user.userId,
        createdByEmail: req.user.email || '',
      });
    }
    const created = await AccessCode.insertMany(docs);
    res.json({ created: created.map((c) => ({ code: c.code, label: c.label, expiresAt: c.expiresAt })) });
  } catch (e) {
    console.error('[access-code/create]', e);
    res.status(500).json({ message: e.message });
  }
});

router.get('/access-code/list', authMiddleware, authorizeRoles('ONCHAIN_ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const status = req.query.status || 'all';
    const filter = {};
    if (status === 'unused') filter.usedAt = null;
    if (status === 'used')   filter.usedAt = { $ne: null };
    const items = await AccessCode.find(filter).sort({ createdAt: -1 }).limit(500);
    res.json({ items });
  } catch (e) {
    console.error('[access-code/list]', e);
    res.status(500).json({ message: e.message });
  }
});

router.delete('/access-code/:code', authMiddleware, authorizeRoles('ONCHAIN_ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const c = await AccessCode.findOne({ code: req.params.code.toUpperCase() });
    if (!c) return res.status(404).json({ message: 'Code not found' });
    if (c.usedAt) return res.status(409).json({ message: 'Cannot revoke a redeemed code' });
    await c.deleteOne();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// =====================================================================
// Public-ish endpoints — used by /apply-access flow
// =====================================================================

// Quick "is this code valid" check — no side effects, used to gate the
// next step of the form before we ask for name/email/wallet.
router.post('/access-code/check', async (req, res) => {
  try {
    const code = (req.body?.code || '').toUpperCase().trim();
    if (!code) return res.status(400).json({ valid: false, reason: 'code required' });
    const ac = await AccessCode.findOne({ code });
    if (!ac)             return res.json({ valid: false, reason: 'Code not found' });
    if (ac.usedAt)       return res.json({ valid: false, reason: 'Code already redeemed' });
    if (ac.expiresAt && ac.expiresAt < new Date()) {
      return res.json({ valid: false, reason: 'Code expired' });
    }
    return res.json({ valid: true });
  } catch (e) {
    res.status(500).json({ valid: false, reason: e.message });
  }
});

// Atomic redeem: verify wallet sig → mark code used → upsert Lender →
// issue lender JWT. The findOneAndUpdate with usedAt:null guard ensures
// two concurrent redeems can't both consume the same code.
router.post('/access-code/redeem', async (req, res) => {
  try {
    const codeStr   = (req.body?.code || '').toUpperCase().trim();
    const name      = (req.body?.name  || '').trim();
    const email     = (req.body?.email || '').trim();
    const wallet    = (req.body?.wallet || '').trim();
    const nonce     = req.body?.nonce;
    const signature = req.body?.signature;
    const message   = req.body?.message;

    if (!codeStr || !name || !email || !wallet || !nonce || !signature || !message) {
      return res.status(400).json({ message: 'code, name, email, wallet, nonce, signature, message all required' });
    }

    // 1. Verify wallet ownership via SIWE signature over the issued message.
    const verifiedWallet = await verifySignature({ wallet, nonce, signature, message, purpose: 'login' });

    // 2. Atomically claim the code: only consumes it if still unused
    //    AND not expired.
    const now = new Date();
    const claimed = await AccessCode.findOneAndUpdate(
      {
        code: codeStr,
        usedAt: null,
        $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
      },
      {
        $set: {
          usedAt: now,
          usedByWallet: verifiedWallet,
          usedByName: name,
          usedByEmail: email,
        },
      },
      { new: true }
    );
    if (!claimed) {
      return res.status(409).json({ message: 'Access code is invalid, already redeemed, or expired.' });
    }

    // 3. Upsert Lender on the verified wallet. If a Lender record already
    //    exists for this wallet, we still attach the code so the audit
    //    trail points to the most recent redemption — but typically this
    //    is a brand-new wallet.
    let lender = await Lender.findOne({ wallet: verifiedWallet });
    if (!lender) {
      lender = await Lender.create({
        wallet: verifiedWallet,
        displayName: name,
        contactEmail: email,
      });
    } else {
      // Existing lender re-redeeming with new code (rare). Keep their
      // original displayName/email unless empty.
      if (!lender.displayName)   lender.displayName = name;
      if (!lender.contactEmail)  lender.contactEmail = email;
    }
    lender.lastLoginAt = now;
    lender.loginCount = (lender.loginCount || 0) + 1;
    await lender.save();

    // Persist the Lender ref on the code for the admin audit list.
    claimed.usedByLenderId = lender._id;
    await claimed.save();

    // 4. Issue the same lender JWT shape walletAuth/login uses.
    const token = jwt.sign(
      { kind: 'lender', lenderId: lender._id.toString(), wallet: verifiedWallet },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Match the shape returned by /auth/wallet/login so client code that
    // reads `JSON.parse(localStorage.lender).id` works for both code-redeem
    // and wallet-only sign-ins.
    res.json({
      token,
      lender: {
        id: lender._id,
        wallet: lender.wallet,
        displayName: lender.displayName,
        contactEmail: lender.contactEmail,
      },
    });
  } catch (e) {
    console.error('[access-code/redeem]', e);
    res.status(400).json({ message: e.message });
  }
});

module.exports = router;
