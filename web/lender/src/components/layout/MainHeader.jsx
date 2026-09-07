import React, { useState, useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { setSelectedChain } from "@/store/chainSlice";
import { useAccount, useDisconnect } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import defaLogo from "../../assets/multiChain-ui/main-defa-logo.svg";
import Button from "../ui/Button";
import { DropdownItem } from "../navigation/Dropdown";
import { DROPDOWN_PANEL_CLASS } from "../navigation/PlusDropdown";
import Typography from "../ui/Typography";
import TabBar from "../navigation/TabBar";
import { ChevronDown, UserRound } from "lucide-react";
import { getChainIcon, chainOptions } from "@/libs/utils/chainIcons";
import { toast } from "react-toastify";

const navItems = [
  { id: "dashboard", to: "/dashboard", label: "Dashboard" },
  // { id: "agent-cara", to: "/agent-cara", label: "Agent CARA" },
  { id: "pools", to: "/pools", label: "Pools" },
  { id: "refer", to: "/refer", label: "Refer a Friend" },
  { id: "loans", to: "/loans", label: "Loans" },
  { id: "support", to: "/customer-support", label: "Customer Support" },
];

const MainHeader = () => {
  const [openChainModle, setOpenChainModle] = useState(false);
  const [mobileChainOpen, setMobileChainOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const dispatch = useDispatch();
  const selectedChain = useSelector((state) => state.chain.selected);
  // Wagmi + RainbowKit shim replacing the deprecated multi-chain
  // useWalletConnect hook. Same 5-variable surface so nothing else in
  // this component needs to change.
  const { address: walletAddress, isConnected, isConnecting } = useAccount();
  const { disconnect } = useDisconnect();
  const { openConnectModal } = useConnectModal();
  const connect = () => openConnectModal?.();
  const navigate = useNavigate();
  const location = useLocation();
  const profileRef = useRef(null);
  const mobileChainRef = useRef(null);

  const activeId =
    navItems.find((item) => location.pathname.startsWith(item.to))?.id ||
    navItems[0].id;

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (profileRef.current && !profileRef.current.contains(e.target)) {
        setOpenChainModle(false);
      }
      if (
        mobileChainRef.current &&
        !mobileChainRef.current.contains(e.target)
      ) {
        setMobileChainOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  const handleNavChange = (id) => {
    const item = navItems.find((n) => n.id === id);
    if (item) navigate(item.to);
  };

  const handleWalletConnect = async () => {
    try {
      if (!selectedChain) return;
      if (isConnected) {
        disconnect();
      } else {
        connect();
      }
    } catch (error) {
      console.log("🚀 ~ handleWalletConnect ~ error:", error);
    }
  };

  const desktopBar = (
    <div className="hidden lg:flex w-full items-center justify-between px-6 py-3">
      {/* Logo */}
      <div className="flex flex-col items-center shrink-0 w-auto">
        <img src={defaLogo} alt="DeFa Logo" className="h-8 w-auto" />
        <Typography className="text-[9px] font-light tracking-[0.18em] text-white/70 uppercase mt-0.5">
          A PROTOCOL BY INVOICEMATE
        </Typography>
      </div>

      {/* Nav */}
      <nav className="flex items-center">
        <TabBar
          tabs={navItems}
          defaultActive={activeId}
          onTabChange={handleNavChange}
          className="[&_button]:px-3 [&_button]:py-1.5 [&_button]:text-xs [&>div]:p-1"
        />
      </nav>

      {/* Right actions */}
      <div className="flex items-center gap-2 shrink-0">
        <Button
          variant="icon"
          color="default"
          aria-label="Profile"
          className="bg-primary/90! hover:bg-white/20!"
        >
          <UserRound
            size={20}
            fill="white"
            stroke="white"
            className="opacity-90"
          />
        </Button>

        <div className="relative" ref={profileRef}>
          <Button
            // disabled={isConnected}
            variant="icon"
            color="default"
            aria-label="Select Chain"
            onClick={() => {
              if (isConnected) {
                toast.warning(
                  "Please disconnect your current wallet before switching to another.",
                );
              } else {
                setOpenChainModle((p) => !p);
              }
            }}
            className="flex items-center gap-1 px-3 bg-primary/90! hover:bg-white/20!"
          >
            {getChainIcon(selectedChain.key, 20)}
            <ChevronDown size={16} />
          </Button>

          {openChainModle && (
            <div
              className={`${DROPDOWN_PANEL_CLASS} absolute right-0 mt-2 w-48 py-1`}
            >
              {chainOptions.map((chain) => (
                <DropdownItem
                  key={chain.label}
                  active={selectedChain.key === chain.key}
                  icon={() => getChainIcon(chain.key, 16)}
                  onClick={() => {
                    dispatch(setSelectedChain(chain));
                    setOpenChainModle(false);
                  }}
                >
                  {chain.label}
                </DropdownItem>
              ))}
            </div>
          )}
        </div>
        {selectedChain ? (
          <Button
            variant="solid"
            color="default"
            onClick={handleWalletConnect}
            disabled={isConnecting}
            className="px-5 py-2 text-sm bg-primary/90! hover:bg-white/20! disabled:opacity-60"
            title={isConnected ? walletAddress : undefined}
          >
            {isConnecting
              ? "Connecting..."
              : isConnected
                ? // ? `${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}`
                  "Disconnect Wallet"
                : "Connect Wallet"}
          </Button>
        ) : null}
      </div>
    </div>
  );

  const mobileDrawer = (
    <div
      className={`lg:hidden overflow-hidden transition-all duration-300 ease-in-out ${
        mobileMenuOpen ? "max-h-[400px] opacity-100" : "max-h-0 opacity-0"
      }`}
    >
      <div className="mx-4 mb-4 bg-navy/80 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => handleNavChange(item.id)}
            className={`w-full text-left px-5 py-3.5 text-sm font-medium transition-colors duration-200 flex items-center gap-3 border-b border-white/5 last:border-b-0
              ${activeId === item.id ? "bg-white/15 text-white" : "text-white/70 hover:bg-white/10 hover:text-white"}`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${activeId === item.id ? "bg-white" : "bg-white/20"}`}
            />
            {item.label}
          </button>
        ))}
        <div className="p-3 border-t border-white/10">
          {selectedChain ? (
            <Button
              variant="solid"
              color="default"
              onClick={handleWalletConnect}
              disabled={isConnecting}
              className="w-full py-2.5 text-sm disabled:opacity-60"
              title={isConnected ? walletAddress : undefined}
            >
              {isConnecting
                ? "Connecting..."
                : isConnected
                  ? `${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}`
                  : "Connect Wallet"}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );

  return (
    <header className="w-full bg-transparent">
      {/* MOBILE bar */}
      <div className="lg:hidden flex items-center justify-between px-4 py-3">
        <button
          className="flex flex-col justify-center items-center w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 transition-all duration-200 gap-1.5 shrink-0"
          aria-label="Toggle menu"
          onClick={() => setMobileMenuOpen((p) => !p)}
        >
          <span
            className={`block w-4 h-0.5 bg-white transition-all duration-300 origin-center ${mobileMenuOpen ? "rotate-45 translate-y-[7px]" : ""}`}
          />
          <span
            className={`block w-4 h-0.5 bg-white transition-all duration-300 ${mobileMenuOpen ? "opacity-0 scale-x-0" : ""}`}
          />
          <span
            className={`block w-4 h-0.5 bg-white transition-all duration-300 origin-center ${mobileMenuOpen ? "-rotate-45 -translate-y-[7px]" : ""}`}
          />
        </button>

        <div className="flex flex-col items-center">
          <img src={defaLogo} alt="DeFa Logo" className="h-7 w-auto" />
          <Typography className="text-[8px] font-light tracking-[0.18em] text-white/70 uppercase mt-0.5">
            A PROTOCOL BY INVOICEMATE
          </Typography>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <Button
            variant="icon"
            color="default"
            aria-label="Profile"
            className="p-2"
          >
            <UserRound
              size={20}
              fill="white"
              stroke="white"
              className="opacity-90"
            />
          </Button>
          <div className="relative" ref={mobileChainRef}>
            <Button
              variant="icon"
              color="default"
              aria-label="Select Chain"
              onClick={() => {
                if (isConnected) {
                  toast.warning(
                    "Please disconnect your current wallet before switching to another.",
                  );
                } else {
                  setMobileChainOpen((p) => !p);
                }
              }}
              className="p-2 flex items-center gap-1"
            >
              {getChainIcon(selectedChain.key, 18)}
              <ChevronDown size={14} />
            </Button>
            {mobileChainOpen && (
              <div
                className={`${DROPDOWN_PANEL_CLASS} absolute right-0 mt-2 w-48 py-1`}
              >
                {chainOptions.map((chain) => (
                  <DropdownItem
                    key={chain.label}
                    active={selectedChain.key === chain.key}
                    icon={() => getChainIcon(chain.key, 16)}
                    onClick={() => {
                      dispatch(setSelectedChain(chain));
                      setMobileChainOpen(false);
                    }}
                  >
                    {chain.label}
                  </DropdownItem>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {desktopBar}
      {mobileDrawer}
    </header>
  );
};

export default MainHeader;
