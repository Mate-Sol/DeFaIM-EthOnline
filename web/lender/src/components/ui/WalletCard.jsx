import React from "react";
import Card from "./Card";

const WalletCard = ({ data = {}, className = "" }) => {
  const { balance, label = "Wallet Balance", icon, date } = data;
  const displayValue = date ?? balance ?? "0.00";

  // Enforcing fixed minimums so it NEVER shrinks
  const containerBase =
    "w-full flex flex-col justify-between overflow-hidden relative";
  const mobileStyles = "min-h-[140px] py-5 px-5";
  const desktopStyles = "md:min-h-[170px] md:py-7 md:px-7";

  return (
    <div className={`relative h-full ${className}`}>
      {/* Mobile layout */}
      <Card className={`flex md:hidden ${containerBase} ${mobileStyles}`}>
        <div className="flex items-start justify-between w-full gap-2">
          <p className="text-sm font-medium text-white/80 uppercase tracking-wider truncate">
            {label}
          </p>
          <div className="text-white opacity-90 shrink-0 scale-110">{icon}</div>
        </div>

        <div className="mt-auto">
          <h2 className="text-2xl font-bold tracking-tight text-white truncate leading-none">
            {date ? displayValue : `$${displayValue}`}
          </h2>
        </div>
      </Card>

      {/* Web layout */}
      <Card className={`hidden md:flex ${containerBase} ${desktopStyles}`}>
        <div className="mt-auto w-full ">
          <p className="text-sm lg:text-base font-medium text-white/80 uppercase tracking-wide truncate pr-4">
            {label}
          </p>
          <div className="flex flex-row justify-between">
            <h2 className="text-3xl lg:text-4xl font-bold tracking-tight text-white truncate leading-tight">
              {date ? displayValue : `$${displayValue}`}
            </h2>
            <div className="text-white opacity-90 shrink-0 scale-125">
              {icon}
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
};

export default WalletCard;
