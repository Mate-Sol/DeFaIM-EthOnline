import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';
import { FaArrowLeft, FaPaperPlane, FaCheckCircle, FaExclamationTriangle } from 'react-icons/fa';
import { useAuth } from '../context/AuthContext';
import axios from 'axios';

const SimulateDeposit = () => {
    const navigate = useNavigate();
    const { user } = useAuth();
    const [formData, setFormData] = useState({
        unique_id: `DEP-${Date.now()}`,
        user: "",
        total_amount: '',
        currency: 'USD',
        type: 'DEPOSIT',
        status: 'PROCESSING',
        created_at: new Date().toISOString().split('T')[0]
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    const handleChange = (e) => {
        setFormData({
            ...formData,
            [e.target.name]: e.target.value
        });
        setError('');
        setSuccess('');
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setSuccess('');
        setLoading(true);

        try {
            const loginResponse = await api.post('/auth/third-party/login', {
                "email": user?.email,
                "password": user?.password
            });
            console.log("🚀 ~ handleSubmit ~ loginResponse:", loginResponse)


            // Webhooks usually require X-API-Key
            await axios.post('https://betaprefunding.invoicemate.net/api/webhook/eficyent/deposits', formData, {
                headers: {
                    'X-API-Key': loginResponse.data.apiKey,
                    "Authorization": `Bearer ${loginResponse?.data?.token}`
                }
            });
            setSuccess('Deposit webhook simulated successfully!');

            // Generate a new unique ID for the next simulation
            setFormData(prev => ({
                ...prev,
                unique_id: ''
            }));
        } catch (err) {
            setError(err.message || 'Failed to simulate deposit webhook');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="page-container">
            {/* Header */}
            <div className="page-header">
                <button
                    onClick={() => navigate('/dashboard')}
                    className="btn-secondary mb-4"
                >
                    <FaArrowLeft className="inline mr-2" />
                    Back to Dashboard
                </button>
                <h1 className="page-title">Simulate Deposit Webhook</h1>
                <p className="page-subtitle">Test how CredMate receives your deposit data</p>
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

            <div className="card p-8 max-w-3xl mx-auto">
                <form onSubmit={handleSubmit} className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="form-group">
                            <label className="label">Unique ID *</label>
                            <input
                                type="text"
                                name="unique_id"
                                value={formData.unique_id}
                                disabled
                                onChange={handleChange}
                                className="input"
                                placeholder="e.g., DEP-123456"
                                required
                            />
                        </div>

                        <div className="form-group">
                            <label className="label">User (Customer) Reference</label>
                            <input
                                type="text"
                                name="user"
                                value={formData.user}
                                onChange={handleChange}
                                className="input"
                                placeholder="Customer account ID"
                            />
                        </div>

                        <div className="form-group">
                            <label className="label">Total Amount *</label>
                            <input
                                type="number"
                                name="total_amount"
                                value={formData.total_amount}
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
                                <option value="ZAR">ZAR</option>
                            </select>
                        </div>

                        <div className="form-group">
                            <label className="label">Transaction Type</label>
                            <select
                                name="type"
                                value={formData.type}
                                onChange={handleChange}
                                className="input"
                            >
                                <option value="DEPOSIT">DEPOSIT</option>
                                <option value="REFUND">REFUND</option>
                                <option value="TOPUP">TOPUP</option>
                            </select>
                        </div>

                        <div className="form-group">
                            <label className="label">Status</label>
                            <input
                                type="text"
                                name="status"
                                value={formData.status}
                                disabled
                                onChange={handleChange}
                                className="input"
                                placeholder="SUCCESS, PENDING, etc."
                            />
                        </div>

                        <div className="form-group md:col-span-2">
                            <label className="label">Creation Date *</label>
                            <input
                                type="date"
                                name="created_at"
                                value={formData.created_at}
                                onChange={handleChange}
                                className="input"
                                required
                            />
                        </div>
                    </div>

                    <div className="pt-4">
                        <button
                            type="submit"
                            disabled={loading}
                            className="btn-primary w-full"
                        >
                            {loading ? (
                                <span className="flex items-center justify-center">
                                    <div className="spinner mr-2"></div>
                                    Sending Webhook...
                                </span>
                            ) : (
                                <>
                                    <FaPaperPlane className="inline mr-2" />
                                    Simulate Webhook Call
                                </>
                            )}
                        </button>
                    </div>
                </form>
            </div>

            <div className="mt-8 p-6 bg-dark-800 rounded-lg border border-dark-700">
                <h3 className="text-lg font-bold text-white mb-2">Simulation Details</h3>
                <div className="space-y-2 text-sm text-dark-300">
                    <p><span className="text-dark-500 font-mono">Endpoint:</span> POST /webhook/eficyent/deposits</p>
                    <p><span className="text-dark-500 font-mono">Headers:</span></p>
                    <ul className="list-disc pl-8 space-y-1">
                        <li>X-API-Key: {user?.apiKey}</li>
                        <li>Authorization: Bearer [JWT TOKEN]</li>
                    </ul>
                </div>
            </div>
        </div>
    );
};

export default SimulateDeposit;
