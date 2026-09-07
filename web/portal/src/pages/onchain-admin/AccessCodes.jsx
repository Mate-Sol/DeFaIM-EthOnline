import { useEffect, useState } from 'react';
import { Loader2, RefreshCw, Plus, Copy, Check, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import OnChainAdminLayout from './Layout';
import { api } from '../../services/evm';

// On-chain admin tool: mint + manage one-time lender access codes.
//   Generate N codes with an optional label → copy + share
//   Filter unused / used / all
//   Revoke unused codes
const AccessCodes = () => {
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState('unused');
  const [loading, setLoading] = useState(true);
  const [genOpen, setGenOpen] = useState(false);
  const [justMinted, setJustMinted] = useState(null); // { codes: [...] }

  const refresh = async (status = filter) => {
    try {
      setLoading(true);
      const { data } = await api().get('/access-code/list', { params: { status } });
      setItems(data.items || []);
    } catch (e) {
      toast.error(e.response?.data?.message || e.message);
    } finally { setLoading(false); }
  };
  useEffect(() => { refresh(filter); /* eslint-disable-next-line */ }, [filter]);

  const revoke = async (code) => {
    if (!window.confirm(`Revoke code ${code}? It will no longer be redeemable.`)) return;
    try {
      await api().delete(`/access-code/${code}`);
      toast.success('Revoked');
      refresh();
    } catch (e) {
      toast.error(e.response?.data?.message || e.message);
    }
  };

  return (
    <OnChainAdminLayout>
      <div className="max-w-7xl mx-auto">
        <div className="flex items-end justify-between mb-6 mt-4 gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Lender Access Codes</h1>
            <p className="text-white/70 text-sm mt-1">
              Mint one-time codes for prospective lenders. Codes bind to the lender's wallet on first
              use — no code needed for subsequent sign-ins.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setGenOpen(true)} className="defa-btn-primary">
              <Plus className="w-4 h-4" /> Generate Codes
            </button>
            <button onClick={() => refresh()} className="defa-btn-ghost">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Filter pills */}
        <div className="flex items-center gap-2 mb-5">
          {[
            ['unused', 'Unused'],
            ['used',   'Redeemed'],
            ['all',    'All'],
          ].map(([k, label]) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`defa-pill ${filter === k ? 'defa-pill-active' : ''}`}
            >
              {label}
            </button>
          ))}
        </div>

        {loading && items.length === 0 ? (
          <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-white/70" /></div>
        ) : items.length === 0 ? (
          <div className="defa-card p-12 text-center text-white/70">
            No codes in this view.
          </div>
        ) : (
          <div className="defa-card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-widest text-white/60">
                  <th className="text-left px-4 py-3">Code</th>
                  <th className="text-left px-4 py-3">Label</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-left px-4 py-3">Redeemed By</th>
                  <th className="text-left px-4 py-3">When</th>
                  <th className="text-right px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((c) => <CodeRow key={c._id} c={c} onRevoke={() => revoke(c.code)} />)}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {genOpen && (
        <GenerateModal
          onClose={() => setGenOpen(false)}
          onSuccess={(codes) => {
            setGenOpen(false);
            setJustMinted({ codes });
            refresh();
          }}
        />
      )}

      {justMinted && (
        <MintedModal codes={justMinted.codes} onClose={() => setJustMinted(null)} />
      )}
    </OnChainAdminLayout>
  );
};

const CodeRow = ({ c, onRevoke }) => {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(c.code);
    setCopied(true);
    toast.success('Copied');
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <tr className="border-t border-white/10">
      <td className="px-4 py-3 font-mono text-sm tracking-wider">{c.code}</td>
      <td className="px-4 py-3 text-white/80">{c.label || <span className="text-white/40">—</span>}</td>
      <td className="px-4 py-3">
        {c.usedAt ? (
          <span className="defa-status-pill" style={{ background: 'rgba(34,197,94,0.20)', borderColor: 'rgba(167,243,208,0.45)' }}>
            Redeemed
          </span>
        ) : (
          <span className="defa-status-pill">Available</span>
        )}
      </td>
      <td className="px-4 py-3">
        {c.usedAt ? (
          <div className="text-xs leading-tight">
            <div className="text-white/90">{c.usedByName || '—'}</div>
            <div className="text-white/55">{c.usedByEmail || ''}</div>
            <div className="text-white/40 font-mono mt-0.5">
              {c.usedByWallet ? `${c.usedByWallet.slice(0, 6)}…${c.usedByWallet.slice(-4)}` : ''}
            </div>
          </div>
        ) : <span className="text-white/40">—</span>}
      </td>
      <td className="px-4 py-3 text-xs text-white/70">
        {c.usedAt ? new Date(c.usedAt).toLocaleString() : `Created ${new Date(c.createdAt).toLocaleDateString()}`}
      </td>
      <td className="px-4 py-3 text-right">
        <div className="inline-flex items-center gap-1">
          {!c.usedAt && (
            <>
              <button onClick={copy} className="defa-btn-ghost px-2 py-1" title="Copy code">
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
              <button onClick={onRevoke} className="defa-btn-ghost px-2 py-1" title="Revoke">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      </td>
    </tr>
  );
};

const GenerateModal = ({ onClose, onSuccess }) => {
  const [count, setCount] = useState(1);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const { data } = await api().post('/access-code/create', { count: Number(count), label: label.trim() });
      onSuccess(data.created);
    } catch (e) {
      toast.error(e.response?.data?.message || e.message);
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
      <div className="defa-card max-w-md w-full p-6"
           style={{ background: 'linear-gradient(135deg, rgba(28,93,214,0.95), rgba(75,160,255,0.85))' }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Generate Access Codes</h2>
          <button onClick={onClose} className="text-white/70 hover:text-white" disabled={busy}><X className="w-5 h-5" /></button>
        </div>

        <label className="defa-label block mb-1.5">How many?</label>
        <input
          type="number" min="1" max="50" value={count}
          onChange={(e) => setCount(e.target.value)}
          className="defa-input mb-4"
          disabled={busy}
        />

        <label className="defa-label block mb-1.5">Label (optional)</label>
        <input
          type="text" value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder='e.g. "for Q3 partners"'
          className="defa-input mb-4"
          disabled={busy}
        />

        <div className="text-[11px] text-white/65 mb-5">
          Each code is one-time use, 12 characters. Codes never expire by default.
        </div>

        <div className="flex gap-2">
          <button onClick={onClose} disabled={busy} className="defa-btn-ghost flex-1 justify-center">Cancel</button>
          <button onClick={submit} disabled={busy || !(count >= 1)} className="defa-btn-primary flex-[2] justify-center">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Generate {count > 1 ? `${count} codes` : 'code'}
          </button>
        </div>
      </div>
    </div>
  );
};

const MintedModal = ({ codes, onClose }) => {
  const [copiedAll, setCopiedAll] = useState(false);
  const text = codes.map((c) => c.code).join('\n');

  const copyAll = async () => {
    await navigator.clipboard.writeText(text);
    setCopiedAll(true);
    toast.success('All codes copied');
    setTimeout(() => setCopiedAll(false), 1800);
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
      <div className="defa-card max-w-md w-full p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">{codes.length === 1 ? 'Code minted' : `${codes.length} codes minted`}</h2>
          <button onClick={onClose} className="text-white/70 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        <div className="text-xs text-white/70 mb-3">
          Share these with your lenders. They won't be shown again — copy them now if you need to.
        </div>

        <div className="defa-card p-3 mb-4 max-h-[40vh] overflow-y-auto" style={{ background: 'rgba(0,0,0,0.20)' }}>
          {codes.map((c) => (
            <div key={c.code} className="font-mono text-sm py-1 flex items-center justify-between">
              <span>{c.code}</span>
              <CodeCopyButton code={c.code} />
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <button onClick={copyAll} className="defa-btn-ghost flex-1 justify-center">
            {copiedAll ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            Copy all
          </button>
          <button onClick={onClose} className="defa-btn-primary flex-1 justify-center">Done</button>
        </div>
      </div>
    </div>
  );
};

const CodeCopyButton = ({ code }) => {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="text-white/60 hover:text-white"
    >
      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
};

export default AccessCodes;
