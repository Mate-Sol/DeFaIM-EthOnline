import { useState, useEffect } from 'react';
import { adminAPI } from '../services/api';
import { AlertCircle, RefreshCw, HandCoins, PauseCircle, PlayCircle, Activity, ShieldCheck, DollarSign } from 'lucide-react';
import toast from 'react-hot-toast';

const formatCurrency = (amount) => {
  if (amount === undefined || amount === null) return 'N/A';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

export default function ActivePoolTab({ applicationId, application }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [poolStatus, setPoolStatus] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchPoolStatus = async () => {
    try {
      setRefreshing(true);
      setError(null);

      // Attempt to query the specific pool functions (e.g. unutilized fee check)
      let twaFee = "0";
      let feeRes;
      try {
        feeRes = await adminAPI.computeUnutilizedFee(applicationId);
        console.log("🚀 ~ fetchPoolStatus ~ feeRes:", feeRes)
        twaFee = feeRes.data.unutilizedFee;
      } catch (err) {
        console.warn("Could not actively compute TWA fees", err);
      }

      setPoolStatus({
        twaFee: twaFee,
        isPaused: feeRes?.data?.isPaused || false,
        accumulatedPenalty: feeRes?.data?.accumulatedPenalty || 0,
      });

    } catch (err) {
      setError(err.message || 'Failed to sync with smart contract');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchPoolStatus();
  }, [applicationId]);

  const handleReplenish = async () => {
    const principal = prompt("1. Enter Principal Replenishment Amount (USD):");
    if (!principal) return;

    try {
      setRefreshing(true);
      await adminAPI.replenishPool(applicationId, {
        principal: parseFloat(principal),
        receiptId: `MANUAL-${Date.now()}`
      });
      toast.success('Pool Replenished Successfully!');
      window.location.reload();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Replenishment failed');
    } finally {
      setRefreshing(false);
    }
  };

  const handlePenalty = async () => {
    if (!window.confirm("Trigger daily penalty calculation explicitly on-chain?")) return;
    try {
      setRefreshing(true);
      await adminAPI.triggerPenalty(applicationId, {
        penaltyAmount: poolStatus?.accumulatedPenalty || 0,
        referenceId: applicationId
      });
      toast.success('Penalty triggered successfully.');
      window.location.reload();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to trigger penalty');
    } finally {
      setRefreshing(false);
    }
  };

  const handlePauseToggle = async () => {
    try {
      setRefreshing(true);
      if (poolStatus?.isPaused) {
        await adminAPI.unpausePool(applicationId);
        toast.success('Pool Unpaused.');
      } else {
        await adminAPI.pausePool(applicationId);
        toast.success('Pool Paused.');
      }
      window.location.reload();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Action failed');
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center p-12">
        <RefreshCw className="w-8 h-8 animate-spin text-brand-purple" />
      </div>
    );
  }

  const drawableLimit = (application.approvedCreditLine || application.approvedAmount || 0) - (application.creditReserve || 0);

  return (
    <div className="animate-fade-in">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Activity className="w-6 h-6 text-brand-purple" />
            Active Pool Console
          </h2>
          <p className="text-gray-500 text-sm font-mono mt-1">Contract: {application.assignedPoolAddress}</p>
        </div>

        <button
          onClick={fetchPoolStatus}
          disabled={refreshing}
          className="btn-secondary flex items-center gap-2 text-sm"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh Blockchain Data
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border-l-4 border-red-500 p-4 mb-6 rounded-r-lg flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 mt-0.5 shrink-0" />
          <p className="text-red-700 text-sm">{error}</p>
        </div>
      )}

      {/* Stats Blocks */}
      <div className="grid md:grid-cols-4 gap-4 mb-8">
        <div className="bg-white border rounded-xl p-4 shadow-sm">
          <p className="text-xs text-gray-500 uppercase font-bold mb-1">Total Limit</p>
          <p className="text-xl font-bold text-gray-900">{formatCurrency(application.approvedCreditLine || application.approvedAmount)}</p>
        </div>
        <div className="bg-white border rounded-xl p-4 shadow-sm border-brand-purple/20">
          <p className="text-xs text-gray-500 uppercase font-bold mb-1">Drawable Limit</p>
          <p className="text-xl font-bold text-brand-purple">{formatCurrency(drawableLimit)}</p>
        </div>
        <div className="bg-gray-50 border rounded-xl p-4 shadow-sm">
          <p className="text-xs text-gray-500 uppercase font-bold mb-1">Credit Reserve (Locked)</p>
          <p className="text-xl font-bold text-gray-700">{formatCurrency(application.creditReserve)}</p>
        </div>
        <div className="bg-amber-50 border rounded-xl p-4 shadow-sm border-amber-200">
          <p className="text-xs text-amber-700 uppercase font-bold mb-1">Currently Utilized</p>
          <p className="text-xl font-bold text-amber-800">{formatCurrency(application.currentlyUtilized)}</p>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6 mb-8">

        {/* On-Chain Trackers */}
        <div className="card">
          <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-green-600" /> Current Accruals
          </h3>
          <div className="space-y-4">
            <div className="flex justify-between items-center py-2 border-b">
              <span className="text-gray-600 text-sm">Time-Weighted Unutilized Fee</span>
              <span className="font-bold text-gray-900">{formatCurrency(poolStatus?.twaFee)}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b">
              <span className="text-gray-600 text-sm">Accumulated Penalty</span>
              <span className="font-bold text-red-600">{formatCurrency(poolStatus.accumulatedPenalty || 0)}</span>
            </div>
            <div className="flex justify-between items-center py-2">
              <span className="text-gray-600 text-sm">Pool Status</span>
              <span className={`px-3 py-1 rounded-full text-xs font-bold ${poolStatus?.isPaused ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                {poolStatus?.isPaused ? 'PAUSED' : 'ACTIVE'}
              </span>
            </div>
          </div>
        </div>

        {/* Administrative Actions */}
        <div className="card border-brand-purple/20 bg-brand-purple/5">
          <h3 className="font-bold text-lg mb-4 text-brand-purple flex items-center gap-2">
            <HandCoins className="w-5 h-5" /> Administrative Interventions
          </h3>

          <div className="space-y-3">
            <button
              onClick={handleReplenish}
              className="w-full bg-white border border-gray-200 hover:border-brand-purple p-3 rounded-lg flex items-center justify-between transition-all group"
            >
              <div className="flex items-center gap-3">
                <div className="bg-blue-100 p-2 rounded-full text-blue-600 group-hover:bg-blue-600 group-hover:text-white transition-colors">
                  <DollarSign className="w-4 h-4" />
                </div>
                <div className="text-left">
                  <p className="text-sm font-bold text-gray-900">Push Replenishment</p>
                  <p className="text-xs text-gray-500">Restore drawable limit for PSP by providing principal</p>
                </div>
              </div>
            </button>

            {/* <button
              onClick={handlePenalty}
              className="w-full bg-white border border-gray-200 hover:border-red-500 p-3 rounded-lg flex items-center justify-between transition-all group"
            >
              <div className="flex items-center gap-3">
                <div className="bg-red-100 p-2 rounded-full text-red-600 group-hover:bg-red-600 group-hover:text-white transition-colors">
                  <AlertCircle className="w-4 h-4" />
                </div>
                <div className="text-left">
                  <p className="text-sm font-bold text-gray-900">Trigger Force Penalty</p>
                  <p className="text-xs text-gray-500">Manually invoke smart contract's penalty hooks</p>
                </div>
              </div>
            </button> */}

            <button
              onClick={handlePauseToggle}
              className={`w-full bg-white border p-3 rounded-lg flex items-center justify-between transition-all group ${poolStatus?.isPaused ? 'border-green-200 hover:border-green-500' : 'border-gray-200 hover:border-orange-500'}`}
            >
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-full transition-colors ${poolStatus?.isPaused ? 'bg-green-100 text-green-600 group-hover:bg-green-600 group-hover:text-white' : 'bg-orange-100 text-orange-600 group-hover:bg-orange-600 group-hover:text-white'}`}>
                  {poolStatus?.isPaused ? <PlayCircle className="w-4 h-4" /> : <PauseCircle className="w-4 h-4" />}
                </div>
                <div className="text-left">
                  <p className="text-sm font-bold text-gray-900">{poolStatus?.isPaused ? 'Unpause Credit Line' : 'Pause Credit Line'}</p>
                  <p className="text-xs text-gray-500">{poolStatus?.isPaused ? 'Re-enable borrowing capabilities' : 'Instantly halt future drawdowns'}</p>
                </div>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
