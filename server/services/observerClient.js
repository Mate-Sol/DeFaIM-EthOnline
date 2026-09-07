/**
 * services/observerClient.js — outbound HTTP client for the SAFE-Observer
 * -----------------------------------------------------------------------
 *
 * WHAT THIS FILE IS
 *   A small axios wrapper that calls the SAFE-Observer reconciliation
 *   service's public API. It is the OUTBOUND counterpart to
 *   middleware/observerAuth.js (inbound).
 *
 * WHY IT EXISTS
 *   PayMate's admin UI wants to display a unified "lifecycle" view per
 *   drawdown — combining what PayMate already knows (FinancingRequest +
 *   RepaymentRecord) with what the chain says (Safe events, mismatches,
 *   yield/duration computed from dual timestamps). The reconciled view
 *   lives in the SAFE-Observer service. PayMate's BE calls this client
 *   from routes/lifecycle.js, merges the result with its own data, and
 *   returns the merged object to the FE.
 *
 *   We isolate the HTTP call here so the route handler stays small,
 *   so it's easy to mock in tests, and so any future change to the
 *   observer's URL/auth scheme is a one-line edit.
 *
 * REQUIRED ENV VARS
 *   OBSERVER_BASE_URL     — base URL of the running SAFE-Observer service.
 *                           Example: http://localhost:3456
 *   OBSERVER_SERVICE_KEY  — shared secret. Same value the observer expects
 *                           in its X-Service-Key header (see observer's
 *                           OBSERVER_SERVICE_KEY env var).
 *
 * BEHAVIOR
 *   - getActivity(reference) → returns the parsed JSON body on 200.
 *   - 404 from observer → returns null (means "no reconciled data yet").
 *   - Network failure / timeout / unexpected status → throws an Error.
 *     The route handler is responsible for catching and degrading
 *     gracefully (still return PayMate-only data).
 *
 * ADDED
 *   2026-04-11 — feat/observer-lifecycle-integration
 */

const axios = require('axios');

const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Internal: build a fresh axios instance per call so we always pick up the
 * current env vars. Cheap, and avoids stale config if env is reloaded.
 */
function buildClient() {
  const baseURL = process.env.OBSERVER_BASE_URL;
  const serviceKey = process.env.OBSERVER_SERVICE_KEY;

  if (!baseURL) {
    throw new Error('OBSERVER_BASE_URL is not set');
  }
  if (!serviceKey) {
    throw new Error('OBSERVER_SERVICE_KEY is not set');
  }

  return axios.create({
    baseURL: baseURL.replace(/\/$/, ''),
    timeout: DEFAULT_TIMEOUT_MS,
    headers: {
      Accept: 'application/json',
      'X-Service-Key': serviceKey,
    },
    // We handle 404 explicitly; let axios resolve it instead of throwing.
    validateStatus: (status) => status >= 200 && status < 500,
  });
}

/**
 * Fetch the reconciled lifecycle for a single drawdown by orderReference.
 *
 * @param {string} reference - The PayMate orderReference (also the join key).
 * @returns {Promise<object|null>} parsed JSON response, or null on 404.
 * @throws {Error} on network/timeout/server errors.
 */
async function getActivity(reference) {
  if (!reference || typeof reference !== 'string') {
    throw new Error('observerClient.getActivity: reference must be a string');
  }

  const client = buildClient();
  const path = `/api/credit-lines/${encodeURIComponent(reference)}/activity`;
  const res = await client.get(path);
  console.log("🚀 ~ getActivity ~ res:", res.data)
  

  if (res.status === 404) {
    return null;
  }
  if (res.status >= 400) {
    throw new Error(
      `Observer responded ${res.status} for ${path}: ${JSON.stringify(res.data).slice(0, 300)}`,
    );
  }
  return res.data;
}

/**
 * Fetch the reconciled lifecycle for ONE specific drawdown by its
 * paymate_drawdown_id (= FinancingRequest._id). Use this whenever an
 * orderReference is ambiguous — under PayMate's revolving-credit flow a
 * single orderReference can have multiple drawdowns, and the orderRef-based
 * lookup only returns the latest. Drawdown ids are unique by construction.
 *
 * @param {string} drawdownId - The FinancingRequest._id (mongo ObjectId as string).
 * @returns {Promise<object|null>} parsed JSON response, or null on 404.
 * @throws {Error} on network/timeout/server errors.
 */
async function getActivityByDrawdownId(drawdownId) {
  if (!drawdownId || typeof drawdownId !== 'string') {
    throw new Error('observerClient.getActivityByDrawdownId: drawdownId must be a string');
  }

  const client = buildClient();
  const path = `/api/drawdowns/${encodeURIComponent(drawdownId)}/activity`;
  const res = await client.get(path);

  if (res.status === 404) {
    return null;
  }
  if (res.status >= 400) {
    throw new Error(
      `Observer responded ${res.status} for ${path}: ${JSON.stringify(res.data).slice(0, 300)}`,
    );
  }
  return res.data;
}

/**
 * Fetch ALL reconciled lifecycles for the given orderReference. Used when
 * the caller wants to render every drawdown under that ref (revolving-
 * credit case) without making N+1 calls to the per-drawdown endpoint.
 *
 * @param {string} reference - The PayMate orderReference.
 * @returns {Promise<{reference: string, count: number, activities: object[]}>}
 * @throws {Error} on network/timeout/server errors.
 */
async function listActivitiesByReference(reference) {
  if (!reference || typeof reference !== 'string') {
    throw new Error('observerClient.listActivitiesByReference: reference must be a string');
  }

  const client = buildClient();
  const path = `/api/credit-lines/${encodeURIComponent(reference)}/activities`;
  const res = await client.get(path);

  if (res.status >= 400) {
    throw new Error(
      `Observer responded ${res.status} for ${path}: ${JSON.stringify(res.data).slice(0, 300)}`,
    );
  }
  return res.data;
}

/**
 * Lightweight liveness check used by routes/lifecycle.js to short-circuit
 * the observer call when the service is obviously down. Resolves with a
 * boolean — never throws.
 */
async function isReachable() {
  try {
    const client = buildClient();
    const res = await client.get('/health');
    return res.status === 200;
  } catch {
    return false;
  }
}

module.exports = {
  getActivity,
  getActivityByDrawdownId,
  listActivitiesByReference,
  isReachable,
};
