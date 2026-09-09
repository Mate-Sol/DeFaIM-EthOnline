import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, RefreshCw, Loader2, ExternalLink, CheckCircle, AlertTriangle,
  TrendingUp, Calendar, DollarSign, Banknote, Clock, ShieldOff, Pause,
} from 'lucide-react';
import toast from 'react-hot-toast';
import Sidebar from '../../components/Sidebar';
import { api } from '../../services/evm';
import { isSettledFromPool } from '../../utils/poolStatus';

const fmtUsdc = (base) => {
  if (base === undefined || base === null) return '$0';
  const n = Number(BigInt(base) / 1_000_000n);
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);
};
const todayDayIndex = () => Math.floor(Date.now() / 1000 / 86400);
const fmtBps = (bps) => `${(Number(bps) / 100).toFixed(2)}%/d`;
const EXPLORER_BASE = (import.meta.env.VITE_CHAIN_EXPLORER_URL || 'https://testnet.arcscan.app')
  .replace(/\/+$/, '');
const explorer = (kind, val) => `${EXPLORER_BASE}/${kind === 'address' ? 'address' : 'tx'}/${val}`;

const FacilityDetail = () => {
  const { pool: poolPubkey } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState(null);
  const [drawdowns, setDrawdowns] = useState([]);
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      setLoading(true);
      const [s, d, a] = await Promise.all([
        api().get(`/pool/pool/${poolPubkey}/state`),
        api().get(`/pool/pool/${poolPubkey}/drawdowns`, { params: { includeRepaid: true } }),
        api().get(`/pool/pool/${poolPubkey}/activity`, { params: { limit: 30 } }).catch(() => ({ data: [] })),
      ]);
      setState(s.data);
      setDrawdowns(d.data);
      setActivity(a.data);
    } catch (e) {
      toast.error(e.response?.data?.message || e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, [poolPubkey]);

  const stats = useMemo(() => {
    if (!state) return null;
    const today = todayDayIndex();
    const tenorEnd = state.activatedDay ? state.activatedDay + state.facilityTenorDays : null;
    const daysRemaining = tenorEnd ? Math.max(0, tenorEnd - today) : null;
    const tenorExpired = tenorEnd ? today >= tenorEnd : false;

    const active = drawdowns.filter((d) => !d.repaid);
    const repaid = drawdowns.filter((d) => d.repaid);
    const totalDrawn = drawdowns.reduce((s, d) => s + BigInt(d.principal), 0n);
    const totalRepaid = repaid.reduce((s, d) => s + BigInt(d.principal), 0n);
    const outstanding = BigInt(state.outstandingPrincipal);

    // Per-active-drawdown due day = drawdown_day + tenor + grace + penalty.
    // Past this day, the program blocks new draws.
    const activeWithDueDays = active.map((d) => {
      const cliff = d.drawdownDay + d.tenorDays + state.graceDays + state.penaltyDays;
      const daysToCliff = cliff - today;
      const overdue = daysToCliff <= 0;
      return { ...d, cliff, daysToCliff, overdue };
    }).sort((a, b) => a.daysToCliff - b.daysToCliff);

    const totalAccruedFees =
      BigInt(state.accruedUtilFee) +
      BigInt(state.accruedCommitFee) +
      BigInt(state.accruedPenaltyFee);

    return {
      today, tenorEnd, daysRemaining, tenorExpired,
      activeWithDueDays, repaid,
      totalDrawn, totalRepaid, outstanding, totalAccruedFees,
    };
  }, [state, drawdowns]);

  if (loading && !state) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Sidebar />
        <main className="ml-64 p-8 flex justify-center"><Loader2 className="w-7 h-7 animate-spin text-brand-purple mt-16" /></main>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Sidebar />
        <main className="ml-64 p-8">
          <div className="max-w-3xl mx-auto card p-12 text-center text-gray-500">Pool not found.</div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar />
      <main className="ml-64 p-8">
        <div className="max-w-6xl mx-auto">
          {/* Back + header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <button onClick={() => navigate('/psp/facilities')} className="text-sm text-gray-500 hover:text-gray-900 inline-flex items-center gap-1 mb-2">
                <ArrowLeft className="w-4 h-4" /> Back to facilities
              </button>
              <h1 className="page-header">Facility #{state.facilityId} · {state.pspName}</h1>
              <a href={explorer('address', poolPubkey)} target="_blank" rel="noopener noreferrer"
                 className="text-xs text-gray-500 hover:text-brand-purple font-mono inline-flex items-center gap-1">
                {poolPubkey} <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={refresh} className="text-gray-500 hover:text-gray-900 p-2" title="Refresh">
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
              {state.isActive && !state.isDefaulted && !state.isCancelled && (
                null
              )}
            </div>
          </div>

          {/* Status banner */}
          {state.isDefaulted && (
            <div className="card p-4 mb-6 border-l-4 border-l-red-500 bg-red-50 flex items-center gap-3">
              <ShieldOff className="w-5 h-5 text-red-600" />
              <div>
                <div className="font-semibold text-red-900">Facility Defaulted</div>
                <div className="text-sm text-red-700">Lenders can redeem against the vault remainder.</div>
              </div>
            </div>
          )}
          {state.isCancelled && (
            <div className="card p-4 mb-6 border-l-4 border-l-gray-500 bg-gray-50 flex items-center gap-3">
              <Pause className="w-5 h-5 text-gray-600" />
              <div>
                <div className="font-semibold text-gray-900">Funding Cancelled</div>
                <div className="text-sm text-gray-700">Soft cap wasn't met. Lenders can withdraw their deposits.</div>
              </div>
            </div>
          )}
          {isSettledFromPool(state) && (
            <div className="card p-4 mb-6 border-l-4 border-l-emerald-500 bg-emerald-50 flex items-center gap-3">
              <CheckCircle className="w-5 h-5 text-emerald-600" />
              <div>
                <div className="font-semibold text-emerald-900">Facility Settled</div>
                <div className="text-sm text-emerald-700">All drawdowns repaid, no fees pending. Ready to close.</div>
              </div>
            </div>
          )}

          {/* Top stat cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <StatCard
              icon={<DollarSign className="w-5 h-5" />}
              label="Outstanding Principal"
              value={fmtUsdc(stats.outstanding)}
              hint="What you currently owe in principal"
              tone="purple"
            />
            <StatCard
              icon={<Banknote className="w-5 h-5" />}
              label="Total Repaid"
              value={fmtUsdc(stats.totalRepaid)}
              hint={`${stats.repaid.length} of ${drawdowns.length} drawdowns settled`}
              tone="emerald"
            />
            <StatCard
              icon={<TrendingUp className="w-5 h-5" />}
              label="Fees Owed"
              value={fmtUsdc(stats.totalAccruedFees)}
              hint="Util + commit + penalty (auto-deducted on next repay)"
              tone="amber"
            />
            <StatCard
              icon={<Calendar className="w-5 h-5" />}
              label={stats.tenorExpired ? 'Tenor Status' : 'Tenor Remaining'}
              value={stats.tenorExpired ? 'Expired' : (stats.daysRemaining !== null ? `${stats.daysRemaining}d` : '—')}
              hint={
                state.activatedDay
                  ? `Started day ${state.activatedDay} · ends day ${stats.tenorEnd}`
                  : 'Not yet activated'
              }
              tone={stats.tenorExpired ? 'red' : 'blue'}
            />
          </div>

          {/* Active drawdowns */}
          <Section title="Active Drawdowns" subtitle={`${stats.activeWithDueDays.length} open`}>
            {stats.activeWithDueDays.length === 0 ? (
              <div className="text-sm text-gray-500 text-center py-6">No active drawdowns.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                    <tr>
                      <th className="px-4 py-3 text-left">Drawdown</th>
                      <th className="px-4 py-3 text-right">Principal</th>
                      <th className="px-4 py-3 text-center">Drawn</th>
                      <th className="px-4 py-3 text-center">Tenor</th>
                      <th className="px-4 py-3 text-center">Status</th>
                      <th className="px-4 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.activeWithDueDays.map((d) => (
                      <tr key={d.pubkey} className="border-t border-gray-100">
                        <td className="px-4 py-3">
                          <div className="text-gray-900 font-medium">#{d.id}</div>
                          <a href={explorer('address', d.pubkey)} target="_blank" rel="noopener noreferrer"
                             className="text-xs text-gray-400 hover:text-brand-purple font-mono">
                            {d.pubkey.slice(0, 8)}…
                          </a>
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-gray-900 tabular-nums">
                          {fmtUsdc(d.principal)}
                        </td>
                        <td className="px-4 py-3 text-center text-gray-600">day {d.drawdownDay}</td>
                        <td className="px-4 py-3 text-center text-gray-600">{d.tenorDays}d</td>
                        <td className="px-4 py-3 text-center">
                          {d.overdue ? (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700 bg-red-50 px-2 py-1 rounded">
                              <AlertTriangle className="w-3 h-3" />
                              Overdue {Math.abs(d.daysToCliff)}d
                            </span>
                          ) : d.daysToCliff <= state.penaltyDays ? (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 px-2 py-1 rounded">
                              <Clock className="w-3 h-3" />
                              Due in {d.daysToCliff}d
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 px-2 py-1 rounded">
                              <CheckCircle className="w-3 h-3" />
                              {d.daysToCliff}d to cliff
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {/* Repaid history */}
          {stats.repaid.length > 0 && (
            <Section title="Repaid Drawdowns" subtitle={`${stats.repaid.length} settled`}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                    <tr>
                      <th className="px-4 py-3 text-left">Drawdown</th>
                      <th className="px-4 py-3 text-right">Principal</th>
                      <th className="px-4 py-3 text-center">Drawn</th>
                      <th className="px-4 py-3 text-center">Tenor</th>
                      <th className="px-4 py-3 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.repaid.map((d) => (
                      <tr key={d.pubkey} className="border-t border-gray-100">
                        <td className="px-4 py-3">
                          <div className="text-gray-900 font-medium">#{d.id}</div>
                          <a href={explorer('address', d.pubkey)} target="_blank" rel="noopener noreferrer"
                             className="text-xs text-gray-400 hover:text-brand-purple font-mono">
                            {d.pubkey.slice(0, 8)}…
                          </a>
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-gray-900 tabular-nums">
                          {fmtUsdc(d.principal)}
                        </td>
                        <td className="px-4 py-3 text-center text-gray-600">day {d.drawdownDay}</td>
                        <td className="px-4 py-3 text-center text-gray-600">{d.tenorDays}d</td>
                        <td className="px-4 py-3 text-center">
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 px-2 py-1 rounded">
                            <CheckCircle className="w-3 h-3" />Repaid
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          )}

          {/* Facility terms */}
          <Section title="Facility Terms">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4">
              <Term label="Soft cap" value={fmtUsdc(state.softCap)} />
              <Term label="Hard cap" value={fmtUsdc(state.hardCap)} />
              <Term label="Max per drawdown" value={fmtUsdc(state.maxDrawdownAmount)} />
              <Term label="Tenor" value={`${state.facilityTenorDays} days`} />
              <Term label="Utilization rate" value={fmtBps(state.utilizationRateBps)} />
              <Term label="Commitment rate" value={fmtBps(state.commitmentRateBps)} />
              <Term label="Penalty rate" value={fmtBps(state.penaltyRateBps)} />
              <Term label="Grace / Penalty days" value={`${state.graceDays} / ${state.penaltyDays}`} />
            </div>
          </Section>

          {/* Activity feed */}
          {activity.length > 0 && (
            <Section title="On-chain Activity" subtitle={`${activity.length} events`}>
              <div className="divide-y divide-gray-100">
                {activity.map((ev, i) => (
                  <ActivityRow key={i} event={ev} />
                ))}
              </div>
            </Section>
          )}
        </div>
      </main>
    </div>
  );
};

const TONE = {
  purple:  { ring: 'border-brand-purple/20',  bg: 'bg-brand-purple/5',  text: 'text-brand-purple',  iconBg: 'bg-brand-purple/10' },
  emerald: { ring: 'border-emerald-200',      bg: 'bg-emerald-50',      text: 'text-emerald-700',   iconBg: 'bg-emerald-100' },
  amber:   { ring: 'border-amber-200',        bg: 'bg-amber-50',        text: 'text-amber-700',     iconBg: 'bg-amber-100' },
  red:     { ring: 'border-red-200',          bg: 'bg-red-50',          text: 'text-red-700',       iconBg: 'bg-red-100' },
  blue:    { ring: 'border-blue-200',         bg: 'bg-blue-50',         text: 'text-blue-700',      iconBg: 'bg-blue-100' },
};

const StatCard = ({ icon, label, value, hint, tone = 'purple' }) => {
  const t = TONE[tone];
  return (
    <div className={`rounded-xl border ${t.ring} ${t.bg} p-5`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs uppercase tracking-wide text-gray-500 font-medium">{label}</span>
        <div className={`p-1.5 rounded-md ${t.iconBg} ${t.text}`}>{icon}</div>
      </div>
      <div className="text-2xl font-bold text-gray-900 tabular-nums">{value}</div>
      <div className="text-xs text-gray-500 mt-1">{hint}</div>
    </div>
  );
};

const Section = ({ title, subtitle, children }) => (
  <div className="card mb-6 overflow-hidden">
    <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
      <div>
        <h3 className="font-semibold text-gray-900">{title}</h3>
        {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
      </div>
    </div>
    {children}
  </div>
);

const Term = ({ label, value }) => (
  <div>
    <div className="text-xs text-gray-500 mb-0.5">{label}</div>
    <div className="text-sm font-semibold text-gray-900">{value}</div>
  </div>
);

const EVENT_LABELS = {
  PoolInitialized: 'Pool Initialized',
  Deposited: 'Lender Deposit',
  WithdrawnFunding: 'Lender Withdraw',
  FacilityExecuted: 'Facility Activated',
  FundingCancelledEvent: 'Funding Cancelled',
  DrawdownExecuted: 'Drawdown',
  RepaymentProcessed: 'Repayment',
  CommitFeeSettled: 'Commit Fee Settled',
  LpRedeemed: 'LP Redeemed',
  ProtocolFeesClaimed: 'Protocol Fees Claimed',
  DefaultDeclared: 'Default Declared',
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
  const usd = (v) => v ? fmtUsdc(v) : '—';
  const d = event.data || {};
  let detail = '';
  switch (event.name) {
    case 'Deposited':           detail = `${usd(d.amount)} from ${(d.lender || '').slice(0, 6)}…`; break;
    case 'WithdrawnFunding':    detail = `${usd(d.amount)} to ${(d.lender || '').slice(0, 6)}…`; break;
    case 'FacilityExecuted':    detail = `Activated with ${usd(d.totalCapital)} on day ${d.activatedDay}`; break;
    case 'DrawdownExecuted':    detail = `${usd(d.amount)} for ${d.tenorDays}d (#${d.id})`; break;
    case 'RepaymentProcessed':  detail = `Principal ${usd(d.principal)} · util ${usd(d.utilFee)} · penalty ${usd(d.penaltyFee)}`; break;
    case 'CommitFeeSettled':    detail = `${usd(d.amount)} settled`; break;
    case 'LpRedeemed':          detail = `${usd(d.usdcPaid)} for ${usd(d.lpBurned)} LP`; break;
    case 'ProtocolFeesClaimed': detail = `${usd(d.amount)} to admin`; break;
    case 'DefaultDeclared':     detail = `Outstanding ${usd(d.outstanding)}`; break;
    default: detail = '';
  }
  return (
    <a
      href={explorer('tx', event.signature)}
      target="_blank" rel="noopener noreferrer"
      className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors"
    >
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-gray-900">{EVENT_LABELS[event.name] || event.name}</div>
        {detail && <div className="text-xs text-gray-500 truncate">{detail}</div>}
      </div>
      <div className="text-xs text-gray-400 text-right">
        <div>{fmtTime(event.blockTime)}</div>
        <div className="font-mono">{event.signature.slice(0, 6)}…</div>
      </div>
    </a>
  );
};

export default FacilityDetail;
