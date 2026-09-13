'use strict';

/**
 * The agent's only data source.
 *
 * Everything the risk monitor knows comes from the Subgraph — facility terms,
 * lifecycle timestamps, drawdowns and their repayment state. There is no RPC
 * client here and no database: if the Subgraph is unavailable the agent has
 * nothing to reason about, which is what "load-bearing" means in practice.
 */

const DEFAULT_ENDPOINT =
  process.env.SUBGRAPH_URL ||
  'https://api.studio.thegraph.com/query/1760269/defa-arc/v0.0.1';

const FACILITIES_QUERY = `
  query Facilities($first: Int!, $skip: Int!) {
    _meta { block { number timestamp } hasIndexingErrors }
    facilities(first: $first, skip: $skip, orderBy: createdAt, orderDirection: desc) {
      id
      poolId
      borrower
      status
      softCap
      hardCap
      totalAssets
      totalDrawn
      totalRepaid
      totalFinanceCharge
      totalYieldClaimed
      outstanding
      tenureDays
      penaltyGraceDays
      penaltyRateDaily
      utilizedRateDaily
      fundingMaturity
      lockedAt
      finalityAt
      lenderCount
      drawdownCount
      drawdowns {
        ref
        receiver
        amount
        drawnAt
        repaid
        repaidAt
        financeCharge
      }
    }
  }
`;

async function query(endpoint, q, variables) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q, variables }),
  });
  if (!res.ok) throw new Error(`Subgraph HTTP ${res.status}`);
  const body = await res.json();
  if (body.errors?.length) {
    throw new Error(`Subgraph query failed: ${body.errors[0].message}`);
  }
  return body.data;
}

/**
 * Page through every facility. The book is small today, but a rule that only
 * ever sees the first page silently stops flagging the oldest facilities —
 * which are exactly the ones most likely to be overdue.
 */
async function fetchFacilities({ endpoint = DEFAULT_ENDPOINT, pageSize = 100 } = {}) {
  const facilities = [];
  let meta = null;
  for (let skip = 0; ; skip += pageSize) {
    const data = await query(endpoint, FACILITIES_QUERY, { first: pageSize, skip });
    meta = meta ?? data._meta;
    facilities.push(...data.facilities);
    if (data.facilities.length < pageSize) break;
  }
  return { facilities, meta };
}

module.exports = { fetchFacilities, query, DEFAULT_ENDPOINT, FACILITIES_QUERY };
