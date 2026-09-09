/**
 * Wait for a submitted transaction to be mined, and fail if it reverted.
 *
 * wagmi's sendTransactionAsync resolves as soon as the wallet broadcasts, not
 * when the transaction is mined. Reporting success off that return value means
 * a reverted transaction is indistinguishable from a successful one: the user
 * sees a green toast and a transaction hash for something that did not happen.
 *
 * Polls the injected provider rather than taking a wagmi config, so the same
 * helper works from anywhere in either app.
 */
export async function waitForReceipt(hash, { timeoutMs = 120000, pollMs = 2000 } = {}) {
  const provider = window.ethereum;
  if (!provider || !hash) return null;

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const receipt = await provider
      .request({ method: 'eth_getTransactionReceipt', params: [hash] })
      .catch(() => null);

    if (receipt) {
      if (receipt.status === '0x0' || receipt.status === 0) {
        throw new Error(await revertReason(hash, receipt));
      }
      return receipt;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  // Not a failure — the transaction may still land. Say so precisely.
  throw new Error('Timed out waiting for confirmation; check the explorer before retrying');
}

/**
 * Best-effort revert reason: replay the call at the block it failed in. Falls
 * back to a plain message when the node will not give one.
 */
async function revertReason(hash, receipt) {
  try {
    const tx = await window.ethereum.request({ method: 'eth_getTransactionByHash', params: [hash] });
    await window.ethereum.request({
      method: 'eth_call',
      params: [{ from: tx.from, to: tx.to, data: tx.input, value: tx.value }, receipt.blockNumber],
    });
  } catch (e) {
    const msg = e?.data?.message || e?.message || '';
    const m = msg.match(/execution reverted:?\s*(.*)/i);
    if (m && m[1]) return `Transaction reverted: ${m[1].trim()}`;
  }
  return 'Transaction reverted on chain';
}
