import React from 'react';
import { DollarSign, Calendar, Clock, CheckCircle, AlertCircle, Info, ArrowRight, ShieldCheck, FileText } from 'lucide-react';

const FinancingLimitTab = ({ profile }) => {
  if (!profile) return null;

  const getStatusConfig = (status) => {
    switch (status) {
      case 'Approved':
        return { color: 'text-green-600', bg: 'bg-green-50', border: 'border-green-200', icon: CheckCircle, label: 'Approved' };
      case 'Pending':
        return { color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200', icon: Clock, label: 'Pending Review' };
      case 'Rejected':
        return { color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200', icon: AlertCircle, label: 'Rejected' };
      case 'NeedMoreInfo':
        return { color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200', icon: Info, label: 'Need More Information' };
      case 'UnderReview':
        return { color: 'text-indigo-600', bg: 'bg-indigo-50', border: 'border-indigo-200', icon: ShieldCheck, label: 'Under Review' };
      default:
        return { color: 'text-gray-600', bg: 'bg-gray-50', border: 'border-gray-200', icon: Info, label: status || 'No Application' };
    }
  };

  const statusConfig = getStatusConfig(profile.creditLineStatus);
  const StatusIcon = statusConfig.icon;

  const formatDate = (date) => {
    if (!date) return 'N/A';
    return new Date(date).toLocaleDateString();
  };

  const formatCurrency = (amount) => {
    if (amount === undefined || amount === null) return 'N/A';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
  };

  return (
    <div className="space-y-6">
      {/* Status Header */}
      <div className={`p-6 rounded-xl border-2 ${statusConfig.bg} ${statusConfig.border} flex flex-col md:flex-row md:items-center justify-between gap-4`}>
        <div className="flex items-center gap-4">
          <div className={`w-12 h-12 rounded-full ${statusConfig.bg} border-2 ${statusConfig.border} flex items-center justify-center`}>
            <StatusIcon className={`w-6 h-6 ${statusConfig.color}`} />
          </div>
          <div>
            <h3 className={`text-lg font-bold ${statusConfig.color}`}>
              Facility Status: {statusConfig.label}
            </h3>
            <p className="text-sm text-gray-500">
              {profile.creditLineStatus === 'Approved' 
                ? 'Your pre-funding facility is active and ready to deploy.' 
                : 'Current status of your pre-funding application.'}
            </p>
          </div>
        </div>
        
        {profile.workflowStep && (
            <div className="px-4 py-2 bg-white rounded-lg border border-gray-200 shadow-sm">
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider block mb-1">APPROVAL STAGE</span>
                <span className="text-sm font-bold text-gray-700 uppercase">{profile.creditLineStatus === 'Approved' ? 'ACTIVATED' : (profile.workflowStep?.replace(/_/g, ' ') || 'UNDER REVIEW')}</span>
            </div>
        )}
      </div>

      {/* Comparison Grid */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Requested Facility */}
        <div className="card border border-gray-100 shadow-sm hover:shadow-md transition-all">
          <div className="flex items-center gap-2 mb-4 border-b border-gray-50 pb-3">
            <FileText className="w-5 h-5 text-gray-400" />
            <h4 className="font-bold text-gray-700 uppercase tracking-tight text-sm">REQUESTED FACILITY</h4>
          </div>
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-gray-500 text-sm">Facility Size Requested</span>
              <span className="font-bold text-gray-900">{formatCurrency(profile.requestedAmount)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-500 text-sm">Requested Tenure</span>
              <span className="font-medium text-gray-700">{profile.requestedDuration ? `${profile.requestedDuration} Days` : 'N/A'}</span>
            </div>
          </div>
        </div>

        {/* Approved Facility */}
        <div className={`card border shadow-sm transition-all ${profile.creditLineStatus === 'Approved' ? 'border-brand-purple/20 bg-brand-purple/[0.02]' : 'border-gray-100 opacity-60'}`}>
          <div className="flex items-center gap-2 mb-4 border-b border-gray-50 pb-3">
            <CheckCircle className={`w-5 h-5 ${profile.creditLineStatus === 'Approved' ? 'text-brand-purple' : 'text-gray-300'}`} />
            <h4 className="font-bold text-gray-700 uppercase tracking-tight text-sm">APPROVED FACILITY</h4>
          </div>
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-gray-500 text-sm">Approved Facility Size</span>
              <span className={`font-bold ${profile.creditLineStatus === 'Approved' ? 'text-brand-purple text-lg' : 'text-gray-400'}`}>
                {profile.creditLineStatus === 'Approved' ? formatCurrency(profile.approvedAmount) : 'Pending Approval'}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-500 text-sm">Approved Tenure</span>
              <span className="font-medium text-gray-700">
                {profile.approvedDuration ? `${profile.approvedDuration} Days` : 'N/A'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Detailed Approved Stats (Only show if approved) */}
      {profile.creditLineStatus === 'Approved' && (
        <div className="card bg-gray-50 border-none shadow-inner grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <span className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">FACILITY START</span>
            <p className="font-medium text-gray-700">{formatDate(profile.creditLineStartDate)}</p>
          </div>
          <div>
            <span className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">FACILITY END</span>
            <p className="font-medium text-gray-700">{formatDate(profile.creditLineEndDate)}</p>
          </div>
          <div>
            <span className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">UTILISATION RATE</span>
            <p className="font-medium text-gray-700">{profile.utilizedBips} bps</p>
          </div>
          <div>
            <span className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">PENALTY RATE</span>
            <p className="font-medium text-gray-700">{profile.penaltyBips} bps</p>
          </div>
        </div>
      )}

      {/* Message from Admins */}
      {profile.cadMessage && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg flex gap-3">
          <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0" />
          <div className="space-y-1">
            <p className="text-sm font-bold text-amber-900">Review Committee Notes</p>
            <p className="text-sm text-amber-800">{profile.cadMessage}</p>
          </div>
        </div>
      )}

      {/* Pool Information */}
      {/* {profile.assignedPoolAddress && (
        <div className="p-4 bg-gray-100 rounded-lg border border-gray-200 flex items-center justify-between">
           <div className="flex items-center gap-3">
             <ArrowRight className="w-5 h-5 text-gray-400" />
             <div>
               <p className="text-xs text-gray-400 font-bold uppercase tracking-wider">On-chain Pool Address</p>
               <p className="text-sm font-mono text-gray-600 truncate max-w-[200px] md:max-w-none">{profile.assignedPoolAddress}</p>
             </div>
           </div>
           <a 
            href={`https://stellar.expert/explorer/testnet/account/${profile.assignedPoolAddress}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand-purple text-xs font-bold hover:underline"
           >
            View on Explorer
           </a>
        </div>
      )} */}
    </div>
  );
};

export default FinancingLimitTab;
