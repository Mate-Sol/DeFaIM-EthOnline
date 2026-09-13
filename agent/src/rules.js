'use strict';

/**
 * Risk rules over live Subgraph data.
 *
 * Every rule is a pure function of a facility snapshot plus a clock. Pure so
 * the judgements are testable without a network, and so the reason a facility
 * was flagged can be shown next to the flag rather than inferred.
 *
 * Rates are WAD-scaled per day; amounts are USDC base units (6 decimals).
 */

const WAD = 10n ** 18n;
const USDC = 10n ** 6n;

const SEVERITY = { CRITICAL: 3, WARNING: 2, INFO: 1 };

const big = (v) => {
  try { return BigInt(v ?? 0); } catch { return 0n; }
};
const usdc = (base) => Number(big(base)) / Number(USDC);

/**
 * A contract "day" is not a real day on the demo factory, where
 * SECONDS_PER_DAY is 60 so a 30-day facility runs in half an hour. Rules that
 * reason about elapsed days must be told which clock they are on, or every
 * demo facility reads as catastrophically overdue.
 */
function daysBetween(fromTs, toTs, secondsPerDay) {
  const span = Number(big(toTs)) - Number(big(fromTs));
  if (!Number.isFinite(span) || span <= 0) return 0;
  return Math.floor(span / secondsPerDay);
}

/**
 * A drawdown past its grace window is accruing the penalty rate, which is
 * uncapped by design. Left alone it grows without bound, so this is the one
 * finding that is always worth a human's attention.
 */
function penaltyAccruing(facility, drawdown, now, secondsPerDay) {
  if (drawdown.repaid) return null;
  const tenure = Number(facility.tenureDays ?? 0);
  const grace = Number(facility.penaltyGraceDays ?? 0);
  const age = daysBetween(drawdown.drawnAt, now, secondsPerDay);
  const overdueBy = age - (tenure + grace);
  if (overdueBy <= 0) return null;

  const principal = big(drawdown.amount);
  const penaltyPerDay = (principal * big(facility.penaltyRateDaily)) / WAD;
  const accrued = penaltyPerDay * BigInt(overdueBy);

  return {
    rule: 'penalty-accruing',
    severity: 'CRITICAL',
    facility: facility.id,
    borrower: facility.borrower,
    ref: drawdown.ref,
    overdueDays: overdueBy,
    principal: usdc(principal),
    estimatedPenalty: usdc(accrued),
    message:
      `Drawdown ${String(drawdown.ref).slice(0, 10)}… is ${overdueBy} day(s) past grace on a ` +
      `${usdc(principal)} USDC draw. Penalty is uncapped and still accruing ` +
      `(~${usdc(accrued)} USDC so far).`,
  };
}

/**
 * Debt still outstanding as the facility approaches finality. After finality
 * repaid principal stops revolving and lenders expect to claim, so a facility
 * that arrives there with money out is heading for a default declaration.
 */
function outstandingNearFinality(facility, now, secondsPerDay, windowDays = 3) {
  if (facility.status !== 'ACTIVE') return null;
  const outstanding = big(facility.outstanding);
  if (outstanding === 0n) return null;
  if (!facility.finalityAt) return null;

  const daysLeft = daysBetween(now, facility.finalityAt, secondsPerDay);
  if (daysLeft > windowDays) return null;

  return {
    rule: 'outstanding-near-finality',
    severity: daysLeft <= 0 ? 'CRITICAL' : 'WARNING',
    facility: facility.id,
    borrower: facility.borrower,
    daysToFinality: daysLeft,
    outstanding: usdc(outstanding),
    message:
      daysLeft <= 0
        ? `Facility is past finality with ${usdc(outstanding)} USDC still outstanding.`
        : `${usdc(outstanding)} USDC outstanding with ${daysLeft} day(s) to finality.`,
  };
}

/**
 * A funding window that closed below its soft cap strands lender capital: the
 * facility can only go Unsuccessful, and nobody is paid until someone calls
 * finalizeFunding(). It is inert but it needs a nudge.
 */
function fundingStalled(facility, now) {
  if (facility.status !== 'FUNDING') return null;
  if (!facility.fundingMaturity) return null;
  if (Number(big(now)) < Number(big(facility.fundingMaturity))) return null;

  const raised = big(facility.totalAssets);
  const soft = big(facility.softCap);
  const met = raised >= soft && soft > 0n;

  return {
    rule: 'funding-window-expired',
    severity: met ? 'WARNING' : 'INFO',
    facility: facility.id,
    borrower: facility.borrower,
    raised: usdc(raised),
    softCap: usdc(soft),
    message: met
      ? `Funding window closed at or above soft cap (${usdc(raised)}/${usdc(soft)} USDC) ` +
        'but the pool has not been finalised. Call finalizeFunding() to activate.'
      : `Funding window closed below soft cap (${usdc(raised)}/${usdc(soft)} USDC). ` +
        'Pool can only go Unsuccessful; lenders should withdraw.',
  };
}

/**
 * A single borrower holding a large share of all deployed capital. Not a
 * failure, but the thing a credit book is supposed to watch.
 */
function borrowerConcentration(facilities, thresholdPct = 50) {
  const active = facilities.filter((f) => f.status === 'ACTIVE');
  const total = active.reduce((acc, f) => acc + big(f.outstanding), 0n);
  if (total === 0n) return [];

  const byBorrower = new Map();
  for (const f of active) {
    const key = String(f.borrower).toLowerCase();
    byBorrower.set(key, (byBorrower.get(key) ?? 0n) + big(f.outstanding));
  }

  const out = [];
  for (const [borrower, amount] of byBorrower) {
    const pct = Number((amount * 100n) / total);
    if (pct < thresholdPct) continue;
    out.push({
      rule: 'borrower-concentration',
      severity: pct >= 80 ? 'WARNING' : 'INFO',
      borrower,
      sharePct: pct,
      outstanding: usdc(amount),
      message:
        `${borrower.slice(0, 10)}… holds ${pct}% of all outstanding credit ` +
        `(${usdc(amount)} of ${usdc(total)} USDC).`,
    });
  }
  return out;
}

/**
 * Yield a lender has earned but not collected. Harmless, but it is money
 * sitting unclaimed and worth surfacing to whoever owns the relationship.
 */
function unclaimedYield(facility, minUsdc = 0.01) {
  const owed = big(facility.totalFinanceCharge) - big(facility.totalYieldClaimed);
  if (owed <= 0n) return null;
  if (usdc(owed) < minUsdc) return null;
  return {
    rule: 'unclaimed-yield',
    severity: 'INFO',
    facility: facility.id,
    amount: usdc(owed),
    lenderCount: facility.lenderCount ?? 0,
    message:
      `${usdc(owed)} USDC of finance charge collected but not yet claimed by ` +
      `${facility.lenderCount ?? 0} lender(s).`,
  };
}

/**
 * Run every rule over a snapshot. Findings come back worst-first so the
 * caller can act on the top of the list and stop.
 */
function evaluate(facilities, { now, secondsPerDay = 86400 } = {}) {
  const findings = [];
  for (const f of facilities) {
    const drawdowns = f.drawdowns ?? [];
    for (const dd of drawdowns) {
      const hit = penaltyAccruing(f, dd, now, secondsPerDay);
      if (hit) findings.push(hit);
    }
    const near = outstandingNearFinality(f, now, secondsPerDay);
    if (near) findings.push(near);
    const stalled = fundingStalled(f, now);
    if (stalled) findings.push(stalled);
    const yieldHit = unclaimedYield(f);
    if (yieldHit) findings.push(yieldHit);
  }
  findings.push(...borrowerConcentration(facilities));

  return findings.sort((a, b) => SEVERITY[b.severity] - SEVERITY[a.severity]);
}

module.exports = {
  evaluate,
  penaltyAccruing,
  outstandingNearFinality,
  fundingStalled,
  borrowerConcentration,
  unclaimedYield,
  daysBetween,
  usdc,
};
