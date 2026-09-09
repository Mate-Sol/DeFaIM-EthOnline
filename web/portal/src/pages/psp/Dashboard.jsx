import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { CreditCard, TrendingUp, Wallet, FileText, LogOut, Copy, Check, DollarSign, ArrowUpRight, UserPlus, Loader2, Bell, Clock } from 'lucide-react';
import Sidebar from '../../components/Sidebar';
import FinancingStatsCard from '../../components/FinancingStatsCard';
import OrderBookTable from '../../components/OrderBookTable';
import ActiveFinancingTable from '../../components/ActiveFinancingTable';
import RequestFinancingModal from '../../components/RequestFinancingModal';
import RepayModal from '../../components/RepayModal';
import CreditLineExpiryBanner from '../../components/CreditLineExpiryBanner';
import MaintenanceFeeWidget from '../../components/MaintenanceFeeWidget';
import NotificationDropdown from '../../components/NotificationDropdown';
import AlertsBanner from '../../components/common/AlertsBanner';
import { pspAPI, notificationAPI } from '../../services/api';
import { useNavigate } from 'react-router-dom';

const PSPDashboard = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate()




  // stats
  const [copied, setCopied] = useState(false);
  const [selectedOrders, setSelectedOrders] = useState([]);
  const [showFinancingModal, setShowFinancingModal] = useState(false);
  const [showRepayModal, setShowRepayModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [profile, setProfile] = useState(null);
  const [poolStatus, setPoolStatus] = useState(null);
  const [alerts, setAlerts] = useState({ overdueList: [], dueSoonList: [] });

  // Financial data from backend/blockchain
  const [financialData, setFinancialData] = useState({
    totalLimit: 0,
    creditReserve: 0,
    drawableLimit: 0,
    usedAmount: 0,
    availableAmount: 0,
  });

  // Wallet address from backend
  const primaryWallet = Array.isArray(profile?.walletAddress) && profile.walletAddress.length > 0
    ? profile.walletAddress[0]
    : (typeof profile?.walletAddress === 'string' ? { address: profile.walletAddress, name: 'Wallet' } : null);

  const walletAddress = primaryWallet?.address ?
    `${primaryWallet.address.slice(0, 6)}...${primaryWallet.address.slice(-8)}` :
    'Not assigned';
  const fullWalletAddress = primaryWallet?.address || '';

  // Order book data from backend
  const [orders] = useState([
    { _id: 1, referenceId: 'ORD-2026-001', customer: 'TechCorp Inc', amount: 25000, date: '2026-01-25', settlementDate: '2026-02-24', status: 'Pending' },
    { _id: 2, referenceId: 'ORD-2026-002', customer: 'Global Retail', amount: 45000, date: '2026-01-24', settlementDate: '2026-02-23', status: 'Pending' },
    { _id: 3, referenceId: 'ORD-2026-003', customer: 'FastShip LLC', amount: 18000, date: '2026-01-23', settlementDate: '2026-02-22', status: 'Processing' },
    { _id: 4, referenceId: 'ORD-2026-004', customer: 'Metro Services', amount: 32000, date: '2026-01-22', settlementDate: '2026-02-21', status: 'Settled' },
    { _id: 5, referenceId: 'ORD-2026-005', customer: 'DigiPay Corp', amount: 55000, date: '2026-01-21', settlementDate: '2026-02-20', status: 'Pending' },
    { _id: 6, referenceId: 'ORD-2026-006', customer: 'CloudBase Inc', amount: 28000, date: '2026-01-20', settlementDate: '2026-02-19', status: 'Pending' },
    { _id: 7, referenceId: 'ORD-2026-007', customer: 'NextGen Ltd', amount: 42000, date: '2026-01-19', settlementDate: '2026-02-18', status: 'Processing' },
    { _id: 8, referenceId: 'ORD-2026-008', customer: 'Swift Trade', amount: 15000, date: '2026-01-18', settlementDate: '2026-02-17', status: 'Overdue' },
  ]);

  // Fetch dashboard data on mount
  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch profile, order book, and active financings in parallel
      const [profileResponse, financingsResponse] = await Promise.all([
        pspAPI.getProfile(),
        pspAPI.getActiveFinancings()
      ]);

      const profileData = profileResponse.data;
      setProfile(profileData);

      // Compute Alerts
      const tomorrow = new Date();
      tomorrow.setHours(tomorrow.getHours() + 24);
      const now = new Date();

      const overdueList = financingsResponse.data.filter(f =>
        ['Overdue', 'PenaltyApplied'].includes(f.status)
      );

      const dueSoonList = financingsResponse.data.filter(f =>
        f.status === 'Disbursed' &&
        f.dueDate &&
        new Date(f.dueDate) > now &&
        new Date(f.dueDate) < tomorrow
      );

      setAlerts({ overdueList, dueSoonList });

      // If credit line is approved, fetch pool status from blockchain
      if (profileData.creditLineStatus === 'Approved' && profileData.assignedPoolAddress) {
        try {
          const poolResponse = await pspAPI.getPoolStatus();
          setPoolStatus(poolResponse.data);

          // Update financial data from blockchain
          setFinancialData({
            totalLimit: parseFloat(poolResponse.data.creditLine) || 0,
            creditReserve: parseFloat(poolResponse.data.creditReserve) || 0,
            drawableLimit: parseFloat(poolResponse.data.drawableLimit) || 0,
            usedAmount: parseFloat(poolResponse.data.utilizedAmount) || 0,
            availableAmount: parseFloat(poolResponse.data.availableCredit) || 0,
          });
        } catch (poolError) {
          console.error('Failed to fetch pool status:', poolError);
          // Use approved amounts from profile if pool status fails
          const totalInfo = profileResponse.data.approvedCreditLine || profileResponse.data.approvedAmount || 0;
          const reserveInfo = profileResponse.data.creditReserve || 0;
          setFinancialData({
            totalLimit: totalInfo,
            creditReserve: reserveInfo,
            drawableLimit: totalInfo - reserveInfo,
            usedAmount: profileResponse.data.currentlyUtilized || 0,
            availableAmount: (totalInfo - reserveInfo) - (profileResponse.data.currentlyUtilized || 0),
          });
        }
      } else if (profileResponse.data.creditLineStatus === 'Approved') {
        // Use approved amounts from profile
        const totalInfo = profileResponse.data.approvedCreditLine || profileResponse.data.approvedAmount || 0;
        const reserveInfo = profileResponse.data.creditReserve || 0;
        setFinancialData({
          totalLimit: totalInfo,
          creditReserve: reserveInfo,
          drawableLimit: totalInfo - reserveInfo,
          usedAmount: profileResponse.data.currentlyUtilized || 0,
          availableAmount: (totalInfo - reserveInfo) - (profileResponse.data.currentlyUtilized || 0),
        });
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load dashboard data');
      console.error('Dashboard fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  const copyAddress = () => {
    if (fullWalletAddress) {
      navigator.clipboard.writeText(fullWalletAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleFinancingSubmit = async (data) => {
    try {
      // Call async financing API - returns immediately with requestId
      await pspAPI.requestFinancing({
        amount: data.amount,
        orderReference: data.orderReference,
      });

      // Refresh data after successful request
      await fetchDashboardData();

      // Clear selection
      setSelectedOrders([]);
    } catch (err) {
      console.error('Financing request failed:', err);
      throw err;
    }
  };

  const handleRepaySubmit = async (data) => {
    // Repay functionality would be implemented via smart contract
    // For now, simulate the repayment
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Refresh pool status after repayment
    await fetchDashboardData();
  };

  // if (loading) {
  //   return (
  //     <div className="min-h-screen bg-gray-50 flex items-center justify-center">
  //       <div className="text-center">
  //         <Loader2 className="w-12 h-12 animate-spin text-brand-purple mx-auto mb-4" />
  //         <p className="text-gray-600">Loading dashboard...</p>
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
          <p className="text-gray-600">Loading dashboard...</p>
        </div>
      </div>}

      {/* Main Content */}
      {!loading && !error &&
        <main className="ml-64 p-8">
          <div className="max-w-6xl mx-auto">
            {/* Header */}
            <CreditLineExpiryBanner />
            {(profile?.creditLineStatus !== 'Approved' && !!profile?.requestedAmount) && (
              <div className="mb-6 p-4 bg-brand-purple/10 border border-brand-purple/20 rounded-2xl flex items-center justify-between animate-fade-in">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-brand-purple/20 rounded-full flex items-center justify-center">
                    <FileText className="w-5 h-5 text-brand-purple" />
                  </div>
                  <div>
                    <h3 className="font-bold text-gray-900 text-sm">Liquidity Facility Application in Progress</h3>
                    <p className="text-xs text-gray-600">Current Step: <span className="font-bold text-brand-purple">{profile.workflowStep?.replace(/_/g, ' ')}</span></p>
                  </div>
                </div>
                <button
                  onClick={() => navigate('/psp/agrement-onboarding')}
                  className="px-4 py-2 bg-brand-purple text-white text-xs font-bold rounded-xl hover:bg-brand-purple/90 transition-all flex items-center gap-2"
                >
                  View Status & Agreements
                  <ArrowUpRight className="w-4 h-4" />
                </button>
              </div>
            )}
            {!profile?.requestedAmount && profile?.onboardingStatus === 'PRE_QUAL_APPROVED' && (
              <div className="mb-6 p-4 bg-brand-purple/10 border border-brand-purple/20 rounded-2xl flex items-center justify-between animate-fade-in">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-brand-purple/20 rounded-full flex items-center justify-center">
                    <FileText className="w-5 h-5 text-brand-purple" />
                  </div>
                  <div>
                    <h3 className="font-bold text-gray-900 text-sm">Liquidity Facility Application in Progress</h3>
                  </div>
                </div>
                <button
                  onClick={() => navigate('/psp/onboarding')}
                  className="px-4 py-2 bg-brand-purple text-white text-xs font-bold rounded-xl hover:bg-brand-purple/90 transition-all flex items-center gap-2"
                >
                  Complete Onboarding
                  <ArrowUpRight className="w-4 h-4" />
                </button>
              </div>
            )}

            <header className="mb-8 flex justify-between items-start">
              <div>
                <h1 className="page-header mb-1">Welcome, {user?.name}</h1>
                <p className="text-gray-600">Manage your pre-funding facility and liquidity requests</p>
              </div>

              <div className="flex items-center gap-4">
                {/* Settle commit fee on the PSP's pool. The pool contract
                    accrues commit fee lazily on every event; if the PSP
                    repays late in the day or wants to close out, this
                    pays whatever's accrued so lenders can redeem. */}
                <button
                  onClick={() => navigate('/psp/onboarding')}
                  className="btn-secondary flex items-center gap-2"
                >
                  <UserPlus className="w-4 h-4" />
                  View Profile
                </button>
                {/* Notification Dropdown Component */}
                <NotificationDropdown />
              </div>
            </header>

            {/* Alerts Banner */}
            <AlertsBanner overdue={alerts.overdueList} dueSoon={alerts.dueSoonList} />

            {/* Stats Card with Gauge */}
            <div className="mb-8">
              <FinancingStatsCard
                totalLimit={financialData.totalLimit}
                creditReserve={financialData.creditReserve}
                drawableLimit={financialData.drawableLimit}
                usedAmount={financialData.usedAmount}
                availableAmount={financialData.availableAmount}
              />
            </div>

            {/* Maintenance Fee Widget */}
            <div className="mb-8">
              {/* <MaintenanceFeeWidget /> */}
            </div>

            {/* Active Liquidity Section */}
            <div className="mb-8">
              <ActiveFinancingTable />
            </div>

            {/* Action Buttons */}
            <div className="flex gap-4 mb-8">
              {/* <button
              onClick={() => setShowFinancingModal(true)}
              disabled={selectedOrders.length === 0}
              className="btn-brand flex items-center gap-2"
            >
              <DollarSign className="w-5 h-5" />
              Request Financing
              {selectedOrders.length > 0 && (
                <span className="bg-white/20 px-2 py-0.5 rounded text-sm">
                  {selectedOrders.length}
                </span>
              )}
            </button> */}
              {/* <button 
              onClick={() => setShowRepayModal(true)}
              disabled={financialData.usedAmount === 0}
              className="btn-secondary flex items-center gap-2"
            >
              <ArrowUpRight className="w-5 h-5" />
              Repay
            </button> */}
            </div>

            {/* Order Book Table */}
            {/* <OrderBookTable
            orders={orders}
            selectedOrders={selectedOrders}
            onSelectionChange={setSelectedOrders}
          /> */}
          </div>
        </main>
      }

      {/* Modals */}
      <RequestFinancingModal
        isOpen={showFinancingModal}
        onClose={() => setShowFinancingModal(false)}
        selectedOrders={selectedOrders}
        orders={orders}
        availableLimit={financialData.availableAmount}
        onSubmit={handleFinancingSubmit}
      />

      <RepayModal
        isOpen={showRepayModal}
        onClose={() => setShowRepayModal(false)}
        usedAmount={financialData.usedAmount}
        onSubmit={handleRepaySubmit}
      />
    </div>
  );
};

export default PSPDashboard;
