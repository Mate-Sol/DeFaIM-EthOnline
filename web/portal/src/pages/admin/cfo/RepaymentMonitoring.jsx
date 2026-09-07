import { useNavigate } from 'react-router-dom';
import { Clock, CheckCircle, DollarSign, TrendingUp, AlertCircle, Calendar, Building2, Hash, ExternalLink, Filter, Download, CreditCard, BarChart3, PieChart as PieChartIcon, LogOut, Search, ChevronLeft, ChevronRight, Eye, XCircle } from 'lucide-react';
import { adminAPI, cfoAPI } from '../../../services/api';
import Sidebar from '../../../components/Sidebar';
import { useState } from 'react';
import { useEffect } from 'react';
// Added 2026-04-11, feat/observer-lifecycle-integration.
// Drop-in panel that shows the merged PayMate intent + on-chain reality
// (from the SAFE-Observer reconciliation service) for one drawdown. See
// client/src/components/LifecyclePanel.jsx for the full component.
import LifecyclePanel from '../../../components/LifecyclePanel';
// Added 2026-04-12. Shows Safe vault transactions that DON'T match any
// PayMate drawdown/repayment — flagged as unusual activity for admin review.
// Only renders when there are unmatched events; disappears when all clean.
import UnmatchedActivity from '../../../components/UnmatchedActivity';
import { txExplorerUrl } from '../../../services/explorer';
import moment from 'moment';

const RepaymentMonitoring = () => {
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState('pending'); // 'pending' | 'completed'
    const [pendingRepayments, setPendingRepayments] = useState([]);
    const [completedRepayments, setCompletedRepayments] = useState([]);
    const [psps, setPsps] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedPSP, setSelectedPSP] = useState('all');

    // Separate pagination for tabs
    const [pagePending, setPagePending] = useState(1);
    const [totalItemsPending, setTotalItemsPending] = useState(0);
    const [totalPagesPending, setTotalPagesPending] = useState(0);

    const [pageCompleted, setPageCompleted] = useState(1);
    const [totalItemsCompleted, setTotalItemsCompleted] = useState(0);
    const [totalPagesCompleted, setTotalPagesCompleted] = useState(0);

    // Tracks which pending row is currently expanded to show its
    // reconciled lifecycle panel. Only one row open at a time keeps the
    // UI tidy and limits parallel observer requests. (Added 2026-04-11.)
    const [expandedRef, setExpandedRef] = useState(null);

    const itemsPerPage = 10;

    const [stats, setStats] = useState({
        totalPending: 0,
        totalPendingAmount: 0,
        totalCompleted: 0,
        totalCollected: 0,
        totalInterestCollected: 0
    });

    useEffect(() => {
        // When filters change, reset pages and fetch everything
        setPagePending(1);
        setPageCompleted(1);
        fetchRepaymentData(true); // Fetch both for collective stats
    }, [selectedPSP, searchQuery]);

    useEffect(() => {
        // When individual page changes, fetch only that tab
        if (activeTab === 'pending') {
            fetchPending();
        } else {
            fetchCompleted();
        }
    }, [pagePending, pageCompleted, activeTab]);

    const fetchPending = async () => {
        try {
            const params = { page: pagePending, limit: itemsPerPage, search: searchQuery, pspId: selectedPSP };
            const response = await adminAPI.getAllFinancings(params);
            setPendingRepayments(response.data.financings);
            setTotalItemsPending(response.data.total);
            setTotalPagesPending(response.data.pages);
            if (response.data.psps) setPsps(response.data.psps);

            setStats(prev => ({
                ...prev,
                totalPending: response.data.total,
                totalPendingAmount: response.data.summary?.totalExposure || 0

            }));
        } catch (error) {
            console.error('Failed to fetch pending:', error);
        }
    };

    const fetchCompleted = async () => {
        try {
            const params = { page: pageCompleted, limit: itemsPerPage, search: searchQuery, pspId: selectedPSP };
            const response = await adminAPI.getRepaymentHistory(params);
            setCompletedRepayments(response.data.repayments);
            setTotalItemsCompleted(response.data.total);
            setTotalPagesCompleted(response.data.pages);

            setStats(prev => ({
                ...prev,
                totalCompleted: response.data.summary?.totalRepayments || 0,
                totalCollected: response.data.summary?.totalPrincipal || 0,
                totalInterestCollected: response.data.summary?.totalInterestCollected || 0
            }));
        } catch (error) {
            console.error('Failed to fetch completed:', error);
        }
    };

    const fetchRepaymentData = async (both = false) => {
        setLoading(true);
        try {
            const params = { limit: itemsPerPage, search: searchQuery, pspId: selectedPSP };

            if (both) {
                const [pendingRes, completedRes] = await Promise.all([
                    adminAPI.getAllFinancings({ ...params, page: pagePending }),
                    adminAPI.getRepaymentHistory({ ...params, page: pageCompleted })
                ]);

                setPendingRepayments(pendingRes.data.financings);
                setTotalItemsPending(pendingRes.data.total);
                setTotalPagesPending(pendingRes.data.pages);
                if (pendingRes.data.psps) setPsps(pendingRes.data.psps);

                setCompletedRepayments(completedRes.data.repayments);
                setTotalItemsCompleted(completedRes.data.total);
                setTotalPagesCompleted(completedRes.data.pages);

                setStats({
                    totalPending: pendingRes.data.total,
                    totalPendingAmount: pendingRes.data.summary?.totalExposure || 0,
                    totalCompleted: completedRes.data.summary?.totalRepayments || 0,
                    totalCollected: completedRes.data.summary?.totalPrincipal || 0,
                    totalInterestCollected: completedRes.data.summary?.totalInterestCollected || 0
                });
            } else {
                if (activeTab === 'pending') await fetchPending();
                else await fetchCompleted();
            }
        } catch (error) {
            console.error('Failed to fetch repayment data:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSearchChange = (e) => {
        setSearchQuery(e.target.value);
    };

    const handlePSPFilterChange = (e) => {
        setSelectedPSP(e.target.value);
    };

    const handleTabChange = (tab) => {
        setActiveTab(tab);
    };

    const handlePageChange = (newPage) => {
        if (activeTab === 'pending') setPagePending(newPage);
        else setPageCompleted(newPage);
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

    const calculateDaysOverdue = (dueDate) => {
        if (!dueDate) return 0;
        const start = new Date(dueDate);
        start.setHours(0, 0, 0, 0);
        const end = new Date();
        end.setHours(0, 0, 0, 0);

        if (end <= start) return 0;
        const diffTime = end - start;
        const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
        return diffDays;
    };

    const calculateDuration = (disbursedAt, date2) => {
        if (!disbursedAt || !date2) return 'N/A';
        const start = new Date(disbursedAt);
        start.setHours(0, 0, 0, 0);
        const end = new Date(date2);
        end.setHours(0, 0, 0, 0);
        const diffTime = Math.abs(end - start);
        const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24)) + 1;
        return `${diffDays} days`;
    };


    if (loading) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <div className="text-center">
                    <div className="w-12 h-12 border-4 border-brand-purple/30 border-t-brand-purple rounded-full animate-spin mx-auto mb-4" />
                    <p className="text-gray-600">Loading repayment data...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50 flex">
            {/* Sidebar */}
            <Sidebar />

            {/* Main Content */}
            {/* Added w-full to ensure main takes available width */}
            <main className="ml-64 p-8 w-full">
                {/* Added mx-auto here to center this container */}
                <div className="w-full max-w-6xl mx-auto">

                    {/* Header */}
                    <header className="mb-8">
                        <div className="flex items-center justify-between">
                            <div>
                                <h1 className="page-header">Repayment Monitoring</h1>
                                <p className="text-gray-600">Track pending and completed repayments across all PSPs</p>
                            </div>
                            {/* <button
                                onClick={fetchRepaymentData}
                                className="btn-secondary flex items-center gap-2"
                            >
                                <Download className="w-4 h-4" />
                                Export Report
                            </button> */}
                        </div>
                    </header>

                    {/* Summary Stats */}
                    <div className="grid md:grid-cols-4 gap-6 mb-8">
                        <div className="stats-card">
                            <div className="flex items-center gap-2 mb-2">
                                <Clock className="w-5 h-5 text-amber-600" />
                                <span className="stats-label">Pending Repayments</span>
                            </div>
                            <span className="stats-value text-status-warning">{stats.totalPending}</span>
                        </div>

                        <div className="stats-card">
                            <div className="flex items-center gap-2 mb-2">
                                <TrendingUp className="w-5 h-5 text-red-600" />
                                <span className="stats-label">Amount Outstanding</span>
                            </div>
                            <span className="stats-value text-red-600">{formatCurrency(stats.totalPendingAmount)}</span>
                        </div>

                        <div className="stats-card">
                            <div className="flex items-center gap-2 mb-2">
                                <CheckCircle className="w-5 h-5 text-green-600" />
                                <span className="stats-label">Completed Repayments</span>
                            </div>
                            <span className="stats-value text-status-success">{stats.totalCompleted}</span>
                        </div>

                        <div className="stats-card">
                            <div className="flex items-center gap-2 mb-2">
                                <DollarSign className="w-5 h-5 text-brand-purple" />
                                <span className="stats-label">Total Collected</span>
                            </div>
                            <span className="stats-value text-gradient">{formatCurrency(stats.totalCollected)}</span>
                            <span className="stats-label">Fee: {formatCurrency(stats.totalInterestCollected)}</span>
                        </div>
                    </div>

                    {/* Filters and Search */}
                    <div className="card mb-6 p-4">
                        <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
                            <div className="relative w-full md:w-96">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                                <input
                                    type="text"
                                    placeholder="Search by PSP or Order Reference..."
                                    value={searchQuery}
                                    onChange={handleSearchChange}
                                    className="input-field pl-10"
                                />
                            </div>
                            <div className="flex items-center gap-3 w-full md:w-auto">
                                <Filter className="w-4 h-4 text-gray-500" />
                                <select
                                    className="input-field min-w-[200px]"
                                    value={selectedPSP}
                                    onChange={handlePSPFilterChange}
                                >
                                    <option value="all">All PSPs</option>
                                    {psps.map(psp => (
                                        <option key={psp._id} value={psp._id}>{psp.companyName}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    </div>

                    {/* Tabs */}
                    <div className="card">
                        <div className="flex border-b border-gray-200">
                            <button
                                onClick={() => handleTabChange('pending')}
                                className={`flex-1 px-6 py-4 text-sm font-semibold transition-all ${activeTab === 'pending'
                                    ? 'text-brand-purple border-b-2 border-brand-purple bg-gradient-to-r from-purple-50 to-transparent'
                                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                                    }`}
                            >
                                <div className="flex items-center justify-center gap-2">
                                    <Clock className="w-4 h-4" />
                                    Pending Repayments ({stats.totalPending})
                                </div>
                            </button>
                            <button
                                onClick={() => handleTabChange('completed')}
                                className={`flex-1 px-6 py-4 text-sm font-semibold transition-all ${activeTab === 'completed'
                                    ? 'text-brand-purple border-b-2 border-brand-purple bg-gradient-to-r from-purple-50 to-transparent'
                                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                                    }`}
                            >
                                <div className="flex items-center justify-center gap-2">
                                    <CheckCircle className="w-4 h-4" />
                                    Completed Repayments ({stats.totalCompleted})
                                </div>
                            </button>
                        </div>

                        {/* Pending Repayments Table */}
                        {activeTab === 'pending' && (
                            <div className="overflow-x-auto">
                                {pendingRepayments.length === 0 ? (
                                    <div className="text-center py-12">
                                        <Clock className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                                        <p className="text-gray-500">No pending repayments</p>
                                    </div>
                                ) : (
                                    <table className="w-full">
                                        <thead className="bg-gray-50 border-b border-gray-200">
                                            <tr>
                                                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">PSP</th>
                                                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Order Ref</th>
                                                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Receipt</th>
                                                <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase">Principal</th>
                                                <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase" title="Accrued markup is calculated based on elapsed days since disbursement.">Accrued Markup</th>
                                                <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase">Total Due</th>
                                                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Disbursed</th>
                                                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Due Date</th>
                                                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Duration</th>
                                                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Days Elapsed</th>
                                                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Status</th>
                                                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Transaction</th>

                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-200">
                                            {pendingRepayments.map((financing) => {
                                                const totalDue = (financing.amount || 0) + (financing.accruedInterest?.total || 0) + (financing.penaltyAmount || 0);
                                                const daysOverdue = calculateDaysOverdue(financing.dueDate);
                                                // Key the expanded-state by the FinancingRequest's _id, NOT
                                                // orderReference — under PayMate's revolving-credit flow the
                                                // same orderRef can have multiple draws, and using the orderRef
                                                // as the key would collapse them all into one expanded panel.
                                                const isExpanded = expandedRef === financing._id;

                                                return (
                                                    // Fragment so we can render two adjacent <tr> rows per financing:
                                                    // the existing summary row + a conditional expansion row that
                                                    // contains the SAFE-Observer reconciled lifecycle panel.
                                                    // (Added 2026-04-11, feat/observer-lifecycle-integration.)
                                                    <>
                                                        <tr
                                                            key={financing._id}
                                                            className="hover:bg-gray-50 cursor-pointer"
                                                            onClick={(e) => {
                                                                // Don't toggle when clicking the inner PSP-name button.
                                                                if (e.target.closest('button')) return;
                                                                setExpandedRef(isExpanded ? null : financing._id);
                                                            }}
                                                            title="Click to view reconciled on-chain lifecycle"
                                                        >
                                                            <td className="px-6 py-4">
                                                                <button
                                                                    onClick={() => navigate(`/admin/application/${financing.pspId?._id}`)}
                                                                    className="flex items-center gap-2 text-left hover:text-brand-purple transition-colors"
                                                                >
                                                                    <Building2 className="w-4 h-4 text-gray-400" />
                                                                    <span className="font-medium text-gray-900">{financing.pspId?.companyName || 'N/A'}</span>
                                                                </button>
                                                            </td>
                                                            <td className="px-6 py-4">
                                                                <span className="font-mono text-sm text-gray-600">{financing.orderReference}</span>
                                                            </td>
                                                            <td className="px-6 py-4">
                                                                {financing?.receiptUrl ? (
                                                                    <a
                                                                        href={financing.receiptUrl}
                                                                        target="_blank"
                                                                        rel="noopener noreferrer"
                                                                        className="text-brand-purple hover:text-brand-purple/80 transition-colors"
                                                                    >
                                                                        View Receipt
                                                                    </a>
                                                                ) : (
                                                                    <span className="text-gray-400">No receipt</span>
                                                                )}
                                                            </td>
                                                            <td className="px-6 py-4 text-right font-semibold text-gray-900">
                                                                {formatCurrency(financing.amount)}
                                                            </td>
                                                            <td className="px-6 py-4 text-right">
                                                                <div className="flex flex-col items-end gap-1">
                                                                    <div className="flex items-center gap-1 text-green-600 font-medium" title="Accrued markup is calculated based on elapsed days since disbursement.">
                                                                        <TrendingUp className="w-3.5 h-3.5" />
                                                                        {formatCurrency(financing.accruedInterest?.total || 0)}
                                                                    </div>
                                                                    {financing.penaltyAmount > 0 && (
                                                                        <div className="flex items-center gap-1 text-red-600 font-bold text-[10px] bg-red-50 px-1.5 py-0.5 rounded border border-red-100" title={`Penalty triggered at ${formatDate(financing.penaltyTriggeredAt)}`}>
                                                                            <XCircle className="w-2.5 h-2.5" />
                                                                            + {formatCurrency(financing.penaltyAmount)} Penalty
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </td>
                                                            <td className="px-6 py-4 text-right">
                                                                <span className="text-lg font-bold text-gray-900">
                                                                    {formatCurrency(totalDue)}
                                                                </span>
                                                            </td>
                                                            <td className="px-6 py-4 text-sm text-gray-600">
                                                                {moment(financing.disbursedAt).format('DD MMM YYYY')}
                                                            </td>
                                                            <td className="px-6 py-4 text-sm text-gray-600">
                                                                {moment(financing.dueDate).format('DD MMM YYYY')}
                                                            </td>
                                                            <td className="px-6 py-4 text-sm font-medium text-gray-700">
                                                                {calculateDuration(financing.disbursedAt, financing.dueDate)}
                                                            </td>
                                                            <td className="px-6 py-4">
                                                                <span className="text-sm font-medium text-gray-700">
                                                                    {financing.daysElapsed || 0} days
                                                                </span>
                                                            </td>
                                                            <td className="px-6 py-4">
                                                                {daysOverdue > 0 ? (
                                                                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
                                                                        <AlertCircle className="w-3 h-3" />
                                                                        {daysOverdue} days overdue
                                                                    </span>
                                                                ) : (
                                                                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                                                                        <Clock className="w-3 h-3" />
                                                                        Active
                                                                    </span>
                                                                )}
                                                            </td>
                                                            <td className="px-6 py-4">
                                                                {financing.txHash && (
                                                                    financing.txHash.startsWith('OFFCHAIN-') ? (
                                                                        <span className="text-gray-500 font-mono text-sm uppercase">Manual Record</span>
                                                                    ) : (
                                                                        <a
                                                                            href={`${txExplorerUrl(financing.txHash)}`}
                                                                            target="_blank"
                                                                            rel="noopener noreferrer"
                                                                            className="text-indigo-600 hover:text-indigo-800 inline-flex items-center gap-1 text-sm font-mono"
                                                                        >
                                                                            {financing.txHash.substring(0, 8)}...
                                                                            <ExternalLink className="w-3 h-3" />
                                                                        </a>
                                                                    )
                                                                )}
                                                            </td>
                                                        </tr>
                                                        {isExpanded && (
                                                            <tr>
                                                                <td colSpan={11} style={{ padding: '12px 24px', background: '#f8fafc' }}>
                                                                    {/* Pass drawdownId (= FinancingRequest._id) so we
                                                                        get THIS specific drawdown's lifecycle, not
                                                                        whichever one Mongo's findOne picks under a
                                                                        duplicated orderReference. */}
                                                                    <LifecyclePanel drawdownId={financing._id} />
                                                                </td>
                                                            </tr>
                                                        )}
                                                    </>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        )}

                        {/* Completed Repayments Table */}
                        {activeTab === 'completed' && (
                            <div className="overflow-x-auto">
                                {completedRepayments.length === 0 ? (
                                    <div className="text-center py-12">
                                        <CheckCircle className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                                        <p className="text-gray-500">No completed repayments yet</p>
                                    </div>
                                ) : (
                                    <table className="w-full">
                                        <thead className="bg-gray-50 border-b border-gray-200">
                                            <tr>
                                                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">PSP</th>
                                                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Order Ref</th>
                                                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Receipt</th>

                                                <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase">Principal</th>
                                                <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase" title="Accrued markup is calculated based on elapsed days since disbursement.">Markup Paid</th>
                                                <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase">Total Repaid</th>
                                                <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase">Variance</th>
                                                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Duration</th>
                                                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Repaid On</th>
                                                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Transaction</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-200">
                                            {completedRepayments.map((repayment) => {
                                                // Key the expanded-state by the RepaymentRecord's _id, NOT
                                                // orderReference — multiple repayments can share an orderRef
                                                // under PayMate's revolving-credit flow, and using the orderRef
                                                // would collapse them all into one expanded panel.
                                                const isExpanded = expandedRef === repayment._id;

                                                return (
                                                    <>
                                                        <tr
                                                            key={repayment._id}
                                                            className="hover:bg-gray-50 cursor-pointer"
                                                            onClick={(e) => {
                                                                if (e.target.closest('button')) return;
                                                                setExpandedRef(isExpanded ? null : repayment._id);
                                                            }}
                                                            title="Click to view reconciled on-chain lifecycle"
                                                        >
                                                            <td className="px-6 py-4">
                                                                <button
                                                                    onClick={() => navigate(`/admin/application/${repayment.pspProfileId}`)}
                                                                    className="flex items-center gap-2 text-left hover:text-brand-purple transition-colors"
                                                                >
                                                                    <Building2 className="w-4 h-4 text-gray-400" />
                                                                    <span className="font-medium text-gray-900">{repayment.psp}</span>
                                                                </button>
                                                            </td>
                                                            <td className="px-6 py-4">
                                                                <span className="font-mono text-sm text-gray-600">{repayment.orderReference}</span>
                                                            </td>
                                                            <td className="px-6 py-4">
                                                                {repayment?.receiptUrl ? (
                                                                    <a
                                                                        href={repayment.receiptUrl}
                                                                        target="_blank"
                                                                        rel="noopener noreferrer"
                                                                        className="text-brand-purple hover:text-brand-purple/80 transition-colors"
                                                                    >
                                                                        View Receipt
                                                                    </a>
                                                                ) : (
                                                                    <span className="text-gray-400">No receipt</span>
                                                                )}
                                                            </td>
                                                            <td className="px-6 py-4 text-right font-semibold text-gray-900">
                                                                {formatCurrency(repayment.principal)}
                                                            </td>
                                                            <td className="px-6 py-4 text-right">
                                                                <span className="text-green-600 font-medium" title="Accrued markup is calculated based on elapsed days since disbursement.">
                                                                    {formatCurrency(repayment.actualInterest)}
                                                                </span>
                                                            </td>
                                                            <td className="px-6 py-4 text-right">
                                                                <span className="text-lg font-bold text-gray-900">
                                                                    {formatCurrency(repayment.principal + repayment.actualInterest)}
                                                                </span>
                                                            </td>
                                                            <td className="px-6 py-4 text-right">
                                                                <span className={`font-medium ${repayment.variance >= 0 ? 'text-green-600' : 'text-red-600'
                                                                    }`}>
                                                                    {repayment.variance >= 0 ? '+' : ''}{formatCurrency(repayment.variance)}
                                                                </span>
                                                                <span className="text-xs text-gray-500 block">
                                                                    ({repayment.variancePercentage >= 0 ? '+' : ''}{repayment.variancePercentage?.toFixed(1)}%)
                                                                </span>
                                                            </td>
                                                            <td className="px-6 py-4 text-sm font-medium text-gray-700">
                                                                {calculateDuration(repayment.disbursedAt, repayment.repaymentDate)}
                                                            </td>
                                                            <td className="px-6 py-4 text-sm text-gray-600">
                                                                {formatDate(repayment.repaymentDate)}
                                                            </td>
                                                            <td className="px-6 py-4">
                                                                {repayment.txHash && (
                                                                    repayment.txHash.startsWith('OFFCHAIN-') ? (
                                                                        <span className="text-gray-500 font-mono text-sm uppercase">Manual Record</span>
                                                                    ) : (
                                                                        <a
                                                                            href={`${txExplorerUrl(repayment.txHash)}`}
                                                                            target="_blank"
                                                                            rel="noopener noreferrer"
                                                                            className="text-indigo-600 hover:text-indigo-800 inline-flex items-center gap-1 text-sm font-mono"
                                                                        >
                                                                            {repayment.txHash.substring(0, 8)}...
                                                                            <ExternalLink className="w-3 h-3" />
                                                                        </a>
                                                                    )
                                                                )}
                                                            </td>
                                                        </tr>
                                                        {isExpanded && (
                                                            <tr>
                                                                <td colSpan={10} style={{ padding: '12px 24px', background: '#f8fafc' }}>
                                                                    {/* Pass the SPECIFIC drawdown's id rather than the
                                                                        orderReference — when the orderRef has multiple
                                                                        repayments (revolving credit), each row needs to
                                                                        show its OWN drawdown's lifecycle, not whichever
                                                                        one the orderRef-based lookup happens to pick. */}
                                                                    {repayment.financingRequestId ? (
                                                                        <LifecyclePanel drawdownId={repayment.financingRequestId} />
                                                                    ) : (
                                                                        <LifecyclePanel reference={repayment.orderReference} />
                                                                    )}
                                                                </td>
                                                            </tr>
                                                        )}
                                                    </>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        )}

                        {/* Pagination */}
                        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between bg-gray-50 rounded-b-xl">
                            <div className="text-sm text-gray-500">
                                Showing <span className="font-medium">
                                    {activeTab === 'pending'
                                        ? Math.min((pagePending - 1) * itemsPerPage + 1, totalItemsPending)
                                        : Math.min((pageCompleted - 1) * itemsPerPage + 1, totalItemsCompleted)
                                    }
                                </span> to <span className="font-medium">
                                    {activeTab === 'pending'
                                        ? Math.min(pagePending * itemsPerPage, totalItemsPending)
                                        : Math.min(pageCompleted * itemsPerPage, totalItemsCompleted)
                                    }
                                </span> of <span className="font-medium">
                                    {activeTab === 'pending' ? totalItemsPending : totalItemsCompleted}
                                </span> results
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => handlePageChange((activeTab === 'pending' ? pagePending : pageCompleted) - 1)}
                                    disabled={(activeTab === 'pending' ? pagePending : pageCompleted) === 1}
                                    className="p-2 border border-gray-300 rounded-lg hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm"
                                >
                                    <ChevronLeft className="w-4 h-4" />
                                </button>
                                <button
                                    onClick={() => handlePageChange((activeTab === 'pending' ? pagePending : pageCompleted) + 1)}
                                    disabled={(activeTab === 'pending' ? pagePending : pageCompleted) === (activeTab === 'pending' ? totalPagesPending : totalPagesCompleted) || (activeTab === 'pending' ? totalPagesPending : totalPagesCompleted) === 0}
                                    className="p-2 border border-gray-300 rounded-lg hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm"
                                >
                                    <ChevronRight className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Unmatched vault activity — only shows when there are Safe
                    transactions that don't match any PayMate record. Disappears
                    when everything is clean. Added 2026-04-12. */}
                <UnmatchedActivity />
            </main>
        </div>
    );
};

export default RepaymentMonitoring;
