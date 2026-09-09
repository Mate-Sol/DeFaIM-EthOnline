import { useState } from 'react';
import { X, Loader2, Building2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../../services/evm';

// PSP-side form for requesting a new facility (creates a Facility doc
// in REQUESTED status). First request gets full KAM→CAD→CRO review;
// subsequent ones go straight to CRO.
//
// The borrower only fills in what they actually negotiate: a label,
// the credit line they need, and the tenor. Risk-pricing fields
// (util / commit / penalty rates, grace / penalty days, max drawdown,
// day length) are all set by the CRO during review and locked on-chain
// by ONCHAIN_ADMIN at pool init.
const RequestFacilityModal = ({ onClose, onSuccess, isFirstFacility }) => {
  const [form, setForm] = useState({
    label: '',
    // Deliberately blank rather than pre-filled. A default credit line gets
    // submitted unchanged, and on testnet the borrower's own lenders have to
    // fund it — a six-figure facility can never reach its soft cap and stalls
    // in Funding forever. Make the borrower state the number.
    creditLine: '',
    tenorDays: '30',
  });
  const [submitting, setSubmitting] = useState(false);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const num = (k) => Number(form[k]);

  const errs = [];
  if (!(num('creditLine') > 0)) errs.push('Credit line must be > 0');
  if (!(num('tenorDays') > 0)) errs.push('Tenor must be > 0');

  const submit = async () => {
    if (errs.length) return;
    setSubmitting(true);
    try {
      const body = {
        label: form.label || undefined,
        requestedTerms: {
          creditLine: num('creditLine'),
          tenorDays:  num('tenorDays'),
          // Rates / grace / penalty / max draw / day length intentionally
          // omitted — CRO fills them during review.
        },
      };
      const { data } = await api().post('/facility/request', body);
      toast.success(`Facility #${data.onChainFacilityId} requested · waiting on ${data.status.replace('_', ' ').toLowerCase()}`);
      onSuccess?.(data);
    } catch (e) {
      toast.error(e.response?.data?.message || e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
      <div className="defa-card max-w-md w-full p-6 max-h-[90vh] overflow-y-auto"
           style={{ background: 'linear-gradient(135deg, rgba(28,93,214,0.95), rgba(75,160,255,0.85))' }}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Building2 className="w-5 h-5" /> Request New Facility
          </h2>
          <button onClick={onClose} className="text-white/70 hover:text-white" disabled={submitting}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-xs text-white/80 mb-5">
          {isFirstFacility
            ? <>Your first facility — admin team will run KAM, CAD and CRO review on it. Subsequent facilities only need CRO sign-off.</>
            : <>You already have a CRO-approved facility, so this one goes straight to CRO for review.</>}
          {' '}Pricing terms (rates, grace, penalty window) are set by the CRO and locked on-chain by the on-chain admin.
        </p>

        <div className="space-y-4">
          <Field label="Label (optional)">
            <input
              type="text"
              value={form.label}
              onChange={(e) => set('label', e.target.value)}
              placeholder='e.g. "Q3 working capital"'
              className="defa-input"
              disabled={submitting}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Credit line (USD)">
              <input type="number" min="0" step="any" value={form.creditLine}
                     placeholder="e.g. 250000"
                     onChange={(e) => set('creditLine', e.target.value)} className="defa-input" disabled={submitting} />
            </Field>
            <Field label="Tenor (days)">
              <input type="number" min="1" value={form.tenorDays}
                     onChange={(e) => set('tenorDays', e.target.value)} className="defa-input" disabled={submitting} />
            </Field>
          </div>
        </div>

        {errs.length > 0 && (
          <div className="bg-red-500/20 border border-red-300/40 rounded-lg p-3 mt-4 text-xs text-red-100">
            {errs.map((e, i) => <div key={i}>• {e}</div>)}
          </div>
        )}

        <div className="flex gap-2 mt-5">
          <button onClick={onClose} disabled={submitting} className="defa-btn-ghost flex-1 justify-center">Cancel</button>
          <button onClick={submit} disabled={submitting || errs.length > 0} className="defa-btn-primary flex-1 justify-center">
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Building2 className="w-4 h-4" />}
            Submit Request
          </button>
        </div>
      </div>
    </div>
  );
};

const Field = ({ label, hint, children }) => (
  <div>
    <label className="defa-label block mb-1.5">{label}</label>
    {children}
    {hint && <div className="text-[10px] text-white/60 mt-1">{hint}</div>}
  </div>
);

export default RequestFacilityModal;
