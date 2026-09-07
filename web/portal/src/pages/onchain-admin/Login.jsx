import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAccount, useSignMessage } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { Loader2, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import OnChainAdminLayout from './Layout';
import { onchainAdminLogin } from '../../services/evm';

/**
 * On-chain admin sign-in via SIWE. The connected EVM wallet must be on the
 * server's ONCHAIN_ADMIN_WALLETS allowlist (env var); otherwise the login
 * request 403s and the user is bounced back with a toast.
 */
const OnChainAdminLogin = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const navigate = useNavigate();
  const [loggingIn, setLoggingIn] = useState(false);
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem('token')) {
      navigate('/onchain-admin/facilities');
    }
  }, []);

  useEffect(() => {
    if (!isConnected || !address || tried) return;
    setTried(true);
    setLoggingIn(true);
    (async () => {
      try {
        await onchainAdminLogin(address, signMessageAsync);
        toast.success('Signed in');
        navigate('/onchain-admin/facilities');
      } catch (e) {
        toast.error(e.response?.data?.message || e.message);
        setTried(false); // let user retry with a different wallet
      } finally {
        setLoggingIn(false);
      }
    })();
  }, [isConnected, address]);

  return (
    <OnChainAdminLayout requireAuth={false}>
      <div className="max-w-md mx-auto mt-24">
        <div className="defa-card p-8 text-center">
          <div className="w-14 h-14 rounded-2xl bg-white/15 border border-white/30 flex items-center justify-center mx-auto mb-5">
            <ShieldCheck className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold mb-2">On-Chain Admin</h1>
          <p className="text-white/70 text-sm mb-6">
            Sign in with your authorised EVM wallet (MetaMask / RainbowKit) to
            deploy and manage facilities. Your wallet must be on the on-chain
            admin allowlist.
          </p>

          <div className="flex justify-center mb-3">
            <ConnectButton />
          </div>

          {loggingIn && (
            <div className="text-white/80 text-sm flex items-center justify-center gap-2 mt-4">
              <Loader2 className="w-4 h-4 animate-spin" />
              Verifying signature…
            </div>
          )}

          {isConnected && !loggingIn && (
            <p className="text-white/60 text-xs mt-4 font-mono break-all">
              {address}
            </p>
          )}
        </div>
      </div>
    </OnChainAdminLayout>
  );
};

export default OnChainAdminLogin;
