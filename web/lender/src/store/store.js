import { configureStore } from "@reduxjs/toolkit";
import chainSlice from "./chainSlice";
import userSlice from "./loginSlice";

export const store = configureStore({
  reducer: {
    chain: chainSlice,
    auth: userSlice,
  },
});
