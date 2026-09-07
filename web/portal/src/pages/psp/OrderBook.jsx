import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { CreditCard, TrendingUp, Wallet, FileText, LogOut, UserPlus } from 'lucide-react';
import Sidebar from '../../components/Sidebar';
import OrderBookTable from '../../components/OrderBookTable';
import { useEffect } from 'react';
import api, { pspAPI } from '../../services/api';
import RequestFinancingModal from '../../components/RequestFinancingModal';
import UploadReceiptModal from '../../components/UploadReceiptModal';
import toast from 'react-hot-toast';

const OrderBook = () => {
  const { user } = useAuth();
  const [selectedOrders, setSelectedOrders] = useState([]);
  const [orders, setOrders] = useState([]);
  const [showFinancingModal, setShowFinancingModal] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [selectedOrderForReceipt, setSelectedOrderForReceipt] = useState(null);
  const [financialData, setFinancialData] = useState({
    totalLimit: 0,
    usedAmount: 0,
    availableAmount: 0,
  });
  const [poolStatus, setPoolStatus] = useState(null);

  const normalizeOrder = (order) => ({
    _id: order.payload.unique_id,
    referenceId: order.payload.unique_id,
    customerName: order.payload.user,
    amount: Number(order.payload.total_amount),
    createdAt: new Date(order.payload.created_at),
    settlementDate: null, // not available yet
    type: order.payload.type,
    status: order.status,
    receiptUrl: order.receiptUrl || null
  });
  const fetchOrders = async () => {
    try {
      const response = await api.get('/psp/order-book');
      const normalizedOrders = response?.data?.map(normalizeOrder);
      setOrders(normalizedOrders);
    } catch (error) {
      console.error('Error fetching orders:', error);
    }
  };

  const fetchProfile = async () => {
    try {
      const poolResponse = await pspAPI.getPoolStatus();
      setPoolStatus(poolResponse.data);

      // Update financial data from blockchain
      setFinancialData({
        totalLimit: parseFloat(poolResponse.data.creditLine) || 0,
        usedAmount: parseFloat(poolResponse.data.utilizedAmount) || 0,
        availableAmount: parseFloat(poolResponse.data.availableCredit) || 0,
      });
    } catch (poolError) {
      console.error('Failed to fetch pool status:', poolError);
      // Use approved amounts from profile if pool status fails
      setFinancialData({
        totalLimit: profileResponse.data.approvedAmount || 0,
        usedAmount: 0,
        availableAmount: profileResponse.data.approvedAmount || 0,
      });
    }
  };

  const handleFinancingSubmit = async (data) => {
    if (poolStatus.isPaused) {
      toast.error("Pool is paused. Please contact CAD Team.");
      throw new Error("Pool is paused. Please contact CAD Team.");
    }
    try {
      // Call async financing API - returns immediately with requestId
      await pspAPI.requestFinancing({
        amount: data.amount,
        orderReference: data.orderReference,
        drawdownTenor: data.drawdownTenor,
      });

      // Refresh data after successful request
      await fetchOrders();

      // Clear selection
      setSelectedOrders([]);
    } catch (err) {
      console.error('Financing request failed:', err);
      throw err;
    }
  };


  useEffect(() => {
    // fetch orders and profile
    fetchOrders();
    fetchProfile()

  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Sidebar */}
      <Sidebar />

      {/* Main Content */}
      <main className="ml-64 p-8">
        <div className="max-w-6xl mx-auto">
          <header className="mb-8">
            <h1 className="page-header">Order Book</h1>
            <p className="text-gray-600">View and manage your settlement data</p>
          </header>

          <OrderBookTable
            orders={orders}
            selectedOrders={selectedOrders}
            onSelectionChange={setSelectedOrders}
            onFinancingRequest={(order) => {
              setSelectedOrders([order._id]);
              setShowFinancingModal(true);
            }}
            onUploadReceipt={(order) => {
              setSelectedOrderForReceipt(order);
              setShowUploadModal(true);
            }}
            onViewReceipt={(url) => {
              window.open(url, '_blank');
            }}
          />
        </div>
      </main>

      {/* Modals */}
      <RequestFinancingModal
        isOpen={showFinancingModal}
        onClose={() => setShowFinancingModal(false)}
        selectedOrders={selectedOrders}
        orders={orders}
        availableLimit={Number(financialData.availableAmount)}
        onSubmit={handleFinancingSubmit}
        maxDrawdownTenor={poolStatus?.drawdown_tenor}
      />

      <UploadReceiptModal
        isOpen={showUploadModal}
        onClose={() => setShowUploadModal(false)}
        order={selectedOrderForReceipt}
        onUploadSuccess={fetchOrders}
      />
    </div>
  );
};

export default OrderBook;
