import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import mainLogo from "@/assets/multiChain-ui/main-defa-logo.svg";
// import accessBg from "@/assets/multiChain-ui/access-bg.webp";
// import accessBg from "@/assets/multiChain-ui/access-bg.svg";
import accessBg from "@/assets/multiChain-ui/access-bg.jpg";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Typography from "@/components/ui/Typography";
import OtpBox from "@/components/ui/OtpBox";
import LoadingOverlay from "@/components/loading/LoadingOverlay";
import { axiosInstance } from "@/libs/axios";

const OTP_LENGTH = 6;

const GrantAccessPage = () => {
  const [otp, setOtp] = useState(Array(OTP_LENGTH).fill(""));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const handleContinue = async () => {
    try {
      const isIncomplete = otp.some((code) => code === "");
      if (isIncomplete) {
        const msg = "Please enter a complete 6-digit access code to continue.";
        setError(msg);
        toast.error(msg);
        return;
      }
      const otpCode = otp.join("");
      setError("");
      setLoading(true);
      const res = await axiosInstance.post("/users/apply-referral", {
        refercode: otpCode,
      });
      console.log("🚀 ~ handleContinue ~ res:", res);

      toast.success("Verified ! please sign-up for joining ");
      navigate(`/register/${otpCode}`);
    } catch (err) {
      console.error("Access code error:", err);
      toast.error("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <LoadingOverlay isLoading={loading} status={"Please wait..."} />
      <div
        className="relative min-h-screen w-full flex items-center justify-center overflow-hidden"
        style={{
          backgroundImage: `url(${accessBg})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
        }}
      >
        {/* Login button — top right */}
        <div className="absolute top-5 right-6 z-20">
          <Link to="/">
            <Button
              variant="gradient"
              color="secondary"
              className="px-6! py-2! text-sm"
            >
              Login
            </Button>
          </Link>
        </div>

        {/* Main content — centered on mobile, left aligned on desktop */}
        <div className="relative z-10 w-full max-w-6xl mx-auto px-5 sm:px-10 flex flex-col items-center sm:items-start">
          {/* Logo */}
          <div className="mb-3">
            <img src={mainLogo} alt="DeFa Logo" className="h-8 sm:h-9 w-auto" />
          </div>

          {/* Subtitle */}
          <Typography
            variant="h5"
            className="text-white font-bold mb-6 sm:mb-8 text-base sm:text-xl md:text-2xl"
          >
            Private Mainnet
          </Typography>

          {/* Access code card */}
          <div className="flex flex-col gap-4 w-full sm:w-auto">
            <Card className="w-full sm:max-w-sm rounded-2xl! border-white/20!">
              <OtpBox
                label="Enter Access Code"
                length={OTP_LENGTH}
                value={otp}
                onChange={(val) => {
                  setError("");
                  setOtp(val);
                }}
                onKeyDownForSubmit={handleContinue}
              />
              {error && (
                <p className="text-red-400 text-sm mt-2 text-start">{error}</p>
              )}
            </Card>

            <Button
              variant="gradient"
              color="secondary"
              onClick={handleContinue}
              className="w-full sm:w-1/2"
            >
              Continue
            </Button>
          </div>
        </div>
      </div>
    </>
  );
};

export default GrantAccessPage;
