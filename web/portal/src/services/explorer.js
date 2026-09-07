// Block explorer URL helpers.
//
// The base URL is env-driven so the same code points at Arc Testnet during
// development and Arc Mainnet in production; it defaults to Arc Testnet.

const BASE = (import.meta.env.VITE_CHAIN_EXPLORER_URL || 'https://testnet.arcscan.app')
  .replace(/\/+$/, '');

export function txExplorerUrl(hash) {
  if (!hash) return null;
  return `${BASE}/tx/${hash}`;
}

export function addressExplorerUrl(address) {
  if (!address) return null;
  return `${BASE}/address/${address}`;
}
