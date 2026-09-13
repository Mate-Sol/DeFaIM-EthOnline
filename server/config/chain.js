/**
 * EVM chain configuration.
 *
 * Central home for every "which chain / which contract / which key" question
 * the server needs to answer at runtime. Defaults target Arc Testnet.
 * one repo and Arc testnet in the other — only the env values change.
 *
 * Env-var contract:
 *   EVM_CHAIN_ID              chain id (5042002 = Arc Testnet, 5042 = Arc Mainnet)
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
const RPC_URL  = process.env.EVM_RPC_URL || 'https://rpc.testnet.arc.io';

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
const { throttleProvider } = require('./rpcThrottle');

// Every RPC request in the process goes through one throttle. Arc limits
// sustained rate, so per-call-site batching alone still trips it once there
// are more than a couple of pools to read.
const provider = throttleProvider(new ethers.JsonRpcProvider(RPC_URL, CHAIN_ID));

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

// Privy-backed agent signing. When these are set the server never holds the
// agent key: signing happens in Privy's enclave, under a policy, and we only
// broadcast the result. Falls back to the local key when unset so existing
// deployments and the test suite keep working.
const PRIVY_APP_ID     = process.env.PRIVY_APP_ID || '';
const PRIVY_APP_SECRET = process.env.PRIVY_APP_SECRET || '';
const PRIVY_WALLET_ID  = process.env.PRIVY_WALLET_ID || '';
const PRIVY_WALLET_ADDRESS = process.env.PRIVY_WALLET_ADDRESS || '';
const PRIVY_AUTHORIZATION_KEY = process.env.PRIVY_AUTHORIZATION_KEY || '';

function usingPrivyAgent() {
  return Boolean(PRIVY_APP_ID && PRIVY_APP_SECRET && PRIVY_WALLET_ID && PRIVY_WALLET_ADDRESS);
}

let _privySigner = null;

function getAgentSigner() {
  if (usingPrivyAgent()) {
    if (!_privySigner) {
      // Required lazily: the module pulls in fetch-based code that has no
      // business loading when the local-key path is in use.
      const { PrivySigner } = require('../services/privySigner');
      _privySigner = new PrivySigner({
        appId: PRIVY_APP_ID,
        appSecret: PRIVY_APP_SECRET,
        walletId: PRIVY_WALLET_ID,
        address: PRIVY_WALLET_ADDRESS,
        authorizationKey: PRIVY_AUTHORIZATION_KEY,
        provider,
      });
    }
    return _privySigner;
  }

  if (!AGENT_PRIVATE_KEY) {
    throw new Error(
      'No agent signer configured — set PRIVY_APP_ID / PRIVY_APP_SECRET / ' +
      'PRIVY_WALLET_ID / PRIVY_WALLET_ADDRESS to sign through Privy, or ' +
      'AGENT_PRIVATE_KEY to sign locally. This signer holds AGENT2_ROLE and is ' +
      'required to execute drawdowns on the PSP\'s behalf.'
    );
  }
  return new ethers.Wallet(AGENT_PRIVATE_KEY, provider);
}

/**
 * The address holding AGENT2_ROLE, whichever backend signs for it.
 *
 * Switching to Privy changes this address, and the role must be granted to the
 * new one on-chain before drawdowns will work — the contract checks the role,
 * not the intent.
 */
function getAgentAddress() {
  if (usingPrivyAgent()) return ethers.getAddress(PRIVY_WALLET_ADDRESS);
  if (!AGENT_PRIVATE_KEY) return '';
  return new ethers.Wallet(AGENT_PRIVATE_KEY).address;
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
  usingPrivyAgent,
  getAgentAddress,
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
