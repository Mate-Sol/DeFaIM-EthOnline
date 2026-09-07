import React, { useMemo } from "react";
import { Provider as ReduxProvider } from "react-redux";
import { store } from "@/store/store";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

// ── wagmi + RainbowKit + react-query stack for on-chain deposit flow ──
import { WagmiProvider, http } from "wagmi";
import { defineChain } from "viem";
import { RainbowKitProvider, getDefaultConfig } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@rainbow-me/rainbowkit/styles.css";

// Chain config is env-driven so the SAME client code targets Anvil (dev),
// Polygon Amoy, or Arc testnet — only .env changes.
const CHAIN_ID = parseInt(import.meta.env.VITE_CHAIN_ID || "31337", 10);
const RPC_URL = import.meta.env.VITE_RPC_URL || "http://127.0.0.1:8545";
const CHAIN_NAME = import.meta.env.VITE_CHAIN_NAME || "Anvil";
const NATIVE_SYMBOL = import.meta.env.VITE_CHAIN_NATIVE_SYMBOL || "ETH";
const NATIVE_DECIMALS = parseInt(import.meta.env.VITE_CHAIN_NATIVE_DECIMALS || "18", 10);
const EXPLORER_URL = import.meta.env.VITE_CHAIN_EXPLORER_URL || "";

const activeChain = defineChain({
  id: CHAIN_ID,
  name: CHAIN_NAME,
  nativeCurrency: { name: NATIVE_SYMBOL, symbol: NATIVE_SYMBOL, decimals: NATIVE_DECIMALS },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: EXPLORER_URL ? { default: { name: "Explorer", url: EXPLORER_URL } } : undefined,
});

// Frozen so hot-reload doesn't tear down wallet state.
const wagmiConfig = getDefaultConfig({
  appName: "DeFa",
  projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || "defa-demo",
  chains: [activeChain],
  transports: { [activeChain.id]: http(RPC_URL) },
  ssr: false,
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, staleTime: 15_000 },
  },
});

export function AppProviders({ children }) {
  const config = useMemo(() => wagmiConfig, []);
  return (
    <ReduxProvider store={store}>
      <WagmiProvider config={config}>
        <QueryClientProvider client={queryClient}>
          <RainbowKitProvider>
            {children}
            <ToastContainer
              position="top-right"
              autoClose={3000}
              pauseOnHover
              closeOnClick
              toastStyle={{
                background:
                  "linear-gradient(135deg, rgba(6, 70, 176, 0.6), rgba(43, 103, 255, 0.2))",
                backdropFilter: "blur(12px)",
                border: "1px solid rgba(43, 103, 255, 0.3)",
                color: "var(--color-text)",
                borderRadius: "12px",
                boxShadow: "0 4px 24px rgba(43, 103, 255, 0.15)",
              }}
              progressStyle={{
                background:
                  "linear-gradient(to right, var(--color-primary-card), var(--color-secondary))",
              }}
            />
          </RainbowKitProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </ReduxProvider>
  );
}
