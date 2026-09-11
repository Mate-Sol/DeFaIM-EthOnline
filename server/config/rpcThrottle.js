/**
 * Global throttle + rate-limit retry for the JSON-RPC provider.
 *
 * Arc's public RPC limits *sustained* request rate, not burst. Per-call-site
 * batching therefore doesn't help: reading ten pools is ~250 view calls, and
 * whichever call happens to drain the bucket fails — often `poolCount()`, a
 * zero-argument view that cannot revert. Ethers reports the refusal as
 * `missing revert data ... CALL_EXCEPTION` with `data: null`, which reads
 * exactly like a contract error and sent us hunting reverts that weren't there.
 *
 * Throttling belongs on the provider because that is the only place that sees
 * every request. Call sites can then stay ordinary async code, and a new one
 * can't reintroduce the bug by forgetting to batch.
 *
 * Two mechanisms, both needed:
 *   - a concurrency cap plus a minimum gap between sends, which keeps us under
 *     the limit in the first place;
 *   - retry with exponential backoff for when we're over it anyway (another
 *     process sharing the endpoint, or a burst we didn't schedule).
 */

// Deliberately conservative: a public testnet endpoint shared with the
// indexer, the portal and whoever else. A dedicated endpoint can raise both.
const MAX_CONCURRENT = parseInt(process.env.EVM_RPC_MAX_CONCURRENT || '4', 10);
const MIN_GAP_MS     = parseInt(process.env.EVM_RPC_MIN_GAP_MS     || '45', 10);
const MAX_RETRIES    = parseInt(process.env.EVM_RPC_MAX_RETRIES    || '5', 10);
const BASE_BACKOFF   = parseInt(process.env.EVM_RPC_BACKOFF_MS     || '400', 10);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Is this the endpoint refusing us, rather than the contract rejecting us?
 *
 * Arc signals throttling three different ways depending on where the request
 * died, and only one of them looks like throttling. The `data == null` test is
 * what separates a throttled read from a genuine revert: a real revert carries
 * ABI-encoded reason bytes, a refused one carries nothing.
 */
function isRateLimited(err) {
  const msg = String(err?.message || '');
  const inner = String(err?.info?.error?.message || err?.error?.message || '');
  const code = err?.info?.error?.code ?? err?.error?.code;
  if (code === -32005 || code === 429) return true;
  if (/rate limit|too many requests|429|throttl/i.test(msg + ' ' + inner)) return true;
  // A CALL_EXCEPTION with no revert payload at all is Arc declining to serve
  // the call, not the contract reverting.
  if (err?.code === 'CALL_EXCEPTION' && err?.data == null && err?.reason == null) return true;
  if (/could not coalesce|ECONNRESET|ETIMEDOUT|socket hang up/i.test(msg)) return true;
  return false;
}

/**
 * Wrap a provider's `send` so every RPC request in the process passes through
 * one queue. Idempotent — wrapping twice would double-count concurrency.
 */
function throttleProvider(provider) {
  if (provider.__throttled) return provider;

  let active = 0;
  let lastSendAt = 0;
  const waiting = [];

  const pump = () => {
    if (!waiting.length || active >= MAX_CONCURRENT) return;
    const gap = Date.now() - lastSendAt;
    if (gap < MIN_GAP_MS) {
      setTimeout(pump, MIN_GAP_MS - gap);
      return;
    }
    const job = waiting.shift();
    active += 1;
    lastSendAt = Date.now();
    job();
  };

  const acquire = () => new Promise((resolve) => {
    waiting.push(resolve);
    pump();
  });

  const release = () => {
    active -= 1;
    pump();
  };

  const rawSend = provider.send.bind(provider);

  provider.send = async (method, params) => {
    let lastErr;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      await acquire();
      try {
        return await rawSend(method, params);
      } catch (e) {
        lastErr = e;
        // A genuine revert is the contract's answer — returning it fast is
        // correct, and retrying would only delay a deterministic failure.
        if (!isRateLimited(e) || attempt === MAX_RETRIES) throw e;
      } finally {
        release();
      }
      // Backoff happens outside the slot so a sleeping retry doesn't hold
      // capacity other callers could use to drain the queue.
      await sleep(BASE_BACKOFF * (2 ** attempt) + Math.floor(Math.random() * 100));
    }
    throw lastErr;
  };

  provider.__throttled = true;
  return provider;
}

module.exports = { throttleProvider, isRateLimited };
