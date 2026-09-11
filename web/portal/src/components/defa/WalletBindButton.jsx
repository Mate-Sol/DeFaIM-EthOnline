import { useState } from 'react';
import { useAccount, useSignMessage } from 'wagmi';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { Loader2, Wallet, Check } from 'lucide-react';
import toast from 'react-hot-toast';
import { walletBind } from '../../services/evm';

/**
 * Has this address actually been proved, or was it seeded?
 *
 * `/auth/wallet/bind` pushes into `walletAddress` after verifying a SIWE
 * signature. Seeding writes `primaryWallet` directly and leaves the array
 * empty. Treating a seeded address as bound is what made this button vanish
 * for the one person who most needed it: the page rendered a green "Wallet
 * bound" box showing an operator's address, so there was nothing to click and
 * no reason to think anything was wrong — right up until the pool deployed
 * with the wrong borrower, which cannot be undone.
 *
 * Mirrors hasConfirmedBinding() in server/routes/poolTx.js; the server
 * refuses to deploy on the same rule.
 */
const isConfirmedBinding = (boundWallet, signedList) => {
  if (!boundWallet) return false;
  const list = Array.isArray(signedList) ? signedList : [];
  return list.some(
    (w) => String(w?.address || '').toLowerCase() === String(boundWallet).toLowerCase(),
  );
};

/**
 * Bind the borrower's wallet to their account.
 *
 * This is a hard prerequisite, not a convenience: POST /facility/request
 * refuses a profile without a bound wallet, the pool stamps it in as the
 * borrower at creation, and the contract only accepts repayment from it. A
 * borrower who never binds cannot get past the first step of the lifecycle.
 *
 * Binding is a SIWE signature, not a transaction — no gas.
 */
const WalletBindButton = ({ boundWallet, signedWallets, onBound }) => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { openConnectModal } = useConnectModal();
  const [binding, setBinding] = useState(false);

  const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');

  const handleBind = async () => {
    if (!isConnected || !address) {
      openConnectModal?.();
      return;
    }
    setBinding(true);
    try {
      await walletBind(address, signMessageAsync);
      toast.success('Wallet bound');
      onBound?.(address);
    } catch (e) {
      toast.error(e?.response?.data?.message || e?.shortMessage || e.message);
    } finally {
      setBinding(false);
    }
  };

  const confirmed = isConfirmedBinding(boundWallet, signedWallets);

  if (confirmed) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3">
        <Check className="w-4 h-4 text-green-600 shrink-0" />
        <div className="text-sm">
          <div className="font-semibold text-green-900">Wallet bound</div>
          <code className="text-xs text-green-800 font-mono break-all">{boundWallet}</code>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      {boundWallet && (
        // An unconfirmed address still on file. Say whose problem it is and
        // what it will cost, because the address alone looks reassuring.
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <div className="text-sm font-semibold text-amber-900">
            This address has not been verified
          </div>
          <code className="text-xs text-amber-800 font-mono break-all">{boundWallet}</code>
          <p className="text-xs text-amber-800 mt-1">
            It was set up for you rather than signed for. Bind your own wallet below —
            the pool locks this address in as the borrower when it deploys, and it
            cannot be changed afterwards.
          </p>
        </div>
      )}
      <button
        type="button"
        onClick={handleBind}
        disabled={binding}
        className="btn-primary flex items-center gap-2"
      >
        {binding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wallet className="w-4 h-4" />}
        {isConnected ? `Bind ${short(address)}` : 'Connect wallet'}
      </button>
      <p className="text-xs text-gray-600 mt-2">
        You sign a message to prove ownership. No transaction, no gas.
      </p>
    </div>
  );
};

export default WalletBindButton;
