const mongoose = require('mongoose');

/**
 * Lender identity.
 *
 * The v2 flow (defa_v2_mainnet, what prod runs) uses email + password for
 * lender login and OTP access codes for signup. Wallet is bound later
 * for on-chain deposit/redeem. So both auth surfaces are supported:
 *
 *   Email + password             — v2 login flow (/users/login-user)
 *   Wallet-only SIWE (legacy)    — original Colosseum lender flow
 *
 * `wallet` is optional to allow email-only signup + late wallet binding.
 * Unique+sparse index means multiple lenders can have no wallet, but the
 * first to bind an address locks it in.
 */
const LenderSchema = new mongoose.Schema(
  {
    email:         { type: String, unique: true, sparse: true, index: true, lowercase: true, trim: true },
    passwordHash:  { type: String, default: '' },  // bcrypt hash — set for v2 email/password lenders
    userName:      { type: String, default: '' },  // display handle from /users/create-user
    displayName:   { type: String, default: '' },
    contactEmail:  { type: String, default: '' },  // opt-in notifications; usually mirrors `email`

    wallet:        { type: String, unique: true, sparse: true, index: true },
    // Original SIWE lenders that started as wallet-only kept their entry
    // shape (no email + no password). New v2 signups always have all fields.

    lastLoginAt:   { type: Date, default: null },
    loginCount:    { type: Number, default: 0 },
    referredByCode:{ type: String, default: '' },  // the AccessCode value that unlocked this account
  },
  { timestamps: true }
);

module.exports = mongoose.model('Lender', LenderSchema);
