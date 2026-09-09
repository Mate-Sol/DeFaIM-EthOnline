/**
 * Frontend EVM helpers — wallet auth and calldata submission via wagmi.
 *
 * All helpers accept wagmi-shaped inputs (address string + hook mutators)
 * so pages don't need a wallet-object wrapper. Typical usage:
 *
 *   const { address } = useAccount();
 *   const { signMessageAsync } = useSignMessage();
 *   const { sendTransactionAsync } = useSendTransaction();
 *
 *   const jwt = await walletLogin(address, signMessageAsync);
 *   const receipt = await buildAndSend(
 *     address, sendTransactionAsync,
 *     '/pool/lender/build-tx/deposit', { pool, amount }
 *   );
 *
 * Exports
 * -------
 *   api()                                     axios instance with JWT header
 *   walletLogin(address, signMessageAsync)    SIWE nonce → sign → login
 *   onchainAdminLogin(address, signMessageAsync)   admin-allowlisted variant
 *   walletBind(address, signMessageAsync)     bind wallet to authed User
 *   sendCalldata(address, sendTxAsync, {to,data,value})
 *                                             submit built tx and wait
 *   buildAndSend(address, sendTxAsync, endpoint, body)
 *                                             build-tx endpoint → sign → send
 *   buildAndSendSteps(address, sendTxAsync, endpoint, body)
 *                                             multi-step (approve+deposit,
 *                                             claimYield+claimPrincipal) —
 *                                             sequentially prompts + submits
 */

import axios from 'axios';
import { waitForReceipt } from './txReceipt';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5050';

/**
 * Token lookup. v2 pages call setSession(token) which writes to
 * sessionStorage.accessToken. Legacy Colosseum admin/PSP flow uses
 * sessionStorage.token. Legacy lender wallet flow used localStorage.token.
 * We check all three, in priority order:
 *   1. sessionStorage.accessToken   (v2 email/password login, current)
 *   2. localStorage.token           (old lender-wallet flow, still valid)
 *   3. sessionStorage.token         (legacy PSP/admin)
 * Sending the raw token as Authorization header (no "Bearer") — matches v2.
 */
function getToken() {
  return (
    sessionStorage.getItem('accessToken') ||
    localStorage.getItem('token') ||
    sessionStorage.getItem('token') ||
    ''
  );
}

export function api() {
  const token = getToken();
  return axios.create({
    baseURL: API_BASE,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

async function fetchSiweNonce(address, purpose) {
  const { data } = await axios.post(`${API_BASE}/auth/wallet/nonce`, {
    wallet: address, purpose,
  });
  return data; // { wallet, nonce, expiresAt, message }
}

async function signSiweMessage(signMessageAsync, message) {
  if (typeof signMessageAsync !== 'function') {
    throw new Error('signMessageAsync (from useSignMessage) required');
  }
  // wagmi's useSignMessage takes { message } and returns a hex signature
  return signMessageAsync({ message });
}

/**
 * Lender login: nonce → SIWE sign → /auth/wallet/login. On first sign-in
 * for a wallet, the server also creates the Lender record if the wallet
 * was pre-invited via access code.
 */
export async function walletLogin(address, signMessageAsync) {
  if (!address) throw new Error('Wallet not connected');
  const { nonce, message } = await fetchSiweNonce(address, 'login');
  const signature = await signSiweMessage(signMessageAsync, message);
  const { data } = await axios.post(`${API_BASE}/auth/wallet/login`, {
    wallet: address, nonce, signature, message,
  });
  localStorage.setItem('token', data.token);
  localStorage.setItem('lender', JSON.stringify(data.lender));
  return data;
}

/** On-chain admin login. Wallet must be in ONCHAIN_ADMIN_WALLETS. */
export async function onchainAdminLogin(address, signMessageAsync) {
  if (!address) throw new Error('Wallet not connected');
  const { nonce, message } = await fetchSiweNonce(address, 'login');
  const signature = await signSiweMessage(signMessageAsync, message);
  const { data } = await axios.post(`${API_BASE}/auth/wallet/onchain-admin/login`, {
    wallet: address, nonce, signature, message,
  });
  sessionStorage.setItem('token', data.token);
  sessionStorage.setItem('user', JSON.stringify(data.user));
  return data;
}

/**
 * Bind the connected wallet to the currently-authenticated User (PSP /
 * admin). Requires an existing JWT in sessionStorage.
 */
export async function walletBind(address, signMessageAsync) {
  if (!address) throw new Error('Wallet not connected');
  const { nonce, message } = await fetchSiweNonce(address, 'bind');
  const signature = await signSiweMessage(signMessageAsync, message);
  const { data } = await api().post('/auth/wallet/bind', {
    wallet: address, nonce, signature, message,
  });
  return data;
}

/**
 * Send an already-built tx via wagmi's sendTransactionAsync. Returns the
 * transaction hash. The server is not involved after build-tx.
 *
 *   tx = { to, data, value }  ← what the server returned
 */
export async function sendCalldata(address, sendTransactionAsync, tx) {
  if (!address) throw new Error('Wallet not connected');
  if (typeof sendTransactionAsync !== 'function') {
    throw new Error('sendTransactionAsync (from useSendTransaction) required');
  }
  if (!tx?.to || !tx?.data) {
    throw new Error('Malformed tx: expected { to, data, value }');
  }
  const hash = await sendTransactionAsync({
    to: tx.to,
    data: tx.data,
    // wagmi accepts string / bigint / hex for value; the server sends string
    value: tx.value ? BigInt(tx.value) : 0n,
  });
  // sendTransactionAsync resolves on broadcast, not on mining. Without this
  // wait a reverted transaction is reported to the user as a success.
  await waitForReceipt(hash);
  return hash;
}

/**
 * End-to-end for single-step build-tx endpoints:
 *   POST endpoint → get { to, data, value } → wallet signs + sends
 * Returns { hash, built }.
 */
export async function buildAndSend(address, sendTransactionAsync, endpoint, body) {
  const { data: built } = await api().post(endpoint, body);
  if (!built?.to || !built?.data) {
    throw new Error(`Server did not return calldata from ${endpoint}`);
  }
  const hash = await sendCalldata(address, sendTransactionAsync, built);
  return { hash, built };
}

/**
 * End-to-end for multi-step build-tx endpoints (deposit = approve+deposit;
 * redeem = claimYield+claimPrincipal). Each step's tx is signed in
 * sequence; on any step failure, the sequence stops with the caught error.
 *
 * Returns { hashes: [...], built }. `built.steps` is passed through so
 * callers can render "step 1 of 2: approving USDC" style UI.
 */
export async function buildAndSendSteps(address, sendTransactionAsync, endpoint, body) {
  const { data: built } = await api().post(endpoint, body);
  const steps = Array.isArray(built?.steps) ? built.steps : null;
  if (!steps || steps.length === 0) {
    // Fallback to single-tx shape when server didn't emit steps[]
    const hash = await sendCalldata(address, sendTransactionAsync, built);
    return { hashes: [hash], built };
  }
  const hashes = [];
  for (const step of steps) {
    const hash = await sendCalldata(address, sendTransactionAsync, step.tx);
    hashes.push(hash);
  }
  return { hashes, built };
}
