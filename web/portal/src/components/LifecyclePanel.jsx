/**
 * LifecyclePanel.jsx — reconciled drawdown lifecycle view
 * --------------------------------------------------------
 *
 * WHAT THIS COMPONENT IS
 *   A self-contained React component that, given a single drawdown's
 *   `orderReference`, fetches the merged lifecycle from PayMate's BE
 *   (`GET /admin/credit-lines/:reference/lifecycle`) and renders a clean
 *   admin-side view combining:
 *
 *     1. PayMate's intent  — what we (PayMate) think happened, from our
 *                            own MongoDB FinancingRequest + RepaymentRecord
 *     2. Observer's reality — what the SAFE-Observer reconciliation service
 *                            sees on-chain (matched events, dual timestamps,
 *                            mismatches, computed yield)
 *
 *   Designed to drop into any admin page that already knows an
 *   orderReference (e.g. inside an expandable row in the existing
 *   RepaymentMonitoring page, or as the body of a modal).
 *
 * WHY IT EXISTS
 *   The end goal of the SAFE-Observer pilot: a PayMate admin should be
 *   able to look at any drawdown and immediately see whether what we
 *   recorded matches what actually happened on-chain — with mismatches
 *   flagged, yield computed both ways, and dual timestamps preserved.
 *
 * USAGE
 *   import LifecyclePanel from '../../components/LifecyclePanel';
 *
 *   <LifecyclePanel reference={financing.orderReference} />
 *
 *   That's it. The component handles its own loading state, error state,
 *   and "observer unavailable" gracefully.
 *
 * STYLING
 *   Uses inline styles only — no global CSS file is touched, no Tailwind
 *   class assumptions are made (other than that some classes may be
 *   present at the parent level). The styling is intentionally neutral
 *   and matches the dark/grey palette common across the existing admin
 *   pages. Adjust freely after dropping it in.
 *
 * INTEGRATION POINTS
 *   - adminAPI.getCreditLineLifecycle(reference) — added in the same
 *     branch to client/src/services/api.js.
 *   - PayMate BE: GET /admin/credit-lines/:reference/lifecycle, defined
 *     in server/routes/lifecycle.js.
 *
 * ADDED
 *   2026-04-11 — feat/observer-lifecycle-integration
 */

import React, { useEffect, useState } from 'react';
import { adminAPI } from '../services/api';

// ============================================================================
// Inline style atoms — kept tiny so they're easy to scan + override.
// ============================================================================

const styles = {
  panel: {
    border: '1px solid #2a323d',
    borderRadius: '6px',
    background: '#0f1620',
    color: '#e6e6e6',
    padding: '16px 20px',
    fontSize: '13px',
    fontFamily: "'Cabin', system-ui, sans-serif",
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '12px',
    borderBottom: '1px solid #1e242c',
    paddingBottom: '8px',
  },
  title: { fontSize: '14px', fontWeight: 600, margin: 0 },
  refMono: { color: '#8a93a2', fontSize: '12px' },
  section: { marginTop: '14px' },
  sectionTitle: {
    fontSize: '11px',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: '#8a93a2',
    margin: '0 0 6px 0',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: '160px 1fr',
    gap: '4px 16px',
  },
  k: { color: '#8a93a2' },
  v: { color: '#e6e6e6', wordBreak: 'break-all' },
  pill: (kind) => ({
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: '3px',
    fontSize: '10px',
    fontWeight: 600,
    textTransform: 'uppercase',
    background: pillBg(kind),
    color: pillFg(kind),
  }),
  mismatchList: { margin: '4px 0', padding: 0, listStyle: 'none' },
  mismatchItem: (severity) => ({
    padding: '6px 10px',
    margin: '4px 0',
    borderLeft: `3px solid ${severityColor(severity)}`,
    background: '#0b1220',
    fontSize: '12px',
  }),
  loading: { color: '#8a93a2', fontStyle: 'italic' },
  error: { color: '#ff9999', padding: '8px', background: '#2a1010' },
  warnBanner: {
    padding: '8px 12px',
    background: '#2a2515',
    color: '#d4a64a',
    borderRadius: '4px',
    marginBottom: '12px',
    fontSize: '12px',
  },
};

function pillBg(status) {
  return (
    {
      pending_offchain: '#1a1f28',
      pending_onchain: '#2a2515',
      sent: '#0c2a3b',
      repaid: '#0c3b1e',
      reconciled: '#0c3b1e',
      mismatch: '#3b1515',
      Pending: '#1a1f28',
      Validated: '#1a1f28',
      Disbursed: '#0c2a3b',
      Repaid: '#0c3b1e',
      Overdue: '#3b2f0c',
      PenaltyApplied: '#3b1515',
    }[status] || '#1a1f28'
  );
}
function pillFg(status) {
  return (
    {
      pending_offchain: '#8a93a2',
      pending_onchain: '#d4a64a',
      sent: '#7ab8e8',
      repaid: '#7ee5a1',
      reconciled: '#7ee5a1',
      mismatch: '#ff9999',
      Pending: '#8a93a2',
      Validated: '#8a93a2',
      Disbursed: '#7ab8e8',
      Repaid: '#7ee5a1',
      Overdue: '#f4c158',
      PenaltyApplied: '#ff9999',
    }[status] || '#e6e6e6'
  );
}
function severityColor(s) {
  return { error: '#ff5555', warning: '#f4c158', info: '#7ab8e8' }[s] || '#8a93a2';
}

// ============================================================================
// Helpers
// ============================================================================

function fmtDate(s) {
  if (!s) return '—';
  try {
    return new Date(s).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  } catch {
    return String(s);
  }
}

function fmtAmount(n) {
  if (n == null) return '—';
  if (typeof n === 'number') {
    // Show enough decimal places to avoid rounding small amounts to 0.00.
    // For values >= 1, 2 decimals is fine. For smaller values, show up to
    // 6 significant decimals so 0.001 doesn't become 0.00.
    if (Math.abs(n) < 1 && n !== 0) return n.toPrecision(4).replace(/0+$/, '').replace(/\.$/, '');
    return n.toFixed(2);
  }
  return String(n);
}

function fmtDuration(seconds) {
  if (seconds == null) return '—';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h`;
  return `${(seconds / 86400).toFixed(1)}d`;
}

// ============================================================================
// Component
// ============================================================================

/**
 * LifecyclePanel — renders the merged PayMate + observer lifecycle for a
 * drawdown. Takes EITHER a `reference` (orderReference, may match multiple
 * drawdowns under PayMate's revolving-credit flow — all of them are
 * rendered) OR a `drawdownId` (FinancingRequest._id, unambiguous, single
 * panel rendered).
 *
 *   <LifecyclePanel reference={financing.orderReference} />
 *   <LifecyclePanel drawdownId={repayment.financingRequestId._id} />
 */
export default function LifecyclePanel({ reference, drawdownId }) {
  const [state, setState] = useState({ loading: true, items: [], error: null });

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true, items: [], error: null });

    const fetcher = drawdownId
      ? adminAPI
          .getDrawdownLifecycle(drawdownId)
          .then((res) => [res.data])
      : adminAPI
          .getCreditLineLifecycles(reference)
          .then((res) => res.data?.lifecycles || []);

    fetcher
      .then((items) => {
        if (cancelled) return;
        setState({ loading: false, items, error: null });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          loading: false,
          items: [],
          error: err.response?.data?.message || err.message || 'Failed to load',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [reference, drawdownId]);

  const headerLabel = drawdownId
    ? `drawdown ${drawdownId}`
    : `lifecycle for ${reference}`;

  if (state.loading) {
    return (
      <div style={styles.panel}>
        <div style={styles.loading}>Loading {headerLabel}…</div>
      </div>
    );
  }

  if (state.error) {
    return (
      <div style={styles.panel}>
        <div style={styles.error}>{state.error}</div>
      </div>
    );
  }

  if (state.items.length === 0) {
    return (
      <div style={styles.panel}>
        <div style={styles.warnBanner}>
          ⓘ No drawdowns found for {drawdownId || reference}.
        </div>
      </div>
    );
  }

  // Render one card per drawdown. For revolving-credit orderRefs there can
  // be multiple — newest first, label each so admins can tell them apart.
  return (
    <>
      {state.items.map((item, idx) => (
        <SingleDrawdownLifecycle
          key={item.drawdownId || `${reference}-${idx}`}
          item={item}
          indexLabel={
            state.items.length > 1
              ? `Drawdown ${state.items.length - idx} of ${state.items.length}`
              : null
          }
          fallbackReference={reference}
        />
      ))}
    </>
  );
}

/**
 * Renders one drawdown's complete lifecycle card. Pulled out so the outer
 * LifecyclePanel can map over multiple draws under a single orderReference.
 */
function SingleDrawdownLifecycle({ item, indexLabel, fallbackReference }) {
  const { paymate, observer } = item;
  const reference = item.reference || fallbackReference;
  const activity = observer?.activity || null;
  const reconciliation = activity?.reconciliation || null;
  const onchain = activity?.onchain || null;
  const derived = activity?.derived || null;

  return (
    <div style={{ ...styles.panel, marginTop: indexLabel ? '12px' : 0 }}>
      {/* ----- header ----- */}
      <div style={styles.header}>
        <h3 style={styles.title}>
          {indexLabel ? `Drawdown Lifecycle — ${indexLabel}` : 'Drawdown Lifecycle'}
        </h3>
        <span style={styles.refMono}>
          {item.drawdownId
            ? `${reference || ''} · ${item.drawdownId}`.trim()
            : reference}
        </span>
        <span style={{ flex: 1 }} />
        {activity && (
          <span style={styles.pill(activity.status)}>
            {activity.status.replace('_', ' ')}
          </span>
        )}
        {!activity && paymate?.status && (
          <span style={styles.pill(paymate.status)}>{paymate.status}</span>
        )}
      </div>

      {/* ----- observer unavailable banner ----- */}
      {observer && !observer.available && (
        <div style={styles.warnBanner}>
          ⚠ Observer service unavailable: {observer.reason || 'unknown reason'}.
          Showing PayMate data only.
        </div>
      )}
      {observer && observer.available && !activity && (
        <div style={styles.warnBanner}>
          ⓘ Observer is reachable but has no reconciled data for this drawdown
          yet. {observer.reason || ''}
        </div>
      )}

      {/* ----- PayMate intent block ----- */}
      <div style={styles.section}>
        <h4 style={styles.sectionTitle}>PayMate intent (off-chain)</h4>
        <div style={styles.grid}>
          <div style={styles.k}>PSP</div>
          <div style={styles.v}>
            {paymate.pspCompanyName || paymate.pspId || '—'}
          </div>
          <div style={styles.k}>Requested amount</div>
          <div style={styles.v}>{fmtAmount(paymate.amount)}</div>
          <div style={styles.k}>Status (PayMate)</div>
          <div style={styles.v}>{paymate.status || '—'}</div>
          <div style={styles.k}>Requested at</div>
          <div style={styles.v}>{fmtDate(paymate.requestedAt)}</div>
          <div style={styles.k}>Validated at</div>
          <div style={styles.v}>{fmtDate(paymate.validatedAt)}</div>
          <div style={styles.k}>Disbursed at</div>
          <div style={styles.v}>{fmtDate(paymate.disbursedAt)}</div>
          <div style={styles.k}>Due date</div>
          <div style={styles.v}>{fmtDate(paymate.dueDate)}</div>
          {paymate.repaymentRecord && (
            <>
              <div style={styles.k}>Repaid at</div>
              <div style={styles.v}>
                {fmtDate(paymate.repaymentRecord.repaymentDate)}
              </div>
              <div style={styles.k}>Total repayment</div>
              <div style={styles.v}>
                {fmtAmount(paymate.repaymentRecord.totalRepayment)}
              </div>
            </>
          )}
          <div style={styles.k}>On-chain tx (PayMate-recorded)</div>
          <div style={styles.v}>{paymate.txHash || '—'}</div>
        </div>
      </div>

      {/* ----- On-chain reality block (only if observer is available) ----- */}
      {onchain && (
        <div style={styles.section}>
          <h4 style={styles.sectionTitle}>On-chain reality (observer)</h4>
          <div style={styles.grid}>
            <div style={styles.k}>Drawdown tx</div>
            <div style={styles.v}>{onchain.drawdownTxHash || '—'}</div>
            <div style={styles.k}>Drawdown block</div>
            <div style={styles.v}>{onchain.drawdownBlockNumber ?? '—'}</div>
            <div style={styles.k}>Drawdown occurred</div>
            <div style={styles.v}>{fmtDate(onchain.drawdownOccurredAt)}</div>
            <div style={styles.k}>Pool address (from)</div>
            <div style={styles.v}>{onchain.drawdownFromPool || '—'}</div>
            <div style={styles.k}>Safe address (to)</div>
            <div style={styles.v}>{onchain.drawdownToSafe || '—'}</div>
            <div style={styles.k}>Executed amount</div>
            <div style={styles.v}>
              {fmtAmount(onchain.executedAmountDecimal)}
            </div>
            {onchain.repaymentOccurredAt && (
              <>
                <div style={styles.k}>Repayment occurred</div>
                <div style={styles.v}>
                  {fmtDate(onchain.repaymentOccurredAt)}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ----- Reconciliation block ----- */}
      {reconciliation && (
        <div style={styles.section}>
          <h4 style={styles.sectionTitle}>Reconciliation</h4>
          <div style={styles.grid}>
            <div style={styles.k}>Matched</div>
            <div style={styles.v}>
              {reconciliation.matched ? 'Yes' : 'No'}
              {reconciliation.matchStrategy &&
                reconciliation.matchStrategy !== 'none' &&
                ` (by ${reconciliation.matchStrategy})`}
            </div>
            <div style={styles.k}>Amount diff</div>
            <div style={styles.v}>
              {reconciliation.amountDiff == null
                ? '—'
                : fmtAmount(reconciliation.amountDiff)}
            </div>
            <div style={styles.k}>Timestamp drift</div>
            <div style={styles.v}>
              {reconciliation.timestampDriftSeconds == null
                ? '—'
                : fmtDuration(reconciliation.timestampDriftSeconds)}
            </div>
          </div>

          {reconciliation.mismatches &&
            reconciliation.mismatches.length > 0 && (
              <>
                <div style={{ ...styles.k, marginTop: '8px' }}>Mismatches</div>
                <ul style={styles.mismatchList}>
                  {reconciliation.mismatches.map((m, i) => (
                    <li key={i} style={styles.mismatchItem(m.severity)}>
                      <div>
                        <strong style={{ color: severityColor(m.severity) }}>
                          [{m.severity}] {m.kind}
                        </strong>
                      </div>
                      <div style={{ color: '#9aa3b2', marginTop: '2px' }}>
                        {m.message}
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
        </div>
      )}

      {/* ----- Derived metrics block ----- */}
      {derived && (
        <div style={styles.section}>
          <h4 style={styles.sectionTitle}>Derived metrics</h4>
          <div style={styles.grid}>
            <div style={styles.k}>Duration (off-chain)</div>
            <div style={styles.v}>
              {fmtDuration(derived.durationOffchainSeconds)}
            </div>
            <div style={styles.k}>Duration (on-chain)</div>
            <div style={styles.v}>
              {fmtDuration(derived.durationOnchainSeconds)}
            </div>
            <div style={styles.k}>Yield (off-chain)</div>
            <div style={styles.v}>{fmtAmount(derived.yieldOffchain)}</div>
            <div style={styles.k}>Yield (on-chain)</div>
            <div style={styles.v}>{fmtAmount(derived.yieldOnchain)}</div>
          </div>
        </div>
      )}
    </div>
  );
}
