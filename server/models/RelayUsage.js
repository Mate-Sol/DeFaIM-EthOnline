const mongoose = require('mongoose');

/**
 * Per-wallet rate-limit ledger for the fee-payer relay. The relay covers
 * gas for paymate-pool-v2 instructions so users never need SOL; this model
 * caps abuse:
 *  - dailyCount   : transactions submitted in the last 24h.
 *  - lifetimeCount: total ever (informational).
 *  - lastWindowAt : start of the current 24h window.
 *
 * Reset logic is lazy: when a request comes in, if `now - lastWindowAt > 24h`
 * we reset dailyCount to 0 and update lastWindowAt.
 */
const RelayUsageSchema = new mongoose.Schema(
  {
    wallet: { type: String, required: true, unique: true, index: true },
    dailyCount: { type: Number, default: 0 },
    lifetimeCount: { type: Number, default: 0 },
    lastWindowAt: { type: Date, default: Date.now },
    lastTxAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('RelayUsage', RelayUsageSchema);
