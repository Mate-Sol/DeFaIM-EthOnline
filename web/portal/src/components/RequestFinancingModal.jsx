import { useState } from 'react';
import { X, DollarSign, FileText, AlertCircle, Loader2, CheckCircle } from 'lucide-react';
import { useEffect } from 'react';

const RequestFinancingModal = ({ isOpen, onClose, selectedOrders, orders, availableLimit, onSubmit, maxDrawdownTenor }) => {

  if (!isOpen) return null;

  const selectedOrderData = orders.filter(o => selectedOrders.includes(o._id));
  const totalSelectedAmount = selectedOrderData.reduce((sum, o) => sum + o.amount, 0);

  const [amount, setAmount] = useState('');
  const [drawdownTenor, setDrawdownTenor] = useState(30);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (isOpen && maxDrawdownTenor) {
      setDrawdownTenor(maxDrawdownTenor);
    }
  }, [isOpen, maxDrawdownTenor]);




  const formatCurrency = (value) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
    }).format(value);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const requestedAmount = parseFloat(amount);

    // Validation
    if (!requestedAmount || requestedAmount <= 0) {
      setError('Please enter a valid amount');
      return;
    }

    if (requestedAmount > availableLimit) {
      setError(`Amount exceeds available limit of ${formatCurrency(availableLimit)}`);
      return;
    }

    if (requestedAmount > totalSelectedAmount) {
      setError(`Amount cannot exceed total selected orders (${formatCurrency(totalSelectedAmount)})`);
      return;
    }

    setIsSubmitting(true);

    try {
      // Call async financing request API - uses first selected order as reference
      await onSubmit({
        amount: requestedAmount,
        orderReference: selectedOrderData[0]?.referenceId,
        drawdownTenor: parseInt(drawdownTenor),
      });

      setSuccess(true);
      // Auto-close after 2 seconds
      setTimeout(handleClose, 2000);
    } catch (err) {
      setError(err.message || 'Failed to submit request');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setAmount('');
    setDrawdownTenor(maxDrawdownTenor || 30);
    setError('');
    setSuccess(false);
    onClose();
  };


  if (success) {
    return (
      <div className="modal-overlay" onClick={handleClose}>
        <div className="modal-content p-8 text-center max-w-md" onClick={e => e.stopPropagation()}>
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4 animate-bounce">
            <CheckCircle className="w-8 h-8 text-green-600" />
          </div>
          <h2 className="text-xl font-bold mb-2">Request Submitted Successfully!</h2>
          <p className="text-gray-600 mb-4">
            Your financing request for {formatCurrency(parseFloat(amount))} is being processed.
          </p>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-left mb-6">
            <p className="text-sm text-blue-800">
              <strong>What's happening:</strong>
            </p>
            <ul className="text-xs text-blue-700 mt-2 space-y-1 list-disc list-inside">
              <li>Validating credit availability</li>
              <li>Verifying order reference</li>
              <li>Preparing smart contract execution</li>
            </ul>
            <p className="text-xs text-blue-600 mt-3">
              Check your dashboard for status updates. Funds will be disbursed shortly!
            </p>
          </div>
          <button onClick={handleClose} className="btn-brand w-full">
            View Dashboard
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
            <div className="w-10 h-10 bg-brand-gradient rounded-lg flex items-center justify-center">
              <DollarSign className="w-5 h-5 text-white" />
            </div>
            <h2 className="text-xl font-semibold">Request Financing</h2>
          </div>
          <button onClick={handleClose} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Selected Orders Summary */}
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <FileText className="w-5 h-5 text-brand-purple" />
              <span className="font-medium">Selected Orders</span>
            </div>
            <div className="space-y-2 max-h-32 overflow-y-auto">
              {selectedOrderData.map(order => (
                <div key={order.id} className="flex justify-between text-sm">
                  <span className="text-gray-600 font-mono">{order.referenceId}</span>
                  <span className="font-medium">{formatCurrency(order.amount)}</span>
                </div>
              ))}
            </div>
            <div className="border-t border-gray-200 mt-3 pt-3 flex justify-between font-semibold">
              <span>Total Selected</span>
              <span className="text-gradient">{formatCurrency(totalSelectedAmount)}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="input-label">Financing Amount *</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => {
                    const value = Number(e.target.value);
                    if (value > Math.min(Number(availableLimit), Number(totalSelectedAmount))) {
                      setError(`Amount exceeds available limit of ${formatCurrency(Math.min(Number(availableLimit), Number(totalSelectedAmount)))}`);
                    } else {
                      setAmount(value);
                      setError('');
                    }
                  }}
                  className="input-field pl-8"
                  placeholder="Enter amount"
                  max={Math.min(Number(availableLimit), Number(totalSelectedAmount))}
                  required
                />
              </div>
            </div>
            <div>
              <label className="input-label">Drawdown Tenor (Days) *</label>
              <div className="relative">
                <input
                  type="number"
                  value={drawdownTenor}
                  onChange={(e) => {
                    const value = Number(e.target.value);
                    if (value > maxDrawdownTenor) {
                      setError(`Tenor cannot exceed your approved limit of ${maxDrawdownTenor} days`);
                    } else {
                      setDrawdownTenor(value);
                      setError('');
                    }
                  }}
                  className="input-field"
                  placeholder="Days"
                  max={maxDrawdownTenor}
                  required
                />
              </div>
              {drawdownTenor > 0 && (
                <p className="text-[10px] text-brand-purple font-medium mt-1">
                  Estimated Due Date: {new Date(new Date().getTime() + (drawdownTenor - 1) * 86400000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                </p>
              )}
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Available limit: {formatCurrency(availableLimit)} | Max Tenor: {maxDrawdownTenor} days
          </p>

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
              <strong>Validation:</strong> Your request will be validated against the Order Book data to ensure
              it's tied to real settlement activity before funds are disbursed.
            </p>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-4">
            <button type="button" onClick={handleClose} className="btn-secondary flex-1">
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !amount || selectedOrders.length === 0}
              className="btn-brand flex-1 flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Processing...
                </>
              ) : (
                'Submit Request'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default RequestFinancingModal;
