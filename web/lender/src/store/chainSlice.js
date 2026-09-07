import { createSlice } from "@reduxjs/toolkit";
import { chainOptions } from "@/libs/utils/chainIcons";

const initValue = {
  selected: chainOptions[0], // { key, label }
  walletAddress: null,       // connected wallet public key / address
  walletStatus: "idle",      // "idle" | "connecting" | "connected" | "error"
  walletError: null,
  usdcBalance: null,         // fetched USDC balance for the connected wallet
};

const chainSlice = createSlice({
  name: "chain",
  initialState: initValue,
  reducers: {
    setSelectedChain(state, action) {
      // switching chain resets wallet connection
      state.selected = action.payload;
      state.walletAddress = null;
      state.walletStatus = "idle";
      state.walletError = null;
    },
    setWalletConnecting(state) {
      state.walletStatus = "connecting";
      state.walletError = null;
    },
    setWalletConnected(state, action) {
      state.walletAddress = action.payload;
      state.walletStatus = "connected";
      state.walletError = null;
    },
    setWalletError(state, action) {
      state.walletStatus = "error";
      state.walletError = action.payload;
      state.walletAddress = null;
    },
    setUsdcBalance(state, action) {
      state.usdcBalance = action.payload;
    },
    disconnectWallet(state) {
      state.walletAddress = null;
      state.walletStatus = "idle";
      state.walletError = null;
      state.usdcBalance = null;
    },
  },
});

export const {
  setSelectedChain,
  setWalletConnecting,
  setWalletConnected,
  setWalletError,
  setUsdcBalance,
  disconnectWallet,
} = chainSlice.actions;
export default chainSlice.reducer;
