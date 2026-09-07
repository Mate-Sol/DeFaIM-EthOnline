import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "../components/layout/AppLayout";
import { HomePage } from "../pages/HomePage";
import LoginPage from "@/pages/LoginPage";
import GrantAccessPage from "@/pages/GrantAccessPage";
import WellcomePage from "@/pages/WellcomePage";
import DashboardPage from "@/pages/DashboardPage";
import LoanPage from "@/pages/LoanPage";
import PoolList from "@/pages/PoolList";
import SupportPage from "@/pages/SupportPage";
import ReferFriend from "@/pages/ReferFriend";
import CaraAgentPage from "@/pages/CaraAgentPage";
import PoolDetails from "@/pages/PoolDetails";
import RegisterPage from "@/pages/RegisterPage";

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<LoginPage />} />
      <Route path="/register/:otpCode" element={<RegisterPage />} />
      <Route path="/sample" element={<HomePage />} />
      <Route path="/enter-access-code" element={<GrantAccessPage />} />
      {/* ======================================================= */}
      {/* dashbord */}
      <Route element={<AppLayout />}>
        <Route path="/wellcome" element={<WellcomePage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/loans" element={<LoanPage />} />
        <Route path="/pools" element={<PoolList />} />
        <Route path="/pool/:dealId" element={<PoolDetails />} />
        <Route path="/customer-support" element={<SupportPage />} />
        <Route path="/refer" element={<ReferFriend />} />
        {/* <Route path="/agent-cara" element={<CaraAgentPage />} /> */}
      </Route>
      {/* ======================================================= */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
