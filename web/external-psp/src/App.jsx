import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import OrderBook from './pages/OrderBook';
import CreateOrder from './pages/CreateOrder';
import LoanRequest from './pages/LoanRequest';
import SimulateDeposit from './pages/SimulateDeposit';
import './App.css';

function App() {
  return (
    <Router basename="/externel-psp">
      <AuthProvider>
        <Routes>
          {/* Public Routes */}
          <Route path="/login" element={<Login />} />

          {/* Protected Routes */}
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <Layout>
                  <Dashboard />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/orderbook"
            element={
              <ProtectedRoute>
                <Layout>
                  <OrderBook />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/orderbook/create"
            element={
              <ProtectedRoute>
                <Layout>
                  <CreateOrder />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/loan-request"
            element={
              <ProtectedRoute>
                <Layout>
                  <LoanRequest />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/simulate-deposit"
            element={
              <ProtectedRoute>
                <Layout>
                  <SimulateDeposit />
                </Layout>
              </ProtectedRoute>
            }
          />

          {/* Redirect root to dashboard */}
          <Route path="/" element={<Navigate to="/dashboard" replace />} />

          {/* 404 - Redirect to dashboard */}
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </AuthProvider>
    </Router>
  );
}

export default App;

