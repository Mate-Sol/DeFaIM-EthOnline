import { axiosInstance } from "@/libs/axios";
import { isValidToken, setSession } from "@/libs/utils/utils";
import { loginSuccess } from "@/store/loginSlice";
import { jwtDecode } from "jwt-decode";
import React, { useEffect, useState } from "react";
import { useDispatch } from "react-redux";
import { useNavigate } from "react-router-dom";
import mainLogo from "@/assets/multiChain-ui/main-defa-logo.svg";

const AuthProtection = ({ children }) => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [isAuthorized, setIsAuthorized] = useState(false);

  useEffect(() => {
    const init = async () => {
      // ── LOCAL DEV VIEWING BYPASS (reference clone only — never ship) ──
      // Set VITE_AUTH_BYPASS=1 to render gated pages without the backend.
      if (import.meta.env.VITE_AUTH_BYPASS === "1") {
        setIsAuthorized(true);
        return;
      }
      // debugger;
      const token = sessionStorage.getItem("accessToken");

      if (!token || !isValidToken(token)) {
        setSession(null);
        navigate("/");
        return;
      }

      try {
        const { userId } = jwtDecode(token);

        if (!userId) throw new Error("Invalid token payload");

        const fetchedUser = await axiosInstance.get(
          `/users/get-user/${userId}`,
        );
        dispatch(loginSuccess(fetchedUser?.data));
        setSession(token);
        setIsAuthorized(true);
      } catch (error) {
        console.error("Auth error:", error);
        setSession(null);
        navigate("/");
      }
    };

    init();
  }, []);

  if (!isAuthorized)
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-6 z-50 bg-overlay">
        <img src={mainLogo} alt="DeFa Logo" className="h-9 w-auto opacity-90" />
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 rounded-full border-4 border-white/20 border-t-accent animate-spin" />
          <p className="text-white/70 text-sm tracking-wide">Please Wait...</p>
        </div>
      </div>
    );

  return <>{children}</>;
};

export default AuthProtection;
