import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, RefreshCw, Layers, Plus, Building2, Clock } from 'lucide-react';
import toast from 'react-hot-toast';
import PspBorrowLayout from './Layout';
import FacilityCard from '../../../components/defa/FacilityCard';
import QuickRequestModal from '../../../components/defa/QuickRequestModal';
import RequestFacilityModal from '../../../components/defa/RequestFacilityModal';
import { api } from '../../../services/evm';

// PSP-side facility list. Two sections:
//   1. On-chain facilities (initialized pools) — full FacilityCard with stats
//   2. Off-chain only facilities (pending review / awaiting init) — slim row
// Lets PSP request a new facility OR a drawdown against any active one.
const PspBorrowFacilities = () => {
  const navigate = useNavigate();
  const [onChain, setOnChain] = useState([]);     // /pool/psp/facilities
  const [offChain, setOffChain] = useState([]);   // /facility/my (only pending)
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [requestFacilityOpen, setRequestFacilityOpen] = useState(false);
  const [drawdownPool, setDrawdownPool] = useState(null); // { pool, label }

  const refresh = async () => {
    try {
      setLoading(true);
      const [onChainRes, myRes] = await Promise.all([
        api().get('/pool/psp/facilities').catch(() => ({ data: [] })),
        api().get('/facility/my'),
      ]);
      const pools = onChainRes.data || [];

      // Pull lifetime fee aggregates per pool (full signature scan on
      // the server). PSPs typically have a handful of facilities so the
      // parallel cost is bounded. earnedYieldGross is the authoritative
      // lifetime borrower-paid total = util + penalty + settled commit.
      const aggs = await Promise.all(pools.map((p) =>
        api().get(`/pool/pool/${p.pubkey}/fee-aggregates`).then((r) => r.data).catch(() => null)
      ));
      const enriched = pools.map((p, i) => ({
        ...p,
        earnedYieldGross:        aggs[i]?.earnedYieldGross,
        settledCommitLifetime:   aggs[i]?.settledCommitLifetime,
      }));
      setOnChain(enriched);

      // Off-chain shows only pending records (not yet on-chain). Closed/Cancelled too.
      const pending = (myRes.data.items || []).filter((f) =>
        ['REQUESTED','KAM_REVIEW','CAD_REVIEW','CRO_REVIEW','AWAITING_POOL_INIT','CANCELLED'].includes(f.status)
      );
      setOffChain(pending);
    } catch (e) {
      toast.error(e.response?.data?.message || e.message);
    } finally { setLoading(false); }
  };
  useEffect(() => { refresh(); }, [refreshKey]);

  const isFirstFacility = onChain.length === 0
    && offChain.filter((f) => f.status !== 'CANCELLED').length === 0;

  return (
    <PspBorrowLayout>
      <div className="max-w-7xl mx-auto">
        <div className="flex items-end justify-between mb-6 mt-4">
          <div>
            <h1 className="text-4xl font-bold tracking-tight">My Facilities</h1>
            <p className="text-white/70 mt-1">All credit facilities issued to you. Click a card for drawdown details.</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setRequestFacilityOpen(true)} className="defa-btn-primary">
              <Building2 className="w-4 h-4" /> Request New Facility
            </button>
            <button onClick={() => setRefreshKey((k) => k + 1)} className="defa-btn-ghost">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        null

        {loading && onChain.length === 0 && offChain.length === 0 ? (
          <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-white/70" /></div>
        ) : onChain.length === 0 && offChain.length === 0 ? (
          <div className="defa-card p-16 text-center">
            <Layers className="w-12 h-12 text-white/40 mx-auto mb-3" />
            <p className="text-lg font-semibold">No facilities yet</p>
            <p className="text-sm text-white/60 mt-1 mb-4">
              Request your first facility — admin will run KAM, CAD and CRO review on it.
            </p>
            <button onClick={() => setRequestFacilityOpen(true)} className="defa-btn-primary">
              <Plus className="w-4 h-4" /> Request Your First Facility
            </button>
          </div>
        ) : (
          <>
            {/* On-chain facilities */}
            {onChain.length > 0 && (
              <div className="mb-8">
                <h2 className="text-sm uppercase tracking-widest text-white/60 mb-3">Active Facilities</h2>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                  {onChain.map((f) => (
                    <div key={f.pubkey} className="relative">
                      <FacilityCard
                        pool={f}
                        onOpen={() => navigate(`/psp/borrow/facilities/${f.pubkey}`)}
                      />
                      {/* Per-facility drawdown CTA */}
                      <button
                        onClick={(e) => { e.stopPropagation(); setDrawdownPool({ pool: f.pubkey, label: f.pspName || `Facility #${f.facilityId}` }); }}
                        className="absolute top-4 right-4 defa-btn-primary text-xs"
                      >
                        <Plus className="w-3.5 h-3.5" /> Drawdown
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Off-chain (pending review or awaiting init) */}
            {offChain.length > 0 && (
              <div>
                <h2 className="text-sm uppercase tracking-widest text-white/60 mb-3">Pending Facilities</h2>
                <div className="space-y-3">
                  {offChain.map((f) => <PendingFacilityRow key={f._id} f={f} />)}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {requestFacilityOpen && (
        <RequestFacilityModal
          isFirstFacility={isFirstFacility}
          onClose={() => setRequestFacilityOpen(false)}
          onSuccess={() => { setRequestFacilityOpen(false); setRefreshKey((k) => k + 1); }}
        />
      )}

      {drawdownPool && (
        <QuickRequestModal
          pool={drawdownPool.pool}
          facilityLabel={drawdownPool.label}
          onClose={() => setDrawdownPool(null)}
          onSuccess={() => { setDrawdownPool(null); setRefreshKey((k) => k + 1); }}
        />
      )}
    </PspBorrowLayout>
  );
};

const PendingFacilityRow = ({ f }) => {
  const t = f.requestedTerms || {};
  const stage = {
    REQUESTED:           { label: 'Submitted',          tint: 'rgba(99,102,241,0.20)' },
    KAM_REVIEW:          { label: 'KAM review',         tint: 'rgba(99,102,241,0.20)' },
    CAD_REVIEW:          { label: 'CAD review',         tint: 'rgba(99,102,241,0.20)' },
    CRO_REVIEW:          { label: 'CRO review',         tint: 'rgba(99,102,241,0.20)' },
    AWAITING_POOL_INIT:  { label: 'Awaiting pool init', tint: 'rgba(34,197,94,0.20)' },
    CANCELLED:           { label: 'Rejected',           tint: 'rgba(239,68,68,0.20)' },
  }[f.status] || { label: f.status, tint: 'rgba(148,163,184,0.20)' };

  return (
    <div className="defa-card p-4 flex items-center justify-between gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-white/50" />
          <div className="font-semibold">
            Facility #{f.facilityId}
            {f.label && <span className="text-white/60 font-normal ml-1">— {f.label}</span>}
            {f.isFirstFacility && <span className="ml-2 px-1.5 py-0.5 text-[10px] bg-emerald-500/20 text-emerald-200 rounded">first</span>}
          </div>
        </div>
        <div className="text-xs text-white/60 mt-1">
          Requested {new Date(f.requestedAt).toLocaleDateString()} · {fmt(t.creditLine)} cap · {t.tenorDays}d tenor
          {t.utilizationRateBps != null && t.commitmentRateBps != null && t.penaltyRateBps != null ? (
            <> · util {t.utilizationRateBps} / commit {t.commitmentRateBps} / penalty {t.penaltyRateBps} bps</>
          ) : (
            <> · pricing set during CRO review</>
          )}
        </div>
        {f.status === 'CANCELLED' && f.rejectionReason && (
          <div className="text-xs text-red-200 mt-1">Reason: {f.rejectionReason}</div>
        )}
      </div>
      <span className="defa-status-pill" style={{ background: stage.tint, borderColor: 'rgba(255,255,255,0.25)' }}>
        {stage.label}
      </span>
    </div>
  );
};

const fmt = (n) =>
  n
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(n))
    : '—';

export default PspBorrowFacilities;
