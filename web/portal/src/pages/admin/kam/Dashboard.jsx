import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext';
import { CreditCard, Users, FileCheck, AlertTriangle, LogOut, Eye, Loader2, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import Sidebar from '../../../components/Sidebar';
import { adminAPI } from '../../../services/api';
import moment from 'moment';
import NotificationDropdown from '../../../components/NotificationDropdown';

const KAMDashboard = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [applications, setApplications] = useState([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [limit] = useState(10);

  useEffect(() => {
    fetchDashboardData();
  }, [page]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (page !== 1) setPage(1);
      else fetchDashboardData();
    }, 500);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      const response = await adminAPI.getApplications({ search, page, limit });
      setApplications(response.data.applications);
      setTotalPages(response.data.totalPages);
    } catch (err) {
      console.error('Failed to fetch KAM dashboard data:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Sidebar */}
      <Sidebar />

      {/* Main Content */}
      <main className="ml-64 p-8">
        <div className="max-w-6xl mx-auto">
          <header className="mb-8 flex justify-between items-start">
            <div>
              <h1 className="page-header mb-1">Welcome, {user?.name}</h1>
              <p className="text-gray-600">Manage your pre-funding pipeline and PSP applications</p>
            </div>

            <div className="flex items-center gap-4">
              {/* Notification Dropdown Component */}
              <NotificationDropdown />

            </div>
          </header>

          {/* Stats Cards */}
          <div className="grid md:grid-cols-3 gap-6 mb-8">
            <div className="stats-card">
              <span className="stats-label">New PSP Applications</span>
              <span className="stats-value text-status-warning">{applications.length}</span>
            </div>
            <div className="stats-card">
              <span className="stats-label">Awaiting My Review</span>
              <span className="stats-value text-status-info">{applications.filter(a => a.creditLineStatus === 'Pending').length}</span>
            </div>
            <div className="stats-card">
              <span className="stats-label">Info Requested</span>
              <span className="stats-value text-gradient">{applications.filter(a => a.creditLineStatus === 'NeedMoreInfo').length}</span>
            </div>
          </div>

          {/* Pending Applications Table */}
          <div className="table-container mb-8">
            <div className="px-6 py-4 border-b border-gray-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <h2 className="text-lg font-semibold whitespace-nowrap">PSP Pre-Funding Applications</h2>
              
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search PSP or company..."
                  className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-purple/20 focus:border-brand-purple transition-all"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
            {loading ? (
              <div className="p-12 text-center">
                <Loader2 className="w-8 h-8 animate-spin text-brand-purple mx-auto" />
                <p className="text-gray-500 mt-2">Loading applications...</p>
              </div>
            ) : applications.length === 0 ? (
              <div className="p-12 text-center">
                <FileCheck className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500">No applications pending Relationship Review.</p>
              </div>
            ) : (
              <table className="w-full">
                <thead className="table-header">
                  <tr>
                    <th className="table-cell text-left">PSP / COMPANY</th>
                    <th className="table-cell text-left">FACILITY REQUESTED</th>
                    <th className="table-cell text-left">APPLICATION DATE</th>
                    <th className="table-cell text-left">STATUS</th>
                    <th className="table-cell text-left">ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {applications.map((app) => (
                    <tr key={app._id} className="table-row">
                      <td className="table-cell font-medium">{app.companyName}</td>
                      <td className="table-cell">${(app?.requestedAmount ||  0).toLocaleString()}</td>
                      <td className="table-cell">{moment(app.createdAt).format("ll")}</td>
                      <td className="table-cell">
                        <span className={`badge ${app.creditLineStatus === 'NeedMoreInfo' ? 'badge-warning' : 'badge-info'}`}>
                          {app.creditLineStatus}
                        </span>
                      </td>
                      <td className="table-cell">
                        <button
                          onClick={() => navigate(`/admin/application/${app._id}`)}
                          className="flex items-center gap-2 px-4 py-2 text-brand-purple hover:bg-brand-purple hover:text-white rounded-lg transition-colors font-medium"
                        >
                          <Eye className="w-4 h-4" />
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* Pagination Controls */}
            {!loading && applications.length > 0 && (
              <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between bg-gray-50/50">
                <p className="text-xs text-gray-500">
                  Page <span className="font-semibold text-gray-900">{page}</span> of <span className="font-semibold text-gray-900">{totalPages}</span>
                </p>
                
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage(prev => Math.max(1, prev - 1))}
                    disabled={page === 1 || loading}
                    className="p-2 border border-gray-200 rounded-lg hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  
                  {[...Array(totalPages)].map((_, i) => {
                    const pageNum = i + 1;
                    if (
                      pageNum === 1 || 
                      pageNum === totalPages || 
                      (pageNum >= page - 1 && pageNum <= page + 1)
                    ) {
                      return (
                        <button
                          key={pageNum}
                          onClick={() => setPage(pageNum)}
                          className={`min-w-[36px] h-9 px-3 text-xs font-semibold rounded-lg border transition-all ${
                            page === pageNum 
                              ? 'bg-brand-purple border-brand-purple text-white' 
                              : 'border-gray-200 hover:border-brand-purple/50 text-gray-600 hover:text-brand-purple'
                          }`}
                        >
                          {pageNum}
                        </button>
                      );
                    } else if (
                      pageNum === page - 2 || 
                      pageNum === page + 2
                    ) {
                      return <span key={pageNum} className="px-1 text-gray-400 text-xs">...</span>;
                    }
                    return null;
                  })}

                  <button
                    onClick={() => setPage(prev => Math.min(totalPages, prev + 1))}
                    disabled={page === totalPages || loading}
                    className="p-2 border border-gray-200 rounded-lg hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

export default KAMDashboard;
