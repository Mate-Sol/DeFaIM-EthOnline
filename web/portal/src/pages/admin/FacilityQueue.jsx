import { useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw, ArrowRight, X, Upload, FileText, ExternalLink } from 'lucide-react';
import toast from 'react-hot-toast';
import Sidebar from '../../components/Sidebar';
import { api } from '../../services/evm';

// Role-aware facility approval queue.
// KAM sees KAM_REVIEW (first-facility identity gate),
// CAD sees CAD_REVIEW (compliance), CRO sees CRO_REVIEW (final risk + term lock).
// CRO can edit terms in the review modal before approving.
const ROLE_TO_STATUS = {
  KAM: 'KAM_REVIEW',
  CAD: 'CAD_REVIEW',
  CRO: 'CRO_REVIEW',
};

const FacilityQueue = () => {
  const [me, setMe] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState(null);
  const [busy, setBusy] = useState(false);

  const role = me?.role;
  const status = role && ROLE_TO_STATUS[role];

  const refresh = async () => {
    try {
      setLoading(true);
      const meRes = me ? { data: me } : await api().get('/auth/me');
      setMe(meRes.data);
      const s = ROLE_TO_STATUS[meRes.data.role];
      if (!s) {
        setItems([]);
        return;
      }
      const r = await api().get('/facility/queue', { params: { status: s } });
      setItems(r.data.items || []);
    } catch (e) {
      toast.error(e.response?.data?.message || e.message);
    } finally { setLoading(false); }
  };

  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, []);

  const approve = async (overrides) => {
    if (!active) return;
    setBusy(true);
    try {
      const body = role === 'CRO' ? { termAdjustments: overrides } : {};
      await api().post(`/facility/${active._id}/approve`, body);
      toast.success(`${active.label || `Facility #${active.facilityId}`} approved`);
      setActive(null);
      refresh();
    } catch (e) {
      toast.error(e.response?.data?.message || e.message);
    } finally { setBusy(false); }
  };

  const reject = async (reason) => {
    if (!active) return;
    setBusy(true);
    try {
      await api().post(`/facility/${active._id}/reject`, { reason });
      toast.success('Rejected');
      setActive(null);
      refresh();
    } catch (e) {
      toast.error(e.response?.data?.message || e.message);
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <Sidebar />
      <main className="ml-64 p-8">
        <div className="max-w-6xl mx-auto">
          <header className="mb-6 flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Facility Approval Queue</h1>
              <p className="text-slate-600 text-sm mt-1">
                {role
                  ? <>Awaiting <strong className="text-slate-900">{role}</strong> review · {items.length} facilit{items.length === 1 ? 'y' : 'ies'}</>
                  : 'Loading…'}
              </p>
            </div>
            <button onClick={refresh} className="text-slate-500 hover:text-slate-900" title="Refresh">
              <RefreshCw className="w-4 h-4" />
            </button>
          </header>

          {!status && me ? (
            <div className="bg-white rounded-lg border border-slate-200 p-12 text-center text-slate-500">
              Your role ({me.role}) doesn't review facility requests.
            </div>
          ) : loading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
          ) : items.length === 0 ? (
            <div className="bg-white rounded-lg border border-slate-200 p-12 text-center text-slate-500">
              Queue is empty. New facility requests for {role} review will appear here.
            </div>
          ) : (
            <div className="space-y-3">
              {items.map((f) => (
                <FacilityRow key={f._id} f={f} onOpen={() => setActive(f)} />
              ))}
            </div>
          )}
        </div>
      </main>

      {active && (
        <FacilityReviewModal
          facility={active}
          role={role}
          submitting={busy}
          onCancel={() => setActive(null)}
          onApprove={approve}
          onReject={reject}
        />
      )}
    </div>
  );
};

const fmtUsd = (n) =>
  n
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(n))
    : '—';

const FacilityRow = ({ f, onOpen }) => {
  const t = f.requestedTerms || {};
  return (
    <button
      onClick={onOpen}
      className="w-full text-left bg-white rounded-lg border border-slate-200 p-5 hover:border-slate-400 transition"
    >
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="font-semibold text-slate-900">
            {f.psp?.companyName || 'PSP'} · facility #{f.facilityId}
            {f.label && <span className="text-slate-500 font-normal ml-1">— {f.label}</span>}
          </div>
          <code className="text-xs text-slate-400 font-mono">{f.pspWallet}</code>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          {f.isFirstFacility && <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded">First facility</span>}
          <ArrowRight className="w-4 h-4" />
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <div>
          <div className="text-xs text-slate-500">Credit line</div>
          <div className="text-slate-900">{fmtUsd(t.creditLine)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Tenor</div>
          <div className="text-slate-900">{t.tenorDays}d</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Util / Commit / Penalty</div>
          <div className="text-slate-900">
            {t.utilizationRateBps} / {t.commitmentRateBps} / {t.penaltyRateBps} bps
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Max drawdown</div>
          <div className="text-slate-900">{fmtUsd(t.maxDrawdownAmount || t.creditLine)}</div>
        </div>
      </div>
    </button>
  );
};

const FacilityReviewModal = ({ facility, role, submitting, onCancel, onApprove, onReject }) => {
  // CRO is the only role that can edit terms; KAM/CAD just approve/reject.
  const canEdit = role === 'CRO';
  const t = facility.requestedTerms || {};
  const [form, setForm] = useState({
    creditLine: t.creditLine,
    tenorDays: t.tenorDays,
    utilizationRateBps: t.utilizationRateBps,
    commitmentRateBps: t.commitmentRateBps,
    penaltyRateBps: t.penaltyRateBps,
    graceDays: t.graceDays || 1,
    penaltyDays: t.penaltyDays || 30,
    maxDrawdownAmount: t.maxDrawdownAmount || t.creditLine,
    softCap: t.creditLine,
    hardCap: t.creditLine,
  });
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v === '' ? '' : Number(v) }));

  const errs = [];
  if (canEdit) {
    if (!(form.creditLine > 0)) errs.push('Credit line > 0');
    if (!(form.tenorDays > 0)) errs.push('Tenor > 0');
    if (!(form.utilizationRateBps > 0)) errs.push('Util rate > 0 bps');
    if (form.maxDrawdownAmount > form.creditLine) errs.push('Max drawdown ≤ credit line');
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-900">
            {role} Review · facility #{facility.facilityId}
          </h2>
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-600" disabled={submitting}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="bg-slate-50 rounded-lg p-4 mb-4 space-y-1.5 text-sm">
          <Row label="PSP" value={facility.psp?.companyName || '—'} />
          <Row label="Wallet" value={facility.pspWallet} mono />
          <Row label="Label" value={facility.label || '—'} />
          <Row label="Status" value={facility.status} />
          <Row label="Requested" value={new Date(facility.requestedAt).toLocaleString()} />
          {facility.isFirstFacility && (
            <div className="text-xs text-emerald-700 mt-1">First facility for this PSP — full multi-tier review.</div>
          )}
        </div>

        {!rejectMode ? (
          <>
            <h3 className="text-sm font-semibold text-slate-700 mb-2">
              {canEdit ? 'Lock-in Terms (CRO can edit)' : 'Requested Terms'}
            </h3>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <NumField label="Credit line (USD)"        value={form.creditLine}         onChange={(v) => set('creditLine', v)}         disabled={!canEdit || submitting} />
              <NumField label="Tenor (days)"             value={form.tenorDays}          onChange={(v) => set('tenorDays', v)}          disabled={!canEdit || submitting} />
              <NumField label="Util rate (bps/d)"        value={form.utilizationRateBps} onChange={(v) => set('utilizationRateBps', v)} disabled={!canEdit || submitting} />
              <NumField label="Commit rate (bps/d)"      value={form.commitmentRateBps}  onChange={(v) => set('commitmentRateBps', v)}  disabled={!canEdit || submitting} />
              <NumField label="Penalty rate (bps/d)"     value={form.penaltyRateBps}     onChange={(v) => set('penaltyRateBps', v)}     disabled={!canEdit || submitting} />
              <NumField label="Grace days"               value={form.graceDays}          onChange={(v) => set('graceDays', v)}          disabled={!canEdit || submitting} />
              <NumField label="Penalty days"             value={form.penaltyDays}        onChange={(v) => set('penaltyDays', v)}        disabled={!canEdit || submitting} />
              <NumField label="Max drawdown (USD)"       value={form.maxDrawdownAmount}  onChange={(v) => set('maxDrawdownAmount', v)}  disabled={!canEdit || submitting} />
            </div>

            {/* CRO-only: credit memo PDF that lenders see on the facility
                detail page. Optional, but strongly recommended for first
                facilities so lenders have underwriting context. */}
            {canEdit && (
              <CreditMemoUploader facility={facility} />
            )}

            {errs.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-3 text-xs text-red-800">
                {errs.map((e, i) => <div key={i}>• {e}</div>)}
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => setRejectMode(true)}
                disabled={submitting}
                className="px-4 py-2 border border-red-300 text-red-700 rounded-lg hover:bg-red-50 text-sm"
              >
                Reject
              </button>
              <div className="flex-1" />
              <button
                onClick={onCancel}
                disabled={submitting}
                className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={() => onApprove(canEdit ? form : {})}
                disabled={submitting || errs.length > 0}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded-lg text-sm flex items-center gap-2"
              >
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                Approve {role === 'CRO' ? '& Lock Terms' : `→ ${role === 'KAM' ? 'CAD' : 'CRO'}`}
              </button>
            </div>
          </>
        ) : (
          <div>
            <h3 className="text-sm font-semibold text-slate-700 mb-2">Reject reason</h3>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
              placeholder="Explain why this facility request is being declined…"
              disabled={submitting}
            />
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => setRejectMode(false)}
                disabled={submitting}
                className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 text-sm"
              >
                Back
              </button>
              <div className="flex-1" />
              <button
                onClick={() => onReject(rejectReason)}
                disabled={submitting || !rejectReason.trim()}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-lg text-sm flex items-center gap-2"
              >
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                Confirm Reject
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const Row = ({ label, value, mono }) => (
  <div className="flex justify-between gap-3">
    <span className="text-xs text-slate-500 flex-shrink-0">{label}</span>
    <span className={`text-right break-all ${mono ? 'font-mono text-xs' : 'text-sm'} text-slate-900`}>{value}</span>
  </div>
);

const NumField = ({ label, value, onChange, disabled }) => (
  <div>
    <label className="text-xs text-slate-600 block mb-1">{label}</label>
    <input
      type="number"
      step="any"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono disabled:bg-slate-100"
    />
  </div>
);

// CRO-side credit memo uploader. Shows current memo (if any) with a
// view link, and lets the CRO replace it. Reads as base64 so we can use
// the existing /facility/:id/credit-memo endpoint and its uploadBase64Attachment
// pipeline (Azure in prod, /public/<container> in dev).
const CreditMemoUploader = ({ facility }) => {
  const [current, setCurrent] = useState(facility.creditMemo || null);
  const [busy, setBusy] = useState(false);

  const handleFile = async (file) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error('Credit memo must be ≤ 10 MB');
      return;
    }
    setBusy(true);
    try {
      const base64Data = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload  = () => resolve(String(r.result).split(',')[1]); // strip data URL prefix
        r.onerror = () => reject(r.error);
        r.readAsDataURL(file);
      });
      const { data } = await api().post(`/facility/${facility._id}/credit-memo`, {
        fileName: file.name,
        mimeType: file.type || 'application/pdf',
        base64Data,
      });
      setCurrent(data.creditMemo);
      toast.success('Credit memo uploaded');
    } catch (e) {
      toast.error(e.response?.data?.message || e.message);
    } finally { setBusy(false); }
  };

  return (
    <div className="border border-slate-200 rounded-lg p-3 mb-4 bg-slate-50">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-slate-700">
          <FileText className="w-4 h-4 text-slate-500" />
          <span className="font-medium">Credit Memo</span>
          {current ? (
            <a
              href={current.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-600 hover:underline inline-flex items-center gap-1 text-xs"
            >
              {current.fileName} <ExternalLink className="w-3 h-3" />
            </a>
          ) : (
            <span className="text-xs text-slate-500">— not uploaded</span>
          )}
        </div>
        <label className="px-3 py-1.5 border border-slate-300 rounded-md text-xs font-medium text-slate-700 hover:bg-white cursor-pointer inline-flex items-center gap-1.5">
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
          {current ? 'Replace' : 'Upload PDF'}
          <input
            type="file"
            accept="application/pdf,image/*"
            className="hidden"
            disabled={busy}
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
        </label>
      </div>
      <div className="text-[10px] text-slate-500 mt-1.5">
        Lenders will see this on the facility detail page before depositing. PDF, ≤ 10 MB.
      </div>
    </div>
  );
};

export default FacilityQueue;
