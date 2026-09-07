import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext';
import { FileText, Eye, Loader2, Search, ChevronLeft, ChevronRight, Scale } from 'lucide-react';
import Sidebar from '../../../components/Sidebar';
import { adminAPI } from '../../../services/api';
import moment from 'moment';
import NotificationDropdown from '../../../components/NotificationDropdown';

const LegalDashboard = () => {
  const { user } = useAuth();
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
      console.error('Failed to fetch Legal dashboard data:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar />

      <main className="ml-64 p-8">
        <div className="max-w-6xl mx-auto">
          <header className="mb-8 flex justify-between items-start">
            <div>
              <h1 className="page-header mb-1">Legal Dashboard</h1>
              <p className="text-gray-600">Review applications and manage facility agreements</p>
            </div>

            <div className="flex items-center gap-4">
              <NotificationDropdown />
            </div>
          </header>

          <div className="grid md:grid-cols-3 gap-6 mb-8">
            <div className="stats-card">
              <span className="stats-label">Legal Review Required</span>
              <span className="stats-value text-status-warning">
                {applications.filter(a => a.workflowStep === 'LEGAL_REVIEW').length}
              </span>
            </div>
            <div className="stats-card">
              <span className="stats-label">Agreements Shared</span>
              <span className="stats-value text-status-info">
                {applications.filter(a => a.facilityAgreement?.status === 'Shared').length}
              </span>
            </div>
            <div className="stats-card">
              <span className="stats-label">Agreements Accepted</span>
              <span className="stats-value text-green-600">
                {applications.filter(a => a.facilityAgreement?.status === 'Accepted').length}
              </span>
            </div>
          </div>

          <div className="table-container mb-8">
            <div className="px-6 py-4 border-b border-gray-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <h2 className="text-lg font-semibold whitespace-nowrap">Facility Agreement Reviews</h2>
              
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search company name..."
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
                <Scale className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500">No applications pending legal review.</p>
              </div>
            ) : (
              <table className="w-full">
                <thead className="table-header">
                  <tr>
                    <th className="table-cell text-left">Company</th>
                    <th className="table-cell text-left">Agreement Status</th>
                    <th className="table-cell text-left">Workflow Step</th>
                    <th className="table-cell text-left">Submitted Date</th>
                    <th className="table-cell text-left">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {applications.map((app) => (
                    <tr key={app._id} className="table-row">
                      <td className="table-cell font-medium">{app.companyName}</td>
                      <td className="table-cell">
                        <span className={`badge ${
                          app.facilityAgreement?.status === 'Accepted' ? 'badge-success' :
                          app.facilityAgreement?.status === 'Shared' ? 'badge-info' : 'badge-warning'
                        }`}>
                          {app.facilityAgreement?.status || 'Pending'}
                        </span>
                      </td>
                      <td className="table-cell text-xs">{app.workflowStep}</td>
                      <td className="table-cell">{moment(app.createdAt).format("ll")}</td>
                      <td className="table-cell">
                        <button
                          onClick={() => navigate(`/admin/application/${app._id}`)}
                          className="flex items-center gap-2 px-4 py-2 text-brand-purple hover:bg-brand-purple hover:text-white rounded-lg transition-colors font-medium"
                        >
                          <Eye className="w-4 h-4" />
                          Review & Legalize
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

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

export default LegalDashboard;
