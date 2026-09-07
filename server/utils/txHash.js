/**
 * utils/txHash.js — single source of truth for "is this a real on-chain hash"
 *
 * The historical SAFE-Observer integration used to write `OFFCHAIN-${Date.now()}`
 * onto RepaymentRecord.txHash and FinancingRequest.repaymentTxHash. That synthetic
 * id polluted the observer's matched-set and prevented the real on-chain
 * transaction from ever being recognised — see SAFE-Observer's
 * docs/UNMAPPED_RECOVERY.md.
 *
 * Anything not matching `/^0x[0-9a-fA-F]+$/` is treated as "no on-chain hash
 * known yet" and stored as null.
 *
 * @param {unknown} hash
 * @returns {boolean}
 */
function isRealTxHash(hash) {
  return typeof hash === 'string' && /^0x[0-9a-fA-F]+$/.test(hash);
}

module.exports = { isRealTxHash };
