import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';
import { FaArrowLeft, FaSave } from 'react-icons/fa';

const CreateOrder = () => {
    const navigate = useNavigate();
    const [formData, setFormData] = useState({
        orderReference: '',
        customerName: '',
        customerEmail: '',
        customerPhone: '',
        amount: '',
        currency: 'USD',
        settlementDate: '',
        invoiceNumber: '',
        invoiceDetails: '',
        notes: ''
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleChange = (e) => {
        setFormData({
            ...formData,
            [e.target.name]: e.target.value
        });
        setError('');
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            await api.post('/external-psp/orderbook', formData);
            navigate('/orderbook');
        } catch (err) {
            setError(err.message || 'Failed to create order');
        } finally {
            setLoading(false);
        }
    };

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
                <h1 className="page-title">Create New Order</h1>
                <p className="page-subtitle">Add a new order to your book</p>
            </div>

            {error && (
                <div className="mb-6 p-4 bg-red-900/50 border border-red-700 rounded-lg text-red-300">
                    {error}
                </div>
            )}

            <div className="card p-8 max-w-3xl mx-auto">
                <form onSubmit={handleSubmit} className="space-y-6">
                    {/* Order Information */}
                    <div>
                        <h2 className="text-xl font-bold text-white mb-4 pb-2 border-b border-dark-700">
                            Order Information
                        </h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="form-group">
                                <label className="label">Order Reference *</label>
                                <input
                                    type="text"
                                    name="orderReference"
                                    value={formData.orderReference}
                                    onChange={handleChange}
                                    className="input"
                                    placeholder="e.g., ORD-2024-001"
                                    required
                                />
                            </div>

                            <div className="form-group">
                                <label className="label">Invoice Number</label>
                                <input
                                    type="text"
                                    name="invoiceNumber"
                                    value={formData.invoiceNumber}
                                    onChange={handleChange}
                                    className="input"
                                    placeholder="e.g., INV-001"
                                />
                            </div>

                            <div className="form-group">
                                <label className="label">Amount *</label>
                                <input
                                    type="number"
                                    name="amount"
                                    value={formData.amount}
                                    onChange={handleChange}
                                    className="input"
                                    placeholder="0.00"
                                    min="0"
                                    step="0.01"
                                    required
                                />
                            </div>

                            <div className="form-group">
                                <label className="label">Currency</label>
                                <select
                                    name="currency"
                                    value={formData.currency}
                                    onChange={handleChange}
                                    className="input"
                                >
                                    <option value="USD">USD</option>
                                    <option value="EUR">EUR</option>
                                    <option value="GBP">GBP</option>
                                    <option value="JPY">JPY</option>
                                </select>
                            </div>

                            <div className="form-group md:col-span-2">
                                <label className="label">Settlement Date *</label>
                                <input
                                    type="date"
                                    name="settlementDate"
                                    value={formData.settlementDate}
                                    onChange={handleChange}
                                    className="input"
                                    required
                                />
                            </div>
                        </div>
                    </div>

                    {/* Customer Information */}
                    <div>
                        <h2 className="text-xl font-bold text-white mb-4 pb-2 border-b border-dark-700">
                            Customer Information
                        </h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="form-group md:col-span-2">
                                <label className="label">Customer Name *</label>
                                <input
                                    type="text"
                                    name="customerName"
                                    value={formData.customerName}
                                    onChange={handleChange}
                                    className="input"
                                    placeholder="Customer's full name"
                                    required
                                />
                            </div>

                            <div className="form-group">
                                <label className="label">Customer Email</label>
                                <input
                                    type="email"
                                    name="customerEmail"
                                    value={formData.customerEmail}
                                    onChange={handleChange}
                                    className="input"
                                    placeholder="customer@example.com"
                                />
                            </div>

                            <div className="form-group">
                                <label className="label">Customer Phone</label>
                                <input
                                    type="tel"
                                    name="customerPhone"
                                    value={formData.customerPhone}
                                    onChange={handleChange}
                                    className="input"
                                    placeholder="+1 (555) 000-0000"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Additional Details */}
                    <div>
                        <h2 className="text-xl font-bold text-white mb-4 pb-2 border-b border-dark-700">
                            Additional Details
                        </h2>
                        <div className="space-y-4">
                            <div className="form-group">
                                <label className="label">Invoice Details</label>
                                <textarea
                                    name="invoiceDetails"
                                    value={formData.invoiceDetails}
                                    onChange={handleChange}
                                    className="input"
                                    rows="3"
                                    placeholder="Describe the invoice or goods/services"
                                />
                            </div>

                            <div className="form-group">
                                <label className="label">Notes</label>
                                <textarea
                                    name="notes"
                                    value={formData.notes}
                                    onChange={handleChange}
                                    className="input"
                                    rows="3"
                                    placeholder="Any additional notes or comments"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Submit Buttons */}
                    <div className="flex items-center gap-4 pt-4">
                        <button
                            type="submit"
                            disabled={loading}
                            className="btn-primary flex-1"
                        >
                            {loading ? (
                                <span className="flex items-center justify-center">
                                    <div className="spinner mr-2"></div>
                                    Creating Order...
                                </span>
                            ) : (
                                <>
                                    <FaSave className="inline mr-2" />
                                    Create Order
                                </>
                            )}
                        </button>
                        <button
                            type="button"
                            onClick={() => navigate('/orderbook')}
                            className="btn-secondary"
                            disabled={loading}
                        >
                            Cancel
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default CreateOrder;
