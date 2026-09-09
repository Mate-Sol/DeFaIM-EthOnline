import { useState } from 'react';
import { useAccount, useSendTransaction } from 'wagmi';
import { Loader2, Coins } from 'lucide-react';
import toast from 'react-hot-toast';
import { buildAndSend } from '../../services/evm';

/**
 * Pay the commitment fee accrued on undrawn capital.
 *
 * The pool accrues this lazily, so a facility whose drawdowns are all repaid
 * can still owe it. That matters beyond tidiness: a pool only reaches Closed
 * once collectedYield covers yieldOwed, and only a Closed pool releases the
 * borrower's slot at the factory. Without this the borrower is left holding a
 * settled-looking facility that never closes, and cannot open another one.
 */
const SettleCommitButton = ({ pool, className = '' }) => {
  const { address, isConnected } = useAccount();
  const { sendTransactionAsync } = useSendTransaction();
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);

  const amt = Number(amount) || 0;

  const handleSettle = async () => {
    if (!isConnected) { toast.error('Connect your wallet first'); return; }
    if (!pool) { toast.error('No pool on this facility yet'); return; }
    if (!(amt > 0)) { toast.error('Enter an amount to settle'); return; }
    setBusy(true);
    try {
      const res = await buildAndSend(
        address, sendTransactionAsync,
        '/pool/psp/build-tx/settle-commit-fee',
        // Base units, matching every other amount the API takes.
        { pool, amount: BigInt(Math.round(amt * 1e6)).toString() },
      );
      toast.success(`Commit fee settled · tx ${String(res.hash).slice(0, 10)}…`);
      setAmount('');
    } catch (e) {
      toast.error(e?.response?.data?.message || e?.shortMessage || e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <input
        type="number"
        min="0"
        step="any"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="Commit fee (USDC)"
        className="input-field w-44"
        disabled={busy}
      />
      <button
        onClick={handleSettle}
        disabled={busy || !(amt > 0)}
        className="btn-secondary flex items-center gap-2"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Coins className="w-4 h-4" />}
        Settle commit fee
      </button>
    </div>
  );
};

export default SettleCommitButton;
