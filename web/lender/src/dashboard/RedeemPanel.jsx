import React, { useState } from "react";
import { waitForReceipt } from "@/libs/utils/txReceipt";
import { useAccount, useSendTransaction } from "wagmi";
import { toast } from "react-toastify";
import { Loader2, HandCoins } from "lucide-react";
import { axiosInstance } from "@/libs/axios";

/**
 * Lender redemption — claim accrued yield, then principal.
 *
 * The lender app previously wired only the deposit, so the last step of the
 * facility lifecycle had no interface: capital could go into a pool but never
 * come back out of one.
 *
 * POST /pool/lender/build-tx/redeem returns two steps, claim yield and claim
 * principal, which are signed in order by the lender's own wallet. Both are
 * safe to attempt: the pool pays out whatever is currently claimable, and
 * principal is only released once the facility reaches maturity, so an early
 * click simply returns nothing rather than failing destructively.
 */
const RedeemPanel = ({ deal, currency = "USDC" }) => {
  const { address, isConnected } = useAccount();
  const { sendTransactionAsync } = useSendTransaction();
  const [submitting, setSubmitting] = useState(false);

  const poolAddress = deal?.pubkey || deal?._id;

  const sendOneStep = async (step) => {
    const { tx } = step || {};
    if (!tx?.to || !tx?.data) throw new Error("Malformed step from server");
    const hash = await sendTransactionAsync({
      to: tx.to,
      data: tx.data,
      value: tx.value ? BigInt(tx.value) : 0n,
    });
    await waitForReceipt(hash);
    return hash;
  };

  const handleRedeem = async () => {
    if (!isConnected || !address) {
      toast.error("Connect your wallet first");
      return;
    }
    if (!poolAddress) {
      toast.error("Pool address missing on this view");
      return;
    }
    setSubmitting(true);
    try {
      const res = await axiosInstance.post("/pool/lender/build-tx/redeem", {
        pool: poolAddress,
      });
      const steps =
        Array.isArray(res?.steps) && res.steps.length
          ? res.steps
          : [{ label: "Redeem", tx: { to: res.to, data: res.data, value: res.value } }];

      let last;
      for (let i = 0; i < steps.length; i++) {
        toast.info(`${steps[i].label || `Step ${i + 1}`} — sign in wallet`);
        last = await sendOneStep(steps[i]);
      }
      toast.success(`Redeemed  tx: ${String(last).slice(0, 10)}…`);
    } catch (e) {
      toast.error(
        e?.response?.data?.message || e?.shortMessage || e?.message || "Redeem failed"
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-2xl bg-primary-card/40 backdrop-blur-md border border-white/20 p-5 flex flex-col gap-3 shadow-lg">
      <div className="flex flex-col gap-0.5">
        <span className="text-white/60 text-xs">Redeem</span>
        <span className="text-white font-bold text-lg leading-tight">
          Claim yield &amp; principal
        </span>
      </div>
      <p className="text-white/60 text-xs leading-relaxed">
        Yield is claimable as the borrower repays. Principal is released when the
        facility matures.
      </p>
      <button
        onClick={handleRedeem}
        disabled={submitting || !isConnected}
        className="w-full rounded-full py-3 font-semibold text-white bg-white/15 hover:bg-white/25 disabled:opacity-50 flex items-center justify-center gap-2 transition"
      >
        {submitting ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <HandCoins size={16} />
        )}
        {submitting ? "Signing…" : `Redeem ${currency}`}
      </button>
    </div>
  );
};

export default RedeemPanel;
