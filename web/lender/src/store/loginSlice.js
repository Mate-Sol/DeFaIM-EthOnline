import { createSlice } from "@reduxjs/toolkit";

// Single-chain Redux slice for the authenticated lender. Legacy Solana /
// Stellar branches (getUsdcBalance shim, getUserTokensBlances thunk) were
// removed alongside the deprecated /stellar helper module — on-chain USDC
// balance is now read via wagmi hooks in the pages that need it.

const initialState = {
  user: null,
  success: false,
};

const userSlice = createSlice({
  name: "user",
  initialState,
  reducers: {
    loginSuccess: (state, action) => {
      state.user = { ...state.user, ...action.payload };
      state.success = true;
    },
    updateTokenBalance: (state, action) => {
      state.user = {
        ...state.user,
        usdc: action.payload.usdc,
        dlp: action.payload.dlp,
      };
      state.success = true;
    },
    logOut: (state) => {
      state.user = null;
      state.success = false;
    },
  },
});

export const { loginSuccess, logOut, updateTokenBalance } = userSlice.actions;
export default userSlice.reducer;
