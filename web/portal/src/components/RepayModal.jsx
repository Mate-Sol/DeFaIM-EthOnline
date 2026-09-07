import { useState } from 'react';
import { X, ArrowUpRight, Wallet, AlertCircle, Loader2, CheckCircle, Copy, Check } from 'lucide-react';

const RepayModal = ({ isOpen, onClose, usedAmount, onSubmit }) => {
  const [amount, setAmount] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [copied, setCopied] = useState(false);

  // Mock vault address
  const vaultAddress = '0x742d35Cc6634C0532925a3b844Bc9e7595f8aC0C';

  if (!isOpen) return null;

  const formatCurrency = (value) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
    }).format(value);
  };

  const copyAddress = () => {
    navigator.clipboard.writeText(vaultAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    
    const repayAmount = parseFloat(amount);
    
    if (!repayAmount || repayAmount <= 0) {
      setError('Please enter a valid amount');
      return;
    }
    
    if (repayAmount > usedAmount) {
      setError(`Amount exceeds outstanding balance of ${formatCurrency(usedAmount)}`);
      return;
    }

    setIsSubmitting(true);
    
    try {
      await onSubmit({ amount: repayAmount });
      setSuccess(true);
    } catch (err) {
      setError(err.message || 'Failed to process repayment');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setAmount('');
    setError('');
    setSuccess(false);
    onClose();
  };

  if (success) {
    return (
      <div className="modal-overlay" onClick={handleClose}>
        <div className="modal-content p-8 text-center" onClick={e => e.stopPropagation()}>
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-8 h-8 text-green-600" />
          </div>
          <h2 className="text-xl font-bold mb-2">Repayment Initiated</h2>
          <p className="text-gray-600 mb-6">
            Your repayment of {formatCurrency(parseFloat(amount))} is being processed. 
            Your credit limit will be restored once the transaction is confirmed on-chain.
          </p>
          <button onClick={handleClose} className="btn-brand">
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-500 rounded-lg flex items-center justify-center">
              <ArrowUpRight className="w-5 h-5 text-white" />
            </div>
            <h2 className="text-xl font-semibold">Repay Credit</h2>
          </div>
          <button onClick={handleClose} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Outstanding Balance */}
          <div className="bg-amber-50 rounded-lg p-4">
            <div className="flex justify-between items-center">
              <span className="text-amber-800">Outstanding Balance</span>
              <span className="text-2xl font-bold text-amber-800">{formatCurrency(usedAmount)}</span>
            </div>
          </div>

          {/* Vault Address */}
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <Wallet className="w-5 h-5 text-brand-purple" />
              <span className="font-medium">Repayment Vault Address</span>
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-sm bg-white px-3 py-2 rounded border border-gray-200 font-mono truncate">
                {vaultAddress}
              </code>
              <button 
                type="button"
                onClick={copyAddress}
                className="p-2 hover:bg-white rounded-lg transition-colors"
                title="Copy address"
              >
                {copied ? <Check className="w-5 h-5 text-green-500" /> : <Copy className="w-5 h-5 text-gray-400" />}
              </button>
            </div>
          </div>

          {/* Amount Input */}
          <div>
            <label className="input-label">Repayment Amount *</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="input-field pl-8"
                placeholder="Enter amount"
                max={usedAmount}
                required
              />
            </div>
            <div className="flex justify-between mt-2">
              <button 
                type="button"
                onClick={() => setAmount(usedAmount.toString())}
                className="text-xs text-brand-purple hover:underline"
              >
                Pay Full Balance
              </button>
              <span className="text-xs text-gray-500">
                Includes principal + accrued markup
              </span>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3 text-red-700">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <span className="text-sm">{error}</span>
            </div>
          )}

          {/* Info */}
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-sm text-blue-800">
              <strong>Revolving Credit:</strong> Once your repayment is settled, your available 
              credit limit will automatically increase by the repaid amount.
            </p>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-4">
            <button type="button" onClick={handleClose} className="btn-secondary flex-1">
              Cancel
            </button>
            <button 
              type="submit" 
              disabled={isSubmitting || !amount}
              className="btn-brand flex-1 flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Processing...
                </>
              ) : (
                'Confirm Repayment'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default RepayModal;
