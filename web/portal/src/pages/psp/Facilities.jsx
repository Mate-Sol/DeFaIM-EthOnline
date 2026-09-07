import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Loader2, RefreshCw, ChevronRight, CheckCircle, Clock, XCircle, Pause,
  TrendingUp, AlertCircle, Layers,
} from 'lucide-react';
import toast from 'react-hot-toast';
import Sidebar from '../../components/Sidebar';
import { api } from '../../services/evm';

const fmtUsdc = (base) => {
  if (base === undefined || base === null) return '$0';
  const n = Number(BigInt(base) / 1_000_000n);
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
};

const Status = ({ f }) => {
  const cls = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border';
  if (f.isDefaulted)  return <span className={`${cls} bg-red-50    text-red-700    border-red-200`}><AlertCircle className="w-3 h-3" />Defaulted</span>;
  if (f.isCancelled)  return <span className={`${cls} bg-gray-50   text-gray-700   border-gray-200`}><Pause className="w-3 h-3" />Cancelled</span>;
  if (f.isActive)     return <span className={`${cls} bg-emerald-50 text-emerald-700 border-emerald-200`}><CheckCircle className="w-3 h-3" />Active</span>;
  return                       <span className={`${cls} bg-blue-50   text-blue-700   border-blue-200`}><Clock className="w-3 h-3" />Funding</span>;
};

const PSPFacilities = () => {
  const navigate = useNavigate();
  const [facilities, setFacilities] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      setLoading(true);
      const { data } = await api().get('/pool/psp/facilities');
      setFacilities(data);
    } catch (e) {
      toast.error(e.response?.data?.message || e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar />
      <main className="ml-64 p-8">
        <div className="max-w-6xl mx-auto">
          <header className="mb-6 flex items-center justify-between">
            <div>
              <h1 className="page-header">My Facilities</h1>
              <p className="text-gray-600 text-sm mt-1">Credit facilities issued to you. Click to view drawdowns and history.</p>
            </div>
            <button onClick={refresh} className="text-gray-500 hover:text-gray-900" title="Refresh">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </header>

          {loading && facilities.length === 0 ? (
            <div className="flex justify-center py-16"><Loader2 className="w-7 h-7 animate-spin text-brand-purple" /></div>
          ) : facilities.length === 0 ? (
            <div className="card p-12 text-center">
              <Layers className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <h3 className="text-base font-semibold text-gray-700 mb-1">No facilities yet</h3>
              <p className="text-sm text-gray-500">
                Once an admin signs <code className="text-xs bg-gray-100 px-1 rounded">initialize_pool</code> for an
                approved credit line, your facility will appear here.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {facilities.map((f) => {
                const utilPct = BigInt(f.totalCapital) > 0n
                  ? Number((BigInt(f.outstandingPrincipal) * 10000n) / BigInt(f.totalCapital)) / 100
                  : 0;
                return (
                  <button
                    key={f.pubkey}
                    onClick={() => navigate(`/psp/facilities/${f.pubkey}`)}
                    className="card p-5 text-left hover:shadow-lg transition-shadow group"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <div className="text-xs text-gray-500 mb-0.5">Facility #{f.facilityId}</div>
                        <div className="font-semibold text-gray-900">{f.pspName}</div>
                        <code className="text-xs text-gray-400 font-mono">{f.pubkey.slice(0, 12)}…</code>
                      </div>
                      <Status f={f} />
                    </div>

                    <div className="grid grid-cols-2 gap-3 mb-3 text-sm">
                      <div>
                        <div className="text-xs text-gray-500">Capacity</div>
                        <div className="text-gray-900 font-semibold">{fmtUsdc(f.totalCapital)}</div>
                        <div className="text-xs text-gray-400">of {fmtUsdc(f.hardCap)} cap</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500">Outstanding</div>
                        <div className="text-gray-900 font-semibold">{fmtUsdc(f.outstandingPrincipal)}</div>
                        <div className="text-xs text-gray-400">{utilPct.toFixed(1)}% utilized</div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-xs text-gray-500 pt-3 border-t border-gray-100">
                      <span>{f.countActiveDrawdowns} active loan{f.countActiveDrawdowns === 1 ? '' : 's'} · {f.facilityTenorDays}d tenor</span>
                      <ChevronRight className="w-4 h-4 group-hover:text-brand-purple transition-colors" />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default PSPFacilities;
