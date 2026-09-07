import React, { useState } from "react";

const TabBar = ({
  tabs = [],
  defaultActive = "",
  onTabChange,
  className = "",
  variant = "pill",
}) => {
  const [activeTab, setActiveTab] = useState(
    defaultActive || (tabs.length > 0 ? tabs[0].id : ""),
  );

  const handleTabClick = (id) => {
    setActiveTab(id);
    if (onTabChange) onTabChange(id);
  };

  // Underline style variant
  if (variant === "underline") {
    return (
      <div
        className={`w-full overflow-x-auto overflow-y-hidden no-scrollbar ${className}`}
      >
        <div className="flex items-center gap-6 min-w-max ">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => handleTabClick(tab.id)}
              className={`
                pb-2.5 text-sm sm:text-base font-medium transition-all duration-300 whitespace-nowrap
                ${
                  activeTab === tab.id
                    ? "text-white border-b-2 border-white -mb-px"
                    : "text-white/90 hover:text-white/80 border-b-2 border-transparent -mb-px"
                }
              `}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Default pill variant
  return (
    <div
      className={`w-full overflow-x-auto overflow-y-hidden no-scrollbar ${className}`}
    >
      <div className="bg-primary/90 backdrop-blur-md border border-white/10 shadow-[0_4px_16px_0_rgba(31,38,135,0.05)] rounded-full p-1 sm:p-1.5 flex items-center inline-flex min-w-max">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => handleTabClick(tab.id)}
            className={`
              relative px-4 sm:px-6 py-2 sm:py-2.5 text-sm sm:text-base font-medium transition-all duration-300 rounded-full
              ${
                activeTab === tab.id
                  ? "bg-white/20 text-white shadow-sm backdrop-blur-md border border-white/20"
                  : "text-white hover:text-white hover:bg-white/10 border border-transparent"
              }
            `}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
};

// Add some custom CSS to hide scrollbar while allowing scrolling
// This can also be added to global css:
// .no-scrollbar::-webkit-scrollbar { display: none; }
// .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }

export default TabBar;
