import { useState, useEffect } from 'react';
import WalletBindButton from '../../components/defa/WalletBindButton';
import { useAuth } from '../../context/AuthContext';
import { CreditCard, TrendingUp, Wallet as WalletIcon, FileText, LogOut, UserPlus, Copy, Check, ExternalLink, ArrowDownLeft, ArrowUpRight, Loader2 } from 'lucide-react';
import Sidebar from '../../components/Sidebar';
import { pspAPI } from '../../services/api';
import { txExplorerUrl, addressExplorerUrl } from '../../services/explorer';

const Wallet = () => {
  const { user, logout } = useAuth();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copiedIndex, setCopiedIndex] = useState(null);

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    try {
      setLoading(true);
      const response = await pspAPI.getProfile();
      setProfile(response.data);
    } catch (error) {
      console.error('Failed to fetch profile:', error);
    } finally {
      setLoading(false);
    }
  };

  const copyAddress = (address, index) => {
    navigator.clipboard.writeText(address);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const formatAddress = (address) => {
    if (!address) return '';
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  const balance = 380000; // Mock total balance

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
    }).format(amount);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Sidebar */}
      <Sidebar />

      {/* Main Content */}
      <main className="ml-64 p-8">
        <div className="max-w-4xl mx-auto">
          <header className="mb-8">
            <h1 className="page-header">Wallet</h1>
            <p className="text-gray-600">Your connected wallet for drawdowns and repayments</p>
          </header>

          <div className="mb-8">
            <WalletBindButton
              boundWallet={profile?.primaryWallet}
              signedWallets={profile?.walletAddress}
              onBound={(addr) => setProfile({
                ...profile,
                primaryWallet: addr,
                walletAddress: [
                  { address: addr, name: 'Primary Wallet' },
                  ...(profile?.walletAddress || []).filter(
                    (w) => String(w?.address || '').toLowerCase() !== addr.toLowerCase(),
                  ),
                ],
              })}
            />
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-brand-purple" />
            </div>
          ) : (
            <div className="space-y-6 mb-8">
              {Array.isArray(profile?.walletAddress) && profile.walletAddress.length > 0 ? (
                profile.walletAddress.map((wallet, index) => (
                  <div key={index} className="card bg-brand-gradient text-white overflow-hidden relative">
                    <div className="absolute top-0 right-0 p-8 opacity-10">
                      <WalletIcon className="w-24 h-24" />
                    </div>
                    <div className="relative z-10">
                      <div className="flex items-center justify-between mb-6">
                        <div>
                          <p className="text-white/70 text-sm mb-1">{wallet.name || `Wallet ${index + 1}`}</p>
                          <div className="flex items-center gap-3">
                            <code className="text-xl font-mono">{formatAddress(wallet.address)}</code>
                            <button
                              onClick={() => copyAddress(wallet.address, index)}
                              className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                              title="Copy full address"
                            >
                              {copiedIndex === index ? <Check className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
                            </button>
                            <a
                              href={`${addressExplorerUrl(wallet.address)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                              title="View on Arcscan"
                            >
                              <ExternalLink className="w-5 h-5" />
                            </a>
                          </div>
                        </div>
                        {index === 0 && (
                          <div className="text-right">
                            <p className="text-white/70 text-sm uppercase tracking-wider">Primary Wallet</p>
                            <div className="mt-1 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-white/20 text-white">
                              Active
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="card bg-white border-2 border-dashed border-gray-200 text-center py-12">
                  <WalletIcon className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                  <p className="text-gray-500">No wallet addresses found in your profile.</p>
                </div>
              )}
            </div>
          )}

          {/* Transaction History.

              This listed a `transactions` array that no longer exists — the
              reference survived while the data behind it did not, so the whole
              page threw ReferenceError and rendered blank. A blank page here is
              worse than a missing section: wallet binding lives on this page,
              and binding is a prerequisite for requesting a facility, so anyone
              who landed here saw nothing and moved on believing it was done.

              Left as an honest empty state until it is wired to real data. */}
          <div className="card">
            <h2 className="text-lg font-semibold mb-4">Transaction History</h2>
            <p className="text-sm text-gray-500">
              On-chain activity for this wallet isn't shown here yet — see the facility
              page for drawdowns and repayments.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Wallet;
