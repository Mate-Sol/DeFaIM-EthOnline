import { useState } from 'react';
import { Search, ChevronLeft, ChevronRight, FileText } from 'lucide-react';

const AdminOrderBookTable = ({ orders, loading, totalPages, currentPage, onPageChange, onSearch }) => {
  const [searchTerm, setSearchTerm] = useState('');

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getStatusBadge = (status) => {
    const statusStyles = {
      'REFUND': 'badge-warning',
      'DEPOSIT': 'badge-success',
      'Financed': 'badge-primary',
      'Financing': 'badge-info',
      'None': 'badge-secondary',
    };
    return <span className={`badge ${statusStyles[status] || 'badge-info'}`}>{status}</span>;
  };

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    onSearch(searchTerm);
  };

  return (
    <div className="table-container">
      <div className="px-6 py-4 border-b border-gray-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h2 className="text-lg font-semibold">All Orderbooks (Efficient Deposits)</h2>
        <form onSubmit={handleSearchSubmit} className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search reference, customer or PSP..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="input-field pl-10 w-80"
          />
        </form>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="table-header">
            <tr>
              <th className="table-cell text-left">PSP / Partner</th>
              <th className="table-cell text-left">Reference ID</th>
              <th className="table-cell text-left">Customer</th>
              <th className="table-cell text-left">Amount</th>
              <th className="table-cell text-left">Type</th>
              <th className="table-cell text-left">Status</th>
              <th className="table-cell text-left">Date</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan="7" className="table-cell text-center py-12">
                  <div className="flex justify-center items-center gap-2 text-gray-500">
                    <div className="w-5 h-5 border-2 border-brand-purple border-t-transparent rounded-full animate-spin"></div>
                    Loading deposits...
                  </div>
                </td>
              </tr>
            ) : orders.length === 0 ? (
              <tr>
                <td colSpan="7" className="table-cell text-center py-12 text-gray-500">
                  No orderbook records found.
                </td>
              </tr>
            ) : (
              orders.map((order) => (
                <tr key={order._id} className="table-row">
                  <td className="table-cell">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-brand-purple/10 flex items-center justify-center text-brand-purple">
                        <FileText className="w-4 h-4" />
                      </div>
                      <span className="font-semibold">{order.companyName}</span>
                    </div>
                  </td>
                  <td className="table-cell font-mono text-sm">{order.referenceId}</td>
                  <td className="table-cell font-medium">{order.customerName}</td>
                  <td className="table-cell font-bold text-gray-900">
                    {formatCurrency(order.amount)} <span className="text-[10px] text-gray-400 font-normal">{order.currency}</span>
                  </td>
                  <td className="table-cell">{getStatusBadge(order.type)}</td>
                  <td className="table-cell">{getStatusBadge(order.status)}</td>
                  <td className="table-cell text-gray-500 text-xs">{formatDate(order.createdAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {!loading && totalPages > 1 && (
        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between bg-gray-50/50">
          <span className="text-sm text-gray-500">
            Page <span className="font-semibold text-gray-900">{currentPage}</span> of <span className="font-semibold text-gray-900">{totalPages}</span>
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onPageChange(currentPage - 1)}
              disabled={currentPage === 1}
              className="p-2 rounded-lg border border-gray-200 hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              onClick={() => onPageChange(currentPage + 1)}
              disabled={currentPage === totalPages}
              className="p-2 rounded-lg border border-gray-200 hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminOrderBookTable;
