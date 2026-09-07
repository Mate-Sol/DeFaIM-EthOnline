/**
 * test/lifecycle.test.js — handler tests for the lifecycle merge route
 * --------------------------------------------------------------------
 *
 * Tests `routes/lifecycle.js`'s buildLifecycleHandler factory by injecting
 * fake mongoose-style models + a fake observer client. No real DB, no real
 * HTTP, no Express boot — pure unit tests of the handler logic.
 *
 * Coverage:
 *   - 400 when reference is missing/empty
 *   - 404 when no FinancingRequest matches the reference
 *   - 200 with PayMate data + observer "no data yet" when observer returns null
 *   - 200 with PayMate data + observer activity when observer returns a record
 *   - 200 with PayMate data + observer.available=false on observer error
 *   - 200 with embedded RepaymentRecord when one exists
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildLifecycleHandler,
  buildLifecycleByDrawdownIdHandler,
} = require('../routes/lifecycle');

// ---------------------------------------------------------------------------
// Fake req/res
// ---------------------------------------------------------------------------

function makeReq(reference) {
  return { params: { reference } };
}

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

// ---------------------------------------------------------------------------
// Fake mongoose-style model
//
// findOne(query) returns an object with .populate() and is awaitable. We
// emulate the chain by returning a thenable that supports `.populate()`.
// ---------------------------------------------------------------------------

function makeFinancingModel(rowsByReference) {
  return {
    findOne({ orderReference }) {
      // Mongoose's real findOne() returns a Query BUILDER, not a Promise.
      // The query gets executed when you await it (because it has a .then),
      // OR you call .populate() first which chains and is then awaited.
      // We model only what the handler exercises: a builder with .populate().
      const row = rowsByReference[orderReference] || null;
      return {
        populate() {
          return Promise.resolve(row);
        },
        // Allow direct await if .populate() isn't called (handler guards
        // for this with `typeof financingQuery.populate === 'function'`).
        then(resolve, reject) {
          return Promise.resolve(row).then(resolve, reject);
        },
      };
    },
  };
}

function makeRepaymentModel(rowsByFinancingId) {
  return {
    findOne: async ({ financingRequestId }) =>
      rowsByFinancingId[String(financingRequestId)] || null,
  };
}

function makeObserver({ activity = null, throws = null } = {}) {
  return {
    getActivity: async (reference) => {
      if (throws) throw throws;
      if (typeof activity === 'function') return activity(reference);
      return activity;
    },
  };
}

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const sampleFinancing = {
  _id: 'financing-1',
  orderReference: 'ORD-2026-001',
  pspId: { _id: 'psp-1', companyName: 'Acme Payments' },
  status: 'Disbursed',
  amount: 1000,
  utilizedBips: 50,
  unutilizedBips: 10,
  validatedAt: new Date('2026-04-08T09:05:00.000Z'),
  disbursedAt: new Date('2026-04-08T09:14:47.000Z'),
  dueDate: new Date('2026-05-08T09:14:47.000Z'),
  repaidAt: null,
  txHash: '0xabc123',
  contractAddress: '0xpool',
  createdAt: new Date('2026-04-08T09:00:00.000Z'),
};

const sampleRepayment = {
  _id: 'repayment-1',
  financingRequestId: 'financing-1',
  principalAmount: 1000,
  expectedInterest: 15,
  actualInterestPaid: 15,
  totalRepayment: 1015,
  repaymentDate: new Date('2026-05-08T10:00:00.000Z'),
  txHash: '0xdef456',
  status: 'Completed',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('returns 400 when reference param is missing', async () => {
  const handler = buildLifecycleHandler({
    financingModel: makeFinancingModel({}),
    repaymentModel: makeRepaymentModel({}),
    observer: makeObserver(),
  });
  const req = { params: {} };
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 400);
});

test('returns 404 when no financing exists for reference', async () => {
  const handler = buildLifecycleHandler({
    financingModel: makeFinancingModel({}),
    repaymentModel: makeRepaymentModel({}),
    observer: makeObserver(),
  });
  const req = makeReq('NONEXISTENT-REF');
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 404);
  assert.match(res.body.message, /No FinancingRequest found/);
});

test('returns 200 with PayMate block when financing exists, observer has no data yet', async () => {
  const handler = buildLifecycleHandler({
    financingModel: makeFinancingModel({ 'ORD-2026-001': sampleFinancing }),
    repaymentModel: makeRepaymentModel({}),
    observer: makeObserver({ activity: null }),
  });
  const req = makeReq('ORD-2026-001');
  const res = makeRes();
  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.reference, 'ORD-2026-001');
  assert.equal(res.body.paymate.amount, 1000);
  assert.equal(res.body.paymate.status, 'Disbursed');
  assert.equal(res.body.paymate.pspCompanyName, 'Acme Payments');
  assert.equal(res.body.paymate.txHash, '0xabc123');
  assert.equal(res.body.paymate.repaymentRecord, null);

  assert.equal(res.body.observer.available, true);
  assert.equal(res.body.observer.activity, null);
  assert.match(res.body.observer.reason, /no reconciled data/i);
});

test('returns 200 with observer activity merged when observer returns data', async () => {
  const fakeActivity = {
    reference: 'ORD-2026-001',
    status: 'sent',
    paymate: { drawdownId: 'foo' },
    onchain: { drawdownTxHash: '0xabc123' },
    reconciliation: { matched: true, mismatches: [] },
  };
  const handler = buildLifecycleHandler({
    financingModel: makeFinancingModel({ 'ORD-2026-001': sampleFinancing }),
    repaymentModel: makeRepaymentModel({}),
    observer: makeObserver({ activity: fakeActivity }),
  });
  const req = makeReq('ORD-2026-001');
  const res = makeRes();
  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.observer.available, true);
  assert.equal(res.body.observer.activity.status, 'sent');
  assert.equal(res.body.observer.activity.reconciliation.matched, true);
});

test('fails soft when observer throws — returns PayMate data with available=false', async () => {
  const handler = buildLifecycleHandler({
    financingModel: makeFinancingModel({ 'ORD-2026-001': sampleFinancing }),
    repaymentModel: makeRepaymentModel({}),
    observer: makeObserver({ throws: new Error('connection refused') }),
  });
  const req = makeReq('ORD-2026-001');
  const res = makeRes();
  await handler(req, res);

  assert.equal(res.statusCode, 200);
  // PayMate data still present
  assert.equal(res.body.paymate.amount, 1000);
  // Observer marked unavailable with the reason
  assert.equal(res.body.observer.available, false);
  assert.match(res.body.observer.reason, /connection refused/);
});

test('embeds the matched RepaymentRecord when one exists', async () => {
  const handler = buildLifecycleHandler({
    financingModel: makeFinancingModel({ 'ORD-2026-001': sampleFinancing }),
    repaymentModel: makeRepaymentModel({ 'financing-1': sampleRepayment }),
    observer: makeObserver({ activity: null }),
  });
  const req = makeReq('ORD-2026-001');
  const res = makeRes();
  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.ok(res.body.paymate.repaymentRecord);
  assert.equal(res.body.paymate.repaymentRecord.totalRepayment, 1015);
  assert.equal(res.body.paymate.repaymentRecord.txHash, '0xdef456');
});

test('returns 500 when financing query throws', async () => {
  const handler = buildLifecycleHandler({
    financingModel: {
      findOne() {
        // Builder whose only awaited path (.populate()) rejects.
        return {
          populate() {
            return Promise.reject(new Error('db down'));
          },
        };
      },
    },
    repaymentModel: makeRepaymentModel({}),
    observer: makeObserver(),
  });
  const req = makeReq('ORD-2026-001');
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 500);
});

// ---------------------------------------------------------------------------
// Per-drawdown lifecycle handler — covers the duplicate-orderRef case.
// ---------------------------------------------------------------------------

function makeFinancingModelByIdMap(rowsById) {
  return {
    findById(id) {
      const row = rowsById[String(id)] || null;
      return {
        populate() { return Promise.resolve(row); },
        then(resolve, reject) {
          return Promise.resolve(row).then(resolve, reject);
        },
      };
    },
  };
}

function makeObserverByDrawdownId({ activity = null, throws = null } = {}) {
  return {
    getActivityByDrawdownId: async (drawdownId) => {
      if (throws) throw throws;
      if (typeof activity === 'function') return activity(drawdownId);
      return activity;
    },
  };
}

test('lifecycle-by-drawdownId: 400 when drawdownId param is missing', async () => {
  const handler = buildLifecycleByDrawdownIdHandler({
    financingModel: makeFinancingModelByIdMap({}),
    repaymentModel: makeRepaymentModel({}),
    observer: makeObserverByDrawdownId(),
  });
  const req = { params: {} };
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 400);
});

test('lifecycle-by-drawdownId: 404 when no financing exists for that _id', async () => {
  const handler = buildLifecycleByDrawdownIdHandler({
    financingModel: makeFinancingModelByIdMap({}),
    repaymentModel: makeRepaymentModel({}),
    observer: makeObserverByDrawdownId(),
  });
  const req = { params: { drawdownId: 'nope' } };
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 404);
});

test('lifecycle-by-drawdownId: 200 with paymate + observer blocks for the right drawdown', async () => {
  // Two drawdowns sharing an orderReference (revolving credit). Asking
  // for one by _id must return THAT specific drawdown, not the other.
  const old = { ...sampleFinancing, _id: 'd-old', txHash: '0xfirst' };
  const fresh = {
    ...sampleFinancing,
    _id: 'd-new',
    txHash: '0xsecond',
    disbursedAt: new Date('2026-04-30T07:33:31.000Z'),
  };
  const handler = buildLifecycleByDrawdownIdHandler({
    financingModel: makeFinancingModelByIdMap({ 'd-old': old, 'd-new': fresh }),
    repaymentModel: makeRepaymentModel({}),
    observer: makeObserverByDrawdownId({
      activity: (id) => ({
        reference: 'ORD-REVOLVING',
        paymate: { drawdownId: id },
      }),
    }),
  });

  const req = { params: { drawdownId: 'd-new' } };
  const res = makeRes();
  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.drawdownId, 'd-new');
  assert.equal(res.body.paymate.txHash, '0xsecond');
  assert.equal(res.body.observer.available, true);
  assert.equal(res.body.observer.activity.paymate.drawdownId, 'd-new');
});

test('lifecycle-by-drawdownId: degrades gracefully when observer fails', async () => {
  const handler = buildLifecycleByDrawdownIdHandler({
    financingModel: makeFinancingModelByIdMap({ 'd-1': sampleFinancing }),
    repaymentModel: makeRepaymentModel({}),
    observer: makeObserverByDrawdownId({ throws: new Error('observer 503') }),
  });
  const req = { params: { drawdownId: 'd-1' } };
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.paymate.amount, 1000); // PayMate data still there
  assert.equal(res.body.observer.available, false);
  assert.match(res.body.observer.reason, /observer 503/);
});
