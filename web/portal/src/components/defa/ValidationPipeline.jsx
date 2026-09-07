import { useEffect, useState } from 'react';
import { CheckCircle2, XCircle, Loader2, Clock, Circle, AlertCircle } from 'lucide-react';
import { api } from '../../services/evm';

/**
 * Validation pipeline stepper. Shows the off-chain agent's progress
 * through every gate the financing request had to pass — credit-line
 * check, order verification, sufficient credit, risk validation, and
 * the final on-chain disbursement.
 *
 * Reused on PSP / admin / lender drawdown detail surfaces so all
 * parties see the same auditable pipeline.
 *
 * Props:
 *   pool       — pool PDA (string)
 *   drawdownId — numeric on-chain drawdown id
 *   compact    — when true, renders a one-line summary; expand to see steps
 */
const ValidationPipeline = ({ pool, drawdownId, compact = false }) => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(!compact);

  useEffect(() => {
    if (!pool || drawdownId === undefined || drawdownId === null) return;
    let cancelled = false;
    let interval;
    const load = () => {
      api().get(`/pool/pool/${pool}/drawdown/${drawdownId}/pipeline`)
        .then(({ data }) => { if (!cancelled) { setData(data); setError(null); } })
        .catch((e) => { if (!cancelled) setError(e.response?.data?.message || e.message); });
    };
    load();
    // Re-poll while any step is still pending/running so the UI ticks
    // through in near-real-time. Stops as soon as everything is final.
    interval = setInterval(() => {
      const live = data?.steps?.some((s) => s.status === 'pending' || s.status === 'running');
      if (live || !data) load();
    }, 4000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [pool, drawdownId]);

  if (error) {
    return (
      <div className="text-xs text-amber-700 inline-flex items-center gap-1">
        <AlertCircle className="w-3 h-3" /> Pipeline unavailable
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-xs text-slate-500 inline-flex items-center gap-1">
        <Loader2 className="w-3 h-3 animate-spin" /> Loading pipeline…
      </div>
    );
  }

  const steps = data.steps || [];
  const passedCount = steps.filter((s) => s.status === 'passed').length;
  const failedCount = steps.filter((s) => s.status === 'failed').length;
  const overall = failedCount > 0
    ? 'failed'
    : passedCount === steps.length && steps.length > 0
      ? 'passed'
      : 'running';

  const overallStyles = {
    passed:  { color: 'text-emerald-700', bg: 'bg-emerald-50',  border: 'border-emerald-200', icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
    failed:  { color: 'text-red-700',     bg: 'bg-red-50',      border: 'border-red-200',     icon: <XCircle className="w-3.5 h-3.5" /> },
    running: { color: 'text-indigo-700',  bg: 'bg-indigo-50',   border: 'border-indigo-200',  icon: <Loader2 className="w-3.5 h-3.5 animate-spin" /> },
  }[overall];

  return (
    <div className={`rounded-lg border ${overallStyles.border} ${overallStyles.bg}`}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`w-full px-3 py-2 flex items-center justify-between text-xs ${overallStyles.color}`}
      >
        <span className="flex items-center gap-2 font-semibold">
          {overallStyles.icon}
          Validation pipeline · {passedCount}/{steps.length} {overall}
        </span>
        <span className="text-[10px] opacity-70">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <ol className="px-3 pb-3 space-y-1.5">
          {steps.map((s, i) => (
            <li key={i} className="flex items-start gap-2 text-xs">
              <StepIcon status={s.status} />
              <div className="flex-1 min-w-0">
                <div className={`font-medium ${textForStatus(s.status)}`}>{s.name}</div>
                {s.detail && <div className="text-[10px] text-slate-500 truncate">{s.detail}</div>}
              </div>
              {s.completedAt && (
                <span className="text-[10px] text-slate-400 shrink-0">
                  {new Date(s.completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </li>
          ))}
          {data.rejectionReason && (
            <li className="text-[10px] text-red-700 italic mt-1">Reason: {data.rejectionReason}</li>
          )}
        </ol>
      )}
    </div>
  );
};

const StepIcon = ({ status }) => {
  switch (status) {
    case 'passed':  return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />;
    case 'failed':  return <XCircle      className="w-3.5 h-3.5 text-red-600 shrink-0 mt-0.5" />;
    case 'running': return <Loader2      className="w-3.5 h-3.5 text-indigo-600 shrink-0 mt-0.5 animate-spin" />;
    case 'skipped': return <Clock        className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />;
    default:        return <Circle       className="w-3.5 h-3.5 text-slate-300 shrink-0 mt-0.5" />;
  }
};

const textForStatus = (s) => ({
  passed:  'text-emerald-800',
  failed:  'text-red-800',
  running: 'text-indigo-800',
  skipped: 'text-slate-500',
}[s] || 'text-slate-700');

export default ValidationPipeline;
