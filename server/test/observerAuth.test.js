/**
 * test/observerAuth.test.js — unit tests for the service-key middleware
 * --------------------------------------------------------------------
 *
 * Uses node:test (built into Node 18+) so no new test dependency is added
 * to PayMate's package.json. Run with `npm test`.
 *
 * Scope:
 *   - Fail closed when OBSERVER_SERVICE_KEY is unset (503).
 *   - Reject missing X-Service-Key (401).
 *   - Reject wrong X-Service-Key (401).
 *   - Accept correct X-Service-Key (next() called, req.isServiceCall set).
 *   - safeCompare returns false on length mismatch + wrong content.
 *
 * No mongoose, no Express, no axios — we exercise the middleware as a
 * plain function with fake req/res/next objects.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { observerAuth, safeCompare } = require('../middleware/observerAuth');

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function makeReq(headers = {}) {
  return {
    header(name) {
      return headers[name] ?? headers[name.toLowerCase()];
    },
  };
}

function makeRes() {
  const res = {
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
  return res;
}

function withEnv(values, fn) {
  const saved = {};
  for (const k of Object.keys(values)) {
    saved[k] = process.env[k];
    if (values[k] === undefined) delete process.env[k];
    else process.env[k] = values[k];
  }
  try {
    return fn();
  } finally {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

// ----------------------------------------------------------------------------
// safeCompare
// ----------------------------------------------------------------------------

test('safeCompare returns true for identical strings', () => {
  assert.equal(safeCompare('hello', 'hello'), true);
});

test('safeCompare returns false for different strings of same length', () => {
  assert.equal(safeCompare('hello', 'world'), false);
});

test('safeCompare returns false for strings of different lengths', () => {
  assert.equal(safeCompare('short', 'longer-string'), false);
});

test('safeCompare returns false for non-string inputs', () => {
  assert.equal(safeCompare(null, 'x'), false);
  assert.equal(safeCompare('x', undefined), false);
  assert.equal(safeCompare(123, '123'), false);
});

// ----------------------------------------------------------------------------
// observerAuth — fail-closed when env var missing
// ----------------------------------------------------------------------------

test('observerAuth returns 503 when OBSERVER_SERVICE_KEY is unset', () => {
  withEnv({ OBSERVER_SERVICE_KEY: undefined }, () => {
    const req = makeReq({ 'X-Service-Key': 'whatever' });
    const res = makeRes();
    let nextCalled = false;
    observerAuth(req, res, () => {
      nextCalled = true;
    });
    assert.equal(res.statusCode, 503);
    assert.match(res.body.message, /not configured/i);
    assert.equal(nextCalled, false);
  });
});

// ----------------------------------------------------------------------------
// observerAuth — header validation
// ----------------------------------------------------------------------------

test('observerAuth returns 401 when X-Service-Key header is missing', () => {
  withEnv({ OBSERVER_SERVICE_KEY: 'secret' }, () => {
    const req = makeReq({});
    const res = makeRes();
    let nextCalled = false;
    observerAuth(req, res, () => {
      nextCalled = true;
    });
    assert.equal(res.statusCode, 401);
    assert.match(res.body.message, /Missing X-Service-Key/);
    assert.equal(nextCalled, false);
  });
});

test('observerAuth returns 401 when X-Service-Key is wrong', () => {
  withEnv({ OBSERVER_SERVICE_KEY: 'secret' }, () => {
    const req = makeReq({ 'X-Service-Key': 'not-the-secret' });
    const res = makeRes();
    let nextCalled = false;
    observerAuth(req, res, () => {
      nextCalled = true;
    });
    assert.equal(res.statusCode, 401);
    assert.match(res.body.message, /Invalid X-Service-Key/);
    assert.equal(nextCalled, false);
  });
});

test('observerAuth calls next() when X-Service-Key matches', () => {
  withEnv({ OBSERVER_SERVICE_KEY: 'shared-secret-value' }, () => {
    const req = makeReq({ 'X-Service-Key': 'shared-secret-value' });
    const res = makeRes();
    let nextCalled = false;
    observerAuth(req, res, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true);
    assert.equal(req.isServiceCall, true);
    // Should not have set any error status.
    assert.equal(res.statusCode, 200);
  });
});

test('observerAuth is case-sensitive about the header value', () => {
  withEnv({ OBSERVER_SERVICE_KEY: 'AbcDef' }, () => {
    const req = makeReq({ 'X-Service-Key': 'abcdef' });
    const res = makeRes();
    let nextCalled = false;
    observerAuth(req, res, () => {
      nextCalled = true;
    });
    assert.equal(res.statusCode, 401);
    assert.equal(nextCalled, false);
  });
});

test('observerAuth rejects empty-string header even when key matches the empty string scenario', () => {
  withEnv({ OBSERVER_SERVICE_KEY: 'real-secret' }, () => {
    const req = makeReq({ 'X-Service-Key': '' });
    const res = makeRes();
    let nextCalled = false;
    observerAuth(req, res, () => {
      nextCalled = true;
    });
    // Empty header → falsy, so we treat as missing.
    assert.equal(res.statusCode, 401);
    assert.equal(nextCalled, false);
  });
});
