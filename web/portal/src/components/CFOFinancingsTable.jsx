import { DollarSign, Calendar, TrendingUp, CheckCircle, XCircle, Loader2, Clock, ExternalLink } from 'lucide-react';
import { txExplorerUrl } from '../services/explorer';

const CFOFinancingsTable = ({ financings }) => {
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

  if (!financings || financings.length === 0) {
    return (
      <div className="card p-8 text-center">
        <DollarSign className="w-12 h-12 text-gray-300 mx-auto mb-3" />
        <h3 className="text-lg font-semibold text-gray-700 mb-2">No Active Facilities</h3>
        <p className="text-gray-500">No PSP liquidity has been deployed yet</p>
      </div>
    );
  }

  return (
  <>
  {/* --- Responsive Container --- */}
<div className="space-y-4">
  
  {/* 1. MOBILE VIEW (Cards) - Visible only on small screens */}
  <div className="grid grid-cols-1 gap-4 md:hidden">
    {financings.map((financing) => (
      <div key={financing._id} className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 space-y-3">
        
        {/* Header: PSP Company & Status */}
        <div className="flex justify-between items-start gap-2">
          <div>
            <span className="text-xs text-gray-500 uppercase font-bold tracking-wider">PSP</span>
            <div className="font-semibold text-gray-900">
              {financing.pspId?.companyName || 'Unknown PSP'}
            </div>
          </div>
          {getStatusBadge(financing.status)}
        </div>

        {/* Order Ref & Amount */}
        <div className="flex justify-between items-end border-b border-gray-100 pb-3">
          <div>
             <span className="text-xs text-gray-500 block mb-0.5">Order Ref</span>
             <span className="font-mono text-sm bg-gray-50 px-1.5 py-0.5 rounded text-gray-700">
               {financing.orderReference}
             </span>
          </div>
          <div className="text-right">
            <span className="text-xs text-gray-500 block mb-0.5">Amount</span>
            <span className="text-xl font-bold text-gray-900">{formatCurrency(financing.amount)}</span>
          </div>
        </div>

        {/* Details Grid */}
        <div className="grid grid-cols-2 gap-y-3 text-sm">
          <div>
            <span className="text-xs text-gray-500 block">Date Issued</span>
            <span className="text-gray-700">{formatDate(financing.disbursedAt || financing.createdAt)}</span>
          </div>
          
          <div>
            <span className="text-xs text-gray-500 block">Duration</span>
            {['Disbursed', 'Overdue', 'PenaltyApplied'].includes(financing.status) ? (
              <span className="flex items-center gap-1 text-gray-700">
                <Calendar className="w-3.5 h-3.5 text-gray-400" />
                {financing.daysElapsed || 0} days
              </span>
            ) : <span className="text-gray-400">-</span>}
          </div>

          <div className="col-span-2">
            <span className="text-xs text-gray-500 block" title="Accrued markup is calculated based on the full due period, not the elapsed days. Early repayment will still incur the total markup for the entire agreed tenure.">Accrued Markup</span>
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
                <span className="text-red-600 text-xs block truncate" title={financing.rejectionReason}>
                  {financing.rejectionReason || financing.failureReason}
                </span>
              ) : financing.status === 'Repaid' ? (
                <span className="text-green-600 text-xs block truncate" title={financing.actualInterestPaid}>
                  {formatCurrency(financing.actualInterestPaid)}
                </span>
              ) : (
                <span className="text-gray-400 italic text-xs"> Processing...</span>
              )}
          </div>
        </div>

        {/* Footer: TX Hash */}
        {financing.txHash && (
           <div className="pt-2">
            <a
              href={`${txExplorerUrl(financing.txHash)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center w-full p-2 bg-gray-50 hover:bg-gray-100 border border-gray-100 rounded text-xs font-mono text-brand-purple transition-colors"
            >
              Tx: {financing.txHash.substring(0, 20)}...
              <ExternalLink className="w-3 h-3 ml-2" />
            </a>
           </div>
        )}
      </div>
    ))}
  </div>

  {/* 2. DESKTOP VIEW (Table) - Visible on medium screens and up */}
  <div className="hidden md:block bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wider font-semibold border-b border-gray-200">
          <tr>
            <th className="px-6 py-4 whitespace-nowrap">PSP Company</th>
            <th className="px-6 py-4 whitespace-nowrap">Order Reference</th>
            <th className="px-6 py-4 whitespace-nowrap">Amount</th>
            <th className="px-6 py-4 whitespace-nowrap">Status</th>
            <th className="px-6 py-4 whitespace-nowrap">Date Issued</th>
            <th className="px-6 py-4 whitespace-nowrap">Days Elapsed</th>
            <th className="px-6 py-4 whitespace-nowrap" title="Accrued markup is calculated based on the full due period, not the elapsed days. Early repayment will still incur the total markup for the entire agreed tenure.">Accrued Markup</th>
            <th className="px-6 py-4 whitespace-nowrap text-right">TX Hash</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 text-sm text-gray-700">
          {financings.map((financing) => (
            <tr key={financing._id} className="hover:bg-gray-50 transition-colors">
              <td className="px-6 py-4 font-semibold text-gray-900 whitespace-nowrap">
                {financing.pspId?.companyName || 'Unknown PSP'}
              </td>
              <td className="px-6 py-4 font-mono text-xs whitespace-nowrap">
                {financing.orderReference}
              </td>
              <td className="px-6 py-4 font-medium whitespace-nowrap">
                {formatCurrency(financing.amount)}
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                {getStatusBadge(financing.status)}
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                {formatDate(financing.disbursedAt || financing.createdAt)}
              </td>
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
                  <span className="text-gray-400 text-xs italic">Processing...</span>
                )}
              </td>
              <td className="px-6 py-4 text-right whitespace-nowrap">
                {financing.txHash ? (
                  <a
                    href={`${txExplorerUrl(financing.txHash)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand-purple hover:underline text-xs font-mono inline-flex items-center gap-1"
                  >
                    {financing.txHash.substring(0, 8)}...
                    <ExternalLink className="w-3 h-3" />
                  </a>
                ) : (
                  <span className="text-gray-400 text-sm">-</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
</div>
  </>
  );
};

export default CFOFinancingsTable;
