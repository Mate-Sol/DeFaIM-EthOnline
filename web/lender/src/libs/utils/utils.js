// src/lib/utils.js
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { toast } from "react-toastify";
import { jwtDecode } from "jwt-decode";
import { axiosInstance } from "../axios";

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

/**
 * copyToClipboard — copies text to clipboard and shows a toast
 *
 * @param {string} text              - text to copy
 * @param {string} successMsg        - toast message on success (default: "Copied!")
 * @param {string} errorMsg          - toast message on failure (default: "Failed to copy")
 * @param {function} onSuccess       - optional callback after successful copy
 */
export async function copyToClipboard(
  text,
  successMsg = "Copied!",
  errorMsg = "Failed to copy",
  onSuccess = null,
) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(successMsg);
    if (typeof onSuccess === "function") onSuccess();
  } catch (error) {
    console.error("copyToClipboard error:", error);
    toast.error(errorMsg);
  }
}
// ----------------------------------------------------------------------
// function jwtDecode(token) {
//   const base64Url = token.split(".")[1];
//   const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
//   const jsonPayload = decodeURIComponent(
//     window
//       .atob(base64)
//       .split("")
//       .map((c) => `%${`00${c.charCodeAt(0).toString(16)}`.slice(-2)}`)
//       .join(""),
//   );
//   return JSON.parse(jsonPayload);
// }

// ----------------------------------------------------------------------

export const isValidToken = (accessToken) => {
  if (!accessToken) {
    return false;
  }

  const decoded = jwtDecode(accessToken);

  const currentTime = Date.now() / 1000;

  const expirationTime = decoded.exp; // convert timestamp in milliseconds

  return expirationTime > currentTime;
};

// ----------------------------------------------------------------------

export const tokenExpired = (exp) => {
  // eslint-disable-next-line prefer-const
  let expiredTimer;

  const currentTime = Date.now();

  // Test token expires after 10s
  // const timeLeft = currentTime + 10000 - currentTime; // ~10s
  const timeLeft = exp - currentTime;

  clearTimeout(expiredTimer);
  expiredTimer = setTimeout(() => {
    alert("Token expired");

    sessionStorage.removeItem("accessToken");

    window.location.href = "/";
  }, timeLeft);
};

// ----------------------------------------------------------------------

export const setSession = (accessToken) => {
  if (accessToken) {
    sessionStorage.setItem("accessToken", accessToken);

    // axiosInstance.defaults.headers.common.Authorization = `${accessToken}`;

    // This function below will handle when token is expired
    const { exp } = jwtDecode(accessToken); //

    const expirationTime = exp * 1000;
    // const expirationTime = new Date().now + 100000; // 100 seconds
    tokenExpired(expirationTime);
  } else {
    sessionStorage.removeItem("accessToken");

    delete axiosInstance.defaults.headers.common.Authorization;
  }
};

// ------------------------------------------------------------
export const validateWalletMatch = (walletAddress) => {
  if (!walletAddress) {
    return { walletType: "Unknown", matched: false };
  }

  // Regex for formats
  const starknetRegex = /^0x[a-fA-F0-9]{60,66}$/;
  const stellarRegex = /^G[A-Z2-7]{55}$/;
  const zigchainRegex = /^zig1[a-z0-9]{38}$/;
  // detect type
  const getType = (address) => {
    if (starknetRegex.test(address)) return "Starknet";
    if (stellarRegex.test(address)) return "Stellar";
    if (zigchainRegex.test(address)) return "ZigChain";
    return "Unknown";
  };

  const walletType = getType(walletAddress);

  return walletType;
};

// -------------------------------------------------------------
/* ✅ Enhanced Status Formatting Function */
export const statusFormater = (status) => {
  if (!status) return "";

  // Normalize input to lowercase (safe comparison)
  const normalized = status.toLowerCase();

  // 🔄 Switch-case logic for specific statuses
  switch (normalized) {
    case "completed":
      return "SETTLED";
    case "lending":
    case "tokenized":
      return "OPEN";
    case "closed":
      return "ACTIVE";
    case "unfulfilled":
      return "Unfulfilled";
    default:
      // 🧠 Existing logic: beautify text like 'in_progress' → 'In Progress'
      return status
        .split(/(?=[A-Z])|_|-/)
        .map(
          (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
        )
        .join(" ");
  }
};
