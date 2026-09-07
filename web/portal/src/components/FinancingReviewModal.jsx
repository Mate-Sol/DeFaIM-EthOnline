import { useState, useEffect } from 'react';
import {
  X, DollarSign, FileText, AlertCircle,
  Loader2, CheckCircle, ShieldCheck,
  Layers, CreditCard, CheckCircle2, XCircle, Info
} from 'lucide-react';
import { adminAPI } from '../services/api';

const FinancingReviewModal = ({ isOpen, onClose, request, onConfirm }) => {
  const [loading, setLoading] = useState(true);
  const [validating, setValidating] = useState(false);
  const [validations, setValidations] = useState(null);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [txHash, setTxHash] = useState('');
  const txHashTrimmed = txHash.trim();
  const txHashLooksValid = /^0x[0-9a-fA-F]+$/.test(txHashTrimmed);


  useEffect(() => {
    if (isOpen && request?._id) {
      fetchValidations();
    }
  }, [isOpen, request]);

  const fetchValidations = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await adminAPI.validateFinancing(request._id);
      setValidations(response.data);
    } catch (err) {
      console.error('Failed to fetch validations:', err);
      setError('Failed to perform automated validation checks.');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    try {
      setConfirming(true);
      setError('');
      // Pass through the on-chain Safe transaction hash if the CAD pasted
      // one. Optional — leaving it blank is allowed and the SAFE-Observer
      // will fall back to its heuristic match (amount + timing).

      const body = txHashLooksValid ? { txHash: txHashTrimmed } : {};
      await adminAPI.confirmFinancing(request._id, body);
      onConfirm(); // Callback to refresh dashboard
      onClose();
    } catch (err) {
      console.error('Confirmation failed:', err);
      setError(err.response?.data?.message || 'Failed to confirm disbursement.');
    } finally {
      setConfirming(false);
    }
  };

  if (!isOpen) return null;

  const formatCurrency = (value) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
    }).format(value || 0);
  };

  const ValidationItem = ({ label, passed, icon: Icon }) => (
    <div className="flex items-center justify-between p-3 bg-white border border-gray-100 rounded-lg shadow-sm font-outfit">
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${passed ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
          <Icon className="w-5 h-5" />
        </div>
        <span className="font-medium text-gray-700">{label}</span>
      </div>
      {passed ? (
        <CheckCircle2 className="w-5 h-5 text-green-500" />
      ) : (
        <XCircle className="w-5 h-5 text-red-500" />
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in transition-all">
      <div
        className="bg-white rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-gray-50 to-white">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-brand-gradient rounded-xl flex items-center justify-center shadow-lg shadow-brand-purple/20 rotate-3">
              <ShieldCheck className="w-6 h-6 text-white -rotate-3" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900 font-outfit">Financing Request Review</h2>
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Manual CAD Validation</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors text-gray-400 hover:text-gray-600"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[70vh] custom-scrollbar">
          {loading ? (
            <div className="py-12 text-center">
              <Loader2 className="w-10 h-10 animate-spin text-brand-purple mx-auto mb-4" />
              <p className="text-gray-500 font-medium">Performing automated checks...</p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Summary Stats */}
              <div className="grid grid-cols-3 gap-3">
                <div className="p-4 bg-brand-purple/5 rounded-2xl border border-brand-purple/10">
                  <span className="text-[10px] uppercase font-bold text-brand-purple tracking-widest block mb-1">Requested Amount</span>
                  <span className="text-xl font-black text-gray-900 font-outfit">{formatCurrency(request.amount)}</span>
                </div>
                <div className="p-4 bg-blue-50 rounded-2xl border border-blue-100">
                  <span className="text-[10px] uppercase font-bold text-blue-600 tracking-widest block mb-1">Available Credit</span>
                  <span className="text-xl font-black text-gray-900 font-outfit">{formatCurrency(validations?.details?.availableCredit)}</span>
                </div>
                <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100">
                  <span className="text-[10px] uppercase font-bold text-amber-600 tracking-widest block mb-1">Requested Tenor</span>
                  <span className="text-xl font-black text-gray-900 font-outfit">
                    {request.drawdownTenor || 30} 
                    <span className="text-[10px] font-bold text-gray-400 tracking-normal ml-1">days</span>
                  </span>
                </div>
              </div>

              {/* Validation Checklist */}
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2 mb-2 font-outfit">
                  <Layers className="w-4 h-4 text-brand-purple" />
                  Risk Assessment Checklist
                </h3>

                <ValidationItem
                  label="Approved Credit Line Exists"
                  passed={validations?.hasCreditLine}
                  icon={CreditCard}
                />
                <ValidationItem
                  label="Order Verified in OrderBook"
                  passed={validations?.orderExists}
                  icon={FileText}
                />
                <ValidationItem
                  label="Not Previously Financed"
                  passed={validations?.notAlreadyFinanced}
                  icon={ShieldCheck}
                />
                <ValidationItem
                  label="Sufficient Credit Availability"
                  passed={validations?.sufficientCredit}
                  icon={DollarSign}
                />
              </div>

              {/* PSP Info */}
              <div className="p-4 bg-gray-50 rounded-xl border border-gray-100 flex items-start gap-3">
                <Info className="w-5 h-5 text-gray-400 mt-0.5" />
                <div className="text-sm">
                  <p className="font-bold text-gray-900">{request.pspId?.companyName || 'N/A'}</p>
                  <p className="text-gray-500 font-mono text-xs mt-1">Order Ref: {request.orderReference}</p>
                </div>
              </div>

              {/* On-chain Safe tx hash — optional but enables exact match in
                  the SAFE-Observer instead of the fragile heuristic. */}
              <div className="p-4 bg-amber-50/50 rounded-xl border border-amber-100">
                <label className="block text-[10px] uppercase font-bold text-amber-700 tracking-widest mb-2">
                  On-chain Disbursement Tx Hash <span className="lowercase tracking-normal text-amber-600/70">(optional)</span>
                </label>
                <input
                  type="text"
                  value={txHash}
                  onChange={(e) => setTxHash(e.target.value)}
                  placeholder="0x… (paste from Safe transaction history)"
                  className={`w-full px-3 py-2 rounded-lg border font-mono text-xs bg-white focus:outline-none focus:ring-2 transition-all ${txHashTrimmed && !txHashLooksValid
                    ? 'border-red-300 focus:ring-red-300'
                    : 'border-amber-200 focus:ring-amber-300'
                    }`}
                />
                {txHashTrimmed && !txHashLooksValid && (
                  <p className="text-[11px] text-red-600 mt-1.5">Expected a 0x-prefixed hex string.</p>
                )}
                <p className="text-[11px] text-gray-500 mt-1.5">
                  Pastes from the Safe transaction history. If left blank, the SAFE-Observer will heuristically match by amount and timing — usually fine, but ambiguous when two drawdowns share the same amount.
                </p>
              </div>

              {error && (
                <div className="p-4 bg-red-50 border border-red-100 rounded-xl flex items-center gap-3 text-red-700 animate-pulse">
                  <AlertCircle className="w-5 h-5 flex-shrink-0" />
                  <p className="text-sm font-semibold">{error}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-gray-100 bg-gray-50/50 flex gap-4">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-4 py-3 bg-white border border-gray-200 rounded-xl font-bold text-gray-600 hover:bg-gray-50 transition-all active:scale-95 font-outfit"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading || confirming || !validations?.sufficientCredit || !validations?.orderExists}
            className={`flex-[2] px-6 py-3 rounded-xl font-black text-white shadow-xl shadow-brand-purple/20 flex items-center justify-center gap-3 transition-all active:scale-95 font-outfit ${(loading || confirming || !validations?.sufficientCredit || !validations?.orderExists)
              ? 'bg-gray-300 cursor-not-allowed'
              : 'bg-brand-gradient hover:opacity-90'
              }`}
          >
            {confirming ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Confirming...
              </>
            ) : (
              <>
                <CheckCircle className="w-5 h-5" />
                Confirm Disbursement
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default FinancingReviewModal;
