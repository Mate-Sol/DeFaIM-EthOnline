import React from 'react';
import { AlertCircle, Clock, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const AlertsBanner = ({ overdue = [], dueSoon = [], isAdmin = false }) => {
  const navigate = useNavigate();
  
  if (overdue.length === 0 && dueSoon.length === 0) return null;

  return (
    <div className="space-y-4 mb-8">
      {/* Overdue Alerts */}
      {overdue.length > 0 && (
        <div className="relative overflow-hidden bg-white border-l-4 border-red-500 rounded-xl shadow-sm group hover:shadow-md transition-all duration-300">
          <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
            <AlertCircle size={80} className="text-red-500" />
          </div>
          
          <div className="p-5 flex items-center justify-between relative z-10">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center text-red-600 animate-pulse">
                <AlertCircle size={24} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-900 leading-tight">
                  {overdue.length} CRITICAL OVERDUE {overdue.length === 1 ? 'PAYMENT' : 'PAYMENTS'}
                </h3>
                <p className="text-gray-500 text-sm mt-1">
                  Immediate action required to avoid further penalties and credit line suspension.
                </p>
              </div>
            </div>
            
            {/* <button 
              onClick={() => navigate(isAdmin ? '/admin/repayments' : '/psp/wallet')}
              className="px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg flex items-center gap-2 transition-colors shadow-lg shadow-red-200"
            >
              Track Overdue
              <ChevronRight size={18} />
            </button> */}
          </div>

          {/* Mini list for multiple items if Admin */}
          {isAdmin && overdue.length > 0 && (
            <div className="px-5 pb-4 pt-1 flex flex-wrap gap-2 border-t border-gray-50 bg-gray-50/50">
               {overdue.slice(0, 3).map(item => (
                 <span key={item.id} className="text-xs font-medium px-2.5 py-1 bg-red-100/50 text-red-700 rounded-full border border-red-200">
                    {item.psp}: ${item.amount?.toLocaleString()} ({item.reference})
                 </span>
               ))}
               {overdue.length > 3 && <span className="text-xs text-gray-400 font-medium">+{overdue.length - 3} more</span>}
            </div>
          )}
        </div>
      )}

      {/* Due Soon Alerts */}
      {dueSoon.length > 0 && (
        <div className="relative overflow-hidden bg-white border-l-4 border-amber-500 rounded-xl shadow-sm group hover:shadow-md transition-all duration-300">
          <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
            <Clock size={80} className="text-amber-500" />
          </div>

          <div className="p-5 flex items-center justify-between relative z-10">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-amber-50 rounded-full flex items-center justify-center text-amber-600">
                <Clock size={24} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-900 leading-tight">
                  {dueSoon.length} UPCOMING {dueSoon.length === 1 ? 'DEADLINE' : 'DEADLINES'}
                </h3>
                <p className="text-gray-500 text-sm mt-1">
                  Payments due within the next 24 hours. Ensure wallet balances are sufficient.
                </p>
              </div>
            </div>

            {/* <button 
              onClick={() => navigate(isAdmin ? '/admin/financings' : '/psp/wallet')}
              className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-lg flex items-center gap-2 transition-colors shadow-lg shadow-amber-100"
            >
              Review Deadlines
              <ChevronRight size={18} />
            </button> */}
          </div>
        </div>
      )}
    </div>
  );
};

export default AlertsBanner;
