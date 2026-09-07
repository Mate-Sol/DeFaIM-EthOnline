const mongoose = require('mongoose');

/**
 * Short-lived nonce for wallet-signature authentication.
 *
 * Flow:
 *   1. Client requests a nonce for a given wallet pubkey.
 *   2. Server generates a 32-byte random nonce, stores it with TTL=5 min.
 *   3. Client signs the nonce string with its wallet (ed25519).
 *   4. Server verifies the signature against the wallet pubkey.
 *   5. Nonce is consumed (deleted) on first successful verify, regardless
 *      of outcome — single-use.
 *
 * MongoDB TTL index automatically reaps unused nonces after `expiresAt`.
 */
const AuthNonceSchema = new mongoose.Schema(
  {
    wallet: { type: String, required: true, index: true },
    nonce: { type: String, required: true, unique: true },
    purpose: { type: String, default: 'login' }, // 'login' | 'bind'
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
    consumedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('AuthNonce', AuthNonceSchema);
