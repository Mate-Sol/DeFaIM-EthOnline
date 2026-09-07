import { useState, useEffect } from 'react';
import { Clock, DollarSign, Calendar, TrendingUp, CheckCircle, XCircle, Loader2, RefreshCw, Hash, ExternalLink, Banknote, Upload, Eye } from 'lucide-react';
import { pspAPI } from '../services/api';
import RepaymentModal from './RepaymentModal';
import UploadReceiptModal from './UploadReceiptModal';
import { txExplorerUrl } from '../services/explorer';

const ActiveFinancingTable = () => {
  const [financings, setFinancings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [repaymentModal, setRepaymentModal] = useState({ isOpen: false, financing: null });
  const [uploadModal, setUploadModal] = useState({ isOpen: false, financing: null });

  const fetchFinancings = async () => {
    try {
      setLoading(true);
      const response = await pspAPI.getActiveFinancings();
      setFinancings(response.data);
      setError(null);
    } catch (err) {
      console.error('Failed to fetch financings:', err);
      setError('Failed to load financing data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFinancings();
    // Auto-refresh every 5 seconds for pending statuses
    const interval = setInterval(() => {
      fetchFinancings();
    }, 10000);

    return () => clearInterval(interval);
  }, []);

  const formatCurrency = (value) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
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

  const getStatusBadge = (status) => {
    const badges = {
      Pending: { bg: 'bg-yellow-100', text: 'text-yellow-800', icon: <Loader2 className="w-4 h-4 animate-spin" /> },
      Validated: { bg: 'bg-blue-100', text: 'text-blue-800', icon: <Clock className="w-4 h-4" /> },
      Disbursed: { bg: 'bg-green-100', text: 'text-green-800', icon: <CheckCircle className="w-4 h-4" /> },
      Repaid: { bg: 'bg-purple-100', text: 'text-purple-800', icon: <CheckCircle className="w-4 h-4" /> },
      Rejected: { bg: 'bg-red-100', text: 'text-red-800', icon: <XCircle className="w-4 h-4" /> },
      Failed: { bg: 'bg-red-100', text: 'text-red-800', icon: <XCircle className="w-4 h-4" /> },
      RepaymentPending: { bg: 'bg-amber-100', text: 'text-amber-800', icon: <Clock className="w-4 h-4" /> },
      ProcessingRepayment: { bg: 'bg-indigo-100', text: 'text-indigo-800', icon: <Loader2 className="w-4 h-4 animate-spin" /> },
      Overdue: { bg: 'bg-red-100', text: 'text-red-800', icon: <XCircle className="w-4 h-4" /> },
      PenaltyApplied: { bg: 'bg-orange-100', text: 'text-orange-800', icon: <XCircle className="w-4 h-4" /> },
    };

    const badge = badges[status] || badges.Pending;

    return (
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${badge.bg} ${badge.text}`}>
        {badge.icon}
        {status}
      </span>
    );
  };

  if (loading && financings.length === 0) {
    return (
      <div className="card p-8 text-center">
        <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3 text-brand-purple" />
        <p className="text-gray-600">Loading active financings...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card p-8 text-center">
        <p className="text-red-600 mb-4">{error}</p>
        <button onClick={fetchFinancings} className="btn-secondary">
          Try Again
        </button>
      </div>
    );
  }

  if (financings.length === 0) {
    return (
      <div className="card p-8 text-center">
        <DollarSign className="w-12 h-12 text-gray-300 mx-auto mb-3" />
        <h3 className="text-lg font-semibold text-gray-700 mb-2">No Active Pre-Funding Requests</h3>
        <p className="text-gray-500">Submit a liquidity request to get started</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header Section */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-gray-900">Active Liquidity</h2>
        <button
          onClick={fetchFinancings}
          className="inline-flex items-center justify-center gap-2 px-3 py-2 bg-white border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors shadow-sm"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {/* Responsive Implementation:
        1. Mobile View (Hidden on md screens)
        2. Desktop View (Hidden on small screens)
      */}

      {/* --- MOBILE VIEW (CARDS) --- */}
      <div className="grid grid-cols-1 gap-4 md:hidden">
        {financings.map((financing) => (
          <div key={financing._id} className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 space-y-4">

            {/* Card Header: Ref & Status */}
            <div className="flex justify-between items-start">
              <div className="space-y-1">
                <span className="text-xs text-gray-500 uppercase font-semibold tracking-wider">Order Ref</span>
                <div className="font-mono text-sm font-medium text-gray-900 flex items-center gap-1">
                  <Hash className="w-3 h-3 text-gray-400" />
                  {financing?.orderReference}
                </div>
              </div>
              {getStatusBadge(financing.status)}
            </div>

            {/* Main Value */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className="text-xs text-gray-500 uppercase font-semibold tracking-wider">Total Financing</span>
                <div className="text-xl font-bold text-gray-600">{formatCurrency(financing.amount)}</div>
              </div>
              <div>
                <span className="text-xs text-brand-purple uppercase font-semibold tracking-wider">Outstanding</span>
                <div className="text-xl font-bold text-gray-900">
                  {formatCurrency(financing.remainingPrincipal !== undefined ? financing.remainingPrincipal : financing.amount)}
                </div>
              </div>
            </div>

            {/* Grid for Details */}
            <div className="grid grid-cols-2 gap-y-4 gap-x-2 border-t border-b border-gray-100 py-3">
              <div>
                <span className="text-xs text-gray-500 block mb-1">Date Issued</span>
                <span className="text-sm">{formatDate(financing.disbursedAt || financing.createdAt)}</span>
              </div>

              <div>
                <span className="text-xs text-gray-500 block mb-1">Duration</span>
                {['Disbursed', 'Overdue', 'PenaltyApplied'].includes(financing.status) ? (
                  <span className="flex items-center gap-1 text-sm">
                    <Calendar className="w-3 h-3 text-gray-400" />
                    {financing.daysElapsed || 0} days
                  </span>
                ) : <span className="text-gray-400 text-sm">-</span>}
              </div>

              <div>
                <span className="text-xs text-gray-500 block mb-1" title="Accrued markup is calculated based on the full due period, not the elapsed days. Early repayment will still incur the total markup for the entire agreed tenure.">Accrued Markup </span>
                {['Disbursed', 'Overdue', 'PenaltyApplied'].includes(financing.status) && financing.accruedInterest ? (
                    <div className="flex items-center gap-1 text-green-600 font-medium text-sm" title="Accrued markup is calculated based on the full due period, not the elapsed days. Early repayment will still incur the total markup for the entire agreed tenure.">
                    <TrendingUp className="w-3 h-3" />
                    {formatCurrency(financing.accruedInterest.total)}
                  </div>
                ) : <span className="text-sm text-gray-400">-</span>}
              </div>

              <div>
                <span className="text-xs text-gray-500 block mb-1">Utilization</span>
                {['Disbursed', 'Overdue', 'PenaltyApplied'].includes(financing.status) ? (
                  <div className="text-sm">
                    {financing.utilizedBips || 0} <span className="text-gray-400 text-xs">bps</span>
                  </div>
                ) : <span className="text-sm text-gray-400">-</span>}
              </div>
            </div>

            {/* Penalty Information - Mobile */}
            {financing.penaltyAmount > 0 && (
              <div className="p-3 bg-red-50 rounded-lg border border-red-100 -mt-2">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs font-bold text-red-700 uppercase flex items-center gap-1">
                    <XCircle className="w-3 h-3" />
                    Penalty Applied
                  </span>
                  <span className="text-sm font-bold text-red-700">{formatCurrency(financing.penaltyAmount)}</span>
                </div>
                <div className="text-[10px] text-red-600/70">
                  Triggered on {formatDate(financing.penaltyTriggeredAt)} due to late payment
                </div>
              </div>
            )}

            {/* Footer: Transaction Link */}
            {financing.txHash && (
              <a
                href={`${txExplorerUrl(financing.txHash)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between w-full p-2 bg-gray-50 hover:bg-gray-100 rounded text-sm text-indigo-600 transition-colors"
              >
                <span className="font-mono text-xs">{financing.txHash.substring(0, 16)}...</span>
                <ExternalLink className="w-4 h-4" />
              </a>
            )}
            {financing.rejectionReason && (
              <div className="p-2 bg-red-50 text-red-700 text-sm rounded">
                {financing.rejectionReason}
              </div>
            )}

            {/* Actions for Mobile */}
            <div className="pt-2 border-t border-gray-100">
              {financing.status === 'AwaitingDrawdown' ? (
                null
              ) : ['Disbursed', 'Overdue', 'PenaltyApplied'].includes(financing.status) && (financing.drawdownId !== null && financing.drawdownId !== undefined) ? (
                null
              ) : ['Disbursed', 'Overdue', 'PenaltyApplied'].includes(financing.status) ? (
                financing.receiptUrl ? (
                  <div className="flex flex-col gap-2">
                    <button
                      onClick={() => setRepaymentModal({ isOpen: true, financing })}
                      className="w-full flex items-center justify-center gap-2 py-2.5 bg-brand-purple text-white rounded-md text-sm font-semibold hover:bg-opacity-90 transition-all shadow-sm active:scale-[0.98]"
                    >
                      <Banknote className="w-4 h-4" />
                      Repay Now
                    </button>
                    <a
                      href={financing.receiptUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full flex items-center justify-center gap-2 py-2 text-sm text-brand-purple font-medium hover:underline"
                    >
                      <Eye className="w-4 h-4" />
                      View Receipt
                    </a>
                  </div>
                ) : (
                  <button
                    onClick={() => setUploadModal({ isOpen: true, financing })}
                    className="w-full flex items-center justify-center gap-2 py-2.5 bg-brand-purple text-white rounded-md text-sm font-semibold hover:bg-opacity-90 transition-all shadow-sm active:scale-[0.98]"
                  >
                    <Upload className="w-4 h-4" />
                    Upload Receipt
                  </button>
                )
              ) : financing.status === 'RepaymentPending' ? (
                <div className="w-full text-center py-2 bg-amber-50 rounded-md border border-amber-100 text-amber-700 text-sm font-medium italic">
                  Pending CAD Confirmation
                </div>
              ) : financing.status === 'ProcessingRepayment' ? (
                <div className="w-full flex items-center justify-center gap-2 py-2 bg-indigo-50 rounded-md border border-indigo-100 text-indigo-700 text-sm font-medium italic">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Processing Payment...
                </div>
              ) : financing.status === 'Repaid' ? (
                <div className="w-full flex items-center justify-center gap-2 py-2 bg-purple-50 rounded-md border border-purple-100 text-purple-700 text-sm font-medium">
                  <CheckCircle className="w-4 h-4" />
                  Repayment Completed
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      {/* --- DESKTOP VIEW (TABLE) --- */}
      <div className="hidden md:block bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wider font-semibold border-b border-gray-200">
              <tr>
                <th className="px-6 py-4 whitespace-nowrap">Order Reference</th>
                <th className="px-6 py-4 whitespace-nowrap">Initial Amount</th>
                <th className="px-6 py-4 whitespace-nowrap">Outstanding Principal</th>
                <th className="px-6 py-4 whitespace-nowrap">Status</th>
                <th className="px-6 py-4 whitespace-nowrap">Date Issued</th>
                <th className="px-6 py-4 whitespace-nowrap">Due Date</th>
                <th className="px-6 py-4 whitespace-nowrap">Days Elapsed</th>
                <th className="px-6 py-4 whitespace-nowrap">Markup (BIPS)</th>
                <th className="px-6 py-4 whitespace-nowrap" title="Accrued markup is calculated based on the full due period, not the elapsed days. Early repayment will still incur the total markup for the entire agreed tenure.">Accrued Markup</th>
                {/* <th className="px-6 py-4 whitespace-nowrap text-right">Transaction</th> */}
                <th className="px-6 py-4 whitespace-nowrap text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 text-sm text-gray-700">
              {financings.map((financing) => (
                <tr key={financing._id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4 font-mono">{financing?.orderReference}</td>
                  <td className="px-6 py-4 text-gray-500">{formatCurrency(financing.amount)}</td>
                  <td className="px-6 py-4 font-bold text-gray-900">
                    {formatCurrency(financing.remainingPrincipal !== undefined ? financing.remainingPrincipal : financing.amount)}
                  </td>
                  <td className="px-6 py-4">{getStatusBadge(financing.status)}</td>
                  <td className="px-6 py-4 whitespace-nowrap">{formatDate(financing.disbursedAt || financing.createdAt)}</td>
                  <td className="px-6 py-4 whitespace-nowrap">{formatDate(financing.dueDate)}</td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {['Disbursed', 'Overdue', 'PenaltyApplied'].includes(financing.status) ? (
                      <span className="flex items-center gap-1">
                        <Calendar className="w-4 h-4 text-gray-400" />
                        {financing.daysElapsed || 0} days
                      </span>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {['Disbursed', 'Overdue', 'PenaltyApplied'].includes(financing.status) ? (
                      <div>
                        <div><span className="font-medium">{financing.utilizedBips || 0}</span> <span className="text-xs text-gray-500">/Bips</span></div>
                        {/* <div className="text-xs text-gray-400">{financing.unutilizedBips || 0} unused</div> */}
                      </div>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {['Disbursed', 'Overdue', 'PenaltyApplied'].includes(financing.status) && financing.accruedInterest ? (
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-1 text-green-600 font-medium" title="Accrued markup is calculated based on the full due period, not the elapsed days. Early repayment will still incur the total markup for the entire agreed tenure.">
                          <TrendingUp className="w-4 h-4" />
                          {formatCurrency(financing.accruedInterest.total)}
                        </div>
                        {financing.penaltyAmount > 0 && (
                          <div className="flex items-center gap-1 text-red-600 font-bold text-[11px] bg-red-50 px-1.5 py-0.5 rounded border border-red-100" title={`Penalty triggered at ${formatDate(financing.penaltyTriggeredAt)}`}>
                            <XCircle className="w-3 h-3" />
                            + {formatCurrency(financing.penaltyAmount)} Penalty
                          </div>
                        )}
                      </div>
                    ) : financing.status === 'Rejected' || financing.status === 'Failed' ? (
                      <span className="text-red-600 text-xs max-w-[150px] truncate block" title={financing.rejectionReason}>
                        {financing.rejectionReason || financing.failureReason}
                      </span>
                    ) : financing.status === 'Repaid' ? (
                      <span className="text-green-600 text-xs max-w-[150px] truncate block" title={financing.actualInterestPaid}>
                        {formatCurrency(financing.actualInterestPaid)}
                      </span>
                    ) : (
                      <span className="text-gray-400 italic text-xs">Processing...</span>
                    )}
                  </td>
                  {/* <td className="px-6 py-4 text-right whitespace-nowrap">
                    {financing.txHash ? (
                      <a
                        href={`${txExplorerUrl(financing.txHash)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-indigo-600 hover:text-indigo-800 hover:underline font-mono inline-flex items-center gap-1"
                      >
                        {financing.txHash.substring(0, 6)}...
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td> */}
                  <td className="px-6 py-4 text-right whitespace-nowrap">
                    {financing.status === 'AwaitingDrawdown' ? (
                      null
                    ) : ['Disbursed', 'Overdue', 'PenaltyApplied'].includes(financing.status) ? (
                      financing.drawdownId !== null && financing.drawdownId !== undefined ? (
                        // On-chain drawdown ID present → repay via build-sign-relay
                        null
                      ) : financing.receiptUrl ? (
                        <div className="flex items-center justify-end gap-3">
                          <a
                            href={financing.receiptUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 text-gray-500 hover:text-brand-purple transition-colors"
                            title="View Receipt"
                          >
                            <Eye className="w-4 h-4" />
                          </a>
                          <button
                            onClick={() => setRepaymentModal({ isOpen: true, financing })}
                            className="inline-flex items-center gap-1 px-3 py-1.5 bg-brand-purple text-white text-xs font-medium rounded hover:bg-opacity-90 transition-colors"
                          >
                            <Banknote className="w-3.5 h-3.5" />
                            Repay
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setUploadModal({ isOpen: true, financing })}
                          className="inline-flex items-center gap-1 px-3 py-1.5 bg-brand-purple text-white text-xs font-medium rounded hover:bg-opacity-90 transition-colors"
                        >
                          <Upload className="w-3.5 h-3.5" />
                          Upload Receipt
                        </button>
                      )
                    ) : financing.status === 'RepaymentPending' ? (
                      <span className="text-xs text-amber-600 font-medium italic">Pending Confirmation</span>
                    ) : financing.status === 'ProcessingRepayment' ? (
                      <span className="text-xs text-indigo-600 font-medium italic flex items-center gap-1">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Processing...
                      </span>
                    ) : financing.status === 'Repaid' ? (
                      <div className='flex items-center justify-end gap-3'>
                        <a
                          href={financing.receiptUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1.5 text-gray-500 hover:text-brand-purple transition-colors"
                          title="View Receipt"
                        >
                          <Eye className="w-4 h-4" />
                        </a>
                        <span className="text-xs text-purple-600 font-medium">
                          ✓ Repaid</span>
                      </div>
                    ) : (
                      <span className="text-gray-400 text-xs">-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Repayment Modal */}
      <RepaymentModal
        isOpen={repaymentModal.isOpen}
        onClose={() => setRepaymentModal({ isOpen: false, financing: null })}
        financing={repaymentModal.financing}
        onRepaymentSuccess={() => {
          fetchFinancings(); // Refresh table
          setRepaymentModal({ isOpen: false, financing: null });
        }}
      />

      <UploadReceiptModal
        isOpen={uploadModal.isOpen}
        onClose={() => setUploadModal({ isOpen: false, financing: null })}
        order={uploadModal.financing ? { referenceId: uploadModal.financing.orderReference } : null}
        onUploadSuccess={fetchFinancings}
      />
    </div>
  );
};

export default ActiveFinancingTable;
