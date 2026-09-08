import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../utils/api';
import { FaArrowLeft, FaPaperPlane, FaCheckCircle, FaExclamationTriangle } from 'react-icons/fa';
import dayjs from 'dayjs';

const LoanRequest = () => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const orderIdFromUrl = searchParams.get('orderId');

    const [orders, setOrders] = useState([]);
    const [selectedOrderId, setSelectedOrderId] = useState(orderIdFromUrl || '');
    const [selectedOrder, setSelectedOrder] = useState(null);
    const [requestedAmount, setRequestedAmount] = useState('');
    const [loading, setLoading] = useState(false);
    const [submitLoading, setSubmitLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    useEffect(() => {
        fetchOrders();
    }, []);

    useEffect(() => {
        if (selectedOrderId) {
            const order = orders.find(o => o._id === selectedOrderId);
            setSelectedOrder(order);
            if (order) {
                setRequestedAmount(order.amount.toString());
            }
        } else {
            setSelectedOrder(null);
            setRequestedAmount('');
        }
    }, [selectedOrderId, orders]);

    const fetchOrders = async () => {
        setLoading(true);
        try {
            const response = await api.get('/external-psp/orderbook');
            // Filter orders that haven't requested loans yet or were rejected
            const availableOrders = response.data.filter(
                order => !order.loanRequested || order.loanStatus === 'Rejected'
            );
            setOrders(availableOrders);
        } catch (err) {
            setError('Failed to load orders');
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setSuccess('');
        setSubmitLoading(true);

        try {
            const response = await api.post('/external-psp/request-loan', {
                orderId: selectedOrderId,
                requestedAmount: parseFloat(requestedAmount)
            });

            setSuccess('Loan request submitted successfully to CredMate!');

            // Redirect after 2 seconds
            setTimeout(() => {
                navigate('/orderbook');
            }, 2000);
        } catch (err) {
            setError(err.message || 'Failed to submit loan request');
        } finally {
            setSubmitLoading(false);
        }
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
                <button
                    onClick={() => navigate('/orderbook')}
                    className="btn-secondary mb-4"
                >
                    <FaArrowLeft className="inline mr-2" />
                    Back to Order Book
                </button>
                <h1 className="page-title">Request Financing</h1>
                <p className="page-subtitle">Request a loan from CredMate against your order</p>
            </div>

            {error && (
                <div className="mb-6 p-4 bg-red-900/50 border border-red-700 rounded-lg text-red-300 flex items-start">
                    <FaExclamationTriangle className="mt-1 mr-3 flex-shrink-0" />
                    <div>{error}</div>
                </div>
            )}

            {success && (
                <div className="mb-6 p-4 bg-primary-900/50 border border-primary-700 rounded-lg text-primary-300 flex items-start">
                    <FaCheckCircle className="mt-1 mr-3 flex-shrink-0" />
                    <div>{success}</div>
                </div>
            )}

            {orders.length === 0 ? (
                <div className="card p-12 text-center">
                    <FaExclamationTriangle className="text-5xl text-yellow-500 mx-auto mb-4" />
                    <h2 className="text-2xl font-bold text-white mb-2">No Available Orders</h2>
                    <p className="text-dark-400 mb-6">
                        You don't have any orders available for loan requests.
                        Either all orders already have pending loan requests or you haven't created any orders yet.
                    </p>
                    <button
                        onClick={() => navigate('/orderbook/create')}
                        className="btn-primary"
                    >
                        Create New Order
                    </button>
                </div>
            ) : (
                <div className="max-w-3xl mx-auto">
                    <form onSubmit={handleSubmit} className="space-y-6">
                        {/* Select Order */}
                        <div className="card p-6">
                            <h2 className="text-xl font-bold text-white mb-4">Select Order</h2>
                            <div className="form-group">
                                <label className="label">Choose an order from your book *</label>
                                <select
                                    value={selectedOrderId}
                                    onChange={(e) => setSelectedOrderId(e.target.value)}
                                    className="input"
                                    required
                                >
                                    <option value="">-- Select an order --</option>
                                    {orders.map((order) => (
                                        <option key={order._id} value={order._id}>
                                            {order.orderReference} - {order.customerName} - ${order.amount.toLocaleString()}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {/* Order Details */}
                        {selectedOrder && (
                            <div className="card p-6">
                                <h2 className="text-xl font-bold text-white mb-4">Order Details</h2>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <p className="text-sm text-dark-400 mb-1">Order Reference</p>
                                        <p className="text-white font-semibold">{selectedOrder.orderReference}</p>
                                    </div>
                                    <div>
                                        <p className="text-sm text-dark-400 mb-1">Customer Name</p>
                                        <p className="text-white font-semibold">{selectedOrder.customerName}</p>
                                    </div>
                                    <div>
                                        <p className="text-sm text-dark-400 mb-1">Order Amount</p>
                                        <p className="text-white font-semibold">${selectedOrder.amount.toLocaleString()}</p>
                                    </div>
                                    <div>
                                        <p className="text-sm text-dark-400 mb-1">Settlement Date</p>
                                        <p className="text-white font-semibold">
                                            {dayjs(selectedOrder.settlementDate).format('MMM DD, YYYY')}
                                        </p>
                                    </div>
                                    {selectedOrder.invoiceNumber && (
                                        <div>
                                            <p className="text-sm text-dark-400 mb-1">Invoice Number</p>
                                            <p className="text-white font-semibold">{selectedOrder.invoiceNumber}</p>
                                        </div>
                                    )}
                                    <div>
                                        <p className="text-sm text-dark-400 mb-1">Order Date</p>
                                        <p className="text-white font-semibold">
                                            {dayjs(selectedOrder.orderDate).format('MMM DD, YYYY')}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Loan Request Amount */}
                        {selectedOrder && (
                            <div className="card p-6">
                                <h2 className="text-xl font-bold text-white mb-4">Loan Request</h2>
                                <div className="form-group">
                                    <label className="label">Requested Amount *</label>
                                    <input
                                        type="number"
                                        value={requestedAmount}
                                        onChange={(e) => setRequestedAmount(e.target.value)}
                                        className="input"
                                        placeholder="0.00"
                                        min="0"
                                        max={selectedOrder.amount}
                                        step="0.01"
                                        required
                                    />
                                    <p className="text-sm text-dark-400 mt-2">
                                        Maximum: ${selectedOrder.amount.toLocaleString()}
                                    </p>
                                </div>

                                <div className="mt-6 p-4 bg-primary-900/20 border border-primary-700 rounded-lg">
                                    <h3 className="font-semibold text-primary-300 mb-2">What happens next?</h3>
                                    <ol className="text-sm text-dark-300 space-y-2">
                                        <li>1. Your request will be sent to CredMate via webhook</li>
                                        <li>2. CredMate will validate your order details with our API</li>
                                        <li>3. If approved, the loan will be processed through their workflow</li>
                                        <li>4. Funds will be disbursed to your account</li>
                                        <li>5. Repayment will be managed on the CredMate PSP portal</li>
                                    </ol>
                                </div>
                            </div>
                        )}

                        {/* Submit Button */}
                        {selectedOrder && (
                            <div className="flex items-center gap-4">
                                <button
                                    type="submit"
                                    disabled={submitLoading}
                                    className="btn-primary flex-1"
                                >
                                    {submitLoading ? (
                                        <span className="flex items-center justify-center">
                                            <div className="spinner mr-2"></div>
                                            Submitting to CredMate...
                                        </span>
                                    ) : (
                                        <>
                                            <FaPaperPlane className="inline mr-2" />
                                            Submit Loan Request
                                        </>
                                    )}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => navigate('/orderbook')}
                                    className="btn-secondary"
                                    disabled={submitLoading}
                                >
                                    Cancel
                                </button>
                            </div>
                        )}
                    </form>
                </div>
            )}
        </div>
    );
};

export default LoanRequest;
