import { useState, useEffect } from 'react';
import {
    Clock, CheckCircle, DollarSign, AlertCircle,
    Building2, Hash, ExternalLink, Loader2,
    CheckSquare, XCircle
} from 'lucide-react';
import { adminAPI } from '../../../services/api';
import Sidebar from '../../../components/Sidebar';
import Swal from 'sweetalert2';

const RepaymentTracking = () => {
    const [pendingRepayments, setPendingRepayments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [processingId, setProcessingId] = useState(null);
    const [error, setError] = useState(null);
    const [successMessage, setSuccessMessage] = useState(null);

    const fetchPending = async () => {
        try {
            setLoading(true);
            const response = await adminAPI.getPendingRepayments();
            setPendingRepayments(response.data);
            setError(null);
        } catch (err) {
            console.error('Failed to fetch pending repayments:', err);
            setError('Failed to load pending repayments. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchPending();

        // Auto-refresh every 30 seconds
        const interval = setInterval(fetchPending, 30000);
        return () => clearInterval(interval);
    }, []);

    const handleConfirm = async (repaymentId) => {
        const { value: rawTxHash, isConfirmed } = await Swal.fire({
            title: 'Confirm Repayment',
            html: `
                <div class="text-left text-sm text-gray-600">
                    <p class="mb-3">Paste the on-chain Safe transaction hash (optional but recommended).</p>
                    <p class="mb-3 text-xs">It lets the observer match the deposit exactly instead of guessing by amount/timing.</p>
                    <p class="font-semibold text-gray-700">Leave blank to confirm without a hash.</p>
                </div>
            `,
            input: 'text',
            inputPlaceholder: '0x...',
            showCancelButton: true,
            confirmButtonText: 'Confirm',
            confirmButtonColor: '#7C3AED',
            cancelButtonText: 'Cancel',
            inputValidator: (value) => {
                if (value && !/^0x[0-9a-fA-F]+$/.test(value.trim())) {
                    return 'Please enter a valid 0x-prefixed transaction hash';
                }
            }
        });

        if (!isConfirmed) return;

        const txHashTrimmed = (rawTxHash || '').trim();
        const txHashIsReal = /^0x[0-9a-fA-F]+$/.test(txHashTrimmed);

        try {
            setProcessingId(repaymentId);
            setError(null);

            const body = txHashIsReal ? { txHash: txHashTrimmed } : {};
            await adminAPI.confirmRepayment(repaymentId, body);

            setSuccessMessage(`Repayment confirmed! Credit line restored.`);

            // Refresh list
            await fetchPending();

            // Clear success message after 5 seconds
            setTimeout(() => setSuccessMessage(null), 5000);
        } catch (err) {
            console.error('Confirmation failed:', err);
            setError(err.response?.data?.message || 'Failed to confirm repayment. Please check logs.');
        } finally {
            setProcessingId(null);
        }
    };

    const formatCurrency = (value) => {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: 0,
        }).format(value || 0);
    };

    const formatDate = (dateString) => {
        if (!dateString) return 'N/A';
        return new Date(dateString).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    return (
        <div className="min-h-screen bg-gray-50 flex">
            <Sidebar />

            <main className="ml-64 p-8 w-full">
                <div className="w-full max-w-6xl mx-auto">

                    {/* Header */}
                    <header className="mb-8">
                        <div>
                            <h1 className="page-header">Repayment Tracking</h1>
                            <p className="text-gray-600">Review and confirm repayments submitted by PSPs (Off-chain)</p>
                        </div>
                    </header>

                    {/* Notifications */}
                    {error && (
                        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3 text-red-800 animate-in fade-in slide-in-from-top-2">
                            <XCircle className="w-5 h-5 flex-shrink-0" />
                            <p className="text-sm font-medium">{error}</p>
                            <button onClick={() => setError(null)} className="ml-auto text-red-500 hover:text-red-700">
                                <Hash className="w-4 h-4 rotate-45" />
                            </button>
                        </div>
                    )}

                    {successMessage && (
                        <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-3 text-green-800 animate-in fade-in slide-in-from-top-2">
                            <CheckCircle className="w-5 h-5 flex-shrink-0" />
                            <p className="text-sm font-medium">{successMessage}</p>
                        </div>
                    )}

                    {/* Pending Table */}
                    <div className="card shadow-sm border border-gray-200 overflow-hidden">
                        <div className="bg-gray-50 border-b border-gray-200 px-6 py-4">
                            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider flex items-center gap-2">
                                <Clock className="w-4 h-4 text-amber-500" />
                                Repayments Pending Confirmation ({pendingRepayments.length})
                            </h2>
                        </div>

                        <div className="overflow-x-auto">
                            {loading && pendingRepayments.length === 0 ? (
                                <div className="text-center py-20">
                                    <Loader2 className="w-10 h-10 animate-spin text-brand-purple mx-auto mb-4" />
                                    <p className="text-gray-500">Loading pending repayments...</p>
                                </div>
                            ) : pendingRepayments.length === 0 ? (
                                <div className="text-center py-20">
                                    <CheckCircle className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                                    <p className="text-gray-500">No pending repayments to confirm</p>
                                </div>
                            ) : (
                                <table className="w-full text-left">
                                    <thead className="bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-600 uppercase">
                                        <tr>
                                            <th className="px-6 py-3">PSP / Order</th>
                                            <th className="px-6 py-3 text-right">Principal</th>
                                            <th className="px-6 py-3 text-right">Markup</th>
                                            <th className="px-6 py-3 text-right">Total Due</th>
                                            <th className="px-6 py-3">Requested On</th>
                                            <th className="px-6 py-3 text-center">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-200 bg-white">
                                        {pendingRepayments.map((record) => (
                                            <tr key={record._id} className="hover:bg-gray-50 transition-colors">
                                                <td className="px-6 py-4">
                                                    <div className="flex flex-col">
                                                        <div className="flex items-center gap-2 text-gray-900 font-medium">
                                                            <Building2 className="w-4 h-4 text-gray-400" />
                                                            {record.pspId?.companyName}
                                                        </div>
                                                        <div className="flex items-center gap-2 text-xs text-gray-500 mt-1 font-mono">
                                                            <Hash className="w-3 h-3" />
                                                            {record.financingRequestId?.orderReference}
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4 text-right">
                                                    <span className="font-semibold text-gray-900">{formatCurrency(record.principalAmount)}</span>
                                                </td>
                                                <td className="px-6 py-4 text-right">
                                                    <span className="text-green-600 font-medium">{formatCurrency(record.actualInterestPaid)}</span>
                                                </td>
                                                <td className="px-6 py-4 text-right">
                                                    <span className="text-lg font-bold text-gradient">{formatCurrency(record.totalRepayment)}</span>
                                                </td>
                                                <td className="px-6 py-4 text-sm text-gray-500">
                                                    {formatDate(record.createdAt)}
                                                </td>
                                                <td className="px-6 py-4 text-center">
                                                    <button
                                                        onClick={() => handleConfirm(record._id)}
                                                        disabled={processingId === record._id}
                                                        className={`inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-semibold transition-all ${processingId === record._id
                                                                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                                                : 'bg-brand-purple text-white hover:bg-opacity-90 shadow-sm active:scale-95'
                                                            }`}
                                                    >
                                                        {processingId === record._id ? (
                                                            <>
                                                                <Loader2 className="w-4 h-4 animate-spin" />
                                                                Updating...
                                                            </>
                                                        ) : (
                                                            <>
                                                                <CheckSquare className="w-4 h-4" />
                                                                Confirm Repayment
                                                            </>
                                                        )}
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </div>

                    {/* Info Card */}
                    <div className="mt-8 p-4 bg-blue-50 border border-blue-100 rounded-lg flex gap-3">
                        <AlertCircle className="w-5 h-5 text-blue-500 flex-shrink-0" />
                        <div>
                            <p className="text-sm font-medium text-blue-900">Manual Confirmation Logic</p>
                            <p className="text-xs text-blue-700 mt-1 leading-relaxed">
                                Confirming a repayment will manually update the system to reflect receipt of funds off-chain.
                                The PSP's available credit line will be restored by the principal amount,
                                and the financing status will be set to "Repaid".
                                <strong>Ensure the funds have been cleared in the bank before confirming.</strong>
                            </p>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
};

export default RepaymentTracking;
