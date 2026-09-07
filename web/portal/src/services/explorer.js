// Solana Explorer URL helpers. Replaces sepolia.etherscan.io / etherscan.io
// links from the EVM era. The cluster query string is appended for non-mainnet
// environments so links resolve to the correct network.

const CLUSTER = import.meta.env.VITE_SOLANA_CLUSTER || 'devnet';
const SUFFIX = CLUSTER === 'mainnet-beta' ? '' : `?cluster=${CLUSTER}`;

export function txExplorerUrl(signature) {
  if (!signature) return null;
  return `https://explorer.solana.com/tx/${signature}${SUFFIX}`;
}

export function addressExplorerUrl(address) {
  if (!address) return null;
  return `https://explorer.solana.com/address/${address}${SUFFIX}`;
}
