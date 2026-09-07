import React from "react";
import Chip from "../components/ui/Chip";
import { statusFormater } from "@/libs/utils/utils";
import { useSelector } from "react-redux";
import moment from "moment";

const riskDotColors = {
  low: "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]",
  medium: "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.9)]",
  high: "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.9)]",
};

const StatItem = ({ label, value }) => (
  <div className="flex flex-col gap-0.5">
    <p className="text-white/90 text-[12px]">{label}</p>
    <p className="text-white font-semibold text-xs sm:text-sm">{value}</p>
  </div>
);

const myInvestmentAmt = (lenderArray, userId) => {
  if (!Array.isArray(lenderArray) || !userId) return 0;
  const lenderData = lenderArray.find((lender) => lender?.lenderId === userId);
  return lenderData?.lenderInvestment || 0;
};
const existingLenderState = (lenderInfoArray, userId) => {
  if (!Array.isArray(lenderInfoArray) || !userId) return 0;
  const matchedLender = lenderInfoArray.find(
    (lender) => lender?.lenderId === userId,
  );
  return matchedLender?.lenderProfit || 0;
};
const timestampToDate = (timestamp) => {
  if (!timestamp) return "N/A";

  const date =
    timestamp.toString().length === 10 ? timestamp * 1000 : timestamp;

  return moment(date).format("ll"); // e.g. "Sep 4, 2025"
};
const getDayValue = (days, dateValue) => {
  if (!days && !dateValue) {
    console.log("🚀 ~ getDayValue ~ if !tenure || !dateValue:", days);
    return days ? `${days}` : "N/A";
  }

  try {
    const date = new Date(dateValue);

    // Check if date is valid
    if (isNaN(date.getTime())) {
      return days ? `${days}` : "N/A";
    }

    // Add days to the date
    date.setDate(date.getDate() + parseInt(days));

    // Return formatted date
    return moment(date).format("ll");
  } catch (error) {
    console.error("Error in getDayValue:", error);
    return days ? `${days}` : "N/A";
  }
};

const PoolWideCard = ({ onClick, deal }) => {
  const userData = useSelector((s) => s.auth.user);

  const dotColor = riskDotColors[deal?.poolRiskLevel];

  const myInvestment = myInvestmentAmt(deal?.poolLenders, userData?._id) || 0;

  const myProfit = existingLenderState(deal?.poolLenders, userData?._id) || 0;

  const executionDate = (() => {
    const status = statusFormater(deal?.status);
    if (status === "ACTIVE" || status === "SETTLED") {
      return timestampToDate(deal?.poolMatureTime);
    }
    if (status === "OPEN") {
      return getDayValue(
        deal?.overview?.dealExpiresIn,
        deal?.tokenized?.statusDate || deal?.createdAt,
      );
    }
    return "N/A";
  })();
  const completionDate = (() => {
    const status = statusFormater(deal?.status);
    if (status === "OPEN") {
      return getDayValue(
        (Number.parseInt(deal?.overview?.dealExpiresIn) || 0) +
          (Number.parseInt(deal?.overview?.loanTenure) || 0),
        deal?.createdAt,
      );
    }
    return timestampToDate(deal?.poolEndTime) || "N/A";
  })();

  const amountCollectedPercentage = deal?.overview?.loanAmount
    ? Number(
        (
          ((deal?.poolAmountRaised || 0) / (deal?.overview?.loanAmount || 1)) *
          100
        ).toFixed(),
      )
    : 0;

  return (
    <div
      onClick={() => onClick(deal?._id)}
      className="
        rounded-2xl border border-white/20 overflow-hidden cursor-pointer
        bg-white/8 backdrop-blur-md
        shadow-[0_4px_24px_rgba(0,0,0,0.15),inset_0_1px_1px_rgba(255,255,255,0.12)]
        hover:border-white/35 hover:shadow-[0_8px_32px_rgba(255,255,255,0.06)]
        transition-all duration-300
      "
    >
      {/* ── Header Band ── */}
      <div className="flex items-center justify-between gap-2 px-4 sm:px-5 py-3 sm:py-3.5 bg-blue-600/30 border-b border-white/10 flex-wrap sm:flex-nowrap">
        <div className="flex items-center gap-2 min-w-0">
          <Chip
            variant="low"
            dot={false}
            className="px-3! py-1! text-xs! bg-white/15! shrink-0"
          >
            {statusFormater(deal?.status)}
          </Chip>
          <span className="text-white font-bold text-sm sm:text-base tracking-tight truncate">
            {deal?.poolName}
          </span>
        </div>

        {/* Date + Risk indicator */}
        <div className="flex items-center gap-1.5 shrink-0 ml-auto">
          <span className="text-white/70 text-[10px] sm:text-[11px] hidden sm:inline">
            {deal?.date}
          </span>
          <span className="text-white/20 text-xs hidden sm:inline">|</span>
          <span className="text-white/90 text-[10px] sm:text-[11px] capitalize">
            {/* {`${deal?.poolRiskLevel} risk pool`} */}
            {deal?.overview?.liquidityPool}
          </span>
          <div className="relative flex items-center justify-center">
            <div
              className={`w-1.5 h-1.5 rounded-full animate-ping absolute opacity-60 ${dotColor}`}
            />
            <div
              className={`w-1.5 h-1.5 rounded-full relative z-10 ${dotColor}`}
            />
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="px-4 sm:px-5 pt-4 pb-0">
        {/* Stats Row 1 — 2 cols on mobile, 4 on sm+ */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          {/* apyRate arrives pre-formatted ("14.00%"); overview carries loan
              terms only, so reading it from there always yielded 0%. */}
          <StatItem label="APY Rate:" value={deal?.apyRate ?? `${deal?.apy ?? 0}%`} />
          <StatItem label="Total Loan:" value={`$${Number(deal?.overview?.loanAmount || 0).toLocaleString()}`} />
          <StatItem label="KYI Score:" value={deal?.kyiScore} />
          <StatItem label="Loan Tenure:" value={deal?.overview?.loanTenure} />
        </div>

        {/* Stats Row 2 — 2 cols on mobile, 4 on sm+ */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <StatItem label="My Investments:" value={myInvestment} />
          <StatItem label="My Profit:" value={myProfit} />
          <StatItem label="Execution Date:" value={executionDate} />
          <StatItem label="Completion:" value={completionDate} />
        </div>
      </div>

      {/* ── Progress Footer Band ── */}
      <div className="px-4 sm:px-5 pt-3 pb-4 bg-white/5 border-t border-white/8">
        <p className="text-white font-medium text-xs mb-2.5">
          Investment Progress:
        </p>

        {/* On mobile: stack bar above badges. On sm+: side by side */}
        <div className="flex flex-col sm:flex-row sm:items-start gap-3 sm:gap-4">
          {/* Bar + label */}
          <div className="flex-1 min-w-0 sm:pt-1">
            <div className="w-full h-1.5 bg-white/15 rounded-full overflow-hidden mb-1.5">
              <div
                className="h-full rounded-full bg-white"
                style={{ width: `${amountCollectedPercentage}%` }}
              />
            </div>
            <p className="text-white/90 text-[12px]">
              {amountCollectedPercentage}
            </p>
          </div>

          {/* Badges — row on mobile, column on sm+ */}
          <div className="flex flex-row sm:flex-col gap-2 sm:gap-1.5 shrink-0">
            <Chip
              variant="low"
              dot={false}
              className="px-3! py-1! text-md! bg-blue-300/40! "
            >
              Total Lenders: {deal?.poolLenders?.length || 0}
            </Chip>
            <Chip
              variant="low"
              dot={false}
              className="px-3! py-1! text-[11px]! bg-blue-300/40!"
            >
              Matured: {deal?.isMatured ? "Yes" : "No"}
            </Chip>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PoolWideCard;
