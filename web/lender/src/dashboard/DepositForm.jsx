import React, { useState } from "react";
import Button from "../components/ui/Button";
import { Zap } from "lucide-react";
import { toast } from "react-toastify";
import { useAccount, useSendTransaction } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { axiosInstance } from "@/libs/axios";

/**
 * Deposit form (wagmi-wired).
 *
 * Flow:
 *  1. If wallet not connected → show a Connect button (RainbowKit modal).
 *  2. If connected + amount valid → POST to /pool/lender/build-tx/deposit.
 *     Server returns { steps: [{tx: approve}, {tx: deposit}] }.
 *  3. Sequentially prompt the wallet for each step's calldata via
 *     wagmi's sendTransactionAsync.
 *  4. Toast success / on-chain revert reason.
 *
 * The `deal` prop is what /marketPlaces/getDealsById returns — we read
 * deal._id (pool address) and deal.overview.loanAmount / deal.poolAmountRaised
 * for the min/remaining checks.
 */
const DepositForm = ({ walletBalance, currency = "USDC", apy = "12.00", deal }) => {
  const { address, isConnected } = useAccount();
  const { sendTransactionAsync } = useSendTransaction();

  const [usdcAmount, setUsdcAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const maxBalance = parseFloat(String(walletBalance || "0").replace(/,/g, "")) || 0;
  const apyRate = parseFloat(apy) / 100;
  const parsedAmount = parseFloat(usdcAmount) || 0;
  const projectedEarnings = (parsedAmount * apyRate).toFixed(2);

  const handleChange = (e) => {
    const val = e.target.value;
    if (/^\d*\.?\d*$/.test(val)) setUsdcAmount(val);
  };
  const handleMax = () => setUsdcAmount(maxBalance.toString());

  const sendOneStep = async (step) => {
    const { tx } = step || {};
    if (!tx?.to || !tx?.data) throw new Error("Malformed step from server");
    return sendTransactionAsync({
      to: tx.to,
      data: tx.data,
      value: tx.value ? BigInt(tx.value) : 0n,
    });
  };

  const handleSubmit = async () => {
    try {
      if (!isConnected || !address) {
        toast.error("Connect your wallet first");
        return;
      }
      if (parsedAmount <= 0) {
        toast.warning("Enter a positive USDC amount");
        return;
      }
      const poolAddress = deal?.pubkey || deal?._id;
      if (!poolAddress) {
        toast.error("Pool address missing on this view");
        return;
      }
      const remainingAmount =
        Number(deal?.overview?.loanAmount || 0) - Number(deal?.poolAmountRaised || 0);
      if (remainingAmount >= 100 && parsedAmount < 100) {
        toast.warning("Minimum deposit is 100 USDC");
        return;
      }
      if (remainingAmount > 0 && remainingAmount < 100 && parsedAmount > remainingAmount) {
        toast.warning(`You can deposit only ${remainingAmount.toFixed(2)} USDC`);
        return;
      }

      setSubmitting(true);
      // POST /pool/lender/build-tx/deposit — returns { steps: [approve, deposit], to, data, value }
      const res = await axiosInstance.post("/pool/lender/build-tx/deposit", {
        pool: poolAddress,
        amount: usdcAmount, // BE tolerates decimal strings
      });
      const steps = Array.isArray(res?.steps) && res.steps.length
        ? res.steps
        : [{ label: "Deposit", tx: { to: res.to, data: res.data, value: res.value } }];

      const hashes = [];
      for (let i = 0; i < steps.length; i++) {
        toast.info(`${steps[i].label || `Step ${i + 1}`} — sign in wallet`);
        const hash = await sendOneStep(steps[i]);
        hashes.push(hash);
      }
      const last = hashes[hashes.length - 1];
      toast.success(`Deposited ${parsedAmount} ${currency}  tx: ${last.slice(0, 10)}…`);
      setUsdcAmount("");
    } catch (error) {
      console.log("🚀 ~ handleSubmit ~ error:", error);
      const reason =
        error?.response?.data?.message ||
        error?.shortMessage ||
        error?.reason ||
        error?.message ||
        "Deposit failed";
      toast.error(reason);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col  gap-3">
      {/* Main Card */}
      <div className="rounded-2xl bg-primary-card/40 backdrop-blur-md border border-white/20 p-5 flex flex-col gap-4 shadow-lg">
        {/* Title + Balance */}
        <div className="flex flex-col gap-0.5">
          <span className="text-white/60 text-xs">Deposit {currency}</span>
          <span className="text-white font-bold text-2xl leading-tight">
            {walletBalance} {currency}
          </span>
        </div>

        {/* Input row */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-white text-sm shrink-0">$99.99k</span>
          <div className="flex items-center gap-2 ml-auto">
            <input
              type="text"
              value={usdcAmount}
              onChange={handleChange}
              placeholder={`0.27 ${currency}`}
              className="bg-transparent text-white/70 text-sm text-right outline-none w-24 placeholder-white/40"
            />
            <button
              onClick={handleMax}
              className="border border-white/40 rounded-full px-3 py-1 text-xs text-white hover:bg-white/10 transition-all whitespace-nowrap"
            >
              Max
            </button>
          </div>
        </div>

        {/* Divider */}
        <div className="h-px bg-white/15" />

        {/* Stats */}
        <div className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-2">
            <span className="text-white text-sm font-medium shrink-0">
              Deposit {currency}
            </span>
            <span className="text-white/70 text-sm text-right">
              {usdcAmount || "0.00"} <span className="mx-1">→</span> 99.99k
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-white text-sm font-medium">APY</span>
            <div className="flex items-center gap-1 text-white/70 text-sm">
              <Zap size={13} className="text-yellow-300 fill-yellow-300" />
              <span>{apy}%</span>
            </div>
          </div>
          <div className="flex items-start justify-between gap-2">
            <span className="text-white text-sm font-medium shrink-0">
              Projected Earnings
            </span>
            <span className="text-white/70 text-sm text-right">
              {parsedAmount > 0
                ? `+${projectedEarnings} ${currency}`
                : `0.00 → 99.99k`}
            </span>
          </div>
        </div>
      </div>

      {/* Connect button — shows only when NOT connected */}
      {!isConnected && (
        <div className="flex justify-center">
          <ConnectButton showBalance={false} chainStatus="icon" accountStatus="address" />
        </div>
      )}

      {/* Submit Button */}
      <Button
        variant="gradient"
        color="primary"
        onClick={handleSubmit}
        disabled={!parsedAmount || parsedAmount <= 0 || submitting}
        className="w-full py-3.5 rounded-2xl text-base font-semibold shadow-[0_4px_24px_rgba(107,92,231,0.4)] bg-accent-alt! disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {submitting ? "Signing…" : isConnected ? "Deposit" : "Connect wallet first"}
      </Button>
    </div>
  );
};

export default DepositForm;
