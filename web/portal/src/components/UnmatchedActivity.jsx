/**
 * UnmatchedActivity.jsx — flagged unmapped vault transactions
 * ------------------------------------------------------------
 *
 * Shows Safe vault transactions that have NOT been matched to any PayMate
 * drawdown or repayment. These are flagged as "unusual activity" for the
 * admin to investigate — money moved on the vault but PayMate has no
 * corresponding record.
 *
 * This is NOT the same as showing all vault events. It ONLY shows the
 * anomalies — transactions that the reconciliation engine couldn't link
 * to any PayMate drawdown/repayment. If everything is clean (every vault
 * tx maps to a PayMate record), this component shows nothing.
 *
 * Auto-refreshes every 30 seconds.
 *
 * USAGE:
 *   import UnmatchedActivity from '../../components/UnmatchedActivity';
 *   <UnmatchedActivity />
 *
 * ADDED: 2026-04-12
 */

import React, { useEffect, useState, useCallback } from 'react';
import { adminAPI } from '../services/api';
import { AlertCircle } from 'lucide-react';
import { txExplorerUrl } from '../services/explorer';

const UnmatchedActivity = () => {
  const [events, setEvents] = useState([]);
  const [total, setTotal] = useState(0);
  const [available, setAvailable] = useState(true);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    try {
      const res = await adminAPI.getUnmatchedVaultActivity();
      setAvailable(res.data.available);
      setEvents(res.data.events || []);
      setTotal(res.data.total || 0);
    } catch {
      setAvailable(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch();
    const interval = setInterval(fetch, 30000);
    return () => clearInterval(interval);
  }, [fetch]);

  // Don't render anything if observer is unavailable or there are no flags.
  if (loading) return null;
  if (!available) return null;
  if (total === 0) return null;

  const shortHash = (h) => h && h.length > 14 ? `${h.slice(0, 8)}...${h.slice(-6)}` : h || '—';
  const shortAddr = (a) => a && a.length > 14 ? `${a.slice(0, 8)}...${a.slice(-4)}` : a || '—';
  const fmtDate = (s) => {
    if (!s) return '—';
    try { return new Date(s).toLocaleString(); } catch { return s; }
  };

  return (
    <div className="bg-red-50 border border-red-200 rounded-xl p-6 mt-6">
      <div className="flex items-center gap-2 mb-4">
        <AlertCircle className="w-5 h-5 text-red-600" />
        <h3 className="text-md font-semibold text-red-800">
          Unmapped Vault Activity
          <span className="ml-2 text-xs font-normal text-red-500">
            {total} transaction{total !== 1 ? 's' : ''} not linked to any PayMate record
          </span>
        </h3>
      </div>
      <p className="text-xs text-red-600 mb-4">
        These transactions were observed on the Safe vault but don't match any drawdown or repayment in PayMate.
        This could indicate pending transactions, manual transfers, or activity that needs investigation.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-red-200">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-semibold text-red-700 uppercase">Direction</th>
              <th className="px-4 py-2 text-right text-xs font-semibold text-red-700 uppercase">Amount</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-red-700 uppercase">Token</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-red-700 uppercase">From</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-red-700 uppercase">To</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-red-700 uppercase">Time</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-red-700 uppercase">Tx Hash</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-red-100">
            {events.map((e) => (
              <tr key={e.id} className="hover:bg-red-100/50">
                <td className="px-4 py-3">
                  {e.direction === 'out' ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-200 text-red-800">
                      ↗ OUT
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-orange-200 text-orange-800">
                      ↙ IN
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right font-mono font-semibold text-red-900">{e.amount}</td>
                <td className="px-4 py-3 text-red-700">{e.token}</td>
                <td className="px-4 py-3 font-mono text-xs text-red-500" title={e.from}>{shortAddr(e.from)}</td>
                <td className="px-4 py-3 font-mono text-xs text-red-500" title={e.to}>{shortAddr(e.to)}</td>
                <td className="px-4 py-3 text-red-700 text-xs">{fmtDate(e.occurredAt)}</td>
                <td className="px-4 py-3 font-mono text-xs">
                  {e.txHash ? (
                    <a href={txExplorerUrl(e.txHash)}
                       target="_blank" rel="noopener noreferrer"
                       className="text-red-600 hover:underline">
                      {shortHash(e.txHash)}
                    </a>
                  ) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default UnmatchedActivity;
