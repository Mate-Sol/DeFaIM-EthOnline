/**
 * Maps a payfi_v1 pool response (from GET /pools or GET /pool/:pool/state)
 * into the "deal" shape that the defa_v2 UI components (PoolWideCard,
 * PoolInfoCard, DepositForm) were originally designed around.
 *
 * Bridge, not a rewrite — lets the existing components render real
 * on-chain data without touching their prop selectors. If a downstream
 * component ever needs a field we haven't mapped, we widen this file,
 * not the component.
 */

// ── Formatters ─────────────────────────────────────────────────────

/** USDC base units (6 decimals) → decimal number. */
export function usdcFromBase(baseStr) {
  const s = String(baseStr || '0');
  if (!/^\d+$/.test(s)) return 0;
  const bi = BigInt(s);
  const dollars = bi / 1_000_000n;
  const cents = Number((bi % 1_000_000n) / 10_000n) / 100; // 2-decimal cents
  return Number(dollars) + cents;
}

/** UNIX-seconds BigInt/string → ISO date string. */
export function tsToDate(ts) {
  const n = Number(ts || 0);
  if (!n) return null;
  return new Date(n * 1000).toISOString();
}

/** Human-readable status string aligned to statusFormater in libs/utils. */
export function poolStatus(pool) {
  if (pool.isDefaulted) return 'defaulted';
  if (pool.isCancelled) return 'unfulfilled';
  if (pool.isActive)    return 'lending';    // → formats to "OPEN"
  return 'closed';                            // funding-complete/closed
}

/**
 * Coarse risk tier from APR — the UI has "low / medium / high" affordances
 * baked in for the risk pill. payfi_v1 has no explicit tier; derive from
 * APR bps so pools with higher yield show as higher risk.
 *
 *   apr <= 800 bps      → Low       (≤ 8%)
 *   apr <= 1500 bps     → Medium    (8–15%)
 *   apr >  1500 bps     → High
 */
export function poolRiskLevel(pool) {
  const apr = Number(pool.aprAnnualBps || 0);
  if (apr <= 800)  return 'Low';
  if (apr <= 1500) return 'Medium';
  return 'High';
}

// ── Main mapper ─────────────────────────────────────────────────────

export function mapPoolToDeal(pool) {
  if (!pool) return null;
  const status = poolStatus(pool);
  const loanAmount    = usdcFromBase(pool.hardCap);
  const amountRaised  = usdcFromBase(pool.totalCapital);
  const outstanding   = usdcFromBase(pool.outstandingPrincipal);
  const availableToDd = usdcFromBase(pool.availableToDd);
  const yieldOwed     = usdcFromBase(pool.yieldOwed);

  return {
    _id:              pool.pubkey,
    pubkey:           pool.pubkey,          // pass-through for endpoints
    poolName:         pool.pspName || `Pool ${pool.pubkey?.slice(0, 6)}…`,
    status,
    poolRiskLevel:    poolRiskLevel(pool),
    date:             pool.createdDay ? new Date(pool.createdDay * 86_400_000).toDateString() : null,

    poolMatureTime:   pool.poolFinalityTs ? Number(pool.poolFinalityTs) : null,
    poolEndTime:      pool.poolFinalityTs ? Number(pool.poolFinalityTs) : null,
    createdAt:        pool.createdDay ? new Date(pool.createdDay * 86_400_000).toISOString() : null,

    poolAmountRaised: amountRaised,
    poolLenders:      [],                    // filled from portfolio-side when needed

    overview: {
      loanAmount,
      loanTenure:    Number(pool.facilityTenorDays || 0),
      // Funding window in days (approximation) — used by the deal card's
      // "expires in N days" copy.
      dealExpiresIn: 7,
      liquidityPool: `${poolRiskLevel(pool)} Risk Pool`,
    },

    tokenized: {
      statusDate: pool.activatedDay
        ? new Date(pool.activatedDay * 86_400_000).toISOString()
        : null,
    },

    // Fields not in the original mock but useful in wired views:
    apyBps:           Number(pool.aprAnnualBps || 0),
    apy:              (Number(pool.aprAnnualBps || 0) / 100).toFixed(2),
    outstanding,
    availableToDd,
    yieldOwed,
    stablecoin:       pool.usdcMint,
    pspWallet:        pool.pspWallet,
    softCap:          usdcFromBase(pool.softCap),
    hardCap:          loanAmount,
    utilizationRateBps: Number(pool.utilizationRateBps || 0),
    commitmentRateBps:  Number(pool.commitmentRateBps  || 0),
    penaltyRateBps:     Number(pool.penaltyRateBps     || 0),
    graceDays:          Number(pool.graceDays || 0),
    todayDay:           Number(pool.todayDay || 0),

    // Raw copy for the "advanced" view / debug drawer
    __raw: pool,
  };
}
