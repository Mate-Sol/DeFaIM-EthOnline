import {
  AlertTriangle,
  Building,
  ExternalLink,
  Eye,
  FileText,
  Loader2,
  LogOut,
  Search,
  ShieldCheck,
  TrendingUp,
  Users,
  XCircle
} from 'lucide-react';
import moment from 'moment';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { adminAPI } from '../../services/api';
import Sidebar from '../../components/Sidebar';

const UserManagement = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [selectedUser, setSelectedUser] = useState(null);
  const [userDetailLoading, setUserDetailLoading] = useState(false);
  const [userDetail, setUserDetail] = useState(null);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const response = await adminAPI.getUsers();
      setUsers(response.data);
    } catch (err) {
      console.error('Failed to fetch users:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchUserDetail = async (id) => {
    try {
      setUserDetailLoading(true);
      const response = await adminAPI.getUserDetail(id);
      setUserDetail(response.data);
      setSelectedUser(id);
    } catch (err) {
      console.error('Failed to fetch user detail:', err);
    } finally {
      setUserDetailLoading(false);
    }
  };

  const filteredUsers = users.filter(u => {
    const matchesSearch = (u.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.profile?.companyName?.toLowerCase().includes(searchTerm.toLowerCase()));

    const matchesFilter = filterStatus === 'all' ||
      (filterStatus === 'approved' && u.profile?.creditLineStatus === 'Approved') ||
      (filterStatus === 'pending' && ['Pending', 'UnderReview', 'NeedMoreInfo'].includes(u.profile?.creditLineStatus)) ||
      (filterStatus === 'no-profile' && !u.profile);

    return matchesSearch && matchesFilter;
  });

  const getStatusBadge = (status) => {
    switch (status) {
      case 'Approved': return <span className="badge badge-success">Approved</span>;
      case 'Pending':
      case 'UnderReview': return <span className="badge badge-warning">In Review</span>;
      case 'NeedMoreInfo': return <span className="badge badge-warning">Info Required</span>;
      case 'Rejected': return <span className="badge badge-danger">Rejected</span>;
      default: return <span className="badge bg-gray-100 text-gray-500">Not Started</span>;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Sidebar */}
      <Sidebar />

      {/* Main Content */}
      <main className="ml-64 p-8">
        <div className="max-w-6xl mx-auto">
          <header className="mb-8 flex justify-between items-end">
            <div>
              <h1 className="page-header">PSP Registry</h1>
              <p className="text-gray-600">All registered PSPs and their pre-funding application status</p>
            </div>
            <div className="flex gap-4">
              <div className="relative">
                <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search PSP name, email or company..."
                  className="input-field pl-10 w-64"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              <select
                className="input-field w-40"
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
              >
                <option value="all">All Status</option>
                <option value="approved">Approved</option>
                <option value="pending">Under Review</option>
                <option value="no-profile">No Profile</option>
              </select>
            </div>
          </header>

          <div className="table-container">
            {loading ? (
              <div className="p-12 text-center">
                <Loader2 className="w-8 h-8 animate-spin text-brand-purple mx-auto mb-4" />
                <p className="text-gray-500">Loading user list...</p>
              </div>
            ) : filteredUsers.length === 0 ? (
              <div className="p-12 text-center">
                <Users className="w-12 h-12 text-gray-200 mx-auto mb-4" />
                <p className="text-gray-500">No users found matching your criteria.</p>
              </div>
            ) : (
              <table className="w-full">
                <thead className="table-header">
                  <tr>
                    <th className="table-cell text-left">PSP DETAILS</th>
                    <th className="table-cell text-left">REGISTERED COMPANY</th>
                    <th className="table-cell text-left">REGISTERED ON</th>
                    <th className="table-cell text-left">APPLICATION STATUS</th>
                    <th className="table-cell text-left">ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((u) => (
                    <tr key={u._id} className="table-row">
                      <td className="table-cell">
                        <div className="flex flex-col">
                          <span className="font-bold text-gray-900">{u.name}</span>
                          <span className="text-xs text-gray-500">{u.email}</span>
                        </div>
                      </td>
                      <td className="table-cell font-medium">
                        {u.profile?.companyName || <span className="text-gray-400 italic">Not set</span>}
                      </td>
                      <td className="table-cell text-gray-600">
                        {moment(u.createdAt).format("ll")}
                      </td>
                      <td className="table-cell">
                        {getStatusBadge(u.profile?.creditLineStatus)}
                      </td>
                      <td className="table-cell">
                        <button
                          onClick={() => fetchUserDetail(u._id)}
                          className="flex items-center gap-2 px-3 py-1.5 text-brand-purple hover:bg-brand-purple hover:text-white rounded-lg transition-all font-medium text-sm"
                        >
                          <Eye className="w-4 h-4" />
                          View Profile
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </main>

      {/* User Detail Side Panel */}
      {selectedUser && (
        <div className="fixed inset-0 z-50 overflow-hidden" onClick={() => setSelectedUser(null)}>
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm transition-opacity" />
          <div className="absolute inset-y-0 right-0 max-w-2xl w-full bg-white shadow-2xl animate-slide-in" onClick={e => e.stopPropagation()}>
            <div className="h-full flex flex-col">
              <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-gray-50">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-brand-purple/10 rounded-full flex items-center justify-center">
                    <Users className="w-6 h-6 text-brand-purple" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-gray-900">{userDetail?.user?.name}</h2>
                    <p className="text-sm text-gray-500">User Identification: {selectedUser}</p>
                  </div>
                </div>
                <button onClick={() => setSelectedUser(null)} className="p-2 hover:bg-white rounded-full transition-colors text-gray-400">
                  <XCircle className="w-6 h-6" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-8">
                {userDetailLoading ? (
                  <div className="flex items-center justify-center h-full">
                    <Loader2 className="w-10 h-10 animate-spin text-brand-purple" />
                  </div>
                ) : userDetail?.profile ? (
                  <div className="space-y-8">
                    {/* Company Summary */}
                    <div className="grid grid-cols-2 gap-6">
                      <div className="card-detail p-4 bg-gray-50 rounded-xl border border-gray-100">
                        <div className="flex items-center gap-2 mb-2 text-brand-purple">
                          <Building className="w-4 h-4" />
                          <span className="text-xs font-bold uppercase tracking-wider">Company</span>
                        </div>
                        <p className="font-bold text-lg text-gray-900">{userDetail.profile.companyName}</p>
                        <p className="text-xs text-gray-500">{userDetail.profile.registrationNo} • {userDetail.profile.country}</p>
                      </div>
                      <div className="card-detail p-4 bg-gray-50 rounded-xl border border-gray-100">
                        <div className="flex items-center gap-2 mb-2 text-brand-purple">
                          <ShieldCheck className="w-4 h-4" />
                          <span className="text-xs font-bold uppercase tracking-wider">Financing Status</span>
                        </div>
                        <div>{getStatusBadge(userDetail.profile.creditLineStatus)}</div>
                        <p className="text-xs text-gray-500 mt-1">Stage: {userDetail.profile.workflowStep}</p>
                      </div>
                    </div>

                    {/* Financial Overview */}
                    <div>
                      <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4 border-l-2 border-brand-purple pl-2">Financial Profile</h3>
                      <div className="grid grid-cols-3 gap-4">
                        <div className="p-3 border border-gray-100 rounded-lg">
                          <p className="text-[10px] text-gray-500 font-bold uppercase">Approved Limit</p>
                          <p className="text-lg font-bold text-brand-purple">${userDetail.profile.approvedAmount?.toLocaleString() || '0'}</p>
                        </div>
                        <div className="p-3 border border-gray-100 rounded-lg">
                          <p className="text-[10px] text-gray-500 font-bold uppercase">Requested Amount</p>
                          <p className="text-lg font-bold text-gray-900">${userDetail.profile.requestedAmount?.toLocaleString() || '0'}</p>
                        </div>
                        <div className="p-3 border border-gray-100 rounded-lg">
                          <p className="text-[10px] text-gray-500 font-bold uppercase">Annual Revenue</p>
                          <p className="text-lg font-bold text-gray-900">${userDetail.profile.annualRevenue?.toLocaleString() || '0'}</p>
                        </div>
                      </div>
                    </div>

                    {/* Contact Details */}
                    <div>
                      <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4 border-l-2 border-brand-purple pl-2">Contact Information</h3>
                      <div className="p-4 border border-gray-100 rounded-lg space-y-3">
                        <div className="flex justify-between items-center text-sm">
                          <span className="text-gray-500">Key Contact Name</span>
                          <span className="font-medium text-gray-900">{userDetail.profile.keyContact?.name}</span>
                        </div>
                        <div className="flex justify-between items-center text-sm">
                          <span className="text-gray-500">Contact Email</span>
                          <span className="font-medium text-gray-900 font-mono">{userDetail.profile.keyContact?.email}</span>
                        </div>
                        <div className="flex justify-between items-center text-sm">
                          <span className="text-gray-500">Contact Phone</span>
                          <span className="font-medium text-gray-900">{userDetail.profile.keyContact?.phone}</span>
                        </div>
                      </div>
                    </div>

                    {/* Documents */}
                    <div>
                      <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4 border-l-2 border-brand-purple pl-2">Uploaded Documents ({userDetail.documents?.length || 0})</h3>
                      <div className="space-y-2">
                        {userDetail.documents?.map(doc => (
                          <div key={doc._id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg group hover:bg-gray-100 transition-colors">
                            <div className="flex items-center gap-3">
                              <FileText className="w-4 h-4 text-gray-400 group-hover:text-brand-purple transition-colors" />
                              <div>
                                <p className="text-sm font-medium text-gray-900">{doc.documentType}</p>
                                <p className="text-[10px] text-gray-500">{doc.name}</p>
                              </div>
                            </div>
                            <button
                              onClick={async () => {
                                try {
                                  const response = await adminAPI.downloadDocument(doc._id);
                                  const blob = new Blob([response.data], { type: response.headers['content-type'] || 'application/octet-stream' });
                                  const blobUrl = window.URL.createObjectURL(blob);
                                  const a = document.createElement('a');
                                  a.href = blobUrl;
                                  a.download = doc.name || 'download';
                                  document.body.appendChild(a);
                                  a.click();
                                  document.body.removeChild(a);
                                  window.URL.revokeObjectURL(blobUrl);
                                } catch (err) {
                                  console.error('Failed to download document:', err);
                                }
                              }}
                              className="text-brand-purple hover:underline text-xs font-bold"
                            >
                              Download
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
{/* 
                    <div className="pt-6 border-t border-gray-100">
                      <button
                        onClick={() => navigate(`/admin/application/${userDetail.profile._id}`)}
                        className="w-full py-3 bg-brand-purple text-white rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-brand-purple-dark transition-all shadow-lg shadow-brand-purple/20"
                      >
                        <ExternalLink className="w-5 h-5" />
                        Go to Full Application Review
                      </button>
                    </div> */}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-center p-12">
                    <AlertTriangle className="w-12 h-12 text-amber-500 mb-4" />
                    <h3 className="text-lg font-bold text-gray-900 mb-2">No Portfolio Found</h3>
                    <p className="text-gray-500 text-sm max-w-sm">This user hasn't submitted their financing profile or application yet.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserManagement;
