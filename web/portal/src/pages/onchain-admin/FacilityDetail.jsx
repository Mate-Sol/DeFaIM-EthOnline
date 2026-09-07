import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAccount, useSendTransaction } from 'wagmi';
import {
  ArrowLeft, RefreshCw, Loader2, ExternalLink, Zap,
  ShieldOff, Pause, AlertTriangle, CheckCircle2, Clock, ArrowDownLeft, ArrowUpRight, AlertCircle,
  TrendingUp, BarChart3, Coins,
} from 'lucide-react';
import toast from 'react-hot-toast';
import OnChainAdminLayout from './Layout';
import { api, buildAndSend } from '../../services/evm';
import { fmtDayIndex, fmtCountdown, isWarpMode } from '../../utils/dateFmt';
import { isSettledFromPool } from '../../utils/poolStatus';
import ValidationPipeline from '../../components/defa/ValidationPipeline';

const fmtUsdc = (base) => {
  if (base === undefined || base === null) return '$0';
  const n = Number(BigInt(base) / 1_000_000n);
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
};
const fmtBps = (bps) => `${(Number(bps) / 100).toFixed(2)}%/d`;
const fmtBpsRaw = (bps) => `${Number(bps)}bps/d`;
const todayDayIndex = (secondsPerDay = 86400) =>
  Math.floor(Date.now() / 1000 / (Number(secondsPerDay) || 86400));
const explorer = (kind, val) => `https://testnet.arcscan.app/${kind === 'tx' ? 'tx' : 'address'}/${val}`;

const FacilityDetail = () => {
  const { pool: poolPubkey } = useParams();
  const navigate = useNavigate();
  const { address, isConnected } = useAccount();
  const { sendTransactionAsync } = useSendTransaction();
  const [state, setState] = useState(null);
  const [drawdowns, setDrawdowns] = useState([]);
  const [activity, setActivity] = useState([]);
  const [pending, setPending] = useState(null);
  const [aggregates, setAggregates] = useState(null);
  const [loading, setLoading] = useState(true);
  const [signing, setSigning] = useState(null);
  const [drawdownPage, setDrawdownPage] = useState(1);
  const [activityPage, setActivityPage] = useState(1);
  const [expandedDd, setExpandedDd] = useState(null);
  const PAGE_SIZE = 10;

  const refresh = async () => {
    try {
      setLoading(true);
      const [s, d, a, da, ag] = await Promise.all([
        api().get(`/pool/pool/${poolPubkey}/state`),
        api().get(`/pool/pool/${poolPubkey}/drawdowns`, { params: { includeRepaid: true } }),
        api().get(`/pool/pool/${poolPubkey}/activity`, { params: { limit: 200 } }).catch(() => ({ data: [] })),
        api().get(`/pool/pool/${poolPubkey}/daily-activity`).catch(() => ({ data: null })),
        api().get(`/pool/pool/${poolPubkey}/fee-aggregates`).catch(() => ({ data: null })),
      ]);
      setState(s.data); setDrawdowns(d.data); setActivity(a.data);
      setPending(da.data); setAggregates(ag.data);
    } catch (e) {
      toast.error(e.response?.data?.message || e.message);
    } finally { setLoading(false); }
  };
  useEffect(() => { refresh(); }, [poolPubkey]);

  useEffect(() => {
    const max = Math.max(1, Math.ceil(drawdowns.length / PAGE_SIZE));
    if (drawdownPage > max) setDrawdownPage(max);
  }, [drawdowns.length]);
  useEffect(() => {
    const max = Math.max(1, Math.ceil(activity.length / PAGE_SIZE));
    if (activityPage > max) setActivityPage(max);
  }, [activity.length]);

  const stats = useMemo(() => {
    if (!state) return null;
    const today = todayDayIndex(state.secondsPerDay);
    const tenorEnd = state.activatedDay ? state.activatedDay + state.facilityTenorDays : null;
    const tenorExpired = tenorEnd ? today >= tenorEnd : false;
    const defaultEligible = tenorEnd ? today >= tenorEnd + 30 : false;
    const totalCapital = BigInt(state.totalCapital);
    const softCap = BigInt(state.softCap);
    const softCapMet = totalCapital >= softCap;

    const isSettled = isSettledFromPool(state, pending);

    return { today, tenorEnd, tenorExpired, defaultEligible, softCapMet, isSettled };
  }, [state, pending]);

  // Wallet-pubkey gate. Admin actions sign txs as `state.admin`. If the
  // browser wallet is something else (e.g. a lender wallet that wandered
  // in here), the chain would reject the tx anyway — but we hide the buttons
  // to make the security boundary explicit.
  const walletMatchesAdmin = useMemo(() => {
    if (!state || !address) return false;
    return address.toLowerCase() === String(state.admin || '').toLowerCase();
  }, [state, address]);

  // Lifetime yield aggregates. Earned + Redeemed are sourced from the
  // server-side /fee-aggregates endpoint, which paginates the entire
  // signature history and combines authoritative on-chain counters
  // (accrued_util_fee, accrued_penalty_fee — cumulative on-chain) with
  // event-only totals (CommitFeeSettled, ProtocolFeesClaimed, LpRedeemed)
  // that the program does NOT itself accumulate. Pending is composed
  // from current on-chain state + the live /daily-activity estimate.
  const yieldBuckets = useMemo(() => {
    if (!state) return null;
    const protocolBps = BigInt(state.protocolFeeShareBps || 0);
    const lenderBps   = 10000n - protocolBps;
    const split = (gross) => ({
      total:    gross,
      lenders:  (gross * lenderBps) / 10000n,
      protocol: (gross * protocolBps) / 10000n,
    });

    const pendingGross = BigInt(pending?.utilFeePending || '0')
      + BigInt(state.accruedCommitFee)
      + BigInt(pending?.penaltyFeePending || '0');

    // Wait for /fee-aggregates before showing Earned/Redeemed — these
    // require lifetime event data and we don't want to flash an estimate.
    if (!aggregates) {
      return {
        pending: split(pendingGross),
        earned:  null,
        redeemed: null,
      };
    }

    const earnedGross = BigInt(aggregates.earnedYieldGross);
    const lenderRedeemedYield = BigInt(aggregates.lenderRedeemedYieldLifetime);
    const protocolClaimed     = BigInt(aggregates.protocolClaimedLifetime);

    return {
      pending: split(pendingGross),
      earned:  split(earnedGross),
      redeemed: {
        total:    lenderRedeemedYield + protocolClaimed,
        lenders:  lenderRedeemedYield,
        protocol: protocolClaimed,
      },
      _capped: aggregates.sigsCapped,
    };
  }, [state, pending, aggregates]);

  // Run a build-tx flow + relay submit for an admin-signed instruction.
  const runAction = async (kind, endpoint) => {
    if (!isConnected) { toast.error('Connect wallet first'); return; }
    setSigning(kind);
    try {
      const res = await buildAndSend(address, sendTransactionAsync, endpoint, { pool: poolPubkey });
      toast.success(`${kind} confirmed: ${res.hash.slice(0, 10)}…`);
      refresh();
    } catch (e) {
      toast.error(e.response?.data?.message || e.message);
    } finally { setSigning(null); }
  };

  if (loading && !state) {
    return <OnChainAdminLayout><div className="flex justify-center pt-32"><Loader2 className="w-8 h-8 animate-spin text-white/70" /></div></OnChainAdminLayout>;
  }
  if (!state) {
    return <OnChainAdminLayout><div className="defa-card p-12 text-center text-white/70 max-w-3xl mx-auto mt-16">Pool not found.</div></OnChainAdminLayout>;
  }

  return (
    <OnChainAdminLayout>
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between mb-6 mt-4 gap-4">
          <div>
            <button onClick={() => navigate('/onchain-admin/facilities')} className="text-white/70 hover:text-white text-sm inline-flex items-center gap-1 mb-2">
              <ArrowLeft className="w-4 h-4" /> Back to facilities
            </button>
            <h1 className="text-3xl font-bold tracking-tight">Facility #{state.facilityId} · {state.pspName}</h1>
            <a href={explorer('address', poolPubkey)} target="_blank" rel="noopener noreferrer"
               className="text-xs font-mono text-white/60 hover:text-white inline-flex items-center gap-1 mt-1 break-all">
              {poolPubkey} <ExternalLink className="w-3 h-3" />
            </a>
          </div>
          <button onClick={refresh} className="defa-btn-ghost flex-shrink-0">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>

        {/* Status banners */}
        {state.isDefaulted && (
          <div className="defa-card p-4 mb-5 flex items-center gap-3" style={{ background: 'rgba(239,68,68,0.15)', borderColor: 'rgba(239,68,68,0.4)' }}>
            <ShieldOff className="w-5 h-5 text-red-200" />
            <div><div className="font-semibold">Defaulted</div><div className="text-xs text-white/70">Lenders may redeem against the vault remainder.</div></div>
          </div>
        )}
        {state.isCancelled && (
          <div className="defa-card p-4 mb-5 flex items-center gap-3">
            <Pause className="w-5 h-5 text-white/80" />
            <div><div className="font-semibold">Cancelled</div><div className="text-xs text-white/70">Lenders can withdraw their deposits.</div></div>
          </div>
        )}
        {stats.isSettled && (
          <div className="defa-card p-4 mb-5 flex items-center gap-3" style={{ background: 'rgba(34,197,94,0.15)', borderColor: 'rgba(34,197,94,0.4)' }}>
            <CheckCircle2 className="w-5 h-5 text-emerald-200" />
            <div><div className="font-semibold">Settled</div><div className="text-xs text-white/70">All drawdowns repaid, no fees pending. Lenders can redeem the full vault.</div></div>
          </div>
        )}

        {/* Live facility clock — visible only while the facility is actively
            running (drawdowns may still occur or fees may still accrue).
            Once settled / cancelled / defaulted, the clock is irrelevant. */}
        {state.isActive && state.activatedDay > 0 && !stats.isSettled && !state.isCancelled && !state.isDefaulted && (
          <FacilityClock
            activatedDay={state.activatedDay}
            facilityTenorDays={state.facilityTenorDays}
            secondsPerDay={state.secondsPerDay || 86400}
          />
        )}

        {/* Stats grid — Capacity / Outstanding / 3 yield buckets, each
            with a Lender / Protocol split derived from protocolFeeShareBps. */}
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
          <Stat
            label="Capacity"
            value={fmtUsdc(state.totalCapital)}
            sub={`of ${fmtUsdc(state.hardCap)} cap`}
            icon={<Coins className="w-4 h-4 text-indigo-200" />}
          />
          <Stat
            label="Outstanding"
            value={fmtUsdc(state.outstandingPrincipal)}
            sub={`${state.countActiveDrawdowns} active loan${state.countActiveDrawdowns === 1 ? '' : 's'}`}
            icon={<TrendingUp className="w-4 h-4 text-amber-200" />}
          />
          {yieldBuckets && (
            <>
              <SplitStat
                label="Pending Yield"
                total={yieldBuckets.pending.total}
                lenders={yieldBuckets.pending.lenders}
                protocol={yieldBuckets.pending.protocol}
                icon={<Clock className="w-4 h-4 text-blue-200" />}
              />
              {yieldBuckets.earned ? (
                <SplitStat
                  label="Earned Yield"
                  total={yieldBuckets.earned.total}
                  lenders={yieldBuckets.earned.lenders}
                  protocol={yieldBuckets.earned.protocol}
                  icon={<Coins className="w-4 h-4 text-emerald-200" />}
                />
              ) : (
                <SplitStatSkeleton label="Earned Yield" icon={<Coins className="w-4 h-4 text-emerald-200" />} />
              )}
              {yieldBuckets.redeemed ? (
                <SplitStat
                  label="Redeemed Yield"
                  total={yieldBuckets.redeemed.total}
                  lenders={yieldBuckets.redeemed.lenders}
                  protocol={yieldBuckets.redeemed.protocol}
                  icon={<ArrowUpRight className="w-4 h-4 text-fuchsia-200" />}
                />
              ) : (
                <SplitStatSkeleton label="Redeemed Yield" icon={<ArrowUpRight className="w-4 h-4 text-fuchsia-200" />} />
              )}
            </>
          )}
        </div>
        {yieldBuckets?._capped && (
          <div className="text-[11px] text-amber-200/80 -mt-4 mb-6">
            Note: signature scan was capped at 2000 — extremely long-lived pools may slightly under-count. Increase the server cap if needed.
          </div>
        )}

        {/* Daily activity entry */}
        <button
          onClick={() => navigate(`/onchain-admin/facilities/${poolPubkey}/daily-activity`)}
          className="defa-card defa-card-hover w-full p-4 mb-6 flex items-center gap-3 text-left"
        >
          <div className="p-2 rounded-lg bg-white/15 text-white">
            <BarChart3 className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <div className="font-semibold">Daily Activity & P&L Breakdown</div>
            <div className="text-xs text-white/60">Day-by-day capital, fees, events and yield realized</div>
          </div>
          <ArrowUpRight className="w-5 h-5 text-white/60" />
        </button>

        {/* Action bar — state-aware. Hidden entirely if connected wallet
            doesn't match the on-chain admin pubkey for this pool. */}
        <div className="defa-card p-5 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Zap className="w-4 h-4 text-white/80" />
            <h3 className="font-semibold">Admin Actions</h3>
          </div>
          {!isConnected ? (
            <div className="text-sm text-white/60">Connect the on-chain admin wallet to take actions.</div>
          ) : !walletMatchesAdmin ? (
            <div className="text-sm flex items-start gap-2 text-amber-200">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                Connected wallet does not match this pool's admin signer.
                Switch to <span className="font-mono">{state.admin.slice(0, 6)}…{state.admin.slice(-4)}</span> to manage this facility.
              </div>
            </div>
          ) : (
          <div className="flex flex-wrap gap-2">
            {/* Funding state */}
            {!state.isActive && !state.isCancelled && !state.isDefaulted && (
              <>
                <ActionBtn
                  label={stats.softCapMet ? 'Execute Facility' : `Execute (need ${fmtUsdc(BigInt(state.softCap) - BigInt(state.totalCapital))} more)`}
                  enabled={stats.softCapMet}
                  busy={signing === 'execute'}
                  onClick={() => runAction('execute', '/pool/admin/build-tx/execute-facility')}
                />
                <ActionBtn
                  label="Cancel Funding"
                  ghost
                  busy={signing === 'cancel'}
                  onClick={() => {
                    if (!confirm('Cancel this funding round? Lenders will need to withdraw individually. This cannot be undone.')) return;
                    runAction('cancel', '/pool/admin/build-tx/cancel-funding');
                  }}
                />
              </>
            )}

            {/* Active state */}
            {state.isActive && !state.isDefaulted && (
              <>
                <ActionBtn
                  label={`Claim Protocol Fees (${fmtUsdc(state.protocolFeesOwed)})`}
                  enabled={BigInt(state.protocolFeesOwed) > 0n}
                  busy={signing === 'claim'}
                  onClick={() => runAction('claim', '/pool/admin/build-tx/claim-protocol-fees')}
                />
                <ActionBtn
                  label={stats.defaultEligible ? 'Declare Default' : `Default (eligible ${fmtDayIndex(stats.tenorEnd + 30)})`}
                  ghost
                  enabled={stats.defaultEligible}
                  busy={signing === 'default'}
                  onClick={() => {
                    if (!confirm('Declare this facility defaulted? Lenders will eat a haircut on redemption.')) return;
                    runAction('default', '/pool/admin/build-tx/declare-default');
                  }}
                />
              </>
            )}

            {/* Defaulted / Cancelled — claim fees only */}
            {(state.isDefaulted || state.isCancelled) && BigInt(state.protocolFeesOwed) > 0n && (
              <ActionBtn
                label={`Claim Protocol Fees (${fmtUsdc(state.protocolFeesOwed)})`}
                busy={signing === 'claim'}
                onClick={() => runAction('claim', '/pool/admin/build-tx/claim-protocol-fees')}
              />
            )}

            {state.isActive && !state.isDefaulted && !stats.defaultEligible && BigInt(state.protocolFeesOwed) === 0n && (
              <span className="text-sm text-white/60">No actions available right now.</span>
            )}
          </div>
          )}
        </div>

        {/* Drawdowns */}
        <div className="defa-card p-5 mb-6">
          <h3 className="font-semibold mb-3">Drawdowns ({drawdowns.length})</h3>
          {drawdowns.length === 0 ? (
            <div className="text-sm text-white/60 text-center py-4">No drawdowns yet.</div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-white/60 text-xs uppercase">
                    <tr>
                      <th className="text-left py-2">ID</th>
                      <th className="text-right py-2">Principal</th>
                      <th className="text-center py-2">Drawn Day</th>
                      <th className="text-center py-2">Tenor</th>
                      <th className="text-center py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drawdowns.slice((drawdownPage - 1) * PAGE_SIZE, drawdownPage * PAGE_SIZE).map((d) => {
                      const cliff = d.drawdownDay + d.tenorDays + state.graceDays + state.penaltyDays;
                      const today = todayDayIndex(state.secondsPerDay);
                      const overdue = !d.repaid && today >= cliff;
                      const isExpanded = expandedDd === d.id;
                      return (
                        <>
                          <tr
                            key={d.pubkey}
                            className="border-t border-white/10 cursor-pointer hover:bg-white/5"
                            onClick={() => setExpandedDd(isExpanded ? null : d.id)}
                          >
                            <td className="py-3">#{d.id}</td>
                            <td className="py-3 text-right font-semibold tabular-nums">{fmtUsdc(d.principal)}</td>
                            <td className="py-3 text-center text-white/70">{fmtDayIndex(d.drawdownDay)}</td>
                            <td className="py-3 text-center text-white/70">{d.tenorDays}d</td>
                            <td className="py-3 text-center">
                              {d.repaid ? (
                                <span className="defa-status-pill" style={{ background: 'rgba(34,197,94,0.25)', borderColor: 'rgba(34,197,94,0.5)' }}>Repaid</span>
                              ) : overdue ? (
                                <span className="defa-status-pill" style={{ background: 'rgba(239,68,68,0.25)', borderColor: 'rgba(239,68,68,0.5)' }}>Overdue</span>
                              ) : (
                                <span className="defa-status-pill">Open</span>
                              )}
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr key={`${d.pubkey}-pipeline`} className="bg-white/5">
                              <td colSpan={5} className="px-3 py-3">
                                <ValidationPipeline pool={poolPubkey} drawdownId={d.id} />
                              </td>
                            </tr>
                          )}
                        </>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Pager total={drawdowns.length} page={drawdownPage} pageSize={PAGE_SIZE} onChange={setDrawdownPage} />
            </>
          )}
        </div>

        {/* Terms */}
        <div className="defa-card p-5 mb-6">
          <h3 className="font-semibold mb-4">Terms</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Term label="Facility Range" value={`${fmtUsdc(state.softCap)} - ${fmtUsdc(state.hardCap)}`} />
            <Term label="Max drawdown" value={fmtUsdc(state.maxDrawdownAmount)} />
            <Term label="Tenor" value={`${state.facilityTenorDays} days`} />
            <Term label="Activated" value={state.activatedDay ? fmtDayIndex(state.activatedDay) : '—'} />
            <Term label="Utilization" value={fmtBpsRaw(state.utilizationRateBps)} />
            <Term label="Commitment" value={fmtBpsRaw(state.commitmentRateBps)} />
            <Term label="Penalty" value={fmtBpsRaw(state.penaltyRateBps)} />
            <Term label="Grace / Penalty days" value={`${state.graceDays} / ${state.penaltyDays}`} />
          </div>
        </div>

        {/* Activity feed */}
        <div className="defa-card p-5">
          <h3 className="font-semibold mb-3">On-chain Activity ({activity.length})</h3>
          {activity.length === 0 ? (
            <div className="text-sm text-white/60 text-center py-4">No events recorded.</div>
          ) : (
            <>
              <div className="space-y-2">
                {activity.slice((activityPage - 1) * PAGE_SIZE, activityPage * PAGE_SIZE).map((ev, i) => (
                  <ActivityRow key={`${ev.signature}-${i}`} event={ev} />
                ))}
              </div>
              <Pager total={activity.length} page={activityPage} pageSize={PAGE_SIZE} onChange={setActivityPage} />
            </>
          )}
        </div>
      </div>
    </OnChainAdminLayout>
  );
};

// Live-ticking countdown to the next on-chain day boundary + summary of
// where we are in the facility tenor. For warp pools (secondsPerDay < 86400)
// this is the most useful signal during testing — you can literally watch
// "Day N" tick over.
const FacilityClock = ({ activatedDay, facilityTenorDays, secondsPerDay }) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const spd = Number(secondsPerDay) || 86400;
  const tenor = Number(facilityTenorDays) || 0;
  const nowSec = Math.floor(now / 1000);
  const today = Math.floor(nowSec / spd);
  const dayOfFacility = Math.max(1, today - activatedDay + 1);
  const tenorEnd = activatedDay + tenor;
  const daysRemaining = Math.max(0, tenorEnd - today);
  const secondsIntoDay = nowSec % spd;
  const secondsToNextDay = spd - secondsIntoDay;
  const dayProgressPct = (secondsIntoDay / spd) * 100;
  const past = today >= tenorEnd;
  const warp = isWarpMode(spd);

  return (
    <div
      className="defa-card p-5 mb-5"
      style={{ background: warp ? 'rgba(251,191,36,0.12)' : 'rgba(99,102,241,0.15)', borderColor: 'rgba(255,255,255,0.25)' }}
    >
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 items-center">
        {/* Day-of */}
        <div>
          <div className="defa-label flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" />
            {warp ? 'Warp Day' : 'Facility Day'}
          </div>
          <div className="text-4xl font-bold tabular-nums mt-1">
            {past ? <span className="text-red-200">Past tenor</span> : <>Day {dayOfFacility}</>}
          </div>
          <div className="text-xs text-white/65 mt-1">
            of {tenor} day{tenor === 1 ? '' : 's'} · {past ? 0 : daysRemaining} day{daysRemaining === 1 ? '' : 's'} remaining
          </div>
        </div>

        {/* Countdown */}
        <div>
          <div className="defa-label">Next day starts in</div>
          <div className="text-4xl font-bold tabular-nums mt-1 text-white tracking-tight">
            {fmtCountdown(secondsToNextDay)}
          </div>
          <div className="text-xs text-white/65 mt-1">
            commit-fee snapshot rolls over at the boundary
          </div>
        </div>

        {/* Progress + warp badge */}
        <div>
          <div className="defa-label flex items-center gap-2">
            Day Progress
            {warp && (
              <span className="defa-status-pill" style={{ background: 'rgba(251,191,36,0.22)', borderColor: 'rgba(251,191,36,0.55)' }}>
                Warp · 1 day = {spd}s
              </span>
            )}
          </div>
          <div className="mt-3 h-3 rounded-full bg-white/15 overflow-hidden">
            <div
              className="h-full transition-all"
              style={{
                width: `${dayProgressPct}%`,
                background: 'linear-gradient(90deg, rgba(255,255,255,0.85), rgba(255,255,255,0.55))',
              }}
            />
          </div>
          <div className="text-xs text-white/65 mt-2 tabular-nums">
            {dayProgressPct.toFixed(1)}% through day · today day-index {today}
          </div>
        </div>
      </div>
    </div>
  );
};

const SplitStatSkeleton = ({ label, icon }) => (
  <div className="defa-card p-4">
    <div className="flex items-center justify-between">
      <div className="defa-label">{label}</div>
      {icon}
    </div>
    <div className="text-2xl font-bold tabular-nums mt-1 text-white/40">…</div>
    <div className="text-[10px] text-white/40 mt-2">scanning chain history…</div>
  </div>
);

const SplitStat = ({ label, total, lenders, protocol, icon }) => (
  <div className="defa-card p-4">
    <div className="flex items-center justify-between">
      <div className="defa-label">{label}</div>
      {icon}
    </div>
    <div className="text-2xl font-bold tabular-nums mt-1">{fmtUsdc(total)}</div>
    <div className="mt-2 grid grid-cols-2 gap-1">
      <div>
        <div className="text-[10px] uppercase tracking-wide text-white/50">Lenders</div>
        <div className="text-xs font-semibold tabular-nums text-emerald-200">{fmtUsdc(lenders)}</div>
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wide text-white/50">Protocol</div>
        <div className="text-xs font-semibold tabular-nums text-fuchsia-200">{fmtUsdc(protocol)}</div>
      </div>
    </div>
  </div>
);

const Pager = ({ total, page, pageSize, onChange }) => {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (pageCount <= 1) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <div className="flex items-center justify-between mt-4 pt-3 border-t border-white/10 text-xs">
      <div className="text-white/60">{from}–{to} of {total}</div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onChange(Math.max(1, page - 1))}
          disabled={page <= 1}
          className="px-2.5 py-1 rounded-md border border-white/15 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-white/10"
        >
          Prev
        </button>
        <span className="text-white/70 tabular-nums">Page {page} / {pageCount}</span>
        <button
          onClick={() => onChange(Math.min(pageCount, page + 1))}
          disabled={page >= pageCount}
          className="px-2.5 py-1 rounded-md border border-white/15 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-white/10"
        >
          Next
        </button>
      </div>
    </div>
  );
};

const ActionBtn = ({ label, onClick, enabled = true, busy, ghost }) => (
  <button
    onClick={onClick}
    disabled={!enabled || busy}
    className={ghost ? 'defa-btn-ghost' : 'defa-btn-primary'}
  >
    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
    {label}
  </button>
);

const Stat = ({ label, value, sub, icon }) => (
  <div className="defa-card p-4">
    <div className="flex items-center justify-between">
      <div className="defa-label">{label}</div>
      {icon}
    </div>
    <div className="text-2xl font-bold tabular-nums mt-1">{value}</div>
    {sub && <div className="text-[11px] text-white/60 mt-1">{sub}</div>}
  </div>
);

const Term = ({ label, value }) => (
  <div>
    <div className="defa-label mb-1">{label}</div>
    <div className="text-sm font-semibold">{value}</div>
  </div>
);

const EVENT_LABELS = {
  PoolInitialized: { label: 'Pool Initialized', icon: <Zap className="w-3.5 h-3.5" /> },
  Deposited: { label: 'Lender Deposit', icon: <ArrowDownLeft className="w-3.5 h-3.5" /> },
  WithdrawnFunding: { label: 'Lender Withdraw', icon: <ArrowUpRight className="w-3.5 h-3.5" /> },
  FacilityExecuted: { label: 'Facility Activated', icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
  FundingCancelledEvent: { label: 'Funding Cancelled', icon: <Pause className="w-3.5 h-3.5" /> },
  DrawdownExecuted: { label: 'PSP Drawdown', icon: <ArrowUpRight className="w-3.5 h-3.5" /> },
  RepaymentProcessed: { label: 'PSP Repayment', icon: <ArrowDownLeft className="w-3.5 h-3.5" /> },
  CommitFeeSettled: { label: 'Commit Fee Settled', icon: <ArrowDownLeft className="w-3.5 h-3.5" /> },
  LpRedeemed: { label: 'LP Redeemed', icon: <ArrowUpRight className="w-3.5 h-3.5" /> },
  ProtocolFeesClaimed: { label: 'Protocol Fees Claimed', icon: <Zap className="w-3.5 h-3.5" /> },
  DefaultDeclared: { label: 'Default Declared', icon: <AlertCircle className="w-3.5 h-3.5" /> },
};
const fmtTime = (unix) => {
  if (!unix) return '—';
  const ageMs = Date.now() - unix * 1000;
  if (ageMs < 60_000) return 'just now';
  if (ageMs < 3_600_000) return `${Math.floor(ageMs / 60_000)}m ago`;
  if (ageMs < 86_400_000) return `${Math.floor(ageMs / 3_600_000)}h ago`;
  return `${Math.floor(ageMs / 86_400_000)}d ago`;
};
const ActivityRow = ({ event }) => {
  const meta = EVENT_LABELS[event.name] || { label: event.name, icon: null };
  const d = event.data || {};
  const usd = (v) => v ? fmtUsdc(v) : '—';
  let detail = '';
  switch (event.name) {
    case 'Deposited':           detail = `${usd(d.amount)} from ${(d.lender || '').slice(0, 6)}…`; break;
    case 'WithdrawnFunding':    detail = `${usd(d.amount)} to ${(d.lender || '').slice(0, 6)}…`; break;
    case 'FacilityExecuted':    detail = `Activated with ${usd(d.totalCapital)} on ${fmtDayIndex(d.activatedDay)}`; break;
    case 'DrawdownExecuted':    detail = `${usd(d.amount)} for ${d.tenorDays}d (#${d.id})`; break;
    case 'RepaymentProcessed':  detail = `Principal ${usd(d.principal)} · util ${usd(d.utilFee)} · penalty ${usd(d.penaltyFee)}`; break;
    case 'CommitFeeSettled':    detail = `Settled ${usd(d.amount)}`; break;
    case 'LpRedeemed':          detail = `${usd(d.usdcPaid)} for ${usd(d.lpBurned)} LP`; break;
    case 'ProtocolFeesClaimed': detail = `${usd(d.amount)} to admin`; break;
    case 'DefaultDeclared':     detail = `Outstanding ${usd(d.outstanding)}`; break;
    case 'FundingCancelledEvent': detail = `Capital at cancel: ${usd(d.totalCapitalAtCancel)}`; break;
    default: detail = '';
  }
  return (
    <a
      href={explorer('tx', event.signature)}
      target="_blank" rel="noopener noreferrer"
      className="flex items-center gap-3 p-3 rounded-lg hover:bg-white/10 transition-colors"
    >
      <div className="p-2 rounded-lg bg-white/15 text-white">{meta.icon}</div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">{meta.label}</div>
        {detail && <div className="text-xs text-white/60 truncate">{detail}</div>}
      </div>
      <div className="text-xs text-white/50 text-right shrink-0">
        <div>{fmtTime(event.blockTime)}</div>
        <div className="font-mono">{event.signature.slice(0, 6)}…</div>
      </div>
    </a>
  );
};

export default FacilityDetail;
