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
import LoadingOverlay from "@/components/loading/LoadingOverlay";
import { axiosInstance } from "@/libs/axios";

// Access codes are issued by POST /access-code/create as three dash-separated
// groups of four alphanumerics, e.g. M4G9-8JEK-BYCD. This page previously used
// a six-box numeric OTP widget, which no generated code could ever be typed
// into — the only code that worked was a numeric one seeded straight into
// Mongo, and codes are single-use, so once it was redeemed nobody could
// register at all.
const CODE_GROUPS = 3;
const GROUP_LEN = 4;
const CODE_LEN = CODE_GROUPS * GROUP_LEN;

// Accept whatever the user pastes or types — strip anything that is not a code
// character, uppercase it, then re-insert the dashes.
function formatCode(raw) {
  const clean = String(raw).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, CODE_LEN);
  return clean.match(/.{1,4}/g)?.join("-") ?? "";
}

const GrantAccessPage = () => {
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const handleContinue = async () => {
    try {
      const otpCode = otp.trim();
      if (otpCode.replace(/-/g, "").length !== CODE_LEN) {
        const msg = "Enter the full access code, e.g. M4G9-8JEK-BYCD.";
        setError(msg);
        toast.error(msg);
        return;
      }
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
      // Surface the server's reason — "Invalid or expired code" is the common
      // one and is actionable, unlike a generic failure message.
      const msg = err?.response?.data?.message || "Something went wrong. Please try again.";
      setError(msg);
      toast.error(msg);
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
              <label className="block text-start">
                <span className="text-white/90 font-semibold">Enter Access Code</span>
                <input
                  type="text"
                  value={otp}
                  spellCheck={false}
                  autoComplete="off"
                  placeholder="XXXX-XXXX-XXXX"
                  maxLength={CODE_LEN + CODE_GROUPS - 1}
                  onChange={(e) => {
                    setError("");
                    setOtp(formatCode(e.target.value));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleContinue();
                  }}
                  className="mt-2 w-full rounded-xl bg-white/10 border border-white/25 px-4 py-3 text-white tracking-[0.18em] font-mono uppercase placeholder:text-white/40 focus:outline-none focus:border-white/60"
                />
              </label>
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
