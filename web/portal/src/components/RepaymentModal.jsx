import { useEffect, useState } from 'react';
import { X, DollarSign, Calendar, TrendingUp, AlertCircle, CheckCircle } from 'lucide-react';
import { pspAPI } from '../services/api';


const RepaymentModal = ({ isOpen, onClose, financing, onRepaymentSuccess }) => {
  console.log(financing);
  const [loading, setLoading] = useState(false);
  const [quote, setQuote] = useState(null);
  const [error, setError] = useState(null);
  const [step, setStep] = useState('quote'); // 'quote' | 'processing' | 'complete'
  const [repayAmount, setRepayAmount] = useState(''); // Principal to repay




  const loadQuote = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await pspAPI.getRepaymentQuote(financing._id);
      setQuote(response.data);
      setRepayAmount(response.data.principal.toString()); // Default to full principal
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load repayment quote');
    } finally {
      setLoading(false);
    }
  };

  const handleProcessRepayment = async () => {
    try {
      setLoading(true);
      setError(null);
      setStep('processing');

      console.log('[Repayment Modal] Requesting repayment for:', financing._id);

      // Dynamic interest calculation for the specific principal portion being repaid
      const principalToRepayNum = parseFloat(repayAmount) || 0;
      const dynamicInterest = (principalToRepayNum * (quote.utilizedBips || 0) * (quote.interestDays || 0)) / 10000;
      const roundedInterest = Math.round(dynamicInterest * 100) / 100;

      // Simple API call to mark as repaid (no SC call from frontend)
      const response = await pspAPI.requestRepayment({
        requestId: financing._id,
        principalAmount: principalToRepayNum,
        actualInterestPaid: roundedInterest
      });

      console.log('[Repayment Modal] Backend updated:', response.data);

      setStep('complete');

      setTimeout(() => {
        onRepaymentSuccess(response.data);
        handleClose();
      }, 2000);
    } catch (err) {
      console.error('[Repayment Modal] Error:', err);
      let errorMessage = 'Failed to submit repayment request';

      if (err.response?.data?.message) {
        errorMessage = err.response.data.message;
      } else if (err.message) {
        errorMessage = err.message;
      }

      setError(errorMessage);
      setStep('quote');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setStep('quote');
    setQuote(null);
    setError(null);
    onClose();
  };

  const formatCurrency = (value) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2, // Ensure 2 decimal places for accuracy
    }).format(value || 0);
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  // Load repayment quote when modal opens
  useEffect(() => {
    if (isOpen && financing._id) {
      loadQuote();
    }
  }, [isOpen, financing]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-md w-full shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold">Repay Financing</h2>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            disabled={loading && step === 'processing'}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6">
          {/* Quote Step */}
          {step === 'quote' && quote && (
            <>
              <div className="space-y-4 mb-6">
                {/* Order Reference */}
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <span className="text-sm text-gray-600">Order Reference</span>
                  <span className="font-mono text-sm font-semibold">{quote.orderReference}</span>
                </div>

                {/* Principal Amount Input */}
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Principal to Repay
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <DollarSign className="w-4 h-4 text-gray-400" />
                    </div>
                    <input
                      type="number"
                      value={repayAmount}
                      onChange={(e) => setRepayAmount(e.target.value)}
                      max={quote.principal}
                      min="0"
                      step="0.01"
                      className="block w-full pl-10 pr-12 py-3 border border-gray-300 rounded-lg text-lg font-bold focus:ring-brand-purple focus:border-brand-purple"
                      placeholder="0.00"
                    />
                    <div className="absolute inset-y-0 right-0 pr-3 flex items-center">
                      <button 
                        onClick={() => setRepayAmount(quote.principal.toString())}
                        className="text-xs font-medium text-brand-purple hover:underline"
                      >
                        Max
                      </button>
                    </div>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-gray-500">Current Outstanding: {formatCurrency(quote.principal)}</span>
                    <span className="text-gray-500">Remaining: {formatCurrency(Math.max(0, quote.principal - (parseFloat(repayAmount) || 0)))}</span>
                  </div>
                </div>

                {/* Interest Details - Dynamic Calculation */}
                {(() => {
                  const principalToRepayNum = parseFloat(repayAmount) || 0;
                  const dynamicInterest = (principalToRepayNum * (quote.utilizedBips || 0) * (quote.interestDays || 0)) / 10000;
                  const roundedInterest = Math.round(dynamicInterest * 100) / 100;
                  const totalWithInterest = principalToRepayNum + roundedInterest + quote.penaltyAmount;

                  return (
                    <>
                      <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg">
                        <div>
                          <span className="text-sm text-gray-600 block" title="Accrued markup is calculated based on the full due period, not the elapsed days. Early repayment will still incur the total markup for the entire agreed tenure."> Markup (For this repayment)</span>
                          <span className="text-xs text-gray-500">
                            {quote.interestDays} days @ {quote.utilizedBips} bps/day
                          </span>
                        </div>
                        <span className="text-lg font-semibold text-blue-600 transition-all duration-200">
                          {formatCurrency(roundedInterest)}
                        </span>
                      </div>

                      {/* Penalty Applied */}
                      {quote.penaltyAmount > 0 && (
                        <div className="flex items-center justify-between p-3 bg-red-50 rounded-lg border border-red-100">
                          <div>
                            <span className="text-sm text-red-700 font-semibold block">Late Payment Penalty</span>
                            <span className="text-xs text-red-600">
                              Full penalty applied for late payment
                            </span>
                          </div>
                          <span className="text-lg font-bold text-red-700">
                            {formatCurrency(quote.penaltyAmount)}
                          </span>
                        </div>
                      )}

                      {/* Note about Maintenance Fees */}
                      <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                        <div className="flex items-start gap-2">
                          <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                          <div>
                            <p className="text-xs text-amber-800 font-medium">Credit Line Maintenance Fees</p>
                            <p className="text-xs text-amber-700 mt-1">
                              Maintenance fees are billed separately on a weekly basis. Check the "Credit Line Maintenance" section on your dashboard.
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Total Due */}
                      <div className="flex items-center justify-between p-4 bg-gradient-to-r from-brand-purple to-brand-magenta rounded-lg text-white">
                        <div>
                          <span className="text-sm text-white/80 block">Total Payment (Settlement)</span>
                          <span className="text-xs text-white/60">
                            Repay Amount + Markup {quote.penaltyAmount > 0 ? '+ Penalty' : ''}
                          </span>
                        </div>
                        <span className="text-2xl font-bold transition-all duration-200 text-right">
                          {formatCurrency(totalWithInterest)}
                        </span>
                      </div>
                    </>
                  );
                })()}
              </div>

               {/* Info Box - Updated for On-Chain Guidance */}
               {/* <div className="flex items-start gap-3 p-4 bg-indigo-50 border border-indigo-200 rounded-lg mb-6">
                 <AlertCircle className="w-5 h-5 text-indigo-600 flex-shrink-0 mt-0.5" />
                 <div className="text-sm text-indigo-800">
                   <p className="font-medium mb-1">On-Chain Vault Payment Required:</p>
                   <p className="text-xs leading-relaxed">
                     To complete this repayment, send the <strong>Total Payment</strong> amount in USD-DF to your credit line vault:
                     <br />
                     <code className="block mt-1 p-1 bg-white/50 rounded break-all font-mono text-[10px] border border-indigo-100">
                       {quote.poolAddress}
                     </code>
                     <br />
                     After sending the transaction, click <strong>"Notify for Confirmation"</strong> below. Our team will verify the payment and restore your credit line.
                   </p>
                 </div>
               </div> */}

              {error && (
                <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg mb-4">
                  <AlertCircle className="w-5 h-5 text-red-600" />
                  <span className="text-sm text-red-800">{error}</span>
                </div>
              )}

              <button
                onClick={handleProcessRepayment}
                disabled={loading}
                className="btn-brand w-full flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-5 h-5" />
                    Notify for Confirmation
                  </>
                )}
              </button>
            </>
          )}

          {/* Processing Step */}
          {step === 'processing' && (
            <div className="text-center py-8">
              <div className="w-16 h-16 border-4 border-brand-purple/30 border-t-brand-purple rounded-full animate-spin mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">Processing Repayment</h3>
              <p className="text-gray-600 text-sm">
                Updating credit line and creating repayment record...
              </p>
            </div>
          )}

          {/* Complete Step */}
          {step === 'complete' && (
            <div className="text-center py-8">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-10 h-10 text-green-600" />
              </div>
              <h3 className="text-lg font-semibold mb-2 text-green-600">Repayment Successful!</h3>
              <p className="text-gray-600 text-sm mb-4">
                Your credit line has been restored.
              </p>
              <div className="p-3 bg-green-50 rounded-lg">
                <p className="text-sm text-green-800">
                  <span className="font-semibold">{formatCurrency(quote.principal)}</span> added back to available credit
                </p>
              </div>
            </div>
          )}

          {/* Loading Quote */}
          {loading && !quote && step === 'quote' && (
            <div className="text-center py-8">
              <div className="w-12 h-12 border-3 border-gray-300 border-t-brand-purple rounded-full animate-spin mx-auto mb-3" />
              <p className="text-gray-600">Loading repayment quote...</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default RepaymentModal;
