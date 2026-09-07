import React, { useState } from "react";
import WalletCard from "../components/ui/WalletCard";

import { BASE_WALLET_CARDS, WALLET_CARD_OPTIONS } from "@/Mock/mock_data.jsx";
import PlusDropdown from "@/components/navigation/PlusDropdown";
import LoanPage from "./LoanPage";

// --- Dashboard ---
const DashboardPage = () => {
  const [walletCards, setWalletCards] = useState(BASE_WALLET_CARDS);

  // All possible options = base cards + extra options
  const allWalletOptions = [
    ...BASE_WALLET_CARDS.map((c) => ({
      key: c.key,
      label: c.label,
      balance: c.balance,
      // date: c.date,
      icon: c.icon,
    })),
    ...WALLET_CARD_OPTIONS,
  ];

  const selectedWalletKeys = walletCards.map((c) => c.key);

  const handleAddWalletCard = (opt) => {
    setWalletCards((prev) => [
      ...prev,
      {
        key: opt.key,
        label: opt.label,
        balance: opt.balance,
        icon: opt.icon,
        date: opt?.date,
      },
    ]);
  };

  const handleRemoveWalletCard = (opt) => {
    setWalletCards((prev) => prev.filter((c) => c.key !== opt.key));
  };

  return (
    <div className="min-h-screen px-4 py-6 md:px-6 md:py-8 lg:px-12 overflow-x-hidden overflow-y-auto no-scrollbar">
      <h1 className="text-2xl md:text-4xl font-semibold text-white mb-6 md:mb-8  ">
        Dashboard
      </h1>

      {/* KPI Cards Container */}
      <div className="flex items-start gap-4 mb-8 md:mb-10">
        {/* Grid layout for 3 cards per row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 flex-1">
          {walletCards.map((card) => (
            <WalletCard key={card.key} data={card} className="w-full" />
          ))}
        </div>

        {/* Plus Button */}
        <div className="mt-1 shrink-0">
          <PlusDropdown
            options={allWalletOptions}
            selectedKeys={selectedWalletKeys}
            onSelect={handleAddWalletCard}
            onDeselect={handleRemoveWalletCard}
          />
        </div>
      </div>

      <div className="border-t border-white/10 mb-6 md:mb-8" />
      {/* Loan Screen */}
      <LoanPage pagination={false} wrapperClassName="p-0" />
    </div>
  );
};

export default DashboardPage;
