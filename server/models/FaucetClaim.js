const mongoose = require('mongoose');

/**
 * Tracks USDC-DF faucet usage per recipient wallet. Enforces the
 * 10M lifetime cap (1M per call → 10 calls before lockout) configured for
 * the test mint. Indexed on `wallet` for O(log n) cap checks per request.
 */
const FaucetClaimSchema = new mongoose.Schema({
  wallet: { type: String, required: true, unique: true, index: true },
  totalMinted: { type: String, default: '0' }, // u64 base units, stored as string
  callCount: { type: Number, default: 0 },
  lastClaimAt: { type: Date, default: null },
  history: [
    {
      amount: String,        // base units of this single claim
      txSignature: String,
      claimedAt: { type: Date, default: Date.now },
    },
  ],
}, { timestamps: true });

module.exports = mongoose.model('FaucetClaim', FaucetClaimSchema);
