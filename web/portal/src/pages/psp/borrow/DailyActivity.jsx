import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, RefreshCw, Loader2, ArrowUpRight, ArrowDownLeft } from 'lucide-react';
import toast from 'react-hot-toast';
import PspBorrowLayout from './Layout';
import Pagination from '../../../components/defa/Pagination';
import { api } from '../../../services/evm';
import { fmtLocalDate, localTzName } from '../../../utils/dateFmt';

const fmt = (base) => {
  if (base === undefined || base === null) return '—';
  const big = BigInt(base);
  if (big === 0n) return '0 USDC';
  const usd = Number(big) / 1_000_000;
  if (Math.abs(usd) >= 100) return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(usd)} USDC`;
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(usd)} USDC`;
};

const PspDailyActivity = () => {
  const { pool: poolPubkey } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const refresh = async (p = page) => {
    try {
      setLoading(true);
      const { data } = await api().get(`/pool/pool/${poolPubkey}/daily-activity`, { params: { page: p, limit: 30 } });
      setData(data);
    } catch (e) {
      toast.error(e.response?.data?.message || e.message);
    } finally { setLoading(false); }
  };
  useEffect(() => { refresh(page); /* eslint-disable-next-line */ }, [poolPubkey, page]);

  // For the PSP, "yield realized" means fees they paid out — i.e. cost.
  // Surface it as "Total fees you've paid" in the headline.
  const totalFeesPaid = data ? data.totals.yieldRealized : null;

  return (
    <PspBorrowLayout>
      <div className="max-w-7xl mx-auto">
        <div className="flex items-start justify-between mb-6 mt-4 gap-4">
          <div>
            <button onClick={() => navigate(`/psp/borrow/facilities/${poolPubkey}`)} className="text-white/70 hover:text-white text-sm inline-flex items-center gap-1 mb-2">
              <ArrowLeft className="w-4 h-4" /> Back to facility
            </button>
            <h1 className="text-3xl font-bold tracking-tight">Daily Activity & Cost Breakdown</h1>
          </div>
          <button onClick={refresh} className="defa-btn-ghost"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /></button>
        </div>

        {/* Borrower headline */}
        {data && (
          <div className="defa-card p-5 mb-6" style={{ background: 'rgba(99,102,241,0.18)', borderColor: 'rgba(165,180,252,0.4)' }}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <div className="defa-label">Fees you've paid</div>
                <div className="text-3xl font-bold tabular-nums mt-1">{fmt(totalFeesPaid)}</div>
                <div className="text-xs text-white/70 mt-1">Across all repayments + commit fee settlements</div>
              </div>
              <div>
                <div className="defa-label">Util Fee Pending</div>
                <div className="text-2xl font-bold tabular-nums mt-1 text-amber-200">{fmt(data.utilFeePending)}</div>
                <div className="text-xs text-white/70 mt-1">Accruing on your active drawdowns</div>
              </div>
              <div>
                <div className="defa-label">Penalty Pending</div>
                <div className="text-2xl font-bold tabular-nums mt-1 text-red-200">{fmt(data.penaltyFeePending)}</div>
                <div className="text-xs text-white/70 mt-1">On overdue drawdowns</div>
              </div>
            </div>
          </div>
        )}

        {loading && !data ? (
          <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-white/70" /></div>
        ) : !data || data.days.length === 0 ? (
          <div className="defa-card p-16 text-center"><p className="text-lg font-semibold">No activity yet</p></div>
        ) : (
          <div className="defa-card overflow-hidden">
            <div className="px-5 py-4 flex items-center justify-between border-b border-white/10">
              <div>
                <h3 className="font-semibold">{data.days.length} day{data.days.length === 1 ? '' : 's'}</h3>
                <p className="text-xs text-white/60">
                  {fmtLocalDate(data.days[0].date)} → {fmtLocalDate(data.days[data.days.length - 1].date)}
                  <span className="text-white/40"> · {localTzName()}</span>
                </p>
              </div>
              <div className="text-xs text-white/70">
                Util {(data.utilizationRateBps / 100).toFixed(2)}%/d · Commit {(data.commitmentRateBps / 100).toFixed(2)}%/d · Penalty {(data.penaltyRateBps / 100).toFixed(2)}%/d
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-widest text-white/60">
                    <th className="text-left px-4 py-3">Date</th>
                    <th className="text-left px-4 py-3">Events</th>
                    <th className="text-right px-4 py-3">Outstanding</th>
                    <th className="text-right px-4 py-3">Idle Capital</th>
                    <th className="text-right px-4 py-3">Util Fee</th>
                    <th className="text-right px-4 py-3">Penalty Fee</th>
                    <th className="text-right px-4 py-3">Commit Fee</th>
                    <th className="text-right px-4 py-3">Fees Paid</th>
                    <th className="text-right px-4 py-3">Day Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.days.map((d) => (
                    <tr key={d.day} className="border-t border-white/10">
                      <td className="px-4 py-3 text-xs">
                        <div className="text-white/90">{fmtLocalDate(d.date)}</div>
                        <div className="text-[10px] text-white/40 font-mono">UTC {d.date} · day {d.day}</div>
                      </td>
                      <td className="px-4 py-3">
                        {d.events.length === 0 ? <span className="text-white/40">—</span>
                          : <div className="space-y-0.5">{d.events.map((ev, i) => <EventLine key={i} ev={ev} />)}</div>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{fmt(d.peakOutstanding)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{fmt(d.unutilized)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{fmt(d.utilFee)}</td>
                      <td className={`px-4 py-3 text-right tabular-nums ${BigInt(d.penaltyFee || 0) > 0n ? 'text-red-300' : 'text-white/40'}`}>
                        {fmt(d.penaltyFee || 0)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{fmt(d.unutilFee)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {BigInt(d.yieldRealized) > 0n
                          ? <span className="text-amber-300 font-semibold">{fmt(d.yieldRealized)}</span>
                          : <span className="text-white/40">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold">{fmt(d.dayTotal)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-white/20 bg-white/5">
                    <td className="px-4 py-3 font-semibold">Period total ({data.pagination?.totalDays ?? data.days.length}d)</td>
                    <td></td>
                    <td className="px-4 py-3 text-right tabular-nums text-white/70 text-xs">{fmt(data.totals.utilizedPD).replace(' USDC', ' PD')}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-white/70 text-xs">{fmt(data.totals.unutilizedPD).replace(' USDC', ' PD')}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold">{fmt(data.totals.utilFee)}</td>
                    <td className={`px-4 py-3 text-right tabular-nums font-semibold ${BigInt(data.totals.penaltyFee || 0) > 0n ? 'text-red-300' : 'text-white/40'}`}>
                      {fmt(data.totals.penaltyFee || 0)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold">{fmt(data.totals.unutilFee)}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold text-amber-300">{fmt(data.totals.yieldRealized)}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-bold">{fmt(data.totals.dayTotal)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <Pagination pagination={data.pagination} onChange={setPage} />
          </div>
        )}
      </div>
    </PspBorrowLayout>
  );
};

const EventLine = ({ ev }) => {
  const usd = (v) => fmt(v);
  switch (ev.kind) {
    case 'drawn':         return <div className="text-blue-300 text-xs flex items-center gap-1"><ArrowUpRight className="w-3 h-3" /> Drew {usd(ev.amount)}</div>;
    case 'repaid':        return <div className="text-emerald-300 text-xs flex items-center gap-1"><ArrowDownLeft className="w-3 h-3" /> Repaid {usd(ev.principal)} · paid {usd(ev.yield)} fees</div>;
    case 'deposit':       return <div className="text-emerald-200 text-xs flex items-center gap-1"><ArrowDownLeft className="w-3 h-3" /> Lender deposited {usd(ev.amount)}</div>;
    case 'withdraw':      return <div className="text-white/60 text-xs flex items-center gap-1"><ArrowUpRight className="w-3 h-3" /> Lender withdrew {usd(ev.amount)}</div>;
    case 'execute':       return <div className="text-emerald-300 text-xs">⚡ Facility activated</div>;
    case 'settleCommit':  return <div className="text-blue-300 text-xs">Commit fee settled · {usd(ev.amount)}</div>;
    case 'redeem':        return <div className="text-fuchsia-300 text-xs">LP redeemed</div>;
    case 'cancel':        return <div className="text-amber-300 text-xs">⏸ Funding cancelled</div>;
    case 'default':       return <div className="text-red-300 text-xs">⚠ Default declared</div>;
    default: return null;
  }
};

export default PspDailyActivity;
