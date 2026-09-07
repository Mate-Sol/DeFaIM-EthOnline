/**
 * Unit tests for poolServiceEvm calldata encoders.
 *
 * These are pure ethers.Interface.encodeFunctionData tests — no RPC calls,
 * no signers, no live chain. They lock in the function selectors and
 * argument ABI encoding so we notice if a contract ABI change breaks the
 * server-side encoder unnoticed.
 *
 * Run with:  npm test
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { ethers } = require('ethers');

// Set the env vars the config module expects BEFORE requiring the service,
// so getFactoryAddress()/getStablecoinAddress() don't throw. Actual RPC is
// never hit — encoders work off ABI + args only.
process.env.PAYFI_FACTORY_ADDRESS = process.env.PAYFI_FACTORY_ADDRESS
  || '0x1111111111111111111111111111111111111111';
process.env.PAYFI_STABLECOIN_ADDRESS = process.env.PAYFI_STABLECOIN_ADDRESS
  || '0x2222222222222222222222222222222222222222';
process.env.PAYFI_TREASURY_ADDRESS = process.env.PAYFI_TREASURY_ADDRESS
  || '0x3333333333333333333333333333333333333333';

const svc = require('../services/poolServiceEvm');

const POOL       = '0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa';
const RECEIVER   = '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB';
const LP         = '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC';
const SPENDER    = '0xDDdDddDdDdddDDddDDddDDDDdDdDDdDDdDDDDDDd';

/** Selector = first 4 bytes of the encoded calldata. */
function selectorOf(data) {
  return data.slice(0, 10); // '0x' + 8 hex chars
}

test('encodeDeposit — selector + arg', () => {
  const { to, data, value } = svc.encodeDeposit(POOL, 1_000_000n);
  assert.strictEqual(to, POOL);
  assert.strictEqual(value, 0n);
  // keccak256("deposit(uint256)").slice(0,10) = 0xb6b55f25
  assert.strictEqual(selectorOf(data), '0xb6b55f25');
  // Arg 1_000_000 (0xf4240) is padded to 32 bytes
  assert.ok(data.endsWith('00000000000000000000000000000000000000000000000000000000000f4240'));
});

test('encodeWithdraw — selector', () => {
  const { data } = svc.encodeWithdraw(POOL, 500n);
  // keccak256("withdraw(uint256)").slice(0,10) = 0x2e1a7d4d
  assert.strictEqual(selectorOf(data), '0x2e1a7d4d');
});

test('encodeFinalizeFunding — no args', () => {
  const { to, data } = svc.encodeFinalizeFunding(POOL);
  assert.strictEqual(to, POOL);
  // Zero-arg function encodes to just the selector.
  assert.strictEqual(data.length, 10);
});

test('encodeExecuteDrawdown — 4 args, bytes32 first', () => {
  const ref = svc.refFromId('drawdown-uuid-abc');
  const { data } = svc.encodeExecuteDrawdown(POOL, ref, RECEIVER, 5_000_000n, 30);
  // keccak256("executeDrawdown(bytes32,address,uint256,uint256)").slice(0,10)
  // = 0x005a51df
  assert.strictEqual(selectorOf(data), '0x005a51df');
  // Length: selector(4) + bytes32(32) + address(32) + uint256(32) + uint256(32) = 132 bytes = 264 hex + '0x'
  assert.strictEqual(data.length, 2 + 8 + 128 * 2);
});

test('encodeRepay — selector', () => {
  const ref = svc.refFromId('drawdown-1');
  const { data } = svc.encodeRepay(POOL, ref);
  // keccak256("repay(bytes32)").slice(0,10) = 0x563dd613
  assert.strictEqual(selectorOf(data), '0x563dd613');
});

test('encodeApprovePsp — factory tx', () => {
  const { to, data } = svc.encodeApprovePsp(RECEIVER);
  assert.strictEqual(to, process.env.PAYFI_FACTORY_ADDRESS);
  // keccak256("approvePsp(address)").slice(0,10) = 0xd9eb3639
  assert.strictEqual(selectorOf(data), '0xd9eb3639');
});

test('encodeApprove — ERC20 approve on stablecoin', () => {
  const { to, data } = svc.encodeApprove(SPENDER, ethers.MaxUint256);
  assert.strictEqual(to, process.env.PAYFI_STABLECOIN_ADDRESS);
  // keccak256("approve(address,uint256)").slice(0,10) = 0x095ea7b3
  assert.strictEqual(selectorOf(data), '0x095ea7b3');
});

test('refFromId — deterministic bytes32 mapping', () => {
  const a = svc.refFromId('facility-42-drawdown-1');
  const b = svc.refFromId('facility-42-drawdown-1');
  assert.strictEqual(a, b, 'same input → same ref');
  assert.match(a, /^0x[0-9a-f]{64}$/, 'valid bytes32 hex');

  const c = svc.refFromId('facility-42-drawdown-2');
  assert.notStrictEqual(a, c, 'different inputs → different refs');
});

test('claim helpers — zero-arg selectors', () => {
  const yieldTx = svc.encodeClaimYield(POOL);
  // keccak256("claimYield()").slice(0,10) = 0x406cf229
  assert.strictEqual(selectorOf(yieldTx.data), '0x406cf229');

  const principalTx = svc.encodeClaimPrincipal(POOL);
  // keccak256("claimPrincipal()").slice(0,10) = 0x7ba32ee3
  assert.strictEqual(selectorOf(principalTx.data), '0x7ba32ee3');
});

test('all encoders return { to, data, value:0n } shape', () => {
  const ref = svc.refFromId('x');
  const cases = [
    svc.encodeDeposit(POOL, 1n),
    svc.encodeWithdraw(POOL, 1n),
    svc.encodeFinalizeFunding(POOL),
    svc.encodeExecuteDrawdown(POOL, ref, RECEIVER, 1n, 1),
    svc.encodeRepay(POOL, ref),
    svc.encodePayAccruedIdleFees(POOL, 1n),
    svc.encodeClaimYield(POOL),
    svc.encodeClaimPrincipal(POOL),
    svc.encodeDeclareDefault(POOL),
    svc.encodeSettleDefaultPrincipal(POOL, 1n),
    svc.encodeSettleDefaultYield(POOL, 1n),
    svc.encodeSweepProtocolFees(POOL),
    svc.encodeAddReceiver(POOL, RECEIVER),
    svc.encodeApprovePsp(RECEIVER),
    svc.encodeRevokePsp(RECEIVER),
    svc.encodeApprove(SPENDER, 1n),
  ];

  for (const c of cases) {
    assert.match(c.to, /^0x[0-9a-fA-F]{40}$/, 'to is a 20-byte address');
    assert.match(c.data, /^0x[0-9a-fA-F]+$/, 'data is 0x-prefixed hex');
    assert.strictEqual(c.value, 0n, 'no ether attached');
  }
});
