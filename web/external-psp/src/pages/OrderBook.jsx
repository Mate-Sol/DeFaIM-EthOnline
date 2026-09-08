import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../utils/api';
import { FaPlus, FaBook, FaFilter, FaSearch } from 'react-icons/fa';
import dayjs from 'dayjs';

const OrderBook = () => {
    const [orders, setOrders] = useState([]);
    const [filteredOrders, setFilteredOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('All');

    useEffect(() => {
        fetchOrders();
    }, []);

    useEffect(() => {
        filterOrders();
    }, [searchTerm, statusFilter, orders]);

    const fetchOrders = async () => {
        try {
            const response = await api.get('/external-psp/orderbook');
            setOrders(response.data);
            setFilteredOrders(response.data);
        } catch (error) {
            console.error('Error fetching orders:', error);
        } finally {
            setLoading(false);
        }
    };

    const filterOrders = () => {
        let filtered = orders;

        // Filter by search term
        if (searchTerm) {
            filtered = filtered.filter(order =>
                order.orderReference.toLowerCase().includes(searchTerm.toLowerCase()) ||
                order.customerName.toLowerCase().includes(searchTerm.toLowerCase())
            );
        }

        // Filter by status
        if (statusFilter !== 'All') {
            filtered = filtered.filter(order => order.loanStatus === statusFilter);
        }

        setFilteredOrders(filtered);
    };

    const getStatusBadge = (status) => {
        const badges = {
            'Pending': 'badge-warning',
            'Completed': 'badge-success',
            'Cancelled': 'badge-danger',
            'Financed': 'badge-info'
        };
        return badges[status] || 'badge-info';
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
            <div className="page-header flex items-center justify-between">
                <div>
                    <h1 className="page-title">Order Book</h1>
                    <p className="page-subtitle">Manage all your orders</p>
                </div>
                <Link to="/orderbook/create" className="btn-primary">
                    <FaPlus className="inline mr-2" />
                    Create Order
                </Link>
            </div>

            {/* Filters */}
            <div className="card p-6 mb-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Search */}
                    <div className="relative">
                        <FaSearch className="absolute left-4 top-1/2 transform -translate-y-1/2 text-dark-400" />
                        <input
                            type="text"
                            placeholder="Search by reference or customer name..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="input pl-12"
                        />
                    </div>

                    {/* Status Filter */}
                    <div className="relative">
                        <FaFilter className="absolute left-4 top-1/2 transform -translate-y-1/2 text-dark-400" />
                        <select
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                            className="input pl-12"
                        >
                            <option value="All">All Loan Statuses</option>
                            <option value="None">No Loan Request</option>
                            <option value="Pending">Pending</option>
                            <option value="Approved">Approved</option>
                            <option value="Disbursed">Disbursed</option>
                            <option value="Rejected">Rejected</option>
                        </select>
                    </div>
                </div>
            </div>

            {/* Orders Table */}
            <div className="card p-6">
                {filteredOrders.length === 0 ? (
                    <div className="text-center py-12">
                        <FaBook className="text-5xl text-dark-600 mx-auto mb-4" />
                        <p className="text-dark-400 mb-4">
                            {searchTerm || statusFilter !== 'All' ? 'No orders match your filters' : 'No orders yet'}
                        </p>
                        <Link to="/orderbook/create" className="btn-primary inline-block">
                            <FaPlus className="inline mr-2" />
                            Create Your First Order
                        </Link>
                    </div>
                ) : (
                    <>
                        <div className="mb-4 flex items-center justify-between">
                            <p className="text-dark-400 text-sm">
                                Showing {filteredOrders.length} of {orders.length} orders
                            </p>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="table">
                                <thead>
                                    <tr>
                                        <th>Order Reference</th>
                                        <th>Customer</th>
                                        <th>Amount</th>
                                        <th>Order Date</th>
                                        <th>Settlement Date</th>
                                        <th>Status</th>
                                        <th>Loan Status</th>
                                        <th>Loan Amount</th>
                                        {/* <th>Actions</th> */}
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredOrders.map((order) => (
                                        <tr key={order._id}>
                                            <td className="font-semibold text-primary-400">
                                                {order.orderReference}
                                            </td>
                                            <td>
                                                <div>
                                                    <div className="font-medium text-white">{order.customerName}</div>
                                                    {order.customerEmail && (
                                                        <div className="text-xs text-dark-400">{order.customerEmail}</div>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="font-semibold text-white">
                                                ${order.amount.toLocaleString()}
                                            </td>
                                            <td className="text-dark-300">
                                                {dayjs(order.orderDate).format('MMM DD, YYYY')}
                                            </td>
                                            <td className="text-dark-300">
                                                {dayjs(order.settlementDate).format('MMM DD, YYYY')}
                                            </td>
                                            <td>
                                                <span className={`badge ${getStatusBadge(order.status)}`}>
                                                    {order.status}
                                                </span>
                                            </td>
                                            <td>
                                                <span className={`badge ${getLoanStatusBadge(order.loanStatus)}`}>
                                                    {order.loanStatus}
                                                </span>
                                            </td>
                                            <td className="text-white">
                                                {order.loanRequestAmount
                                                    ? `$${order.loanRequestAmount.toLocaleString()}`
                                                    : '-'}
                                            </td>
                                            {/* <td>
                                                {!order.loanRequested && (
                                                    <Link
                                                        to={`/loan-request?orderId=${order._id}`}
                                                        className="text-primary-400 hover:text-primary-300 text-sm transition-colors"
                                                    >
                                                        Request Liquidity →
                                                    </Link>
                                                )}
                                                {order.loanRequested && order.loanStatus === 'Pending' && (
                                                    <span className="text-yellow-400 text-sm">Processing...</span>
                                                )}
                                            </td> */}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default OrderBook;
