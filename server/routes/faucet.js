/**
 * USDC-DF faucet — testnet only. EVM edition.
 *
 * POST /faucet/usdc-df
 *   body: { wallet: "0x…" }
 *
 * Mints `GRANT_PER_CALL` (1M USDC, 6 decimals) to the recipient's EVM
 * address by calling `MockStablecoin.mint(to, amount)`. Server holds the
 * mint authority (AGENT_PRIVATE_KEY, doubling as the faucet key here for
 * simplicity — split via FAUCET_AUTHORITY_PRIVATE_KEY in prod).
 *
 * Auth: open endpoint. Rate limit + lifetime cap tracked per wallet in
 * FaucetClaim so the same address can't bypass by hitting from many IPs.
 *
 * Production (real USDC) skips this route entirely by leaving
 * PAYFI_STABLECOIN_ADDRESS pointed at a real USDC contract with no mint
 * function — the mint() call reverts, the endpoint responds 500, and
 * you should reverse-proxy this route to /dev/null anyway.
 */

'use strict';

const express = require('express');
const router = express.Router();
const { ethers } = require('ethers');

const FaucetClaim = require('../models/FaucetClaim');
const {
  getProvider,
  getStablecoinAddress,
  getAgentSigner,   // AGENT_PRIVATE_KEY — used as faucet mint authority here
  getFaucetSigner,  // FAUCET_AUTHORITY_PRIVATE_KEY (optional split)
} = require('../config/chain');
const { ERC20Abi } = require('../abis');

const USDC_DECIMALS = 6n;
const ONE_USDC = 10n ** USDC_DECIMALS;
const GRANT_PER_CALL = 1_000_000n * ONE_USDC; // 1M USDC-DF
const LIFETIME_CAP   = 10_000_000n * ONE_USDC; // 10M USDC-DF
const COOLDOWN_MS    = 60 * 1000;              // 1 minute between calls

function faucetSignerOrNull() {
  // Prefer a dedicated FAUCET_AUTHORITY_PRIVATE_KEY when configured;
  // otherwise fall back to the AGENT signer so a single-key hackathon
  // deployment "just works". Return null if neither is set — the route
  // then 503s cleanly.
  try { return getFaucetSigner(); } catch {}
  try { return getAgentSigner();  } catch {}
  return null;
}

router.post('/usdc-df', async (req, res) => {
  try {
    const walletRaw = req.body?.wallet;
    if (!walletRaw || typeof walletRaw !== 'string') {
      return res.status(400).json({ message: 'wallet (0x-prefixed address) required' });
    }
    let wallet;
    try { wallet = ethers.getAddress(walletRaw); }
    catch { return res.status(400).json({ message: 'wallet is not a valid EVM address' }); }

    const signer = faucetSignerOrNull();
    if (!signer) {
      return res.status(503).json({ message: 'Faucet not configured on this environment' });
    }
    let stablecoinAddress;
    try { stablecoinAddress = getStablecoinAddress(); }
    catch { return res.status(503).json({ message: 'PAYFI_STABLECOIN_ADDRESS not set' }); }

    // Per-wallet cap + cooldown check
    const claim = await FaucetClaim.findOne({ wallet });
    const totalMinted = BigInt(claim?.totalMinted || '0');
    if (totalMinted + GRANT_PER_CALL > LIFETIME_CAP) {
      return res.status(429).json({
        message: 'Lifetime cap reached for this wallet',
        totalMinted: totalMinted.toString(),
        cap: LIFETIME_CAP.toString(),
      });
    }
    if (claim?.lastClaimAt && Date.now() - new Date(claim.lastClaimAt).getTime() < COOLDOWN_MS) {
      const wait = Math.ceil(
        (COOLDOWN_MS - (Date.now() - new Date(claim.lastClaimAt).getTime())) / 1000
      );
      return res.status(429).json({
        message: `Cooldown active; retry in ${wait}s`,
        retryAfterSeconds: wait,
      });
    }

    // Fire the mint tx. MockStablecoin.mint(to, amount) → non-revert path.
    // Real USDC reverts here (no `mint` externally), and we bubble the
    // revert reason up.
    const token = new ethers.Contract(stablecoinAddress, ERC20Abi, signer);
    let receipt;
    try {
      const tx = await token.mint(wallet, GRANT_PER_CALL);
      receipt = await tx.wait();
    } catch (e) {
      const reason = e.shortMessage || e.reason || e.message;
      // If revert reads like "function selector not recognized" the
      // stablecoin isn't a mintable MockStablecoin — that's an expected
      // configuration outcome, not a server error.
      return res.status(400).json({
        message: 'Mint failed',
        reason,
      });
    }

    // Persist claim record
    const newTotal = (totalMinted + GRANT_PER_CALL).toString();
    await FaucetClaim.findOneAndUpdate(
      { wallet },
      {
        $set: { totalMinted: newTotal, lastClaimAt: new Date() },
        $inc: { callCount: 1 },
        $push: {
          history: {
            amount: GRANT_PER_CALL.toString(),
            txSignature: receipt.hash,  // keeping field name; value is now an EVM tx hash
            claimedAt: new Date(),
          },
        },
      },
      { upsert: true, new: true }
    );

    res.json({
      success: true,
      wallet,
      mint: stablecoinAddress,
      amount: GRANT_PER_CALL.toString(),
      totalMinted: newTotal,
      remaining: (LIFETIME_CAP - totalMinted - GRANT_PER_CALL).toString(),
      txSignature: receipt.hash,       // legacy field name preserved
      txHash: receipt.hash,            // canonical EVM name too
      blockNumber: receipt.blockNumber,
    });
  } catch (err) {
    console.error('[faucet] error:', err);
    res.status(500).json({ message: 'Faucet error', error: err.message });
  }
});

router.get('/usdc-df/status/:wallet', async (req, res) => {
  try {
    let addr;
    try { addr = ethers.getAddress(req.params.wallet); }
    catch { return res.status(400).json({ message: 'Invalid EVM address' }); }
    const claim = await FaucetClaim.findOne({ wallet: addr });
    res.json({
      wallet: addr,
      totalMinted: claim?.totalMinted || '0',
      callCount: claim?.callCount || 0,
      remaining: (LIFETIME_CAP - BigInt(claim?.totalMinted || '0')).toString(),
      grantPerCall: GRANT_PER_CALL.toString(),
      lifetimeCap: LIFETIME_CAP.toString(),
      cooldownMs: COOLDOWN_MS,
      lastClaimAt: claim?.lastClaimAt || null,
    });
  } catch (err) {
    res.status(500).json({ message: 'Status lookup failed', error: err.message });
  }
});

module.exports = router;
