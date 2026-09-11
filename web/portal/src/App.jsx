import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { Loader2 } from 'lucide-react';
import ProtectedRoute from './components/ProtectedRoute';
import './App.css';
import { Toaster } from 'react-hot-toast';

// Lazy load page components
const Login = lazy(() => import('./pages/Login'));
const Landing = lazy(() => import('./pages/Landing'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
const Register = lazy(() => import('./pages/psp/Register'));
const ApplyFinancingLimit = lazy(() => import('./pages/psp/ApplyFinancingLimit'));
const AgreementOnboarding = lazy(() => import('./pages/psp/AgreementOnboarding'));
const PSPDashboard = lazy(() => import('./pages/psp/Dashboard'));
const OrderBook = lazy(() => import('./pages/psp/OrderBook'));
const Wallet = lazy(() => import('./pages/psp/Wallet'));
const Onboarding = lazy(() => import('./pages/psp/Onboarding'));
const PSPFacilities = lazy(() => import('./pages/psp/Facilities'));
const PSPFacilityDetail = lazy(() => import('./pages/psp/FacilityDetail'));
const PspBorrowFacilities = lazy(() => import('./pages/psp/borrow/Facilities'));
const PspBorrowFacilityDetail = lazy(() => import('./pages/psp/borrow/FacilityDetail'));
const PspBorrowDrawdownDetail = lazy(() => import('./pages/psp/borrow/DrawdownDetail'));
const PspBorrowDailyActivity = lazy(() => import('./pages/psp/borrow/DailyActivity'));
const CRODashboard = lazy(() => import('./pages/admin/cro/Dashboard'));
const KAMDashboard = lazy(() => import('./pages/admin/kam/Dashboard'));
const CADDashboard = lazy(() => import('./pages/admin/cad/Dashboard'));
const AllOrderBook = lazy(() => import('./pages/admin/cad/AllOrderBook'));
const ApplicationReview = lazy(() => import('./pages/admin/cro/ApplicationReview'));
const UserManagement = lazy(() => import('./pages/admin/UserManagement'));
const CFODashboard = lazy(() => import('./pages/admin/cfo/Dashboard'));
const ExposureAnalysis = lazy(() => import('./pages/admin/cfo/ExposureAnalysis'));
const YieldReports = lazy(() => import('./pages/admin/cfo/YieldReports'));
const RepaymentMonitoring = lazy(() => import('./pages/admin/cfo/RepaymentMonitoring'));
const RepaymentTracking = lazy(() => import('./pages/admin/cro/RepaymentTracking'));
const SuperAdminDashboard = lazy(() => import('./pages/admin/super-admin/Dashboard'));
const LegalDashboard = lazy(() => import('./pages/admin/legal/LegalDashboard'));
const Support = lazy(() => import('./pages/Support'));
const Settings = lazy(() => import('./pages/Settings'));
const RAGProjects = lazy(() => import('./pages/rag/RAGProjects'));
const RAGProjectDetail = lazy(() => import('./pages/rag/RAGProjectDetail'));
const RAGChat = lazy(() => import('./pages/rag/RAGChat'));
const FacilityQueue = lazy(() => import('./pages/admin/FacilityQueue'));
const OnChainAdminLogin = lazy(() => import('./pages/onchain-admin/Login'));
const OnChainInitializeQueue = lazy(() => import('./pages/onchain-admin/InitializeQueue'));
const OnChainFacilities = lazy(() => import('./pages/onchain-admin/Facilities'));
const OnChainFacilityDetail = lazy(() => import('./pages/onchain-admin/FacilityDetail'));
const OnChainDailyActivity = lazy(() => import('./pages/onchain-admin/DailyActivity'));
const OnChainAccessCodes = lazy(() => import('./pages/onchain-admin/AccessCodes'));

// Loading component
const PageLoader = () => (
  <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
    <Loader2 className="w-10 h-10 animate-spin text-brand-purple mb-4" />
    <p className="text-gray-600 font-medium">Loading ...</p>
  </div>
);

const LENDER_URL =
  import.meta.env.VITE_LENDER_URL || 'https://defa-arc-hackathon.invoicemate.net';

/**
 * Shown for any route this app does not have. The common case is someone
 * reaching for the lender portal on the admin host, so say so rather than
 * leaving a blank page.
 */
const NotFound = () => {
  const wantedLender = window.location.pathname.startsWith('/lender');
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: '#f8fafc', padding: 24,
    }}>
      <div style={{ maxWidth: 460, textAlign: 'center', fontFamily: 'system-ui, sans-serif' }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', margin: '0 0 8px' }}>
          Page not found
        </h1>
        <p style={{ color: '#475569', fontSize: 14, lineHeight: 1.6, margin: '0 0 20px' }}>
          {wantedLender
            ? 'The lender portal is a separate site — it is not on this address.'
            : `No page at ${window.location.pathname} on the PSP & Admin portal.`}
        </p>
        {wantedLender && (
          <a href={LENDER_URL}
             style={{
               display: 'inline-block', padding: '10px 18px', borderRadius: 999,
               background: '#2540D8', color: '#fff', fontWeight: 600,
               fontSize: 14, textDecoration: 'none', marginRight: 8,
             }}>
            Go to the lender portal
          </a>
        )}
        <a href="/login"
           style={{
             display: 'inline-block', padding: '10px 18px', borderRadius: 999,
             border: '1px solid #cbd5e1', color: '#0f172a',
             fontWeight: 600, fontSize: 14, textDecoration: 'none',
           }}>
          PSP &amp; Admin sign in
        </a>
      </div>
    </div>
  );
};

function App() {
  return (
    <AuthProvider>
      <Toaster position="top-right" />

      <Router>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            {/* Public Routes */}
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password/:token" element={<ResetPassword />} />
            <Route path="/psp/apply-limit" element={<ApplyFinancingLimit />} />
            <Route path="/psp/agrement-onboarding" element={<AgreementOnboarding />} />

            {/* Facility approval queue — KAM/CAD/CRO each see their own step */}
            <Route
              path="/admin/facility-queue"
              element={
                <ProtectedRoute allowedRoles={['KAM', 'CAD', 'CRO']}>
                  <FacilityQueue />
                </ProtectedRoute>
              }
            />

            {/* On-Chain Admin — wallet-only role for signing all program-side
                instructions (initialize, execute, cancel, claim, default).
                Auth gate is handled inside the layout. */}
            <Route path="/onchain-admin" element={<Navigate to="/onchain-admin/facilities" replace />} />
            <Route path="/onchain-admin/login" element={<OnChainAdminLogin />} />
            <Route path="/onchain-admin/initialize" element={<OnChainInitializeQueue />} />
            <Route path="/onchain-admin/facilities" element={<OnChainFacilities />} />
            <Route path="/onchain-admin/facilities/:pool" element={<OnChainFacilityDetail />} />
            <Route path="/onchain-admin/facilities/:pool/daily-activity" element={<OnChainDailyActivity />} />
            <Route path="/onchain-admin/access-codes" element={<OnChainAccessCodes />} />

            {/* PSP Routes */}
            <Route
              path="/psp/dashboard"
              element={
                <ProtectedRoute allowedRoles={['PSP']}>
                  <PSPDashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/psp/order-book"
              element={
                <ProtectedRoute allowedRoles={['PSP']}>
                  <OrderBook />
                </ProtectedRoute>
              }
            />
            <Route
              path="/psp/wallet"
              element={
                <ProtectedRoute allowedRoles={['PSP']}>
                  <Wallet />
                </ProtectedRoute>
              }
            />
            <Route
              path="/psp/onboarding"
              element={
                <ProtectedRoute allowedRoles={['PSP']}>
                  <Onboarding />
                </ProtectedRoute>
              }
            />
            {/* Legacy light-themed PSP facility pages (kept while in-flight links migrate) */}
            <Route
              path="/psp/facilities"
              element={
                <ProtectedRoute allowedRoles={['PSP']}>
                  <PSPFacilities />
                </ProtectedRoute>
              }
            />
            <Route
              path="/psp/facilities/:pool"
              element={
                <ProtectedRoute allowedRoles={['PSP']}>
                  <PSPFacilityDetail />
                </ProtectedRoute>
              }
            />

            {/* New DeFa-themed borrower section */}
            <Route
              path="/psp/borrow/facilities"
              element={
                <ProtectedRoute allowedRoles={['PSP']}>
                  <PspBorrowFacilities />
                </ProtectedRoute>
              }
            />
            <Route
              path="/psp/borrow/facilities/:pool"
              element={
                <ProtectedRoute allowedRoles={['PSP']}>
                  <PspBorrowFacilityDetail />
                </ProtectedRoute>
              }
            />
            <Route
              path="/psp/borrow/facilities/:pool/drawdowns/:drawdownId"
              element={
                <ProtectedRoute allowedRoles={['PSP']}>
                  <PspBorrowDrawdownDetail />
                </ProtectedRoute>
              }
            />
            <Route
              path="/psp/borrow/facilities/:pool/daily-activity"
              element={
                <ProtectedRoute allowedRoles={['PSP']}>
                  <PspBorrowDailyActivity />
                </ProtectedRoute>
              }
            />

            {/* Admin Routes */}
            <Route
              path="/admin/super-admin"
              element={
                <ProtectedRoute allowedRoles={['VIEW_ONLY_ADMIN', 'CFO', 'KAM', 'CAD', 'CRO']}>
                  <SuperAdminDashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/kam"
              element={
                <ProtectedRoute allowedRoles={['KAM', 'VIEW_ONLY_ADMIN']}>
                  <KAMDashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/cad"
              element={
                <ProtectedRoute allowedRoles={['CAD', 'VIEW_ONLY_ADMIN']}>
                  <CADDashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/cad/order-book"
              element={
                <ProtectedRoute allowedRoles={['CAD']}>
                  <AllOrderBook />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/cro"
              element={
                <ProtectedRoute allowedRoles={['CRO', 'VIEW_ONLY_ADMIN']}>
                  <CRODashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/legal"
              element={
                <ProtectedRoute allowedRoles={['LEGAL_ADMIN', 'VIEW_ONLY_ADMIN']}>
                  <LegalDashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/repayments_confirmation"
              element={
                <ProtectedRoute allowedRoles={['CAD']}>
                  <RepaymentTracking />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/application/:id"
              element={
                <ProtectedRoute allowedRoles={['KAM', 'CAD', 'CRO', 'VIEW_ONLY_ADMIN', 'CFO', 'LEGAL_ADMIN']}>
                  <ApplicationReview />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/user-management"
              element={
                <ProtectedRoute allowedRoles={['KAM', 'CAD', 'CRO', 'VIEW_ONLY_ADMIN']}>
                  <UserManagement />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/repayments"
              element={
                <ProtectedRoute allowedRoles={['KAM', 'CAD', 'CRO', 'VIEW_ONLY_ADMIN']}>
                  <RepaymentMonitoring />
                </ProtectedRoute>
              }
            />

            {/* CFO Admin Routes */}
            <Route
              path="/admin/cfo"
              element={
                <ProtectedRoute allowedRoles={['CFO', 'KAM', 'CAD', 'CRO', 'VIEW_ONLY_ADMIN']}>
                  <CFODashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/cfo/exposure"
              element={
                <ProtectedRoute allowedRoles={['CFO', 'KAM', 'CAD', 'CRO', 'VIEW_ONLY_ADMIN']}>
                  <ExposureAnalysis />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/cfo/yields"
              element={
                <ProtectedRoute allowedRoles={['CFO', 'KAM', 'CAD', 'CRO', 'VIEW_ONLY_ADMIN']}>
                  <YieldReports />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/cfo/repayments"
              element={
                <ProtectedRoute allowedRoles={['CFO', 'KAM', 'CAD', 'CRO', 'VIEW_ONLY_ADMIN']}>
                  <RepaymentMonitoring />
                </ProtectedRoute>
              }
            />

            {/* Support Route (Common for PSP and Admin) */}
            <Route
              path="/customer-support"
              element={
                <ProtectedRoute allowedRoles={['PSP', 'KAM', 'CAD', 'CRO', 'CFO', 'VIEW_ONLY_ADMIN']}>
                  <Support />
                </ProtectedRoute>
              }
            />

            {/* Settings Route */}
            <Route
              path="/settings"
              element={
                <ProtectedRoute allowedRoles={['PSP', 'KAM', 'CAD', 'CRO', 'CFO', 'VIEW_ONLY_ADMIN']}>
                  <Settings />
                </ProtectedRoute>
              }
            />

            {/* RAG Routes */}
            <Route
              path="/rag/projects"
              element={
                <ProtectedRoute allowedRoles={['PSP', 'KAM', 'CAD', 'CRO', 'CFO', 'VIEW_ONLY_ADMIN', 'LEGAL_ADMIN']}>
                  <RAGProjects />
                </ProtectedRoute>
              }
            />
            <Route
              path="/rag/projects/:projectId"
              element={
                <ProtectedRoute allowedRoles={['PSP', 'KAM', 'CAD', 'CRO', 'CFO', 'VIEW_ONLY_ADMIN', 'LEGAL_ADMIN']}>
                  <RAGProjectDetail />
                </ProtectedRoute>
              }
            />
            <Route
              path="/rag/chat/:projectId"
              element={
                <ProtectedRoute allowedRoles={['PSP', 'KAM', 'CAD', 'CRO', 'CFO', 'VIEW_ONLY_ADMIN', 'LEGAL_ADMIN']}>
                  <RAGChat />
                </ProtectedRoute>
              }
            />

            {/* Unified landing page — role chooser */}
            <Route path="/" element={<Landing />} />
            {/* Catch all. Without this an unknown path renders a blank white
                page with nothing in the console — indistinguishable from the
                app being down. The lender portal is a separate deployment, so
                /lender/* on this host is the mistake people actually make. */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </Router>
    </AuthProvider>
  );
}

export default App;
