import { useState, useEffect } from 'react';
import { useAuth } from '../../../context/AuthContext';
import { CreditCard, BarChart3, PieChart as PieChartIcon, TrendingUp, LogOut, DollarSign, Loader2, AlertCircle } from 'lucide-react';
import { PieChart, Pie, Cell, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { cfoAPI } from '../../../services/api';
import Sidebar from '../../../components/Sidebar';
import CFOFinancingsTable from '../../../components/CFOFinancingsTable';
import EarnedYieldChart from '../../../components/EarnedYieldChart';
import NotificationDropdown from '../../../components/NotificationDropdown';


const CFODashboard = () => {
  const { user, logout } = useAuth();

  // State for backend data
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [stats, setStats] = useState({
    totalPSPs: 0,
    totalApprovedCredit: 0,
    totalActiveCredit: 0,
    totalFinancings: 0,
    pendingApplications: 0,
    totalInterestRevenue: 0
  });
  const [yieldData, setYieldData] = useState([]);
  const [financings, setFinancings] = useState([]);
  const [yieldAnalytics, setYieldAnalytics] = useState(null);


  // Fetch dashboard data on mount
  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch stats, yield history, and all financings
      const [statsResponse, yieldResponse, financingsResponse, analyticsResponse] = await Promise.all([
        cfoAPI.getDashboardStats(),
        cfoAPI.getYieldHistory(),
        cfoAPI.getAllFinancings(),
        cfoAPI.getYieldAnalytics()
      ]);

      setStats(statsResponse.data);
      setYieldData(yieldResponse.data);
      setFinancings(financingsResponse.data.financings);
      setYieldAnalytics(analyticsResponse.data);
    } catch (err) {
      console.error('Failed to fetch CFO dashboard data:', err);
      setError(err.response?.data?.message || 'Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  };

  // Data for exposure distribution
  const exposureData = [
    { name: 'Active Exposure', value: stats.totalActiveCredit, color: '#8b5cf6' }, // Purple
    { name: 'Avail. Liquidity', value: Math.max(0, stats.totalApprovedCredit - stats.totalActiveCredit), color: '#10b981' }, // Green
    // { name: 'Revision Needed', value: stats.revisionNeededCredit, color: '#f59e0b' }, // Amber
  ];

  const formatCurrency = (value) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
    }).format(value);
  };

  // if (loading) {
  //   return (
  //     <div className="min-h-screen bg-gray-50 flex items-center justify-center">
  //       <div className="text-center">
  //         <Loader2 className="w-12 h-12 animate-spin text-brand-purple mx-auto mb-4" />
  //         <p className="text-gray-600">Loading CFO Dashboard...</p>
  //       </div>
  //     </div>
  //   );
  // }
    if (error && !loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-500 mb-4">Error loading dashboard</div>
          <p className="text-gray-600 mb-4">{error}</p>
          <button onClick={fetchDashboardData} className="btn-brand">
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Sidebar */}
      <Sidebar />
      
      {loading && <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-brand-purple mx-auto mb-4" />
          <p className="text-gray-600">Loading CFO Dashboard...</p>
        </div>
      </div>}

      {/* Main Content */}
      {!loading && !error &&
      <main className="ml-64 p-8">
        <div className="max-w-6xl mx-auto">
          <header className="mb-8 flex justify-between items-start">
            <div>
              <h1 className="page-header mb-1">Welcome, {user?.name}</h1>
              <p className="text-gray-600">Monitor your pre-funding book, yield performance and liquidity exposure</p>
            </div>

            <div className="flex items-center gap-4">
              {/* Notification Dropdown Component */}
              <NotificationDropdown />

            </div>
          </header>

          {/* Treasury Stats */}
          <div className="grid md:grid-cols-3 gap-6 mb-8">
            <div className="stats-card">
              <div className="flex items-center gap-2 mb-2">
                <DollarSign className="w-5 h-5 text-status-success" />
                <span className="stats-label font-semibold text-green-700">Total Active Facility</span>
              </div>
              <span className="stats-value text-green-600">{formatCurrency(stats.totalApprovedCredit)}</span>
              <p className="text-xs text-gray-400 mt-1">Live and non-expired facilities</p>
            </div>
            {/* <div className="stats-card">
              <div className="flex items-center gap-2 mb-2">
                <AlertCircle className="w-5 h-5 text-amber-600" />
                <span className="stats-label font-semibold text-amber-700">Pending / Expired Facilities</span>
              </div>
              <span className="stats-value text-amber-600">{formatCurrency(stats.revisionNeededCredit)}</span>
              <p className="text-xs text-gray-400 mt-1">Requires review or renewal</p>
            </div> */}
            <div className="stats-card">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="w-5 h-5 text-brand-purple" />
                <span className="stats-label font-semibold text-brand-purple">Total Deployed Liquidity</span>
              </div>
              <span className="stats-value text-gradient">{formatCurrency(stats.totalActiveCredit)}</span>
              <p className="text-xs text-gray-400 mt-1">Liquidity currently deployed</p>
            </div>
            <div className="stats-card">
              <div className="flex items-center gap-2 mb-2">
                <DollarSign className="w-5 h-5 text-brand-magenta" />
                <span className="stats-label font-semibold text-brand-magenta">Yield Revenue (YTD)</span>
              </div>
              <span className="stats-value text-brand-magenta">{formatCurrency(stats.totalInterestRevenue)}</span>
              <p className="text-xs text-gray-400 mt-1">Total yield earned this year</p>
            </div>
          </div>

          {/* Active Financings Section */}
          <div className="mb-8">
            <h2 className="text-xl font-semibold mb-4">Active Pre-Funding Facilities</h2>
            <CFOFinancingsTable financings={financings} />
          </div>



          {/* Yield Performance Analytics */}
          {yieldAnalytics && (
            <div className="card mb-8">
              <h2 className="text-xl font-semibold mb-6">Yield Performance</h2>
              <div className="grid md:grid-cols-3 gap-6">
                {/* Expected Yield */}
                <div className="p-5 bg-blue-50 rounded-lg border border-blue-100">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="text-sm text-blue-600 font-medium mb-1">Accrued Yield</p>
                      <p className="text-xs text-blue-500/70">Based on rate × days elapsed</p>
                    </div>
                    <TrendingUp className="w-5 h-5 text-blue-500" />
                  </div>
                  <p className="text-3xl font-bold text-blue-700 mb-2">
                    {formatCurrency(yieldAnalytics.accruedYield.total)}
                  </p>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-blue-600">
                      <span className="font-semibold">{formatCurrency(yieldAnalytics.accruedYield.utilized)}</span> utilized
                    </span>
                    <span className="text-blue-500">
                      <span className="font-semibold">{formatCurrency(yieldAnalytics.accruedYield.unutilized)}</span> idle
                    </span>
                    {yieldAnalytics.accruedYield.penalties > 0 && (
                      <span className="text-red-500">
                        <span className="font-semibold">{formatCurrency(yieldAnalytics.accruedYield.penalties)}</span> penalties
                      </span>
                    )}
                  </div>
                </div>

                {/* Realized Yield */}
                <div className="p-5 bg-green-50 rounded-lg border border-green-100">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="text-sm text-green-600 font-medium mb-1">Collected Yield</p>
                      <p className="text-xs text-green-500/70">Yield received from repayments</p>
                    </div>
                    <DollarSign className="w-5 h-5 text-green-500" />
                  </div>
                  <p className="text-3xl font-bold text-green-700 mb-2">
                    {formatCurrency(yieldAnalytics.realizedYield.totalRealizedYield)}
                  </p>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-green-600">
                      From <span className="font-semibold">{yieldAnalytics.realizedYield.totalRepayments}</span> repayments
                    </span>
                    {yieldAnalytics.realizedYield.totalPenaltiesReceived > 0 && (
                      <span className="text-green-500 font-medium">
                        Inc. {formatCurrency(yieldAnalytics.realizedYield.totalPenaltiesReceived)} penalties
                      </span>
                    )}
                  </div>
                </div>

                {/* Collection Rate & Variance */}
                <div className={`p-5 rounded-lg border ${yieldAnalytics.variance.status === 'over_target' ? 'bg-emerald-50 border-emerald-100' :
                  yieldAnalytics.variance.status === 'under_target' ? 'bg-amber-50 border-amber-100' :
                    'bg-gray-50 border-gray-100'
                  }`}>
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className={`text-sm font-medium mb-1 ${yieldAnalytics.variance.status === 'over_target' ? 'text-emerald-600' :
                        yieldAnalytics.variance.status === 'under_target' ? 'text-amber-600' :
                          'text-gray-600'
                        }`}>Yield Collection Rate</p>
                      <p className="text-xs text-gray-500">Collected vs. Accrued</p>
                    </div>
                    <BarChart3 className={`w-5 h-5 ${yieldAnalytics.variance.status === 'over_target' ? 'text-emerald-500' :
                      yieldAnalytics.variance.status === 'under_target' ? 'text-amber-500' :
                        'text-gray-500'
                      }`} />
                  </div>
                  <p className={`text-3xl font-bold mb-2 ${yieldAnalytics.variance.status === 'over_target' ? 'text-emerald-700' :
                    yieldAnalytics.variance.status === 'under_target' ? 'text-amber-700' :
                      'text-gray-700'
                    }`}>
                    {yieldAnalytics.revenueRate.toFixed(1)}%
                  </p>
                  <div className="flex items-center gap-1 text-xs">
                    <span className={
                      yieldAnalytics.variance.status === 'over_target' ? 'text-emerald-600' :
                        yieldAnalytics.variance.status === 'under_target' ? 'text-amber-600' :
                          'text-gray-600'
                    }>
                      Variance: <span className="font-semibold">
                        {yieldAnalytics.variance.amount >= 0 ? '+' : ''}{formatCurrency(yieldAnalytics.variance.amount)}
                      </span>
                      {' '}({yieldAnalytics.variance.percentage >= 0 ? '+' : ''}{yieldAnalytics.variance.percentage.toFixed(1)}%)
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Charts Row */}
          <div className="grid md:grid-cols-2 gap-6 mb-8">
            {/* Exposure Distribution Pie Chart */}
            <div className="card">
              <h2 className="text-xl font-semibold mb-6">Liquidity Exposure Breakdown</h2>
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={exposureData}
                    cx="50%"
                    cy="50%"
                    labelLine={true}
                    label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                    outerRadius={100}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {exposureData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => formatCurrency(value)} />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Monthly Yield Trends */}

            <div className="card">
              <h2 className="text-xl font-semibold mb-6">Monthly Yield Trends</h2>
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={yieldData}>
                  <defs>
                    <linearGradient id="colorUtilized" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.8} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorUnutilized" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.8} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(value) => formatCurrency(value)} />
                  <Legend />
                  <Area type="monotone" dataKey="utilized" stroke="#10b981" fillOpacity={1} fill="url(#colorUtilized)" name="Deployed Yield" />
                  <Area type="monotone" dataKey="unutilized" stroke="#6366f1" fillOpacity={1} fill="url(#colorUnutilized)" name="Idle Yield" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Yield Stats */}
          <div className="grid md:grid-cols-2 gap-6 mb-8">
            {/* <div className="card">
              <h2 className="text-xl font-semibold mb-4">Yield Generation</h2>
              <div className="space-y-4">
                <div className="flex justify-between items-center p-4 bg-gray-50 rounded-lg">
                  <div>
                    <p className="text-sm text-gray-600">Utilized Rate (Active Loans)</p>
                    <p className="text-lg font-semibold">5 bps/day</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-gray-600">Monthly Yield</p>
                    <p className="text-lg font-semibold text-status-success">
                      {formatCurrency(yieldData.length > 0 ? yieldData[yieldData.length - 1].utilized : 0)}
                    </p>
                  </div>
                </div>
                <div className="flex justify-between items-center p-4 bg-gray-50 rounded-lg">
                  <div>
                    <p className="text-sm text-gray-600">Unutilized Rate (Idle)</p>
                    <p className="text-lg font-semibold">1 bps/day</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-gray-600">Monthly Yield</p>
                    <p className="text-lg font-semibold text-status-info">
                      {formatCurrency(yieldData.length > 0 ? yieldData[yieldData.length - 1].unutilized : 0)}
                    </p>
                  </div>
                </div>
                <div className="flex justify-between items-center p-4 bg-gradient-to-r from-brand-purple to-brand-magenta rounded-lg text-white">
                  <div>
                    <p className="text-sm text-white/80">Total Monthly Yield</p>
                    <p className="text-xl font-bold">
                      {formatCurrency(yieldData.length > 0 ? yieldData[yieldData.length - 1].total : 0)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-white/80">Annualized Return</p>
                    <p className="text-xl font-bold">
                      {stats.totalApprovedCredit > 0
                        ? ((stats.totalInterestRevenue * 12 / stats.totalApprovedCredit) * 100).toFixed(2)
                        : '0.00'}%
                    </p>
                  </div>
                </div>
              </div>
            </div> */}

            <div className="card">
              <h2 className="text-xl font-semibold mb-4">Liquidity Pool Summary</h2>
              <div className="space-y-4">
                <div className="flex justify-between items-center p-4 bg-green-50 rounded-lg">
                  <span className="font-medium text-green-800">Active PSPs</span>
                  <span className="text-xl font-bold text-green-800">{stats.totalPSPs}</span>
                </div>
                <div className="flex justify-between items-center p-4 bg-amber-50 rounded-lg">
                  <span className="font-medium text-amber-800">Applications In Review</span>
                  <span className="text-xl font-bold text-amber-800">{stats.pendingApplications}</span>
                </div>
                <div className="flex justify-between items-center p-4 bg-gray-100 rounded-lg">
                  <span className="font-medium text-gray-800">Active Financings</span>
                  <span className="text-xl font-bold text-gray-800">{stats.totalFinancings}</span>
                </div>
                <div className="flex justify-between items-center p-4 bg-purple-50 rounded-lg">
                  <span className="font-medium text-purple-800">Total Credit Exposure</span>
                  <span className="text-xl font-bold text-purple-800">
                    {formatCurrency(stats.totalActiveCredit)}
                  </span>
                </div>
              </div>
            </div>
            <EarnedYieldChart yieldData={yieldData} />

          </div>

          {/* Yield Stats */}
          <div className="grid md:grid-cols-1 gap-6 mb-8">
            {/* Earned Yield Chart */}


            {/* <EarnedYieldChart yieldData={yieldData} /> */}

          </div>
        </div>
      </main> 
      }
    </div>
  );
};

export default CFODashboard;
