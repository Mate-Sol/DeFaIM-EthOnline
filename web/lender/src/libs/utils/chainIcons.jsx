import React from "react";
import etherIcon from "@/assets/multiChain-ui/ether-icon.svg";
import solanaIcon from "@/assets/multiChain-ui/solana-icon.svg";

// Single-chain deploy — every consumer of chainOptions and getChainIcon
// (MainHeader dropdowns, PoolList header pill, PoolDetails header, the
// loans-page chain column, chainSlice default) should surface Polygon
// and only Polygon. The legacy Stellar / Stark Net / Zig Chain entries
// used to sit here for the multichain UI mock; they are gone in the
// hackathon build.
const chainMap = {
  arc: { label: "Solana", src: solanaIcon },
};

/**
 * getChainIcon — returns the icon element for a given blockchain type.
 * Any legacy key ("stellar", "starknet", "zigchain", "evm") falls back
 * to the Polygon icon so old mock rows still render an icon rather than
 * breaking the layout.
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
