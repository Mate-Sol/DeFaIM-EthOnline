/**
 * EVM chain configuration.
 *
 * Central home for every "which chain / which contract / which key" question
 * the server needs to answer at runtime. Same code deploys to Polygon Amoy in
 * one repo and Arc testnet in the other — only the env values change.
 *
 * Env-var contract:
 *   EVM_CHAIN_ID              chain id (80002 = Polygon Amoy, 421614 = Arb Sepolia, etc.)
 *   EVM_RPC_URL               json-rpc endpoint
 *   PAYFI_FACTORY_ADDRESS     PoolFactory (payfi_v1)
 *   PAYFI_TREASURY_ADDRESS    TreasuryReserve (payfi_v1)
 *   PAYFI_STABLECOIN_ADDRESS  USDC or MockStablecoin
 *   ONCHAIN_ADMIN_WALLETS     comma-separated allowlist (lowercased) — mirrors
 *                             MULTISIG_ROLE at the app level
 *   AGENT_PRIVATE_KEY         server signer for AGENT2_ROLE (drawdown exec
 *                             on the PSP's behalf) and AGENT1_ROLE (pause,
 *                             sc-overdue flag)
 *   FAUCET_AUTHORITY_PRIVATE_KEY   signer for MockStablecoin.mint() calls
 *                                   from /faucet/*. Empty disables the faucet.
 */

require('dotenv').config();
const { ethers } = require('ethers');

const CHAIN_ID = parseInt(process.env.EVM_CHAIN_ID || '80002', 10);
const RPC_URL  = process.env.EVM_RPC_URL || 'https://rpc-amoy.polygon.technology';

const FACTORY_ADDRESS    = process.env.PAYFI_FACTORY_ADDRESS   || '';
const TREASURY_ADDRESS   = process.env.PAYFI_TREASURY_ADDRESS  || '';
const STABLECOIN_ADDRESS = process.env.PAYFI_STABLECOIN_ADDRESS || '';

const AGENT_PRIVATE_KEY            = process.env.AGENT_PRIVATE_KEY || '';
const FAUCET_AUTHORITY_PRIVATE_KEY = process.env.FAUCET_AUTHORITY_PRIVATE_KEY || '';

// Lowercase for case-insensitive comparison — EVM addresses are case-insensitive
// but with EIP-55 checksums by convention.
const ONCHAIN_ADMIN_WALLETS = (process.env.ONCHAIN_ADMIN_WALLETS || '')
  .split(',')
  .map(a => a.trim().toLowerCase())
  .filter(Boolean);

// Cache the provider across requires — a new JsonRpcProvider opens a socket
// pool, no need to recreate it per call. Ethers v6 handles connection reuse.
const provider = new ethers.JsonRpcProvider(RPC_URL, CHAIN_ID);

function getProvider() {
  return provider;
}

function getFactoryAddress() {
  if (!FACTORY_ADDRESS) {
    throw new Error(
      'PAYFI_FACTORY_ADDRESS not set — deploy the PoolFactory (see contracts/script/*) ' +
      'and add its address to .env before hitting any pool endpoint.'
    );
  }
  return FACTORY_ADDRESS;
}

function getTreasuryAddress() {
  if (!TREASURY_ADDRESS) {
    throw new Error('PAYFI_TREASURY_ADDRESS not set');
  }
  return TREASURY_ADDRESS;
}

function getStablecoinAddress() {
  if (!STABLECOIN_ADDRESS) {
    throw new Error(
      'PAYFI_STABLECOIN_ADDRESS not set — for testnets this should be the ' +
      'MockStablecoin address emitted by the deploy script.'
    );
  }
  return STABLECOIN_ADDRESS;
}

function getAgentSigner() {
  if (!AGENT_PRIVATE_KEY) {
    throw new Error(
      'AGENT_PRIVATE_KEY not set — this key holds AGENT2_ROLE and is required ' +
      'to sign drawdowns on the PSP\'s behalf. Rotate before going public.'
    );
  }
  return new ethers.Wallet(AGENT_PRIVATE_KEY, provider);
}

function getFaucetSigner() {
  if (!FAUCET_AUTHORITY_PRIVATE_KEY) {
    throw new Error(
      'FAUCET_AUTHORITY_PRIVATE_KEY not set — needed for MockStablecoin.mint()'
    );
  }
  return new ethers.Wallet(FAUCET_AUTHORITY_PRIVATE_KEY, provider);
}

function isOnchainAdmin(addr) {
  return ONCHAIN_ADMIN_WALLETS.includes((addr || '').toLowerCase());
}

module.exports = {
  CHAIN_ID,
  RPC_URL,
  getProvider,
  getFactoryAddress,
  getTreasuryAddress,
  getStablecoinAddress,
  getAgentSigner,
  getFaucetSigner,
  isOnchainAdmin,
  ONCHAIN_ADMIN_WALLETS,
};
