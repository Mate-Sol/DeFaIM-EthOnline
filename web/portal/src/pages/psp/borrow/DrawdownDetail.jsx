import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAccount, useSendTransaction } from 'wagmi';
import {
  ArrowLeft, RefreshCw, Loader2, ExternalLink, AlertTriangle, Clock, CheckCircle2, Zap, Calendar, DollarSign,
} from 'lucide-react';
import toast from 'react-hot-toast';
import PspBorrowLayout from './Layout';
import { api, buildAndSend } from '../../../services/evm';
import { fmtLocalDate, fmtDayIndex } from '../../../utils/dateFmt';

const fmt = (base) => {
  if (base === undefined || base === null) return '$0';
  const big = BigInt(base);
  const usd = Number(big) / 1_000_000;
  if (Math.abs(usd) >= 1) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(usd);
  }
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 }).format(usd);
};
const fmtBps = (bps) => `${(Number(bps) / 100).toFixed(2)}%/d`;
const explorer = (kind, val) => `https://testnet.arcscan.app/${kind === 'tx' ? 'tx' : 'address'}/${val}`;

const DrawdownDetail = () => {
  const { pool: poolPubkey, drawdownId } = useParams();
  const navigate = useNavigate();
  const { address, isConnected } = useAccount();
  const { sendTransactionAsync } = useSendTransaction();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try {
      setLoading(true);
      const { data } = await api().get(`/pool/pool/${poolPubkey}/drawdown/${drawdownId}/amortization`);
      setData(data);
    } catch (e) {
      toast.error(e.response?.data?.message || e.message);
    } finally { setLoading(false); }
  };
  useEffect(() => { refresh(); }, [poolPubkey, drawdownId]);

  const handleRepay = async () => {
    if (!isConnected) { toast.error('Connect wallet first'); return; }
    setBusy(true);
    try {
      const r = await buildAndSend(address, sendTransactionAsync, '/pool/psp/build-tx/repay', { drawdownId: Number(drawdownId), pool: poolPubkey });
      toast.success(`Repaid: ${r.hash.slice(0, 10)}…`);
      navigate(`/psp/borrow/facilities/${poolPubkey}`);
    } catch (e) {
      toast.error(e.response?.data?.message || e.message);
    } finally { setBusy(false); }
  };

  if (loading && !data) {
    return <PspBorrowLayout><div className="flex justify-center pt-32"><Loader2 className="w-8 h-8 animate-spin text-white/70" /></div></PspBorrowLayout>;
  }
  if (!data) {
    return <PspBorrowLayout><div className="defa-card p-12 text-center text-white/70 max-w-3xl mx-auto mt-16">Drawdown not found.</div></PspBorrowLayout>;
  }

  const dd = data.drawdown;
  const r = data.rates;
  const status = dd.repaid ? 'repaid' : (data.today >= data.cliff ? 'overdue' : (data.today >= data.normalDueDay ? 'penalty-window' : 'open'));
  const principalUsd = Number(BigInt(dd.principal)) / 1_000_000;

  return (
    <PspBorrowLayout>
      <div className="max-w-7xl mx-auto">
        <div className="flex items-start justify-between mb-6 mt-4 gap-4">
          <div>
            <button onClick={() => navigate(`/psp/borrow/facilities/${poolPubkey}`)} className="text-white/70 hover:text-white text-sm inline-flex items-center gap-1 mb-2">
              <ArrowLeft className="w-4 h-4" /> Back to facility
            </button>
            <h1 className="text-3xl font-bold tracking-tight">Drawdown #{dd.id}</h1>
            <a href={explorer('address', dd.pubkey)} target="_blank" rel="noopener noreferrer"
               className="text-xs font-mono text-white/60 hover:text-white inline-flex items-center gap-1 mt-1 break-all">
              {dd.pubkey} <ExternalLink className="w-3 h-3" />
            </a>
          </div>
          <button onClick={refresh} className="defa-btn-ghost"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /></button>
        </div>

        {/* Headline — what it costs to repay TODAY */}
        <div className="defa-card p-6 mb-6" style={{
          background: status === 'overdue'  ? 'rgba(239,68,68,0.15)' :
                      status === 'penalty-window' ? 'rgba(251,191,36,0.15)' :
                      status === 'repaid'  ? 'rgba(34,197,94,0.15)' :
                                            'rgba(99,102,241,0.18)',
          borderColor: 'rgba(255,255,255,0.25)',
        }}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-2">
              <div className="defa-label">{dd.repaid ? 'Repaid total' : 'Cost to repay today'}</div>
              <div className="text-5xl font-bold tabular-nums mt-2">
                {fmt(data.snapshot.totalOwed)}
              </div>
              <div className="text-xs text-white/70 mt-2">
                Principal {fmt(dd.principal)} +
                util {fmt(data.snapshot.utilFee)} +
                penalty {fmt(data.snapshot.penaltyFee)}
              </div>
              <div className="text-[11px] text-white/60 mt-1">
                After {data.snapshot.daysActive} day{data.snapshot.daysActive === 1 ? '' : 's'} active
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Mini label="Tenor" value={`${dd.tenorDays}d`} sub={`Drawn ${fmtDayIndex(dd.drawdownDay)}`} />
              <Mini label="Status" value={
                status === 'repaid' ? 'Repaid' :
                status === 'overdue' ? 'OVERDUE' :
                status === 'penalty-window' ? 'Penalty days' :
                'Open'
              } accent={
                status === 'overdue' ? 'text-red-300' :
                status === 'penalty-window' ? 'text-amber-300' :
                status === 'repaid' ? 'text-emerald-300' : ''
              } />
              <Mini label="Normal due" value={fmtDayIndex(data.normalDueDay)} sub={`grace +${r.graceDays}d`} />
              <Mini label="Cliff" value={fmtDayIndex(data.cliff)} sub={`+${r.penaltyDays}d penalty`} />
            </div>
          </div>

          {!dd.repaid && (
            <button
              onClick={handleRepay}
              disabled={busy || !wallet.connected}
              className="defa-btn-primary mt-5"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
              Repay {fmt(data.snapshot.totalOwed)} now
            </button>
          )}
        </div>

        {/* Amortization schedule */}
        <div className="defa-card overflow-hidden">
          <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
            <div>
              <h3 className="font-semibold">Amortization Schedule</h3>
              <p className="text-xs text-white/60">
                Day-by-day cost from drawdown to cliff. Util at {fmtBps(r.utilizationRateBps)}, penalty at {fmtBps(r.penaltyRateBps)} after grace.
              </p>
            </div>
            <Legend />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-widest text-white/60">
                  <th className="text-left px-4 py-3">Date</th>
                  <th className="text-center px-4 py-3">Day in Loan</th>
                  <th className="text-center px-4 py-3">Phase</th>
                  <th className="text-right px-4 py-3">Util Fee</th>
                  <th className="text-right px-4 py-3">Penalty Fee</th>
                  <th className="text-right px-4 py-3">Total Owed</th>
                </tr>
              </thead>
              <tbody>
                {data.schedule.map((row) => {
                  const isPenaltyOnly = row.isPenaltyDay;
                  const isToday = row.isToday;
                  const isCliff = row.day === data.cliff;
                  return (
                    <tr key={row.day} className={`border-t border-white/10 ${isToday ? 'bg-indigo-500/15' : ''}`}>
                      <td className="px-4 py-2.5 text-xs">
                        <div className="text-white/90">
                          {fmtLocalDate(row.date)}
                          {isToday && <span className="ml-2 text-[10px] uppercase tracking-wider text-indigo-200">today</span>}
                          {isCliff && <span className="ml-2 text-[10px] uppercase tracking-wider text-red-200">cliff</span>}
                        </div>
                        <div className="text-[10px] text-white/40 font-mono">UTC {row.date}</div>
                      </td>
                      <td className="px-4 py-2.5 text-center text-white/70">day {row.daysActive}</td>
                      <td className="px-4 py-2.5 text-center">
                        {isPenaltyOnly ? (
                          <span className="defa-status-pill" style={{ background: 'rgba(239,68,68,0.20)', borderColor: 'rgba(239,68,68,0.45)' }}>
                            Penalty
                          </span>
                        ) : row.daysActive > dd.tenorDays ? (
                          <span className="defa-status-pill" style={{ background: 'rgba(251,191,36,0.20)', borderColor: 'rgba(251,191,36,0.45)' }}>
                            Grace
                          </span>
                        ) : (
                          <span className="defa-status-pill">Util</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{fmt(row.utilFee)}</td>
                      <td className={`px-4 py-2.5 text-right tabular-nums ${BigInt(row.penaltyFee) > 0n ? 'text-red-300' : 'text-white/40'}`}>
                        {fmt(row.penaltyFee)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{fmt(row.totalOwed)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </PspBorrowLayout>
  );
};

const Mini = ({ label, value, sub, accent }) => (
  <div>
    <div className="defa-label">{label}</div>
    <div className={`text-lg font-bold tabular-nums mt-0.5 ${accent || ''}`}>{value}</div>
    {sub && <div className="text-[11px] text-white/60 mt-0.5">{sub}</div>}
  </div>
);

const Legend = () => (
  <div className="hidden md:flex items-center gap-3 text-xs text-white/70">
    <span className="flex items-center gap-1">
      <span className="defa-status-pill">Util</span>
    </span>
    <span className="flex items-center gap-1">
      <span className="defa-status-pill" style={{ background: 'rgba(251,191,36,0.20)', borderColor: 'rgba(251,191,36,0.45)' }}>Grace</span>
    </span>
    <span className="flex items-center gap-1">
      <span className="defa-status-pill" style={{ background: 'rgba(239,68,68,0.20)', borderColor: 'rgba(239,68,68,0.45)' }}>Penalty</span>
    </span>
  </div>
);

export default DrawdownDetail;
