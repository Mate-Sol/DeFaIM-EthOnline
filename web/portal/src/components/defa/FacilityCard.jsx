import { ChevronRight } from 'lucide-react';
import { isSettledFromPool } from '../../utils/poolStatus';

/**
 * Reusable DeFa-themed facility card. Shared between on-chain admin and
 * lender pages. Optionally renders a "your position" badge if a position
 * object is passed in.
 */

const fmt = (base) => {
  if (base === undefined || base === null) return '$0';
  const big = BigInt(base);
  const usd = Number(big) / 1_000_000;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(usd);
};

// "Settled" = active pool whose entire lifecycle has been paid down to
// zero: no open drawdowns, zero accrued commit fee, and at least one
// drawdown ever happened (so a brand-new active pool with no draws yet
// reads as "Active", not "Settled"). PSP can call close_facility from
// this state.
const isSettled = (pool) => isSettledFromPool(pool);

const StatusBadge = ({ pool }) => {
  if (pool.isDefaulted)  return <span className="defa-status-pill" style={{ background: 'rgba(239,68,68,0.25)', borderColor: 'rgba(239,68,68,0.5)' }}>Defaulted</span>;
  if (pool.isCancelled)  return <span className="defa-status-pill">Cancelled</span>;
  if (isSettled(pool))   return <span className="defa-status-pill" style={{ background: 'rgba(99,102,241,0.30)', borderColor: 'rgba(165,180,252,0.6)' }}>Settled</span>;
  if (pool.isActive)     return <span className="defa-status-pill" style={{ background: 'rgba(34,197,94,0.25)', borderColor: 'rgba(34,197,94,0.5)' }}>Active</span>;
  return                        <span className="defa-status-pill" style={{ background: 'rgba(251,191,36,0.25)', borderColor: 'rgba(251,191,36,0.5)' }}>Funding</span>;
};

const FacilityCard = ({ pool, position, onOpen }) => {
  const totalCapital = BigInt(pool.totalCapital);
  const hardCap = BigInt(pool.hardCap);
  const softCap = BigInt(pool.softCap);
  const outstanding = BigInt(pool.outstandingPrincipal);
  const pctRaised = hardCap > 0n ? Number((totalCapital * 10000n) / hardCap) / 100 : 0;
  const utilization = totalCapital > 0n ? Number((outstanding * 10000n) / totalCapital) / 100 : 0;
  const softCapMet = totalCapital >= softCap;
  // Yield buckets used in the two yield cards.
  //
  // PAID  — borrower has actually paid this into the vault, lifetime.
  //         Combines two sources:
  //           - accrued_util_fee + accrued_penalty_fee (cumulative
  //             on-chain counters that only grow on repayment)
  //           - settled commit fees (event-only — the pool resets
  //             accrued_commit_fee to 0 on each settle, so the
  //             lifetime total has to come from CommitFeeSettled
  //             events, surfaced via /pool/:pool/fee-aggregates as
  //             earnedYieldGross / settledCommitLifetime).
  //         When earnedYieldGross is provided we use it directly; if
  //         the parent didn't enrich (e.g. lender browse list) we fall
  //         back to util + penalty only.
  // PENDING — accruing but not yet paid. accrued_commit_fee is the
  //         currently-pending unutilized fee, plus utilFeePending /
  //         penaltyFeePending which the /psp/facilities endpoint
  //         computes per pool against active drawdowns.
  const utilRealized    = BigInt(pool.accruedUtilFee     || '0');
  const penaltyRealized = BigInt(pool.accruedPenaltyFee  || '0');
  const commitAccrued   = BigInt(pool.accruedCommitFee   || '0');
  const utilPending     = BigInt(pool.utilFeePending     || '0');
  const penaltyPending  = BigInt(pool.penaltyFeePending  || '0');
  const settledCommit   = BigInt(pool.settledCommitLifetime || '0');
  const totalYieldPaid = pool.earnedYieldGross !== undefined
    ? BigInt(pool.earnedYieldGross || '0')
    : utilRealized + penaltyRealized;
  const totalYieldPending = commitAccrued + utilPending + penaltyPending;

  return (
    <div
      className={`defa-card defa-card-hover p-6 cursor-pointer ${position ? 'ring-1 ring-indigo-300/50' : ''}`}
      onClick={onOpen}
      style={position ? { borderColor: 'rgba(165,180,252,0.5)' } : undefined}
    >
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="text-xs uppercase tracking-widest text-white/60 mb-1 flex items-center gap-2">
            Facility #{pool.facilityId}
            {position && (
              <span className="text-[10px] font-bold uppercase tracking-wide bg-indigo-500/30 text-white px-1.5 py-0.5 rounded">
                Your Stake
              </span>
            )}
          </div>
          <h3 className="text-xl font-bold">{pool.pspName || 'Unnamed PSP'}</h3>
          <code className="text-xs text-white/50 font-mono break-all">{pool.pubkey.slice(0, 16)}…</code>
        </div>
        <StatusBadge pool={pool} />
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <Stat
          label="Facility Limit"
          value={fmt(pool.hardCap)}
          sub={`${fmt(pool.totalCapital)} raised`}
        />
        {position ? (
          <Stat label="Your Position" value={fmt(position.deposited)} sub={`${position.sharePctNum.toFixed(2)}% share`} />
        ) : (
          <Stat label="Outstanding" value={fmt(pool.outstandingPrincipal)} sub={pool.isActive ? `${utilization.toFixed(1)}% utilized` : '—'} />
        )}

        {position ? (
          <>
            {/* LENDER VIEW — yield from the lender's POV. Claimed = what
                they actually pulled out via redemption (lifetime).
                Pending = their pro-rata share of every fee bucket that
                will eventually flow into the vault: vault remainder
                share + commit-fee share + in-flight util/penalty share. */}
            <Stat
              label="Total Yield Claimed"
              value={fmt(BigInt(position.realizedYield || '0'))}
              sub={
                BigInt(position.realizedYield || '0') > 0n
                  ? 'redeemed via LP burn'
                  : position.positionStatus === 'closed_loss'
                    ? `loss: ${fmt(position.realizedLoss || '0')}`
                    : 'redeem to claim accrued yield'
              }
            />
            <Stat
              label="Total Yield Pending"
              value={fmt(BigInt(position.pendingYieldLender || position.outstandingYield || '0'))}
              sub={(() => {
                const cp = BigInt(position.lenderCommitPending  || '0');
                const up = BigInt(position.lenderUtilPending    || '0');
                const pp = BigInt(position.lenderPenaltyPending || '0');
                const parts = [
                  up > 0n ? `util ${fmt(up)}`        : null,
                  pp > 0n ? `penalty ${fmt(pp)}`     : null,
                  cp > 0n ? `unutilized ${fmt(cp)}`  : null,
                ].filter(Boolean);
                return parts.length ? `your share — ${parts.join(' · ')}` : 'no yield accruing right now';
              })()}
            />
          </>
        ) : (
          <>
            {/* PSP / ADMIN VIEW — facility-wide totals. */}
            <Stat
              label="Total Yield Paid"
              value={fmt(totalYieldPaid)}
              sub={
                totalYieldPaid > 0n
                  ? [
                      utilRealized    > 0n ? `util ${fmt(utilRealized)}`     : null,
                      penaltyRealized > 0n ? `penalty ${fmt(penaltyRealized)}` : null,
                      settledCommit   > 0n ? `unutilized ${fmt(settledCommit)}` : null,
                    ].filter(Boolean).join(' · ') || 'lifetime borrower payments'
                  : 'borrower repayments will accrue here'
              }
            />
            <Stat
              label="Total Yield Pending"
              value={fmt(totalYieldPending)}
              sub={
                totalYieldPending > 0n
                  ? `util ${fmt(utilPending)}${penaltyPending > 0n ? ` · penalty ${fmt(penaltyPending)}` : ''}${commitAccrued > 0n ? ` · unutilized ${fmt(commitAccrued)}` : ''}`
                  : 'nothing accruing right now'
              }
            />
          </>
        )}
      </div>

      {/* Cap progress */}
      <div className="mb-4">
        <div className="h-1.5 rounded-full overflow-hidden bg-white/10 relative">
          <div
            className="h-full transition-all"
            style={{
              width: `${Math.min(100, pctRaised)}%`,
              background: softCapMet
                ? 'linear-gradient(90deg, rgba(34,197,94,1), rgba(110,231,183,1))'
                : 'linear-gradient(90deg, rgba(255,255,255,0.85), rgba(255,255,255,0.5))',
            }}
          />
          {hardCap > 0n && (
            <div
              className="absolute top-0 bottom-0 w-px bg-yellow-300"
              style={{ left: `${Number((softCap * 10000n) / hardCap) / 100}%` }}
              title={`Soft cap: ${fmt(softCap)}`}
            />
          )}
        </div>
        <div className="text-[10px] text-white/60 mt-1.5 flex justify-between">
          <span>{pctRaised.toFixed(1)}% of hard cap</span>
          <span>{softCapMet ? '✓ soft cap met' : 'soft cap pending'}</span>
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-white/60">
        <span>{pool.facilityTenorDays || 0}d tenor · {pool.countActiveDrawdowns || 0} active loan(s)</span>
        <ChevronRight className="w-4 h-4" />
      </div>
    </div>
  );
};

const Stat = ({ label, value, sub }) => (
  <div>
    <div className="defa-label">{label}</div>
    <div className="text-base font-semibold tabular-nums">{value}</div>
    {sub && <div className="text-[10px] text-white/50">{sub}</div>}
  </div>
);

export default FacilityCard;
