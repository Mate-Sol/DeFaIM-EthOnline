require('dotenv').config();

// Sentry must be initialised BEFORE express is required so its
// instrumentation can wrap the framework. No-op if SENTRY_DSN is unset
// (so local dev / tests aren't affected).
if (process.env.SENTRY_DSN) {
  // eslint-disable-next-line global-require
  const Sentry = require('@sentry/node');
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENV || process.env.NODE_ENV || 'devnet-beta',
    tracesSampleRate: 0.1,
  });
}

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const connectDB = require('./config/database');

// Initialize express app
const app = express();

// Connect to MongoDB
connectDB();

// Populate a fresh database without needing to exec into the container:
// set SEED_DEMO_DATA=1 on the deployment. Idempotent, and a failure here
// never prevents the server from starting.
if (process.env.SEED_DEMO_DATA === '1') {
  mongoose.connection.once('open', () => {
    require('./scripts/seedAll')()
      .then(() => console.log('[seed] demo data ready'))
      .catch((e) => console.error('[seed] failed:', e.message));
  });
}

// Initialize scheduled jobs (credit maintenance)
const { initializeScheduledJobs } = require('./config/scheduler');
const { startOverdueWatcher } = require('./workers/overdueWatcher');
// The Arc indexer refuses
// to boot until PAYFI_FACTORY_ADDRESS is set (guarded start), so dev envs
// without a deploy stay quiet instead of stack-tracing every 30s.
const { start: startEvmIndexer } = require('./workers/evmIndexer');

// CORS — accepts the configured production frontend AND any localhost
// origin so a local dev client (Vite on :5173 / :5174) can hit a
// server that's also configured for the deployed FRONTEND_URL. The
// dynamic `origin` callback whitelists per-request instead of using
// a single static string.
const allowedOrigins = new Set([
  process.env.FRONTEND_URL,
  // Extra allowed origins (comma-separated) for staging / preview deploys.
  ...(process.env.EXTRA_CORS_ORIGINS || '').split(',').map((s) => s.trim()),
].filter(Boolean));
app.use(cors({
  credentials: true,
  origin(origin, cb) {
    // No Origin header (curl, same-origin, server-to-server) — let it through.
    if (!origin) return cb(null, true);
    if (allowedOrigins.has(origin)) return cb(null, true);
    // Permissive for any localhost / 127.0.0.1 during dev.
    if (/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$/.test(origin)) {
      return cb(null, true);
    }
    // Permissive for Vercel preview deploys (`*.vercel.app`). Production
    // hits the exact FRONTEND_URL above; previews get the wildcard.
    if (/^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin)) {
      return cb(null, true);
    }
    return cb(new Error(`CORS blocked: ${origin}`));
  },
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use('/public', express.static('public'));

// Rate limiting on the abuse-prone surfaces. 30 req/min/IP per group.
// Tune if legitimate users start hitting it. The `standardHeaders` flag
// emits RateLimit-* headers so the frontend can surface a friendly
// "slow down" UI if it ever wants to.
const sensitiveLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/auth', sensitiveLimiter);                 // login + nonce spam
app.use('/auth/wallet', sensitiveLimiter);          // SIWS spam
app.use('/faucet', sensitiveLimiter);               // mint abuse
app.use('/access-code/check', sensitiveLimiter);    // code-guess attempts
app.use('/access-code/redeem', sensitiveLimiter);   // race attempts

// Routes
app.use('/auth', require('./routes/auth'));
app.use('/auth/wallet', require('./routes/walletAuth'));
app.use('/psp', require('./routes/psp'));
app.use('/admin', require('./routes/admin'));
app.use('/maintenance', require('./routes/maintenance'));
app.use('/cfo', require('./routes/cfo'));
app.use('/external-psp', require('./routes/externalPsp'));
app.use('/webhook', require('./routes/webhook'));
app.use('/notifications', require('./routes/notification'));
app.use('/segment', require('./routes/segment'));
app.use('/support', require('./routes/support'));

// SAFE-Observer reconciliation integration (added 2026-04-11, see
// feat/observer-lifecycle-integration). Both mounts are additive — they
// do not modify any existing route or middleware.
//   /observer/*                     → service-key auth, called BY the
//                                     SAFE-Observer service to ingest
//                                     PayMate data.
//   /admin/credit-lines/.../lifecycle → JWT auth, called BY the admin UI
//                                     to render the reconciled lifecycle
//                                     view. Lives in its own router file
//                                     (routes/lifecycle.js); Express
//                                     merges it with the existing /admin
//                                     namespace cleanly.
app.use('/observer', require('./routes/observer'));
app.use('/admin', require('./routes/lifecycle'));
app.use('/faucet', require('./routes/faucet'));
// Pool transactions: /pools, /pool/:pool/*, /lender/build-tx/*,
// /lender/portfolio, /psp/exec/drawdown, /psp/build-tx/*,
// /admin/build-tx/*, /admin/exec/*. Mounted at root because poolTx.js
// declares its own path prefixes.
app.use('/', require('./routes/poolTx'));
app.use('/access-code', require('./routes/accessCode'));
// Legacy v2 auth shim — POST /users/{login-user,apply-referral,create-user}.
// Serves defa_v2_mainnet's URL contract so the restored v2 UI works
// unmodified. Backed by Lender + AccessCode models.
app.use('/users', require('./routes/legacyAuth'));
// Legacy v2 marketplaces shim — POST /marketPlaces/getAlldealsnew and
// GET /marketPlaces/getDealsById/:id. Backed by our EVM pool state.
app.use('/marketPlaces', require('./routes/legacyMarketPlaces'));
app.use('/pool', require('./routes/poolTx'));
app.use('/', require('./routes/facility'));
app.use('/', require('./routes/accessCode'));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'CredMate PSP Backend is running' });
});

// Sentry error handler (must come AFTER all routes, BEFORE the generic
// fallback middleware below). No-op when SENTRY_DSN isn't set.
if (process.env.SENTRY_DSN) {
  // eslint-disable-next-line global-require
  const Sentry = require('@sentry/node');
  Sentry.setupExpressErrorHandler(app);
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    message: 'Something went wrong!',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

// Start server
const PORT = process.env.PORT || 5050;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);

  // Start background workers
  startOverdueWatcher();
  initializeScheduledJobs();
  startEvmIndexer();
});

module.exports = app;
