/**
 * ethers-based client for the payfi_v1 contract set.
 *
 * Same responsibilities as the legacy Anchor-based poolService.js:
 *   1. Read on-chain state (factory, pool, drawdown, LP position) for
 *      the indexer worker and every /pool/* read endpoint.
 *   2. Encode calldata for every state-changing instruction. Callers
 *      pass the calldata to the frontend, which signs via wagmi and
 *      submits. Server never holds user keys.
 *
 * The one exception: writes that carry an AGENT role (executeDrawdown,
 * declareDefault, setScOverdue, setPaused) can also be signed server-side
 * using the AGENT_PRIVATE_KEY from env — see serverExecuteDrawdown() etc.
 * This mirrors Colosseum's fee-payer relay but is stricter: only role-
 * gated ops, not arbitrary txs.
 *
 * Interface shape returned by encode*():
 *   { to: address, data: '0x...', value: 0n }
 * — the shape wagmi's writeContract / ethers.sendTransaction expect.
 */

const { ethers } = require('ethers');
const {
  getProvider,
  getFactoryAddress,
  getStablecoinAddress,
  getTreasuryAddress,
  getAgentSigner,
} = require('../config/chain');
const {
  PoolFactoryAbi,
  PoolContractAbi,
  TreasuryReserveAbi,
  ERC20Abi,
} = require('../abis');

// ── Contract factories ─────────────────────────────────────────────────
// Prefer passing an explicit signer for writes; reads default to provider.

function getFactory(signerOrProvider) {
  return new ethers.Contract(getFactoryAddress(), PoolFactoryAbi, signerOrProvider || getProvider());
}

function getPool(poolAddress, signerOrProvider) {
  return new ethers.Contract(poolAddress, PoolContractAbi, signerOrProvider || getProvider());
}

function getTreasury(signerOrProvider) {
  return new ethers.Contract(getTreasuryAddress(), TreasuryReserveAbi, signerOrProvider || getProvider());
}

function getStablecoin(signerOrProvider) {
  return new ethers.Contract(getStablecoinAddress(), ERC20Abi, signerOrProvider || getProvider());
}

// Cached Interface for cheap calldata encoding without instantiating a
// Contract each time.
const poolInterface   = new ethers.Interface(PoolContractAbi);
const factoryInterface = new ethers.Interface(PoolFactoryAbi);
const erc20Interface  = new ethers.Interface(ERC20Abi);

// ── Reads ───────────────────────────────────────────────────────────────

/**
 * Snapshot every relevant Pool storage var in one round-trip.
 * The indexer worker calls this every 15s per pool. Batched via
 * Promise.all so a single provider RPC call under the hood.
 */
// Retry helper — transient RPC errors on public testnet RPCs are common.
// Retries on:
//   - 429 / 500 / timeout / rate limits (standard HTTP-level throttling)
//   - CALL_EXCEPTION with missing revert data — Arc's public RPC pattern
//     when overloaded; the RPC returns a bogus revert instead of 429.
//   - "could not coalesce" — ethers.js signal of RPC batch failure.
// Exponential backoff: 500ms, 1s, 2s.
async function _withRetry(fn, retries = 3) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = String(e?.message || '');
      const code = e?.code || '';
      const transient =
        /429|500|timeout|rate|coalesce|ECONNRESET|missing revert data/i.test(msg) ||
        code === 'CALL_EXCEPTION';
      if (transient && i < retries) {
        await new Promise((r) => setTimeout(r, 500 * (2 ** i)));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

// Reading a pool's full state means ~25 view calls. Firing them all at once
// per pool trips the rate limiter on public RPC endpoints once more than a
// couple of pools exist, so they go out in small waves instead. Order is
// preserved, which the destructuring above depends on.
//
// The batch size and spacing are deliberately conservative; a dedicated
// endpoint can raise both via env.
const RPC_BATCH_SIZE  = parseInt(process.env.EVM_RPC_BATCH_SIZE || '5', 10);
const RPC_BATCH_PAUSE = parseInt(process.env.EVM_RPC_BATCH_PAUSE_MS || '120', 10);

async function _inBatches(thunks) {
  const out = [];
  for (let i = 0; i < thunks.length; i += RPC_BATCH_SIZE) {
    const slice = thunks.slice(i, i + RPC_BATCH_SIZE);
    out.push(...await Promise.all(slice.map((fn) => fn())));
    if (i + RPC_BATCH_SIZE < thunks.length && RPC_BATCH_PAUSE > 0) {
      await new Promise((r) => setTimeout(r, RPC_BATCH_PAUSE));
    }
  }
  return out;
}

async function readPoolState(poolAddress) {
  const pool = getPool(poolAddress);
  const [
    status, pspWallet, stablecoin, factory,
    softCap, hardCap, tenure, aprAnnual,
    idleRateDaily, utilizedRateDaily, penaltyRateDaily, penaltyGraceDays, minDeposit,
    fundingStartTs, fMaturityTs, poolStartTs, poolFinalityTs,
    principal, availableToDd, outstanding, fundingCredit, yieldOwed, dollarSeconds,
    isDrawdownAllowed, currentDay,
  ] = await _withRetry(() => _inBatches([
    () => pool.status(), () => pool.pspWallet(), () => pool.stablecoin(), () => pool.factory(),
    () => pool.softCap(), () => pool.hardCap(), () => pool.tenure(), () => pool.aprAnnual(),
    () => pool.idleRateDaily(), () => pool.utilizedRateDaily(), () => pool.penaltyRateDaily(),
    () => pool.penaltyGraceDays(), () => pool.minDeposit(),
    () => pool.fundingStartTs(), () => pool.fMaturityTs(), () => pool.poolStartTs(),
    () => pool.poolFinalityTs(),
    () => pool.principal(), () => pool.availableToDd(), () => pool.outstanding(),
    () => pool.fundingCredit(), () => pool.yieldOwed(), () => pool.dollarSeconds(),
    () => pool.isDrawdownAllowed(), () => pool.currentDay(),
  ]));

  return {
    poolAddress,
    // Status enum from PoolContract.sol:
    //   0=Funding, 1=Active, 2=Unsuccessful, 3=Closed, 4=Default
    status: Number(status),
    pspWallet,
    stablecoin,
    factory,
    softCap,
    hardCap,
    tenure,
    aprAnnual,
    idleRateDaily,
    utilizedRateDaily,
    penaltyRateDaily,
    penaltyGraceDays,
    minDeposit,
    fundingStartTs,
    fMaturityTs,
    poolStartTs,
    poolFinalityTs,
    principal,
    availableToDd,
    outstanding,
    fundingCredit,
    yieldOwed,
    dollarSeconds,
    isDrawdownAllowed,
    currentDay,
  };
}

/**
 * Read a pool's drawdowns directly from its DrawdownExecuted events.
 *
 * The indexer is the normal source, but it only scans drawdowns for pools it
 * has already recorded, so a pool it has not yet seen appears to have none.
 * This is the fallback for that case: the events are authoritative and the
 * current principal is read back per ref, which is also how a repaid drawdown
 * is detected (the pool zeroes the principal on repayment).
 */
async function readDrawdownsFromChain(poolAddress, { includeRepaid = false, lookback = 20000 } = {}) {
  const pool = getPool(poolAddress);
  const provider = getProvider();
  const latest = await provider.getBlockNumber();
  const earliest = Math.max(0, latest - lookback);

  // Arc's RPC rejects wide log queries with "requested range too large", so
  // walk backwards in windows rather than asking for the whole span at once.
  const STEP = parseInt(process.env.EVM_LOG_WINDOW || '4000', 10);
  const events = [];
  for (let to = latest; to > earliest; to -= STEP) {
    const from = Math.max(earliest, to - STEP + 1);
    try {
      const batch = await pool.queryFilter(pool.filters.DrawdownExecuted(), from, to);
      events.push(...batch);
    } catch (e) {
      // A window that fails should not lose the windows that succeeded.
      console.warn('[readDrawdownsFromChain] window', from, to, e.message);
    }
  }
  const out = [];
  for (const ev of events) {
    const ref = ev.args?.ref;
    if (!ref) continue;
    const dd = await readDrawdown(poolAddress, ref);
    const repaid = !dd.exists;
    if (repaid && !includeRepaid) continue;
    out.push({
      pubkey: ref,
      id: ref,
      principal: (repaid ? ev.args.principal : dd.principal).toString(),
      drawdownDay: Number((dd.startTs || 0n) / 86400n),
      tenorDays: Number(((dd.expiryTs || 0n) - (dd.startTs || 0n)) / 86400n),
      repaid,
    });
  }
  return out;
}

async function readDrawdown(poolAddress, ref) {
  const pool = getPool(poolAddress);
  const [principal, startTs, expiryTs, receiverWallet] = await pool.getDrawDown(ref);
  return {
    ref,
    principal,
    startTs,
    expiryTs,
    receiverWallet,
    // A drawdown is treated as "empty" (never existed / already removed) when
    // principal is 0. Consumers can filter these out.
    exists: principal > 0n,
  };
}

async function readAllPools() {
  const factory = getFactory();
  const count = Number(await factory.poolCount());
  // Sequential to avoid slamming the RPC with poolCount concurrent calls
  // when count is high. On testnets this stays small enough that a serial
  // loop is fine (~50-100ms total for 20 pools).
  const pools = [];
  for (let i = 0; i < count; i++) {
    pools.push(await factory.pools(i));
  }
  return pools;
}

async function readPspRecord(pspAddress) {
  const factory = getFactory();
  const [approved, activePool] = await factory.psps(pspAddress);
  return { pspAddress, approved, activePool };
}

async function readLpPosition(poolAddress, lpAddress) {
  const pool = getPool(poolAddress);
  const [
    principal,
    fundingCredit,
    lastUpdate,
    dollarSeconds,
    claimedYield,
    claimedPrincipal,
    claimedOverrunYield,
    claimedBonus,
    finalized,
  ] = await pool.getLpPosition(lpAddress);
  return {
    lpAddress,
    principal,
    fundingCredit,
    lastUpdate,
    dollarSeconds,
    claimedYield,
    claimedPrincipal,
    claimedOverrunYield,
    claimedBonus,
    finalized,
  };
}

async function balanceOfStablecoin(address) {
  return getStablecoin().balanceOf(address);
}

// ── Calldata encoders (client will sign) ───────────────────────────────
// Each returns { to, data, value } — the exact shape wagmi's writeContract
// and ethers.sendTransaction consume.

function _tx(to, data) {
  return { to, data, value: 0n };
}

function encodeApprove(spender, amount) {
  return _tx(
    getStablecoinAddress(),
    erc20Interface.encodeFunctionData('approve', [spender, amount])
  );
}

function encodeDeposit(poolAddress, amount) {
  return _tx(poolAddress, poolInterface.encodeFunctionData('deposit', [amount]));
}

function encodeWithdraw(poolAddress, amount) {
  return _tx(poolAddress, poolInterface.encodeFunctionData('withdraw', [amount]));
}

function encodeFinalizeFunding(poolAddress) {
  return _tx(poolAddress, poolInterface.encodeFunctionData('finalizeFunding', []));
}

/**
 * Encode an executeDrawdown call. In production this is called with the
 * server as AGENT2 signer (see serverExecuteDrawdown), not the PSP —
 * but we expose the calldata form too so an on-chain admin flow could
 * sign it manually if needed.
 */
function encodeExecuteDrawdown(poolAddress, ref, receiverWallet, amount, settlementDays) {
  return _tx(
    poolAddress,
    poolInterface.encodeFunctionData('executeDrawdown', [ref, receiverWallet, amount, settlementDays])
  );
}

function encodeRepay(poolAddress, ref) {
  return _tx(poolAddress, poolInterface.encodeFunctionData('repay', [ref]));
}

function encodePayAccruedIdleFees(poolAddress, amount) {
  return _tx(poolAddress, poolInterface.encodeFunctionData('payAccruedIdleFees', [amount]));
}

function encodeClaimYield(poolAddress) {
  return _tx(poolAddress, poolInterface.encodeFunctionData('claimYield', []));
}

function encodeClaimPrincipal(poolAddress) {
  return _tx(poolAddress, poolInterface.encodeFunctionData('claimPrincipal', []));
}

function encodeDeclareDefault(poolAddress) {
  return _tx(poolAddress, poolInterface.encodeFunctionData('declareDefault', []));
}

function encodeSettleDefaultPrincipal(poolAddress, amount) {
  return _tx(poolAddress, poolInterface.encodeFunctionData('settleDefaultPrincipal', [amount]));
}

function encodeSettleDefaultYield(poolAddress, amount) {
  return _tx(poolAddress, poolInterface.encodeFunctionData('settleDefaultYield', [amount]));
}

function encodeSweepProtocolFees(poolAddress) {
  return _tx(poolAddress, poolInterface.encodeFunctionData('sweepProtocolFees', []));
}

function encodeAddReceiver(poolAddress, receiverWallet) {
  return _tx(poolAddress, poolInterface.encodeFunctionData('addReceiver', [receiverWallet]));
}

function encodeApprovePsp(pspWallet) {
  return _tx(
    getFactoryAddress(),
    factoryInterface.encodeFunctionData('approvePsp', [pspWallet])
  );
}

function encodeRevokePsp(pspWallet) {
  return _tx(
    getFactoryAddress(),
    factoryInterface.encodeFunctionData('revokePsp', [pspWallet])
  );
}

/**
 * Encode a createPool call. Params must match PoolFactory.CreatePoolParams
 * exactly. Amounts are 6-decimal (USDC); rates + APR are WAD (1e18).
 */
function encodeCreatePool(params) {
  return _tx(
    getFactoryAddress(),
    factoryInterface.encodeFunctionData('createPool', [params])
  );
}

/**
 * Dry-run factory.createPool before handing the caller calldata to sign.
 *
 * The factory enforces a set of constraints that are easy to trip and
 * expensive to discover the hard way — the economic envelope, cap ordering,
 * the "PSP already has a live pool" gate, and the APR coverability invariant
 *
 *     aprAnnual * maxTenureSecs <= utilizedRateDaily * 365 * tenure * D
 *
 * where maxTenureSecs includes the funding window. That last one makes the
 * funding duration load-bearing: widening it can push a set of terms that was
 * fine over the line. Without this check the caller signs, pays gas, and gets
 * a bare "execution reverted" from the wallet.
 *
 * Returns null when the call would succeed, or the revert reason string.
 */
async function simulateCreatePool(params, from) {
  try {
    const factory = getFactory();
    await factory.createPool.staticCall(params, from ? { from } : {});
    return null;
  } catch (e) {
    return (
      e?.reason ||
      e?.revert?.args?.[0] ||
      e?.shortMessage ||
      e?.info?.error?.message ||
      e?.message ||
      'createPool would revert'
    );
  }
}

// ── Server-signed operations (AGENT_PRIVATE_KEY holds AGENT2_ROLE) ─────

/**
 * Server-signed drawdown execution — the PSP requests, the server signs
 * as AGENT2. Non-custodial in the payfi_v1 sense: funds go directly to
 * the pre-authorized receiverWallet, not through the server. The server
 * only signs the transition.
 */
async function serverExecuteDrawdown(poolAddress, ref, receiverWallet, amount, settlementDays) {
  const signer = getAgentSigner();
  const pool = getPool(poolAddress, signer);
  const tx = await pool.executeDrawdown(ref, receiverWallet, amount, settlementDays);
  return tx.wait();
}

async function serverSetPaused(poolAddress, paused) {
  const signer = getAgentSigner();
  const pool = getPool(poolAddress, signer);
  const tx = await pool.setPaused(Boolean(paused));
  return tx.wait();
}

async function serverSetScOverdue(poolAddress, enabled) {
  const signer = getAgentSigner();
  const pool = getPool(poolAddress, signer);
  const tx = await pool.setScOverdue(Boolean(enabled));
  return tx.wait();
}

// ── Utility: bytes32 ref from a UUID-ish string ────────────────────────
// The server stores per-drawdown DB rows keyed by a UUID (drawdown_id).
// executeDrawdown wants a bytes32 ref — deterministically hash the id so
// the same drawdown always maps to the same on-chain ref.
function refFromId(drawdownId) {
  return ethers.id(String(drawdownId));  // keccak256(utf8) → bytes32
}

module.exports = {
  // Contract getters
  getFactory,
  getPool,
  getTreasury,
  getStablecoin,

  // Reads
  readPoolState,
  readDrawdown,
  readDrawdownsFromChain,
  readAllPools,
  readPspRecord,
  readLpPosition,
  balanceOfStablecoin,

  // Calldata encoders (client-signed)
  encodeApprove,
  encodeDeposit,
  encodeWithdraw,
  encodeFinalizeFunding,
  encodeExecuteDrawdown,
  encodeRepay,
  encodePayAccruedIdleFees,
  encodeClaimYield,
  encodeClaimPrincipal,
  encodeDeclareDefault,
  encodeSettleDefaultPrincipal,
  encodeSettleDefaultYield,
  encodeSweepProtocolFees,
  encodeAddReceiver,
  encodeApprovePsp,
  encodeRevokePsp,
  encodeCreatePool,
  simulateCreatePool,

  // Server-signed operations
  serverExecuteDrawdown,
  serverSetPaused,
  serverSetScOverdue,

  // Helpers
  refFromId,

  // Interfaces (exposed for tests + advanced callers)
  poolInterface,
  factoryInterface,
  erc20Interface,
};
