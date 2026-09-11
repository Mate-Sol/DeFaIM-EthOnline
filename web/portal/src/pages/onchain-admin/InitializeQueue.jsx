import { useEffect, useState } from 'react';
import { useAccount, useSendTransaction } from 'wagmi';
import { Loader2, RefreshCw, Zap, Inbox } from 'lucide-react';
import toast from 'react-hot-toast';
import OnChainAdminLayout from './Layout';
import { api, buildAndSend } from '../../services/evm';

/**
 * How long the new pool accepts deposits before it can be locked.
 *
 * The pool cannot be locked early — finalizeFunding requires
 * block.timestamp >= fMaturityTs — so this window is also the earliest the
 * facility can go live. It is wall-clock seconds and must therefore match the
 * clock of the factory the backend is pointed at: on a fast-clock deployment
 * (where a contract "day" is a real minute) a 7-day window would leave the
 * pool unlockable for a real week.
 */
const FUNDING_WINDOWS = [
  { label: '10 minutes', secs: 600 },
  { label: '1 hour', secs: 3600 },
  { label: '1 day', secs: 86400 },
  { label: '7 days', secs: 7 * 86400 },
];
// Default to the shortest window. It is the only one that always satisfies the
// factory's APR-coverability check, which counts the funding window as part of
// the facility's life — on a fast-clock factory a longer window is sixty-plus
// contract days and is rejected outright. Widening it is a deliberate choice,
// not something an operator should back into by accepting a default.
const DEFAULT_FUNDING_SECS = 600;

const fmtUsd = (n) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  }).format(Number(n) || 0);

/**
 * On-chain admin queue: CRO-approved facilities awaiting factory.createPool.
 *
 * Each row triggers a two-step user-signed flow:
 *   1. POST /admin/build-tx/approve-psp    → factory.approvePsp(pspWallet)
 *   2. POST /admin/build-tx/initialize-pool → factory.createPool(...)
 *
 * Both txs are signed via wagmi's useSendTransaction; server signs nothing.
 * Server-side evmIndexer picks up the PoolCreated event and mirrors the
 * new pool address onto Facility.poolPda within ~90s.
 */
const InitializeQueue = () => {
  const { address, isConnected } = useAccount();
  const { sendTransactionAsync } = useSendTransaction();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [signing, setSigning] = useState(null);
  // facility._id -> funding window in seconds
  const [fundingSecs, setFundingSecs] = useState({});

  const refresh = async () => {
    try {
      setLoading(true);
      const { data } = await api().get('/facility/queue?status=AWAITING_POOL_INIT');
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (e) {
      toast.error(e.response?.data?.message || e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const handleInitialize = async (facility) => {
    if (!isConnected) { toast.error('Connect wallet first'); return; }
    const pspWallet = facility.pspWallet || facility.psp?.walletAddress;
    if (!pspWallet) {
      toast.error('PSP wallet not bound on this facility');
      return;
    }
    setSigning(facility._id);
    try {
      toast.loading('1/2 · approving PSP on factory…', { id: 'init' });
      await buildAndSend(
        address, sendTransactionAsync,
        '/admin/build-tx/approve-psp',
        { pspWallet, facilityId: facility._id },
      );
      toast.loading('2/2 · deploying pool…', { id: 'init' });
      const init = await buildAndSend(
        address, sendTransactionAsync,
        '/admin/build-tx/initialize-pool',
        {
          facilityId: facility._id,
          fundingDurationSecs: fundingSecs[facility._id] ?? DEFAULT_FUNDING_SECS,
        },
      );
      toast.success(`Pool deployed · tx ${init.hash.slice(0, 10)}…`, { id: 'init' });

      // Bind the facility to its new pool now rather than waiting for the
      // indexer's poll. Until that binding happens the facility stays in this
      // queue, still offering a button that can only fail with "PSP has live
      // pool" — and the funding window is already running down while the
      // operator works out why.
      try {
        await api().post(`/pool/admin/confirm-pool-init/${facility._id}`);
      } catch {
        // The indexer reconciles anyway; the row just clears a cycle later.
      }
      refresh();
    } catch (e) {
      toast.error(e.response?.data?.message || e.shortMessage || e.message, { id: 'init' });
    } finally {
      setSigning(null);
    }
  };

  return (
    <OnChainAdminLayout>
      <div className="max-w-7xl mx-auto">
        <div className="flex items-end justify-between mb-8 mt-4">
          <div>
            <h1 className="text-4xl font-bold tracking-tight">Initialize Queue</h1>
            <p className="text-white/70 mt-1">
              CRO-approved facilities awaiting on-chain deployment.
            </p>
          </div>
          <button onClick={refresh} className="defa-btn-ghost">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {loading && items.length === 0 ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-white/70" />
          </div>
        ) : items.length === 0 ? (
          <div className="defa-card p-16 text-center">
            <Inbox className="w-12 h-12 text-white/40 mx-auto mb-3" />
            <p className="text-lg font-semibold">Queue is empty</p>
            <p className="text-sm text-white/60 mt-1">
              CRO approvals will appear here for on-chain deployment.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {items.map((f) => {
              const t = f.approvedTerms || f.requestedTerms || {};
              const pspWallet = f.pspWallet || f.psp?.walletAddress;
              return (
                <div key={f._id} className="defa-card defa-card-hover p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <div className="text-xs uppercase tracking-widest text-white/60 mb-1">
                        Awaiting Init
                      </div>
                      <h3 className="text-xl font-bold">
                        {f.psp?.companyName || 'PSP'}
                      </h3>
                      <code className="text-xs text-white/50 font-mono break-all">
                        {pspWallet}
                      </code>
                      {f.label && (
                        <div className="text-xs text-white/60 mt-1 italic">
                          {f.label}
                        </div>
                      )}
                    </div>
                    <span className="defa-status-pill">Pending</span>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
                    <Stat label="Credit Line" value={fmtUsd(t.creditLine)} />
                    <Stat label="Tenor" value={`${t.tenorDays || 0}d`} />
                    <Stat
                      label="Util / Commit"
                      value={`${t.utilizationRateBps || 0}/${t.commitmentRateBps || 0} bps`}
                    />
                    <Stat
                      label="Penalty"
                      value={`${t.penaltyRateBps || 0} bps/d`}
                    />
                  </div>

                  <label className="block mb-4">
                    <span className="text-xs uppercase tracking-widest text-white/60">
                      Funding window
                    </span>
                    <select
                      value={fundingSecs[f._id] ?? DEFAULT_FUNDING_SECS}
                      onChange={(e) =>
                        setFundingSecs((prev) => ({
                          ...prev,
                          [f._id]: Number(e.target.value),
                        }))
                      }
                      className="defa-input w-full mt-1"
                    >
                      {FUNDING_WINDOWS.map((w) => (
                        <option key={w.secs} value={w.secs}>
                          {w.label}
                        </option>
                      ))}
                    </select>
                    <span className="text-xs text-white/50 mt-1 block">
                      Deposits close after this; the pool can only be locked once
                      it elapses.
                    </span>
                  </label>

                  <button
                    onClick={() => handleInitialize(f)}
                    disabled={!isConnected || signing === f._id}
                    className="defa-btn-primary w-full justify-center"
                  >
                    {signing === f._id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Zap className="w-4 h-4" />
                    )}
                    Approve PSP + Initialize Pool
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </OnChainAdminLayout>
  );
};

const Stat = ({ label, value }) => (
  <div>
    <div className="defa-label">{label}</div>
    <div className="text-base font-semibold tabular-nums">{value}</div>
  </div>
);

export default InitializeQueue;
