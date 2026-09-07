import React from "react";
import etherIcon from "@/assets/multiChain-ui/ether-icon.svg";

// Single-chain deploy. Every consumer of chainOptions and getChainIcon —
// the header dropdown, the pool list and detail pills, the loans-page chain
// column, and the chainSlice default — surfaces Arc and only Arc.
//
// The label is also sent to the marketplace API as blockChainType, so it has
// to match what the backend indexes facilities under.
const chainMap = {
  arc: { label: "Arc", src: etherIcon },
};

/**
 * getChainIcon — returns the icon element for a given blockchain type.
 * Any legacy chain key falls
 * back to Arc so old rows still render an icon rather than breaking layout.
 */
export function getChainIcon(bcType, size = 16) {
  const chain = chainMap[bcType?.toLowerCase()] || chainMap.arc;
  return <img src={chain.src} alt={chain.label} width={size} height={size} />;
}

/** chainOptions — list of chains for dropdowns etc. Single entry. */
export const chainOptions = Object.entries(chainMap).map(([key, val]) => ({
  key,
  label: val.label,
}));
