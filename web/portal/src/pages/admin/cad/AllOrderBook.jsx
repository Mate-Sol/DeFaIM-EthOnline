import { useState, useEffect } from 'react';
import { useAuth } from '../../../context/AuthContext';
import Sidebar from '../../../components/Sidebar';
import AdminOrderBookTable from '../../../components/AdminOrderBookTable';
import { adminAPI } from '../../../services/api';
import toast from 'react-hot-toast';

const AllOrderBook = () => {
  const { user } = useAuth();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');

  const fetchOrders = async () => {
    try {
      setLoading(true);
      const response = await adminAPI.getOrderBook({ page, search, limit: 10 });
      setOrders(response.data.orders);
      setTotalPages(response.data.pages);
    } catch (error) {
      console.error('Error fetching all orderbooks:', error);
      toast.error('Failed to load orderbook data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, [page, search]);

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar />

      <main className="ml-64 p-8">
        <div className="max-w-7xl mx-auto">
          <header className="mb-8">
            <h1 className="page-header">Global Order Books</h1>
            <p className="text-gray-600">Unified view of all settlement data (Efficient Deposits) across all partners</p>
          </header>

          <AdminOrderBookTable
            orders={orders}
            loading={loading}
            currentPage={page}
            totalPages={totalPages}
            onPageChange={setPage}
            onSearch={(term) => {
              setSearch(term);
              setPage(1);
            }}
          />
        </div>
      </main>
    </div>
  );
};

export default AllOrderBook;
