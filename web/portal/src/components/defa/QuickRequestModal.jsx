import { useEffect, useState } from 'react';
import { X, Loader2, Zap, ShoppingCart, ArrowLeft, Check, FileText } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../../services/evm';

const fmtUsd = (n) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(Number(n) || 0);

/**
 * Borrower "Request Financing" flow.
 *
 * Two steps:
 *   1. Pick an external order from the seeded orderbook. Customer name and
 *      invoice details give the demo a real-feel "I'm financing THIS
 *      receivable" story. The orderbook is optional — if it is unavailable
 *      the borrower can still draw against available liquidity.
 *   2. Set the amount and tenor, then submit. The server signs the drawdown
 *      as AGENT2 and USDC moves straight to the borrower's authorised
 *      receiver wallet, so there is no wallet popup on the borrower's side.
 *
 * The order amounts are six and seven figures, while a testnet pool holds
 * whatever a lender actually deposited, so the amount is editable and capped
 * at the pool's availableToDd — otherwise every drawdown reverts for exceeding
 * liquidity.
 */
const QuickRequestModal = ({ onClose, onSuccess, pool, facilityLabel }) => {
  const [step, setStep] = useState('pick'); // 'pick' | 'confirm'
  const [orders, setOrders] = useState(null);
  const [picked, setPicked] = useState(null);
  const [tenor, setTenor] = useState('5');
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [poolState, setPoolState] = useState(null);

  // Load orderbook + pool rates in parallel.
  useEffect(() => {
    let cancelled = false;
    api().get('/psp/order-book')
      .then(({ data }) => { if (!cancelled) setOrders(data || []); })
      .catch(() => { if (!cancelled) setOrders([]); });
    if (pool) {
      api().get(`/pool/pool/${pool}/state`)
        .then(({ data }) => { if (!cancelled) setPoolState(data); })
        .catch(() => {});
    }
    return () => { cancelled = true; };
  }, [pool]);

  // availableToDd is base units (USDC has 6 decimals).
  const availableUsdc = Number(poolState?.availableToDd || 0) / 1e6;
  const amtNum = Number(amount) || 0;
  const overLiquidity = amtNum > availableUsdc;
  const tenorNum = parseInt(tenor, 10) || 0;
  const utilBps = Number(poolState?.utilizationRateBps || 0);
  const projDailyFee = amtNum > 0 && utilBps > 0 ? (amtNum * utilBps) / 10000 : 0;
  const projTotalFee = projDailyFee * tenorNum;
  const projTotalRepay = amtNum + projTotalFee;

  const handleSubmit = async () => {
    if (!pool) { toast.error('No pool on this facility yet'); return; }
    if (!picked) { toast.error('Pick an order first'); return; }
    if (!(amtNum > 0)) { toast.error('Enter an amount to draw'); return; }
    if (overLiquidity) { toast.error(`Only ${fmtUsd(availableUsdc)} is available to draw`); return; }
    if (!Number.isInteger(tenorNum) || tenorNum <= 0) { toast.error('Tenor must be a positive integer'); return; }
    setSubmitting(true);
    try {
      const { data } = await api().post('/pool/psp/exec/drawdown', {
        // The borrower may hold several facilities, so the server resolves
        // which one from the pool address rather than guessing.
        pool,
        // Base units — the API reads a bare integer as already scaled.
        amount: BigInt(Math.round(amtNum * 1e6)).toString(),
        tenorDays: tenorNum,
        drawdownId: picked.orderReference,
      });
      toast.success(`Drawdown executed — tx ${String(data.txHash).slice(0, 10)}…`);
      onSuccess?.(data);
    } catch (e) {
      toast.error(e.response?.data?.message || e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
      <div className="defa-card max-w-xl w-full p-6 max-h-[90vh] overflow-y-auto"
           style={{ background: 'linear-gradient(135deg, rgba(28,93,214,0.95), rgba(75,160,255,0.85))' }}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            {step === 'confirm' && (
              <button
                onClick={() => setStep('pick')}
                disabled={submitting}
                className="text-white/70 hover:text-white"
                title="Back"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <h2 className="text-lg font-semibold flex items-center gap-2">
              {step === 'pick'
                ? <><ShoppingCart className="w-5 h-5" /> Pick an Order</>
                : <><Zap className="w-5 h-5" /> Confirm Drawdown</>}
            </h2>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white" disabled={submitting}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-xs text-white/80 mb-4">
          {facilityLabel
            ? <>Drawing from <strong>{facilityLabel}</strong>. Pick an external customer order to finance against.</>
            : <>Pick an external customer order to finance against.</>}
        </p>

        {step === 'pick' && (
          <>
            {orders === null ? (
              <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin" /></div>
            ) : orders.length === 0 ? (
              // The seeded external orderbook is a demo convenience, not a
              // precondition for borrowing. Without this the picker dead-ends
              // and the borrower cannot draw against a perfectly good facility
              // just because no order happens to be listed.
              <div className="space-y-3">
                <div className="text-sm text-white/70">
                  No open customer orders are listed right now. You can still draw
                  against the facility's available liquidity.
                </div>
                <button
                  onClick={() =>
                    setPicked({
                      id: 'liquidity',
                      orderReference: `DD-${Date.now()}`,
                      amount: availableUsdc,
                      settlementDate: null,
                    })
                  }
                  disabled={submitting || !(availableUsdc > 0)}
                  className={`w-full text-left rounded-lg border p-3 transition-colors ${
                    picked?.id === 'liquidity'
                      ? 'border-white bg-white/15'
                      : 'border-white/15 bg-white/5 hover:bg-white/10'
                  }`}
                >
                  <div className="text-xs uppercase tracking-widest text-white/60">
                    Draw against liquidity
                  </div>
                  <div className="text-base font-bold tabular-nums mt-1">
                    up to {fmtUsd(availableUsdc)}
                  </div>
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {orders.map((o) => {
                  const isPicked = picked?.id === o.id;
                  return (
                    <button
                      key={o.id}
                      onClick={() => setPicked(o)}
                      disabled={submitting}
                      className={`w-full text-left rounded-lg border p-3 transition-colors ${
                        isPicked
                          ? 'border-white bg-white/15'
                          : 'border-white/15 bg-white/5 hover:bg-white/10'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold truncate font-mono">
                            {o.orderReference}
                          </div>
                          <div className="text-[11px] text-white/60 truncate">
                            settles {new Date(o.settlementDate).toLocaleDateString()}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-base font-bold tabular-nums">{fmtUsd(o.amount)}</div>
                          {isPicked && (
                            <div className="text-[10px] inline-flex items-center gap-1 text-emerald-200">
                              <Check className="w-3 h-3" /> Selected
                            </div>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="flex gap-2 mt-5">
              <button onClick={onClose} disabled={submitting} className="defa-btn-ghost flex-1 justify-center">
                Cancel
              </button>
              <button
                onClick={() => {
                  // Seed with whatever the pool can actually lend, not the
                  // order's headline figure.
                  const suggested = Math.min(Number(picked?.amount) || 0, availableUsdc);
                  setAmount(String(suggested > 0 ? suggested : availableUsdc));
                  setStep('confirm');
                }}
                disabled={!picked}
                className="defa-btn-primary flex-1 justify-center"
              >
                <Zap className="w-4 h-4" /> Continue
              </button>
            </div>
          </>
        )}

        {step === 'confirm' && picked && (
          <>
            <div className="defa-card p-3 mb-4" style={{ background: 'rgba(255,255,255,0.10)' }}>
              <div className="flex items-center gap-2 mb-2">
                <FileText className="w-4 h-4" />
                <div className="font-semibold text-sm font-mono">{picked.orderReference}</div>
              </div>
              {picked.settlementDate && (
                <div className="text-[11px] text-white/70 leading-relaxed">
                  Settles {new Date(picked.settlementDate).toLocaleDateString()}
                </div>
              )}
              <div className="text-2xl font-bold tabular-nums mt-2">{fmtUsd(picked.amount)}</div>
            </div>

            <Field label="Amount to draw (USDC)">
              <input
                type="number"
                min="0"
                step="any"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="defa-input"
                disabled={submitting}
              />
              <div className="flex items-center justify-between mt-1 text-[11px]">
                <span className={overLiquidity ? 'text-red-200' : 'text-white/60'}>
                  {fmtUsd(availableUsdc)} available in the pool
                </span>
                <button
                  type="button"
                  onClick={() => setAmount(String(availableUsdc))}
                  className="text-white/80 underline"
                  disabled={submitting || !(availableUsdc > 0)}
                >
                  Max
                </button>
              </div>
            </Field>

            <Field label="Tenor (days)">
              <input
                type="number"
                min="1"
                value={tenor}
                onChange={(e) => setTenor(e.target.value)}
                className="defa-input"
                disabled={submitting}
              />
            </Field>

            {poolState && tenorNum > 0 && (
              <div className="defa-card p-3 text-xs leading-relaxed mt-3" style={{ background: 'rgba(255,255,255,0.10)' }}>
                <div className="defa-label mb-1.5">Projected Cost (on-time repay)</div>
                <div className="space-y-0.5">
                  <div className="flex justify-between">
                    <span className="text-white/70">Util fee / day</span>
                    <span className="font-mono">{fmtUsd(projDailyFee)} ({utilBps}bps/d)</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/70">Total fee over {tenorNum}d</span>
                    <span className="font-mono">{fmtUsd(projTotalFee)}</span>
                  </div>
                  <div className="border-t border-white/15 pt-1 mt-1 flex justify-between font-semibold">
                    <span>Total repay</span>
                    <span className="font-mono">{fmtUsd(projTotalRepay)}</span>
                  </div>
                </div>
              </div>
            )}

            <div className="flex gap-2 mt-5">
              <button onClick={() => setStep('pick')} disabled={submitting} className="defa-btn-ghost flex-1 justify-center">
                Back
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting || overLiquidity || !(amtNum > 0)}
                className="defa-btn-primary flex-1 justify-center"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                Execute Drawdown
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

const Field = ({ label, children }) => (
  <div>
    <label className="defa-label block mb-1.5">{label}</label>
    {children}
  </div>
);

export default QuickRequestModal;
