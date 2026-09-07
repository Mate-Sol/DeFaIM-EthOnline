import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext';
import { 
  CreditCard, Users, FileCheck, AlertTriangle, 
  LogOut, Eye, Loader2, BarChart2, Search, 
  ChevronLeft, ChevronRight, Clock, ShieldCheck, 
  DollarSign, ArrowRight 
} from 'lucide-react';
import Sidebar from '../../../components/Sidebar';
import { adminAPI } from '../../../services/api';
import moment from 'moment';
import NotificationDropdown from '../../../components/NotificationDropdown';
import FinancingReviewModal from '../../../components/FinancingReviewModal';

const CADDashboard = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('applications'); // 'applications' | 'financing'
  const [applications, setApplications] = useState([]);
  const [financingRequests, setFinancingRequests] = useState([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [limit] = useState(10);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState(null);

  useEffect(() => {
    fetchDashboardData();
  }, [page, activeTab]);

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
      if (activeTab === 'applications') {
        const response = await adminAPI.getApplications({ search, page, limit });
        setApplications(response.data.applications);
        setTotalPages(response.data.totalPages);
      } else {
        const response = await adminAPI.getPendingFinancing();
        // Since there's no backend search/pagination for financing yet, we filter locally
        const filtered = response.data.filter(r => 
          r.pspId?.companyName?.toLowerCase().includes(search.toLowerCase()) ||
          r.orderReference?.toLowerCase().includes(search.toLowerCase())
        );
        setFinancingRequests(filtered);
        setTotalPages(1); // Placeholder
      }
    } catch (err) {
      console.error('Failed to fetch CAD dashboard data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleReviewRequest = (request) => {
    setSelectedRequest(request);
    setIsModalOpen(true);
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
              <NotificationDropdown />
            </div>
          </header>

          {/* Stats Cards */}
          <div className="grid md:grid-cols-3 gap-6 mb-8">
            <div className="stats-card">
              <span className="stats-label">PSP Applications for Scoring</span>
              <span className="stats-value text-status-warning">{applications.length}</span>
            </div>
            <div className="stats-card">
              <span className="stats-label">Scoring Completed</span>
              <span className="stats-value text-status-success">{applications.filter(a => a.creditScoring?.totalScore > 0).length}</span>
            </div>
            <div className="stats-card">
              <span className="stats-label">High Risk Alerts</span>
              <span className="stats-value text-status-danger">{applications.filter(a => a.creditScoring?.rating === 'D' || a.pepExposure).length}</span>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-4 mb-6">
            <button
              onClick={() => { setActiveTab('applications'); setPage(1); }}
              className={`px-6 py-3 rounded-xl font-bold transition-all flex items-center gap-2 ${
                activeTab === 'applications' 
                ? 'bg-brand-gradient text-white shadow-lg shadow-brand-purple/20' 
                : 'bg-white text-gray-500 hover:bg-gray-50 border border-gray-100'
              }`}
            >
              <FileCheck className="w-4 h-4" />
              Pre-Funding Applications
            </button>
            <button
              onClick={() => { setActiveTab('financing'); setPage(1); }}
              className={`px-6 py-3 rounded-xl font-bold transition-all flex items-center gap-2 ${
                activeTab === 'financing' 
                ? 'bg-brand-gradient text-white shadow-lg shadow-brand-purple/20' 
                : 'bg-white text-gray-500 hover:bg-gray-50 border border-gray-100'
              }`}
            >
              <DollarSign className="w-4 h-4" />
              Liquidity Requests
              {financingRequests.length > 0 && (
                <span className="bg-white/20 text-white min-w-[20px] h-5 px-1.5 rounded-full text-[10px] flex items-center justify-center">
                  {financingRequests.length}
                </span>
              )}
            </button>
          </div>

          {/* Table Container */}
          <div className="table-container mb-8">
            <div className="px-6 py-4 border-b border-gray-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <h2 className="text-lg font-semibold whitespace-nowrap">
                {activeTab === 'applications' ? 'Applications for Risk Assessment' : 'Direct Liquidity Requests'}
              </h2>
              
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder={activeTab === 'applications' ? "Search company name..." : "Search company or order ref..."}
                  className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-purple/20 focus:border-brand-purple transition-all"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>

            {loading ? (
              <div className="p-12 text-center">
                <Loader2 className="w-8 h-8 animate-spin text-brand-purple mx-auto" />
                <p className="text-gray-500 mt-2">Loading data...</p>
              </div>
            ) : (activeTab === 'applications' ? applications : financingRequests).length === 0 ? (
              <div className="p-12 text-center">
                {activeTab === 'applications' ? <BarChart2 className="w-12 h-12 text-gray-300 mx-auto mb-4" /> : <Clock className="w-12 h-12 text-gray-300 mx-auto mb-4" />}
                <p className="text-gray-500">No {activeTab === 'applications' ? 'applications pending' : 'liquidity requests'} found.</p>
              </div>
            ) : (
              <table className="w-full">
                <thead className="table-header">
                  {activeTab === 'applications' ? (
                    <tr>
                      <th className="table-cell text-left">PSP / COMPANY</th>
                      <th className="table-cell text-left">FACILITY REQUESTED</th>
                      <th className="table-cell text-left">CURRENT SCORE</th>
                      <th className="table-cell text-left">RATING</th>
                      <th className="table-cell text-left">ACTIONS</th>
                    </tr>
                  ) : (
                    <tr>
                      <th className="table-cell text-left">PSP</th>
                      <th className="table-cell text-left">ORDER REFERENCE</th>
                      <th className="table-cell text-right">AMOUNT</th>
                      <th className="table-cell text-center">AVAILABLE CREDIT</th>
                      <th className="table-cell text-left">ACTIONS</th>
                    </tr>
                  )}
                </thead>
                <tbody>
                  {activeTab === 'applications' ? applications.map((app) => (
                    <tr key={app._id} className="table-row">
                      <td className="table-cell font-medium">{app.companyName}</td>
                      <td className="table-cell">${(app?.requestedAmount ||  0).toLocaleString()}</td>
                      <td className="table-cell">
                        {app.creditScoring?.totalScore ? (
                          <span className="font-bold">{app.creditScoring.totalScore}/100</span>
                        ) : (
                          <span className="text-gray-400 italic">Not Scored</span>
                        )}
                      </td>
                      <td className="table-cell">
                        {app.creditScoring?.rating ? (
                          <span className="badge badge-info">{app.creditScoring.rating}</span>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="table-cell">
                        <button
                          onClick={() => navigate(`/admin/application/${app._id}`)}
                          className="flex items-center gap-2 px-4 py-2 text-brand-purple hover:bg-brand-purple hover:text-white rounded-lg transition-colors font-medium"
                        >
                          <BarChart2 className="w-4 h-4" />
                          Score & Review
                        </button>
                      </td>
                    </tr>
                  )) : financingRequests.map((req) => (
                    <tr key={req._id} className="table-row">
                      <td className="table-cell font-medium">{req.pspId?.companyName}</td>
                      <td className="table-cell text-xs font-mono text-gray-500">{req.orderReference}</td>
                      <td className="table-cell text-right font-bold text-gray-900">${req.amount.toLocaleString()}</td>
                      <td className="table-cell text-center">
                        <span className="text-xs font-medium text-gray-500">
                          ${((req.pspId?.approvedAmount || 0) - (req.pspId?.currentlyUtilized || 0)).toLocaleString()}
                        </span>
                      </td>
                      <td className="table-cell">
                        <button
                          onClick={() => handleReviewRequest(req)}
                          className="flex items-center gap-2 px-4 py-2 bg-brand-purple/10 text-brand-purple hover:bg-brand-purple hover:text-white rounded-lg transition-all font-bold text-xs"
                        >
                          <ShieldCheck className="w-4 h-4" />
                          Review & Disburse
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* Pagination Controls */}
            {activeTab === 'applications' && !loading && applications.length > 0 && (
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

      {/* Modals */}
      {selectedRequest && (
        <FinancingReviewModal
          isOpen={isModalOpen}
          onClose={() => { setIsModalOpen(false); setSelectedRequest(null); }}
          request={selectedRequest}
          onConfirm={fetchDashboardData}
        />
      )}
    </div>
  );
};

export default CADDashboard;

