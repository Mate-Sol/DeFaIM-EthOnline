// Single source of truth for the "settled" derived status.
//
// A facility is "settled" once the pool went active, ran its course,
// and there is nothing left for either party to do: every drawdown is
// repaid, no commit fee is accruing, and the protocol has no claim on
// the vault. Lenders can redeem the full vault remainder cleanly.
//
// Two flavors:
//   isSettledFromPool(pool)      — uses pool state only (suitable for
//                                  list cards that don't fetch /daily-activity)
//   isSettledFromPool(pool, pending) — adds in-flight util/penalty fee
//                                  estimates from /daily-activity for the
//                                  strictest check on detail pages.
export const isSettledFromPool = (pool, pending = null) => {
  if (!pool) return false;
  if (pool.isCancelled || pool.isDefaulted) return false;
  if (!pool.isActive) return false;
  if (Number(pool.countActiveDrawdowns || 0) !== 0) return false;
  if (BigInt(pool.accruedCommitFee || '0') !== 0n) return false;
  if (BigInt(pool.protocolFeesOwed || '0') !== 0n) return false;
  // Has actually drawn at least once — otherwise a freshly-activated
  // pool would look "settled" before the PSP ever drew.
  if (Number(pool.nextDrawdownId || 0) === 0) return false;
  if (pending) {
    if (BigInt(pending.utilFeePending || '0') !== 0n) return false;
    if (BigInt(pending.penaltyFeePending || '0') !== 0n) return false;
  }
  return true;
};
