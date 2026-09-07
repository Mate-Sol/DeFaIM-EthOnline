import { useMemo, useState } from 'react';
import { X, Loader2, Zap } from 'lucide-react';

/**
 * Pre-sign confirmation + override form for `initialize_pool`. Wallets like
 * Phantom only show a hex blob for Anchor instruction data, so admin can't
 * verify what they're authorizing from the wallet UI alone. This modal:
 *   1. Lays out every param the server will encode into the tx, derived
 *      from the PSPProfile's CRO-approved values.
 *   2. Lets admin EDIT any param before signing — the form values are
 *      passed to the server as `overrides` and persisted on the profile.
 *
 * On Confirm, the parent calls buildSignRelay with the form values →
 * server validates against on-chain require!() rules → builds tx →
 * wallet popup → relay submit.
 */

const fmtUsd = (n) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(n) || 0);

const PoolInitConfirmModal = ({ profile, onCancel, onConfirm, submitting }) => {
  // `profile` is a Facility doc (CRO-approved, awaiting initialize_pool sign).
  const t = profile.approvedTerms || {};
  const initial = useMemo(() => ({
    poolName:             String(profile.companyName || profile.label || 'PSP').slice(0, 32),
    softCapUsd:           Number(t.softCap          ?? t.creditLine ?? 0),
    hardCapUsd:           Number(t.hardCap          ?? t.creditLine ?? 0),
    maxDrawdownUsd:       Number(t.maxDrawdownAmount ?? t.creditLine ?? 0),
    facilityTenorDays:    Number(t.tenorDays           ?? 30),
    utilizationRateBps:   Number(t.utilizationRateBps  ?? 5),
    commitmentRateBps:    Number(t.commitmentRateBps   ?? 1),
    penaltyRateBps:       Number(t.penaltyRateBps      ?? 50),
    graceDays:            Number(t.graceDays           ?? 1),
    penaltyDays:          Number(t.penaltyDays         ?? 30),
    protocolFeeShareBps:  1000,
    secondsPerDay:        Number(t.secondsPerDay       ?? 86400),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [profile._id]);
  const [form, setForm] = useState(initial);
  // PSP may have requested a warp-time pool. If so, default the toggle on
  // so the admin sees the field populated and can adjust before signing.
  const [testMode, setTestMode] = useState(initial.secondsPerDay !== 86400);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const num = (v) => (v === '' ? '' : Number(v));

  // Live validation mirroring server-side check (which mirrors on-chain).
  const errors = [];
  if (!String(form.poolName || '').trim()) errors.push('Pool name required');
  if (String(form.poolName || '').length > 32) errors.push('Pool name must be ≤ 32 chars');
  if (!(form.softCapUsd > 0)) errors.push('Soft cap must be > 0');
  if (!(form.hardCapUsd >= form.softCapUsd)) errors.push('Hard cap must be ≥ soft cap');
  if (!(form.maxDrawdownUsd > 0)) errors.push('Max drawdown must be > 0');
  if (!(form.maxDrawdownUsd <= form.hardCapUsd)) errors.push('Max drawdown must be ≤ hard cap');
  if (!(form.facilityTenorDays > 0)) errors.push('Tenor must be > 0 days');
  if (!(form.utilizationRateBps > 0)) errors.push('Utilization rate must be > 0 bps');
  if (form.protocolFeeShareBps < 0 || form.protocolFeeShareBps > 10000) errors.push('Protocol fee share must be 0–10000 bps');
  const effSecondsPerDay = testMode ? Number(form.secondsPerDay) : 86400;
  if (!(effSecondsPerDay >= 60 && effSecondsPerDay <= 86400)) errors.push('Day length must be 60..86400 seconds');

  const handleConfirm = () => {
    if (errors.length) return;
    onConfirm({
      poolName: String(form.poolName).trim().slice(0, 32),
      softCapUsd: Number(form.softCapUsd),
      hardCapUsd: Number(form.hardCapUsd),
      maxDrawdownUsd: Number(form.maxDrawdownUsd),
      facilityTenorDays: Number(form.facilityTenorDays),
      utilizationRateBps: Number(form.utilizationRateBps),
      commitmentRateBps: Number(form.commitmentRateBps),
      penaltyRateBps: Number(form.penaltyRateBps),
      graceDays: Number(form.graceDays),
      penaltyDays: Number(form.penaltyDays),
      protocolFeeShareBps: Number(form.protocolFeeShareBps),
      secondsPerDay: effSecondsPerDay,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-900">Confirm Pool Initialization</h2>
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-600" disabled={submitting}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-sm text-slate-600 mb-4">
          Override CRO-approved params if needed, then sign. Wallet popup only shows
          a hex blob; verify the values here.
        </p>

        {/* Identity (read-only) */}
        <div className="bg-slate-50 rounded-lg p-4 mb-4 space-y-2 text-sm">
          <ReadRow label="PSP" value={profile.companyName || profile.label || 'PSP'} mono={false} />
          <ReadRow label="PSP Wallet (immutable)" value={profile.pspWallet} />
          <ReadRow label="Future Pool PDA" value={profile.poolPda} />
          <ReadRow label="Facility ID" value={String(profile.facilityId || 1)} mono={false} />
        </div>

        {/* Pool name — admin-set, on-chain string. Shows on every facility
            list / detail in every portal. 32-char hard cap per program. */}
        <h3 className="text-sm font-semibold text-slate-700 mb-2">Pool Name</h3>
        <div className="mb-4">
          <input
            type="text"
            value={form.poolName}
            onChange={(e) => set('poolName', e.target.value.slice(0, 32))}
            disabled={submitting}
            placeholder="e.g. Acme Q3 Working Capital"
            maxLength={32}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm disabled:bg-slate-100"
          />
          <div className="text-[10px] text-slate-500 mt-1">
            {(form.poolName || '').length}/32 · shown on every portal's facility card
          </div>
        </div>

        {/* Caps & tenor */}
        <h3 className="text-sm font-semibold text-slate-700 mb-2">Caps & Tenor</h3>
        <div className="grid grid-cols-2 gap-3 mb-4">
          <NumField
            label="Soft cap (USD)"
            note="Funding closes when reached"
            value={form.softCapUsd}
            onChange={(v) => set('softCapUsd', num(v))}
            disabled={submitting}
          />
          <NumField
            label="Hard cap (USD)"
            note="Total deposits ceiling"
            value={form.hardCapUsd}
            onChange={(v) => set('hardCapUsd', num(v))}
            disabled={submitting}
          />
          <NumField
            label="Max drawdown / loan (USD)"
            note="Per-loan ceiling"
            value={form.maxDrawdownUsd}
            onChange={(v) => set('maxDrawdownUsd', num(v))}
            disabled={submitting}
          />
          <NumField
            label="Facility tenor (days)"
            value={form.facilityTenorDays}
            onChange={(v) => set('facilityTenorDays', num(v))}
            disabled={submitting}
          />
        </div>

        <h3 className="text-sm font-semibold text-slate-700 mb-2">Fees (basis points)</h3>
        <div className="grid grid-cols-2 gap-3 mb-4">
          <NumField
            label="Utilization rate (bps/day)"
            note={form.utilizationRateBps ? `${(form.utilizationRateBps / 100).toFixed(2)}% per day on drawn principal` : 'On drawn principal'}
            value={form.utilizationRateBps}
            onChange={(v) => set('utilizationRateBps', num(v))}
            disabled={submitting}
          />
          <NumField
            label="Commitment rate (bps/day)"
            note={form.commitmentRateBps ? `${(form.commitmentRateBps / 100).toFixed(2)}% per day on idle capital` : 'On idle capital, peak-during-day'}
            value={form.commitmentRateBps}
            onChange={(v) => set('commitmentRateBps', num(v))}
            disabled={submitting}
          />
          <NumField
            label="Penalty rate (bps/day)"
            note="After tenor + grace expires"
            value={form.penaltyRateBps}
            onChange={(v) => set('penaltyRateBps', num(v))}
            disabled={submitting}
          />
          <NumField
            label="Protocol fee share (bps)"
            note={`${(form.protocolFeeShareBps / 100).toFixed(2)}% of all fees → DeFa`}
            value={form.protocolFeeShareBps}
            onChange={(v) => set('protocolFeeShareBps', num(v))}
            disabled={submitting}
          />
          <NumField
            label="Grace days"
            note="At util rate, before penalty"
            value={form.graceDays}
            onChange={(v) => set('graceDays', num(v))}
            disabled={submitting}
            min={0}
            max={255}
          />
          <NumField
            label="Penalty days"
            note="At penalty rate, then draws blocked"
            value={form.penaltyDays}
            onChange={(v) => set('penaltyDays', num(v))}
            disabled={submitting}
            min={0}
            max={255}
          />
        </div>

        {/* Test mode — compresses every "day" into N seconds. Use only on
            disposable test pools; the on-chain program enforces 60..=86400. */}
        <div className="border-t border-slate-200 pt-3 mb-4">
          <label className="flex items-center gap-2 cursor-pointer select-none text-sm text-slate-700">
            <input
              type="checkbox"
              checked={testMode}
              onChange={(e) => setTestMode(e.target.checked)}
              disabled={submitting}
            />
            <span>Test mode (compressed time)</span>
          </label>
          {testMode && (
            <div className="grid grid-cols-2 gap-3 mt-3">
              <NumField
                label="Day length (seconds)"
                note="60 = 1min/day · 300 = 5min/day · 86400 = real day"
                value={form.secondsPerDay}
                onChange={(v) => set('secondsPerDay', num(v))}
                disabled={submitting}
                min={60}
                max={86400}
              />
              <div className="text-[11px] text-slate-600 leading-snug pt-5">
                A {form.facilityTenorDays}-day facility plays out in roughly{' '}
                <strong className="text-slate-900">
                  {fmtDuration(Number(form.facilityTenorDays) * Number(form.secondsPerDay))}
                </strong>
              </div>
            </div>
          )}
        </div>

        {/* Live preview of computed amounts */}
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 mb-4 text-xs text-emerald-900">
          <div>Soft cap: <strong>{fmtUsd(form.softCapUsd)}</strong> · Hard cap: <strong>{fmtUsd(form.hardCapUsd)}</strong> · Max draw: <strong>{fmtUsd(form.maxDrawdownUsd)}</strong></div>
          <div>Tenor {form.facilityTenorDays}d · Util {(form.utilizationRateBps/100).toFixed(2)}%/d · Commit {(form.commitmentRateBps/100).toFixed(2)}%/d · Penalty {(form.penaltyRateBps/100).toFixed(2)}%/d (after {form.facilityTenorDays + form.graceDays} days)</div>
          {effSecondsPerDay !== 86400 && (
            <div className="mt-1 text-amber-700">
              ⏱ Day length: <strong>{effSecondsPerDay}s</strong> (warp mode — not a real-calendar day)
            </div>
          )}
        </div>

        {errors.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-xs text-red-800">
            {errors.map((e, i) => <div key={i}>• {e}</div>)}
          </div>
        )}

        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-xs text-amber-900">
          <strong>Note:</strong> Once signed, the Pool PDA is permanently bound to the PSP wallet
          ({profile.pspWallet?.slice(0, 8)}…) and these params can't be changed on-chain.
        </div>

        <div className="flex gap-2">
          <button
            onClick={onCancel}
            disabled={submitting}
            className="flex-1 px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={submitting || errors.length > 0}
            className="flex-1 px-4 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded-lg flex items-center justify-center gap-2"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            {submitting ? 'Sign in wallet…' : 'Confirm & Sign'}
          </button>
        </div>
      </div>
    </div>
  );
};

const ReadRow = ({ label, value, mono = true }) => (
  <div className="flex items-start justify-between gap-3">
    <span className="text-xs text-slate-500 flex-shrink-0">{label}</span>
    <span className={`text-right break-all ${mono ? 'font-mono text-xs' : 'text-sm'} text-slate-900`}>
      {value || '—'}
    </span>
  </div>
);

function fmtDuration(seconds) {
  if (!seconds || seconds < 0) return '—';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const NumField = ({ label, note, value, onChange, disabled, min, max }) => (
  <div>
    <label className="text-xs text-slate-600 block mb-1">{label}</label>
    <input
      type="number"
      step="any"
      min={min}
      max={max}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono disabled:bg-slate-100"
    />
    {note && <div className="text-[11px] text-slate-400 mt-1">{note}</div>}
  </div>
);

export default PoolInitConfirmModal;
