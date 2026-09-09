import { useEffect, useMemo, useState } from 'react';
import SettleCommitButton from '../../../components/defa/SettleCommitButton';
import { useNavigate, useParams } from 'react-router-dom';
import { useAccount, useSendTransaction } from 'wagmi';
import {
  ArrowLeft, RefreshCw, Loader2, ExternalLink, ChevronRight, BarChart3,
  ArrowUpRight, AlertTriangle, Clock, CheckCircle2, Zap, ShieldOff, Pause,
  TrendingUp, Coins, DollarSign, Calendar,
} from 'lucide-react';
import toast from 'react-hot-toast';
import PspBorrowLayout from './Layout';
import ValidationPipeline from '../../../components/defa/ValidationPipeline';
import { api, buildAndSend } from '../../../services/evm';
import { fmtDayIndex } from '../../../utils/dateFmt';
import { isSettledFromPool } from '../../../utils/poolStatus';

const fmt = (base) => {
  if (base === undefined || base === null) return '$0';
  const usd = Number(BigInt(base)) / 1_000_000;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(usd);
};
const fmtBps = (bps) => `${Number(bps)}bps/d`;
const EXPLORER_BASE = (import.meta.env.VITE_CHAIN_EXPLORER_URL || 'https://testnet.arcscan.app')
  .replace(/\/+$/, '');
const explorer = (kind, val) => `${EXPLORER_BASE}/${kind === 'address' ? 'address' : 'tx'}/${val}`;
const todayDayIndex = () => Math.floor(Date.now() / 1000 / 86400);

const FacilityDetail = () => {
  const { pool: poolPubkey } = useParams();
  const navigate = useNavigate();
  const { address, isConnected } = useAccount();
  const { sendTransactionAsync } = useSendTransaction();
  const [state, setState] = useState(null);
  const [drawdowns, setDrawdowns] = useState([]);
  const [pending, setPending] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [expandedDd, setExpandedDd] = useState(null);

  const refresh = async () => {
    try {
      setLoading(true);
      const [s, d, p] = await Promise.all([
        api().get(`/pool/pool/${poolPubkey}/state`),
        api().get(`/pool/pool/${poolPubkey}/drawdowns`, { params: { includeRepaid: true } }),
        api().get(`/pool/pool/${poolPubkey}/daily-activity`).catch(() => ({ data: null })),
      ]);
      setState(s.data);
      setDrawdowns(d.data);
      setPending(p.data);
    } catch (e) {
      toast.error(e.response?.data?.message || e.message);
    } finally { setLoading(false); }
  };
  useEffect(() => { refresh(); }, [poolPubkey]);

  // Borrower's total cost-to-clear-today: outstanding principal + util pending
  // + penalty pending. Commit fee is pool-level not per-loan, so shown separately.
  const totalOwed = useMemo(() => {
    if (!state || !pending) return null;
    return BigInt(state.outstandingPrincipal) +
           BigInt(pending.utilFeePending || '0') +
           BigInt(pending.penaltyFeePending || '0');
  }, [state, pending]);

  const stats = useMemo(() => {
    if (!state) return null;
    const today = todayDayIndex(state.secondsPerDay);
    const tenorEnd = state.activatedDay ? state.activatedDay + state.facilityTenorDays : null;
    const daysRemaining = tenorEnd ? Math.max(0, tenorEnd - today) : null;
    const tenorExpired = tenorEnd ? today >= tenorEnd : false;
    const active = drawdowns.filter((d) => !d.repaid);
    const repaid = drawdowns.filter((d) => d.repaid);
    return { today, tenorEnd, daysRemaining, tenorExpired, active, repaid };
  }, [state, drawdowns]);

  const runAction = async (key, endpoint, body) => {
    if (!isConnected) { toast.error('Connect wallet first'); return; }
    setBusy(key);
    try {
      const r = await buildAndSend(address, sendTransactionAsync, endpoint, body);
      toast.success(`Done: ${r.hash.slice(0, 10)}…`);
      refresh();
    } catch (e) {
      toast.error(e.response?.data?.message || e.message);
    } finally { setBusy(null); }
  };

  if (loading && !state) {
    return <PspBorrowLayout><div className="flex justify-center pt-32"><Loader2 className="w-8 h-8 animate-spin text-white/70" /></div></PspBorrowLayout>;
  }
  if (!state) {
    return <PspBorrowLayout><div className="defa-card p-12 text-center text-white/70 max-w-3xl mx-auto mt-16">Facility not found.</div></PspBorrowLayout>;
  }

  return (
    <PspBorrowLayout>
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between mb-6 mt-4 gap-4">
          <div>
            <button onClick={() => navigate('/psp/borrow/facilities')} className="text-white/70 hover:text-white text-sm inline-flex items-center gap-1 mb-2">
              <ArrowLeft className="w-4 h-4" /> Back to facilities
            </button>
            <h1 className="text-3xl font-bold tracking-tight">Facility #{state.facilityId}</h1>
            <a href={explorer('address', poolPubkey)} target="_blank" rel="noopener noreferrer"
               className="text-xs font-mono text-white/60 hover:text-white inline-flex items-center gap-1 mt-1 break-all">
              {poolPubkey} <ExternalLink className="w-3 h-3" />
            </a>
          </div>
          <button onClick={refresh} className="defa-btn-ghost">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Status banners */}
        {state.isDefaulted && (
          <div className="defa-card p-4 mb-5 flex items-center gap-3" style={{ background: 'rgba(239,68,68,0.15)', borderColor: 'rgba(239,68,68,0.4)' }}>
            <ShieldOff className="w-5 h-5 text-red-200" />
            <div><div className="font-semibold">Defaulted</div><div className="text-xs text-white/70">Past tenor + 30d. Lenders eat the haircut on redemption.</div></div>
          </div>
        )}
        {state.isCancelled && (
          <div className="defa-card p-4 mb-5 flex items-center gap-3">
            <Pause className="w-5 h-5 text-white/80" />
            <div><div className="font-semibold">Cancelled</div></div>
          </div>
        )}
        {isSettledFromPool(state) && (
          <div className="defa-card p-4 mb-5 flex items-center gap-3" style={{ background: 'rgba(34,197,94,0.15)', borderColor: 'rgba(34,197,94,0.4)' }}>
            <CheckCircle2 className="w-5 h-5 text-emerald-200" />
            <div><div className="font-semibold">Settled</div><div className="text-xs text-white/70">All drawdowns repaid, no fees pending. Facility can be closed.</div></div>
          </div>
        )}

        {/* Borrower's HEADLINE — total owed today */}
        <div className="defa-card p-6 mb-6" style={{ background: 'rgba(99,102,241,0.20)', borderColor: 'rgba(165,180,252,0.5)' }}>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="md:col-span-2">
              <div className="defa-label text-indigo-100">You owe today</div>
              <div className="text-5xl font-bold tabular-nums mt-2">
                {totalOwed !== null ? fmt(totalOwed) : '…'}
              </div>
              <div className="text-xs text-white/70 mt-2">
                Principal {fmt(state.outstandingPrincipal)} +{' '}
                util {fmt(pending?.utilFeePending || '0')} +{' '}
                penalty {fmt(pending?.penaltyFeePending || '0')}
              </div>
              <div className="text-[11px] text-white/60 mt-1">
                Unutilized fee: {fmt(state.accruedCommitFee)} (settled at end)
              </div>
            </div>
            <div className="md:col-span-2 grid grid-cols-2 lg:grid-cols-3 gap-4">
              {!isSettledFromPool(state) && (
                <Mini
                  label="Drawable Now"
                  value={fmt(BigInt(state.totalCapital) - BigInt(state.outstandingPrincipal))}
                  sub={`Cap: ${fmt(state.maxDrawdownAmount)} per loan`}
                />
              )}
              <Mini
                label="Active Loans"
                value={String(stats.active.length)}
                sub={stats.repaid.length ? `${stats.repaid.length} settled` : 'none settled'}
              />
              <Mini
                label="Tenor"
                value={`${state.facilityTenorDays}d`}
                sub={
                  isSettledFromPool(state)
                    ? '0d left · settled'
                    : stats.daysRemaining !== null
                      ? `${stats.daysRemaining}d left`
                      : 'not yet activated'
                }
                accent={stats.tenorExpired ? 'text-amber-200' : ''}
              />
              <Mini
                label="Util Rate"
                value={fmtBps(state.utilizationRateBps)}
                sub={`Charged on outstanding for ${state.graceDays}d grace, then ${fmtBps(state.penaltyRateBps)} penalty`}
              />
              <Mini
                label="Unutilized Rate"
                value={fmtBps(state.commitmentRateBps)}
                sub="Charged on idle capital · settled at end"
              />
              <Mini
                label="Grace · Penalty Window"
                value={`${state.graceDays}d / ${state.penaltyDays}d`}
                sub={`Util-rate grace, then ${state.penaltyDays}d penalty window — draws blocked after`}
              />
            </div>
          </div>
        </div>

        {/* Commitment fee accrues on undrawn capital and has to be settled
            before the pool can close and release the borrower's slot. */}
        <div className="defa-card p-4 mb-6">
          <div className="defa-label mb-2">Settle commitment fee</div>
          <SettleCommitButton pool={poolPubkey} />
        </div>

        {/* Daily activity entry */}
        <button
          onClick={() => navigate(`/psp/borrow/facilities/${poolPubkey}/daily-activity`)}
          className="defa-card defa-card-hover w-full p-4 mb-6 flex items-center gap-3 text-left"
        >
          <div className="p-2 rounded-lg bg-white/15"><BarChart3 className="w-5 h-5" /></div>
          <div className="flex-1">
            <div className="font-semibold">Daily Activity & P&L Breakdown</div>
            <div className="text-xs text-white/60">Day-by-day capital, fees, and yield from this facility</div>
          </div>
          <ArrowUpRight className="w-5 h-5 text-white/60" />
        </button>

        {/* Drawdowns table — clickable into per-drawdown amortization */}
        <div className="defa-card p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Drawdowns ({drawdowns.length})</h3>
            {/* Settle Commit Fee — available anytime there's accrued
                commit fee. The contract enforces `amount > 0` so we mirror
                that here; no tenor-expired gate (PSP may want to clear
                their commit-fee bill mid-cycle, especially under warp). */}
            {state.isActive && BigInt(state.accruedCommitFee) > 0n && (
              <button
                onClick={() => runAction('settle', '/pool/psp/build-tx/settle-commit-fee', { pool: poolPubkey })}
                disabled={busy === 'settle'}
                className="defa-btn-primary text-xs"
                title={`Pay ${fmt(state.accruedCommitFee)} to clear pool-wide commit fee`}
              >
                {busy === 'settle' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                Settle Commit Fee · {fmt(state.accruedCommitFee)}
              </button>
            )}
          </div>
          {drawdowns.length === 0 ? (
            <div className="text-sm text-white/60 text-center py-4">No drawdowns yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-white/60 text-xs uppercase">
                  <tr>
                    <th className="text-left py-2 px-3">ID</th>
                    <th className="text-right py-2 px-3">Principal</th>
                    <th className="text-center py-2 px-3">Drawn Day</th>
                    <th className="text-center py-2 px-3">Tenor</th>
                    <th className="text-center py-2 px-3">Status</th>
                    <th className="text-right py-2 px-3">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {drawdowns.map((d) => {
                    const cliff = d.drawdownDay + d.tenorDays + state.graceDays + state.penaltyDays;
                    const today = todayDayIndex(state.secondsPerDay);
                    const overdue = !d.repaid && today >= cliff;
                    const dueSoon = !d.repaid && !overdue && cliff - today <= 3;
                    const isExpanded = expandedDd === d.id;
                    return (
                      <>
                        <tr
                          key={d.pubkey}
                          className="border-t border-white/10 hover:bg-white/5 cursor-pointer"
                          onClick={() => setExpandedDd(isExpanded ? null : d.id)}
                        >
                          <td className="py-3 px-3">#{d.id}</td>
                          <td className="py-3 px-3 text-right font-semibold tabular-nums">{fmt(d.principal)}</td>
                          <td className="py-3 px-3 text-center text-white/70">{fmtDayIndex(d.drawdownDay)}</td>
                          <td className="py-3 px-3 text-center text-white/70">{d.tenorDays}d</td>
                          <td className="py-3 px-3 text-center">
                            {d.repaid ? (
                              <span className="defa-status-pill" style={{ background: 'rgba(34,197,94,0.25)', borderColor: 'rgba(34,197,94,0.5)' }}><CheckCircle2 className="w-3 h-3" />Repaid</span>
                            ) : overdue ? (
                              <span className="defa-status-pill" style={{ background: 'rgba(239,68,68,0.25)', borderColor: 'rgba(239,68,68,0.5)' }}><AlertTriangle className="w-3 h-3" />Overdue</span>
                            ) : dueSoon ? (
                              <span className="defa-status-pill" style={{ background: 'rgba(251,191,36,0.25)', borderColor: 'rgba(251,191,36,0.5)' }}><Clock className="w-3 h-3" />Due {cliff - today}d</span>
                            ) : (
                              <span className="defa-status-pill">{cliff - today}d to cliff</span>
                            )}
                          </td>
                          <td className="py-3 px-3 text-right">
                            {!d.repaid && (
                              <button
                                onClick={(e) => { e.stopPropagation(); runAction('repay-' + d.id, '/pool/psp/build-tx/repay', { drawdownId: Number(d.id), pool: poolPubkey }); }}
                                disabled={busy === 'repay-' + d.id}
                                className="defa-btn-primary text-xs"
                              >
                                {busy === 'repay-' + d.id ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                                Repay
                              </button>
                            )}
                            <ChevronRight className={`w-4 h-4 text-white/40 inline-block ml-2 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="border-t border-white/5 bg-white/5">
                            <td colSpan={6} className="px-4 py-3">
                              <ValidationPipeline pool={poolPubkey} drawdownId={d.id} />
                              <div className="mt-2 text-right">
                                <button
                                  onClick={(e) => { e.stopPropagation(); navigate(`/psp/borrow/facilities/${poolPubkey}/drawdowns/${d.id}`); }}
                                  className="text-xs text-indigo-200 hover:text-white inline-flex items-center gap-1"
                                >
                                  Open full drawdown detail <ChevronRight className="w-3 h-3" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Terms */}
        <div className="defa-card p-5">
          <h3 className="font-semibold mb-4">Facility Terms</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Term label="Soft / Hard cap" value={`${fmt(state.softCap)} / ${fmt(state.hardCap)}`} />
            <Term label="Max drawdown" value={fmt(state.maxDrawdownAmount)} />
            <Term label="Tenor" value={`${state.facilityTenorDays} days`} />
            <Term label="Activated" value={state.activatedDay ? fmtDayIndex(state.activatedDay) : '—'} />
            <Term label="Utilization" value={fmtBps(state.utilizationRateBps)} />
            <Term label="Commitment" value={fmtBps(state.commitmentRateBps)} />
            <Term label="Penalty" value={fmtBps(state.penaltyRateBps)} />
            <Term label="Grace / Penalty days" value={`${state.graceDays} / ${state.penaltyDays}`} />
          </div>
        </div>
      </div>
    </PspBorrowLayout>
  );
};

const Mini = ({ label, value, sub, accent }) => (
  <div>
    <div className="defa-label">{label}</div>
    <div className={`text-xl font-bold tabular-nums mt-0.5 ${accent || ''}`}>{value}</div>
    {sub && <div className="text-[11px] text-white/60 mt-0.5">{sub}</div>}
  </div>
);
const Term = ({ label, value }) => (
  <div>
    <div className="defa-label mb-1">{label}</div>
    <div className="text-sm font-semibold">{value}</div>
  </div>
);

export default FacilityDetail;
