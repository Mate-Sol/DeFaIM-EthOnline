import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../utils/api';
import {
    FaBook,
    FaDollarSign,
    FaCheckCircle,
    FaClock,
    FaPlus,
    FaChartLine
} from 'react-icons/fa';
import dayjs from 'dayjs';

const Dashboard = () => {
    const { user } = useAuth();
    const [stats, setStats] = useState({
        totalOrders: 0,
        pendingLoans: 0,
        approvedLoans: 0,
        totalFinanced: 0
    });
    const [recentOrders, setRecentOrders] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchDashboardData();
    }, []);

    const fetchDashboardData = async () => {
        try {
            const response = await api.get('/external-psp/orderbook');
            const orders = response.data;

            // Calculate stats
            const totalOrders = orders.length;
            const pendingLoans = orders.filter(o => o.loanStatus === 'Pending').length;
            const approvedLoans = orders.filter(o => o.loanStatus === 'Disbursed' || o.loanStatus === 'Approved').length;
            const totalFinanced = orders
                .filter(o => o.loanStatus === 'Disbursed')
                .reduce((sum, o) => sum + (o.loanRequestAmount || 0), 0);

            setStats({
                totalOrders,
                pendingLoans,
                approvedLoans,
                totalFinanced
            });

            // Get recent orders (last 5)
            setRecentOrders(orders.slice(0, 5));
        } catch (error) {
            console.error('Error fetching dashboard data:', error);
        } finally {
            setLoading(false);
        }
    };

    const getLoanStatusBadge = (status) => {
        const badges = {
            'None': 'badge-info',
            'Pending': 'badge-warning',
            'Approved': 'badge-success',
            'Rejected': 'badge-danger',
            'Disbursed': 'badge-success'
        };
        return badges[status] || 'badge-info';
    };

    if (loading) {
        return (
            <div className="page-container flex items-center justify-center">
                <div className="spinner w-12 h-12"></div>
            </div>
        );
    }

    return (
        <div className="page-container">
            {/* Header */}
            <div className="page-header">
                <h1 className="page-title">Dashboard</h1>
                <p className="page-subtitle">Welcome back, {user?.companyName}</p>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                <div className="stats-card">
                    <div className="flex items-center justify-between mb-4">
                        <div className="p-3 bg-primary-900/50 rounded-lg">
                            <FaBook className="text-2xl text-primary-400" />
                        </div>
                        <div className="text-right">
                            <p className="text-3xl font-bold text-white">{stats.totalOrders}</p>
                            <p className="text-sm text-dark-400">Total Orders</p>
                        </div>
                    </div>
                    <p className="text-xs text-dark-400">All orders in your book</p>
                </div>

                <div className="stats-card">
                    <div className="flex items-center justify-between mb-4">
                        <div className="p-3 bg-yellow-900/50 rounded-lg">
                            <FaClock className="text-2xl text-yellow-400" />
                        </div>
                        <div className="text-right">
                            <p className="text-3xl font-bold text-white">{stats.pendingLoans}</p>
                            <p className="text-sm text-dark-400">Pending Loans</p>
                        </div>
                    </div>
                    <p className="text-xs text-dark-400">Awaiting approval</p>
                </div>

                <div className="stats-card">
                    <div className="flex items-center justify-between mb-4">
                        <div className="p-3 bg-accent-900/50 rounded-lg">
                            <FaCheckCircle className="text-2xl text-accent-400" />
                        </div>
                        <div className="text-right">
                            <p className="text-3xl font-bold text-white">{stats.approvedLoans}</p>
                            <p className="text-sm text-dark-400">Approved Loans</p>
                        </div>
                    </div>
                    <p className="text-xs text-dark-400">Successfully financed</p>
                </div>

                <div className="stats-card">
                    <div className="flex items-center justify-between mb-4">
                        <div className="p-3 bg-blue-900/50 rounded-lg">
                            <FaDollarSign className="text-2xl text-blue-400" />
                        </div>
                        <div className="text-right">
                            <p className="text-3xl font-bold text-white">${stats.totalFinanced.toLocaleString()}</p>
                            <p className="text-sm text-dark-400">Total Financed</p>
                        </div>
                    </div>
                    <p className="text-xs text-dark-400">Total disbursed amount</p>
                </div>
            </div>

            {/* Quick Actions */}
            <div className="grid grid-cols-1  gap-6 mb-8">
                {/* <Link to="/orderbook/create" className="card-hover p-6 block">
                    <div className="flex items-center">
                        <div className="p-4 bg-gradient-green rounded-lg mr-4">
                            <FaPlus className="text-2xl text-white" />
                        </div>
                        <div>
                            <h3 className="text-lg font-semibold text-white mb-1">Create New Order</h3>
                            <p className="text-sm text-dark-400">Add a new order to your book</p>
                        </div>
                    </div>
                </Link> */}

                {/* <Link to="/loan-request" className="card-hover p-6 block">
                    <div className="flex items-center">
                        <div className="p-4 bg-gradient-green-light rounded-lg mr-4">
                            <FaChartLine className="text-2xl text-white" />
                        </div>
                        <div>
                            <h3 className="text-lg font-semibold text-white mb-1">Request Financing</h3>
                            <p className="text-sm text-dark-400">Request Liquidity against your orders</p>
                        </div>
                    </div>
                </Link> */}

                <Link to="/simulate-deposit" className="card-hover p-6 block md:col-span-2 lg:col-span-1">
                    <div className="flex items-center">
                        <div className="p-4 bg-blue-900/50 rounded-lg mr-4">
                            <FaPlus className="text-2xl text-blue-400" />
                        </div>
                        <div>
                            <h3 className="text-lg font-semibold text-white mb-1">Simulate Deposit</h3>
                            <p className="text-sm text-dark-400">Send a test webhook to CredMate</p>
                        </div>
                    </div>
                </Link>
            </div>

            {/* Recent Orders */}
            <div className="card p-6">
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-xl font-bold text-white">Recent Orders</h2>
                    <Link to="/orderbook" className="text-primary-400 hover:text-primary-300 text-sm transition-colors">
                        View All →
                    </Link>
                </div>

                {recentOrders.length === 0 ? (
                    <div className="text-center py-12">
                        <FaBook className="text-5xl text-dark-600 mx-auto mb-4" />
                        <p className="text-dark-400 mb-4">No orders yet</p>
                        <Link to="/orderbook/create" className="btn-primary inline-block">
                            Create Your First Order
                        </Link>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="table">
                            <thead>
                                <tr>
                                    <th>Order Reference</th>
                                    <th>Customer</th>
                                    <th>Amount</th>
                                    <th>Settlement Date</th>
                                    <th>Loan Status</th>
                                    <th>Created</th>
                                </tr>
                            </thead>
                            <tbody>
                                {recentOrders.map((order) => (
                                    <tr key={order._id}>
                                        <td className="font-semibold text-primary-400">{order.orderReference}</td>
                                        <td>{order.customerName}</td>
                                        <td>${order.amount.toLocaleString()}</td>
                                        <td>{dayjs(order.settlementDate).format('MMM DD, YYYY')}</td>
                                        <td>
                                            <span className={`badge ${getLoanStatusBadge(order.loanStatus)}`}>
                                                {order.loanStatus}
                                            </span>
                                        </td>
                                        <td className="text-dark-400">{dayjs(order.createdAt).format('MMM DD, YYYY')}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Dashboard;
