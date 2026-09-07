import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, RefreshCw, Layers } from 'lucide-react';
import toast from 'react-hot-toast';
import OnChainAdminLayout from './Layout';
import FacilityCard from '../../components/defa/FacilityCard';
import { api } from '../../services/evm';

const fmtUsdc = (base) => {
  if (base === undefined || base === null) return '$0';
  const n = Number(BigInt(base) / 1_000_000n);
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
};

const STATE_FILTERS = [
  { id: 'all',       label: 'All' },
  { id: 'funding',   label: 'Funding' },
  { id: 'active',    label: 'Active' },
  { id: 'cancelled', label: 'Cancelled' },
  { id: 'defaulted', label: 'Defaulted' },
];

const Facilities = () => {
  const navigate = useNavigate();
  const [pools, setPools] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      setLoading(true);
      const { data } = await api().get('/pool/pools', { params: { state: filter } });
      setPools(data);
    } catch (e) {
      toast.error(e.response?.data?.message || e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, [filter]);

  const counts = useMemo(() => {
    const c = { all: pools.length, funding: 0, active: 0, cancelled: 0, defaulted: 0 };
    for (const p of pools) {
      if (p.isDefaulted) c.defaulted++;
      else if (p.isCancelled) c.cancelled++;
      else if (p.isActive) c.active++;
      else c.funding++;
    }
    return c;
  }, [pools]);

  return (
    <OnChainAdminLayout>
      <div className="max-w-7xl mx-auto">
        <div className="flex items-end justify-between mb-6 mt-4">
          <div>
            <h1 className="text-4xl font-bold tracking-tight">Facilities</h1>
            <p className="text-white/70 mt-1">Manage initialized pools across all PSPs.</p>
          </div>
          <button onClick={refresh} className="defa-btn-ghost">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>

        {/* Filter pills */}
        <div className="flex flex-wrap gap-2 mb-8">
          {STATE_FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`defa-pill ${filter === f.id ? 'defa-pill-active' : ''}`}
            >
              {f.label}
              {filter === 'all' && <span className="text-white/60 ml-1">({counts[f.id] ?? 0})</span>}
            </button>
          ))}
        </div>

        {loading && pools.length === 0 ? (
          <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-white/70" /></div>
        ) : pools.length === 0 ? (
          <div className="defa-card p-16 text-center">
            <Layers className="w-12 h-12 text-white/40 mx-auto mb-3" />
            <p className="text-lg font-semibold">No facilities</p>
            <p className="text-sm text-white/60 mt-1">Initialize one from the queue.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {pools.map((pool) => (
              <FacilityCard
                key={pool.pubkey}
                pool={pool}
                onOpen={() => navigate(`/onchain-admin/facilities/${pool.pubkey}`)}
              />
            ))}
          </div>
        )}
      </div>
    </OnChainAdminLayout>
  );
};

export default Facilities;
