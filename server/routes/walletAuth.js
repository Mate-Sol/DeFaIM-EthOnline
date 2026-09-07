/**
 * Wallet-signature auth (lender + bind-wallet flows).
 *
 * Endpoints:
 *   POST /auth/wallet/nonce
 *     body: { wallet, purpose? }     // purpose: 'login' (default) | 'bind'
 *     returns: { wallet, nonce, expiresAt, message }
 *
 *   POST /auth/wallet/login
 *     body: { wallet, nonce, signature }
 *     returns: { token, lender }     // creates Lender record if first login
 *
 *   POST /auth/wallet/bind            (JWT-protected)
 *     body: { wallet, nonce, signature }
 *     binds the verified wallet to the authenticated User
 *     (PSP → PSPProfile.solanaWallet, admin → User.solanaWallet).
 */

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');

const { authMiddleware } = require('../middleware/auth');
// SIWE (EIP-4361) — Chunk B3c swap from services/walletAuth (SIWS).
// Same public API (issueNonce / verifySignature) so the route bodies
// don't change shape; verifySignature also accepts a `message` field
// now — clients must pass the SIWE payload they signed.
const { issueNonce, verifySignature } = require('../services/walletAuthEvm');
const Lender = require('../models/Lender');
const PSPProfile = require('../models/PSPProfile');
const User = require('../models/User');
const { isOnchainAdmin } = require('../config/chain');

router.post('/nonce', async (req, res) => {
  try {
    const { wallet, purpose } = req.body || {};
    if (!wallet) return res.status(400).json({ message: 'wallet required' });
    const out = await issueNonce(wallet, purpose);
    res.json(out);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { wallet, nonce, signature, message } = req.body || {};
    if (!wallet || !nonce || !signature || !message) {
      return res.status(400).json({ message: 'wallet, nonce, signature, message required' });
    }
    const verifiedWallet = await verifySignature({ wallet, nonce, signature, message, purpose: 'login' });

    // Lender access is gated by access codes — the wallet must already be
    // bound to a Lender record (created during /access-code/redeem). If
    // we don't find one, this wallet hasn't been onboarded yet.
    const lender = await Lender.findOne({ wallet: verifiedWallet });
    if (!lender) {
      return res.status(403).json({
        message: 'This wallet is not registered. Visit /apply-access and redeem an invite code to get started.',
        code: 'WALLET_NOT_REGISTERED',
      });
    }
    lender.lastLoginAt = new Date();
    lender.loginCount = (lender.loginCount || 0) + 1;
    await lender.save();

    const token = jwt.sign(
      { kind: 'lender', lenderId: lender._id.toString(), wallet: verifiedWallet },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      lender: {
        id: lender._id,
        wallet: lender.wallet,
        displayName: lender.displayName,
        contactEmail: lender.contactEmail,
      },
    });
  } catch (err) {
    res.status(401).json({ message: err.message });
  }
});

/**
 * On-chain admin login. Wallet-only. The wallet must be in the
 * `ONCHAIN_ADMIN_WALLETS` env allowlist (comma-separated base58 pubkeys).
 *
 * Creates a shadow User record on first sign-in (role=ONCHAIN_ADMIN, no
 * email/password) so existing PSPProfile relations and audit logging work
 * uniformly. JWT is issued with kind=user so authMiddleware loads from
 * the User collection.
 */
router.post('/onchain-admin/login', async (req, res) => {
  try {
    const { wallet, nonce, signature, message } = req.body || {};
    if (!wallet || !nonce || !signature || !message) {
      return res.status(400).json({ message: 'wallet, nonce, signature, message required' });
    }

    // Case-insensitive check — EIP-55 checksum casing is user-facing and
    // shouldn't gate access. The chain config layer normalises to
    // lowercased entries; delegate.
    if (!isOnchainAdmin(wallet)) {
      return res.status(403).json({
        message: 'Wallet not on the on-chain admin allowlist',
        wallet,
      });
    }

    const verifiedWallet = await verifySignature({ wallet, nonce, signature, message, purpose: 'login' });

    // Find-or-create the shadow User record. Use a deterministic email so
    // the User schema's unique-email constraint passes and we can re-find
    // on subsequent logins.
    const shadowEmail = `onchain-admin+${verifiedWallet.toLowerCase()}@paymate.local`;
    let user = await User.findOne({ solanaWallet: verifiedWallet, role: 'ONCHAIN_ADMIN' });
    if (!user) {
      user = await User.create({
        email: shadowEmail,
        // Random hash; never used for login. Pure shadow record.
        passwordHash: require('crypto').randomBytes(32).toString('hex'),
        name: `On-Chain Admin (${verifiedWallet.slice(0, 6)}…)`,
        companyName: 'PayMate Internal',
        role: 'ONCHAIN_ADMIN',
        solanaWallet: verifiedWallet,
      });
    }

    const token = jwt.sign(
      { userId: user._id.toString(), kind: 'user' },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        role: user.role,
        solanaWallet: user.solanaWallet,
      },
    });
  } catch (err) {
    res.status(401).json({ message: err.message });
  }
});

router.post('/bind', authMiddleware, async (req, res) => {
  try {
    if (req.user.kind === 'lender') {
      return res.status(400).json({
        message: 'Lender accounts are wallet-only and already bound',
      });
    }
    const { wallet, nonce, signature, message } = req.body || {};
    if (!wallet || !nonce || !signature || !message) {
      return res.status(400).json({ message: 'wallet, nonce, signature, message required' });
    }
    const verifiedWallet = await verifySignature({ wallet, nonce, signature, message, purpose: 'bind' });

    // PSPs bind on PSPProfile (matches existing schema's walletAddress array
    // for backward compat, plus new solanaWallet field for the canonical
    // primary wallet baked into the on-chain pool).
    if (req.user.role === 'PSP') {
      const profile = await PSPProfile.findOne({ userId: req.user.userId });
      if (!profile) return res.status(404).json({ message: 'PSP profile not found' });

      // Once a pool has been initialized for this PSP, the on-chain pool
      // PDA seed is bound to the wallet at init time. Rebinding to a
      // different wallet would orphan that pool. Block.
      if (profile.solanaWallet && profile.solanaWallet !== verifiedWallet) {
        if (profile.assignedPoolAddress) {
          return res.status(409).json({
            message: 'Wallet already bound and a pool is initialized; cannot rebind',
            currentWallet: profile.solanaWallet,
          });
        }
      }

      profile.solanaWallet = verifiedWallet;
      // Maintain legacy `walletAddress` array for code paths that still
      // read it. New code should prefer `solanaWallet`.
      profile.walletAddress = profile.walletAddress || [];
      const exists = profile.walletAddress.find((w) => w.address === verifiedWallet);
      if (!exists) {
        profile.walletAddress.unshift({ address: verifiedWallet, name: 'Primary Solana Wallet' });
      }
      await profile.save();
      return res.json({ success: true, role: 'PSP', wallet: verifiedWallet });
    }

    // Admin / KAM / CAD / CFO / CRO / LEGAL_ADMIN — bind to User record
    // so admin actions sign as that wallet.
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ message: 'User not found' });
    user.solanaWallet = verifiedWallet;
    await user.save();
    res.json({ success: true, role: req.user.role, wallet: verifiedWallet });
  } catch (err) {
    res.status(401).json({ message: err.message });
  }
});

module.exports = router;
