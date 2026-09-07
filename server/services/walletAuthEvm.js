/**
 * SIWE (Sign in with Ethereum, EIP-4361) auth helpers.
 *
 * Shape-compatible with the SIWS walletAuth.js so consumers can swap by
 * changing only the require path. Same AuthNonce Mongo collection is
 * reused — schema is chain-agnostic (wallet / nonce / purpose /
 * expiresAt / consumedAt).
 *
 * Flow:
 *   1. Frontend calls /auth/wallet/nonce → issueNonce(walletAddress)
 *   2. Backend returns { wallet, nonce, expiresAt, message } — the
 *      `message` is a canonical SIWE payload the wallet renders.
 *   3. User signs the message via wagmi/RainbowKit (personal_sign).
 *   4. Frontend posts { wallet, nonce, signature, message } to
 *      /auth/wallet/login → verifySignature(...).
 *   5. Backend rebuilds the SIWE object from the passed `message`,
 *      cross-checks every field against server state (nonce, address,
 *      chainId, domain), then runs siwe.verify() to confirm the ECDSA
 *      signature actually matches. On success, JWT issued upstream.
 *
 * Env-var contract (from server/config/chain.js and this file):
 *   EVM_CHAIN_ID    — chain id the signature must claim (mismatch = reject)
 *   SIWE_DOMAIN     — RFC 3986 authority (host[:port]) the frontend runs on
 *   SIWE_ORIGIN     — full origin URI (https://…) — the SIWE "uri" field
 */

const { ethers } = require('ethers');
const { SiweMessage, generateNonce } = require('siwe');

const AuthNonce = require('../models/AuthNonce');
const { CHAIN_ID } = require('../config/chain');

const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const SIWE_DOMAIN    = process.env.SIWE_DOMAIN    || 'localhost:5173';
const SIWE_ORIGIN    = process.env.SIWE_ORIGIN    || 'http://localhost:5173';
const SIWE_STATEMENT = process.env.SIWE_STATEMENT || 'Sign in to DeFa.';

// Return an EIP-55 checksummed address, or throw if the input isn't a
// well-formed EVM address. Cheap sanity gate before we hit Mongo.
function normalizeAddress(addr) {
  if (!addr) throw new Error('Missing wallet address');
  try {
    return ethers.getAddress(addr);
  } catch {
    throw new Error('Invalid EVM address');
  }
}

/**
 * Issue a fresh SIWE nonce + canonical message for a wallet. Store the
 * nonce with a TTL so unused nonces reap automatically. Multiple in-flight
 * nonces per wallet are allowed (e.g., two browser tabs); each is single-
 * use because verifySignature atomically consumes them.
 */
async function issueNonce(walletAddress, purpose = 'login') {
  const wallet = normalizeAddress(walletAddress);
  const nonce = generateNonce();
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + NONCE_TTL_MS);

  await AuthNonce.create({ wallet, nonce, purpose, expiresAt });

  const message = new SiweMessage({
    domain: SIWE_DOMAIN,
    address: wallet,
    statement: SIWE_STATEMENT,
    uri: SIWE_ORIGIN,
    version: '1',
    chainId: CHAIN_ID,
    nonce,
    issuedAt: issuedAt.toISOString(),
    expirationTime: expiresAt.toISOString(),
  }).prepareMessage();

  return { wallet, nonce, expiresAt, message };
}

/**
 * Verify a SIWE signature. Consumes the nonce atomically (single-use).
 * Returns the canonical checksummed address on success.
 *
 * Rejects (throws) on: unknown/expired/consumed nonce, malformed SIWE
 * payload, mismatched address / chainId / domain / nonce, or invalid
 * ECDSA signature.
 */
async function verifySignature({ wallet, nonce, signature, message, purpose = 'login' }) {
  const walletAddr = normalizeAddress(wallet);

  // Atomic claim — nonce must still be unconsumed AND unexpired. Putting
  // expiry in the filter (rather than checking after the update) means an
  // expired nonce isn't burned — the user can request a fresh one and
  // retry instead of getting "already used" on the second attempt.
  const record = await AuthNonce.findOneAndUpdate(
    {
      wallet: walletAddr,
      nonce,
      purpose,
      consumedAt: null,
      expiresAt: { $gt: new Date() },
    },
    { $set: { consumedAt: new Date() } },
    { new: false }
  );
  if (!record) throw new Error('Nonce not found, expired, or already used');

  // Parse the client-supplied SIWE payload and cross-check every server-
  // controlled field before touching signature verification. This prevents
  // the client from silently signing over a payload that DIFFERS from what
  // we asked for (e.g., a different domain that they own).
  let siwe;
  try {
    siwe = new SiweMessage(message);
  } catch {
    throw new Error('Malformed SIWE message');
  }
  if (siwe.nonce !== nonce)                 throw new Error('Nonce mismatch');
  if (siwe.address !== walletAddr)          throw new Error('Address mismatch');
  if (Number(siwe.chainId) !== CHAIN_ID)    throw new Error('Chain ID mismatch');
  if (siwe.domain !== SIWE_DOMAIN)          throw new Error('Domain mismatch');

  // Delegate the ECDSA check to the siwe library. It handles both EOA
  // (personal_sign) and EIP-1271 (contract wallet) verification.
  let result;
  try {
    result = await siwe.verify({ signature });
  } catch (e) {
    throw new Error(`Signature verification failed: ${e?.message || 'unknown'}`);
  }
  if (!result?.success) {
    throw new Error(`Signature verification failed: ${result?.error?.type || 'unknown'}`);
  }

  return walletAddr;
}

module.exports = {
  issueNonce,
  verifySignature,
  NONCE_TTL_MS,
  SIWE_DOMAIN,
  SIWE_ORIGIN,
};
