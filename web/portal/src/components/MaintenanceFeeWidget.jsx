import { useState, useEffect } from 'react';
import { AlertCircle, DollarSign, Calendar, TrendingDown, Loader2, CheckCircle, Clock } from 'lucide-react';
import { pspAPI } from '../services/api';

const MaintenanceFeeWidget = () => {
    const [loading, setLoading] = useState(true);
    const [paying, setPaying] = useState(false);
    const [currentCharge, setCurrentCharge] = useState(null);
    const [summary, setSummary] = useState(null);
    const [error, setError] = useState(null);
    const [successMessage, setSuccessMessage] = useState('');

    useEffect(() => {
        fetchMaintenanceData();
    }, []);

    const fetchMaintenanceData = async () => {
        try {
            setLoading(true);
            setError(null);

            const [currentResponse, summaryResponse] = await Promise.all([
                pspAPI.getCurrentMaintenanceCharge(),
                pspAPI.getMaintenanceSummary()
            ]);

            setCurrentCharge(currentResponse.data);
            setSummary(summaryResponse.data);
        } catch (err) {
            console.error('Failed to fetch maintenance data:', err);
            setError(err.response?.data?.message || 'Failed to load maintenance data');
        } finally {
            setLoading(false);
        }
    };

    const handlePayFee = async () => {
        if (!currentCharge?.charge?._id) return;

        try {
            setPaying(true);
            setError(null);

            // TODO: Integrate with smart contract payMaintenanceFee()
            // For now, call API with manual payment
            await pspAPI.payMaintenanceFee(currentCharge.charge._id, {
                txHash: 'MANUAL_PAYMENT' // Replace with actual blockchain tx hash
            });

            setSuccessMessage('Maintenance fee paid successfully!');
            setTimeout(() => setSuccessMessage(''), 3000);

            // Refresh data
            await fetchMaintenanceData();
        } catch (err) {
            console.error('Payment failed:', err);
            setError(err.response?.data?.message || 'Payment failed');
        } finally {
            setPaying(false);
        }
    };

    const formatDate = (dateString) => {
        if (!dateString) return 'N/A';
        return new Date(dateString).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
    };

    const getDaysUntilDue = (dueDate) => {
        if (!dueDate) return null;
        const now = new Date();
        const due = new Date(dueDate);
        const diffTime = due - now;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return diffDays;
    };

    if (loading) {
        return (
            <div className="card">
                <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-brand-purple" />
                </div>
            </div>
        );
    }

    const hasPendingCharge = currentCharge?.hasPendingCharge;
    const charge = currentCharge?.charge;
    const daysUntilDue = charge?.dueDate ? getDaysUntilDue(charge.dueDate) : null;
    const isOverdue = charge?.status === 'Overdue' || (daysUntilDue !== null && daysUntilDue < 0);

    return (
        <div className="card">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                    <TrendingDown className="w-5 h-5 text-brand-purple" />
                    Credit Line Maintenance
                </h3>
                {currentCharge?.accumulatedFee > 0 && (
                    <span className="text-xs text-gray-500">
                        Accumulated: ${currentCharge.accumulatedFee?.toFixed(2)}
                    </span>
                )}
            </div>

            {error && (
                <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">
                    {error}
                </div>
            )}

            {successMessage && (
                <div className="mb-4 p-3 bg-green-50 text-green-700 rounded-lg text-sm flex items-center gap-2">
                    <CheckCircle className="w-4 h-4" />
                    {successMessage}
                </div>
            )}

            {hasPendingCharge ? (
                <>
                    {/* Pending Charge Alert */}
                    <div className={`p-4 rounded-lg mb-4 ${isOverdue ? 'bg-red-50 border border-red-200' : 'bg-amber-50 border border-amber-200'
                        }`}>
                        <div className="flex items-start gap-3">
                            {isOverdue ? (
                                <AlertCircle className="w-5 h-5 text-red-500 mt-0.5" />
                            ) : (
                                <Clock className="w-5 h-5 text-amber-500 mt-0.5" />
                            )}
                            <div className="flex-1">
                                <h4 className={`font-medium ${isOverdue ? 'text-red-900' : 'text-amber-900'}`}>
                                    {isOverdue ? 'Payment Overdue' : 'Payment Due'}
                                </h4>
                                <p className={`text-sm mt-1 ${isOverdue ? 'text-red-700' : 'text-amber-700'}`}>
                                    Weekly maintenance fee for period {formatDate(charge.periodStart)} - {formatDate(charge.periodEnd)}
                                </p>
                                <div className="mt-3 grid grid-cols-2 gap-4">
                                    <div>
                                        <p className="text-xs text-gray-500">Amount Due</p>
                                        <p className={`text-lg font-bold ${isOverdue ? 'text-red-900' : 'text-amber-900'}`}>
                                            ${charge.chargeAmount?.toFixed(2)}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-gray-500">Due Date</p>
                                        <p className={`text-sm font-medium ${isOverdue ? 'text-red-700' : 'text-amber-700'}`}>
                                            {formatDate(charge.dueDate)}
                                            {daysUntilDue !== null && (
                                                <span className="text-xs ml-1">
                                                    ({isOverdue ? `${Math.abs(daysUntilDue)} days overdue` : `${daysUntilDue} days left`})
                                                </span>
                                            )}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Pay Button */}
                    <button
                        onClick={handlePayFee}
                        disabled={paying}
                        className={`btn-brand w-full flex items-center justify-center gap-2 ${isOverdue ? 'bg-red-600 hover:bg-red-700' : ''
                            }`}
                    >
                        {paying ? (
                            <>
                                <Loader2 className="w-5 h-5 animate-spin" />
                                Processing...
                            </>
                        ) : (
                            <>
                                <DollarSign className="w-5 h-5" />
                                Pay Maintenance Fee
                            </>
                        )}
                    </button>
                </>
            ) : (
                /* No Pending Charge */
                <div className="text-center py-6">
                    <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
                    <p className="text-gray-600 mb-2">No pending maintenance fees</p>
                    {currentCharge?.nextDueDate && (
                        <p className="text-sm text-gray-500">
                            Next charge: {formatDate(currentCharge.nextDueDate)}
                        </p>
                    )}
                </div>
            )}

            {/* Summary Stats */}
            {summary && (
                <div className="mt-6 pt-4 border-t border-gray-100">
                    <div className="grid grid-cols-3 gap-4 text-center">
                        <div>
                            <p className="text-xs text-gray-500 mb-1">Available Credit</p>
                            <p className="text-sm font-semibold text-gray-900">
                                ${summary.creditLine?.available?.toLocaleString()}
                            </p>
                        </div>
                        <div>
                            <p className="text-xs text-gray-500 mb-1">Daily Rate</p>
                            <p className="text-sm font-semibold text-gray-900">
                                ${summary.fees?.dailyRate?.toFixed(2)}
                            </p>
                        </div>
                        <div>
                            <p className="text-xs text-gray-500 mb-1">Weekly (est.)</p>
                            <p className="text-sm font-semibold text-gray-900">
                                ${summary.fees?.weeklyProjected?.toFixed(2)}
                            </p>
                        </div>
                    </div>

                    {summary.history && (
                        <div className="mt-3 text-xs text-gray-500 text-center">
                            Total paid: ${summary.history.totalPaid?.toFixed(2)} across {summary.history.totalCharges} charges
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default MaintenanceFeeWidget;
