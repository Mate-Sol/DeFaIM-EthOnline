import React from "react";
import Card from "./Card";

const UpArrowIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="inline-block ml-1 mb-1"
  >
    <path d="M12 19V5"></path>
    <polyline points="5 12 12 5 19 12"></polyline>
  </svg>
);

const PoolInfoCard = ({
  daysLeft = 15,
  ticketSize = "95,000",
  ticketSizeSub = "72.32 USDC",
  totalDeposit = "1,500.00",
  totalDepositSub = "341.2 USDC",
  poolCategoryIcons = [], // Array of icon urls or components
  apyRate = "13.00%",
  apyRateSub = "Annualized",
  tenure = "3.5 years",
  tenureSub = "42 months",
  className = "",
}) => {
  return (
    <Card
      variant="simple"
      className={`pb-8 pt-8 sm:pb-10 sm:pt-10 ${className}`}
    >
      {/* Top Section: Days Left & Progress */}
      <div className="mb-10">
        <div className="flex items-baseline gap-2 mb-3">
          <span className="text-6xl sm:text-4xl font-light tracking-tight">
            {daysLeft}
          </span>
          <span className="text-sm sm:text-base font-light opacity-90">
            Days Left
          </span>
        </div>

        {/* Progress Bar Container */}
        <div className="w-full max-w-[240px] h-1 bg-white/30 rounded-full overflow-hidden">
          {/* Progress Bar Fill - arbitrary width for visual based on image */}
          <div
            className="h-full bg-white rounded-full"
            style={{ width: "60%" }}
          ></div>
        </div>
      </div>

      {/* Bottom Section: Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-6 gap-y-10">
        {/* Ticket Size */}
        <div className="flex flex-col">
          <span className="text-sm font-light opacity-90 mb-3">
            Ticket Size
          </span>
          <span className="text-2xl sm:text-2xl font-bold tracking-tight mb-2 whitespace-nowrap">
            $ {ticketSize}
          </span>
          <span className="text-xs sm:text-sm font-light opacity-80">
            {ticketSizeSub}
          </span>
        </div>

        {/* Total Deposit */}
        <div className="flex flex-col">
          <span className="text-sm font-light opacity-90 mb-3">
            Total Deposit
          </span>
          <span className="text-2xl sm:text-2xl font-bold tracking-tight mb-2 whitespace-nowrap">
            $ {totalDeposit}
          </span>
          <span className="text-xs sm:text-sm font-light opacity-80">
            {totalDepositSub}
          </span>
        </div>

        {/* Pool Category */}
        <div className="flex flex-col">
          <span className="text-sm font-light opacity-90 mb-3">
            Pool Category
          </span>
          <div className="flex items-center mt-2">
            {poolCategoryIcons.length > 0 ? (
              poolCategoryIcons.map((Icon, idx) => (
                <div
                  key={idx}
                  className={`w-8 h-8 rounded-full border border-white/20 bg-blue-500 shadow-sm flex items-center justify-center ${idx > 0 ? "-ml-2" : ""}`}
                >
                  {typeof Icon === "string" ? (
                    <img
                      src={Icon}
                      alt="pool category"
                      className="w-full h-full object-cover rounded-full"
                    />
                  ) : (
                    <Icon />
                  )}
                </div>
              ))
            ) : (
              // Enhanced Placeholders matching visual from original design
              <div className="flex">
                <div className="w-10 h-10 rounded-full border border-white/20 bg-gradient-to-br from-blue-400 to-indigo-600 flex items-center justify-center relative z-10 shadow-md">
                  <div className="w-4 h-4 bg-white/20 rounded-sm"></div>
                </div>
                <div className="w-10 h-10 rounded-full border border-white/20 bg-gradient-to-br from-purple-400 to-blue-600 flex items-center justify-center -ml-3 relative z-20 shadow-md">
                  <div className="w-4 h-4 bg-white/20 rounded-full"></div>
                </div>
                <div className="w-10 h-10 rounded-full border border-white/20 bg-gradient-to-br from-teal-400 to-blue-500 flex items-center justify-center -ml-3 relative z-30 shadow-md">
                  <div className="w-4 h-4 bg-white/20 rounded-sm polygon"></div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* APY Rate */}
        <div className="flex flex-col">
          <span className="text-sm font-light opacity-90 mb-3">
            APY Rate <UpArrowIcon />
          </span>
          <span className="text-2xl sm:text-2xl font-bold tracking-tight mb-2">
            {apyRate}
          </span>
          <span className="text-xs sm:text-sm font-light opacity-80">
            {apyRateSub}
          </span>
        </div>

        {/* Tenure */}
        <div className="flex flex-col">
          <span className="text-sm font-light opacity-90 mb-3">Tenure</span>
          <span className="text-2xl sm:text-2xl font-bold tracking-tight mb-2 whitespace-nowrap">
            {tenure}
          </span>
          <span className="text-xs sm:text-sm font-light opacity-80">
            {tenureSub}
          </span>
        </div>
      </div>
    </Card>
  );
};

export default PoolInfoCard;
