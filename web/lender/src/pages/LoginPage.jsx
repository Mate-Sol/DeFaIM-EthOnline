import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import LoadingOverlay from "@/components/loading/LoadingOverlay";
import InputField from "@/components/ui/InputField";
import Button from "@/components/ui/Button";
import Typography from "@/components/ui/Typography";
import { LuEyeClosed } from "react-icons/lu";
import { FiEye, FiMail, FiLock } from "react-icons/fi";
import yieldHand from "../assets/multiChain-ui/yieldHand.svg";
import leftCoin from "../assets/multiChain-ui/left-defa-coin.svg";
import rightCoin from "../assets/multiChain-ui/right-defa-coin.svg";
import mainLogo from "../assets/multiChain-ui/main-defa-logo.svg";
import { toast } from "react-toastify";
import { axiosInstance } from "@/libs/axios";
import { setSession } from "@/libs/utils/utils";
import { useDispatch } from "react-redux";
import { loginSuccess } from "@/store/loginSlice";

export const loginSchema = z.object({
  email: z.string().min(1, "Email is required").email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
  // .min(8, "Password must be at least 8 characters")
  // .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  // .regex(
  //   /[^A-Za-z0-9]/,
  //   "Password must contain at least one special character",
  // ),
});

const LoginPage = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(loginSchema),
    mode: "onBlur",
    reValidateMode: "onBlur",
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = async (data) => {
    try {
      debugger;
      setLoading(true);
      const res = await axiosInstance.post("/users/login-user", {
        email: data?.email,
        password: data?.password,
      });
      console.log("🚀 ~ onSubmit ~ res:", res);
      if (!res?.token) return;
      // store login session
      setSession(res?.token);
      dispatch(loginSuccess(res?.data));
      toast.success("Logged in successfully");
      // navigate to wellcome page
      navigate("/wellcome");
    } catch (error) {
      console.log("🚀 ~ onSubmit ~ error:", error);
    } finally {
      setLoading(false);
      reset();
    }
  };

  const loginForm = (
    <div className="w-full lg:w-1/2 flex items-center justify-center px-6 sm:px-8 md:px-10 lg:px-16 z-10 py-10 lg:py-0 min-h-screen lg:min-h-0">
      <div className="w-full max-w-[380px] sm:max-w-[400px]">
        {/* Logo */}
        <div className="mb-8 sm:mb-10">
          <img
            src={mainLogo}
            alt="DeFa Logo"
            className="h-8 sm:h-9 md:h-10 w-auto"
          />
        </div>

        {/* Heading */}
        <div className="mb-6 sm:mb-8">
          <h1 className="text-[26px] sm:text-[28px] font-semibold text-white mb-1">
            Login
          </h1>
          <p className="text-white/90 text-[14px] sm:text-[15px] font-normal">
            Welcome back! Please enter your details.
          </p>
        </div>

        <form
          onSubmit={handleSubmit(onSubmit)}
          className="space-y-4 sm:space-y-5"
        >
          {/* Email */}
          <div className="flex flex-col gap-1">
            <Typography
              as="label"
              variant="body2"
              className="text-white font-medium"
            >
              Email
            </Typography>
            <InputField
              className="  text-white placeholder:text-white bg-white/30!"
              {...register("email")}
              type="email"
              placeholder="Enter your email"
              leftIcon={<FiMail size={18} />}
              wrapperClassName={
                errors.email ? "ring-2 ring-red-400 rounded-full" : ""
              }
            />
            {errors.email && (
              <p className="text-red-400 text-[12px] pl-4">
                {errors.email.message}
              </p>
            )}
          </div>

          {/* Password */}
          <div className="flex flex-col gap-1">
            <Typography
              as="label"
              variant="body2"
              className="text-white font-medium"
            >
              Password
            </Typography>
            <InputField
              className=" text-white placeholder:text-white bg-white/30!"
              {...register("password")}
              type={showPassword ? "text" : "password"}
              placeholder="Enter your password"
              leftIcon={<FiLock size={18} />}
              rightIconClickable
              rightIcon={
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="text-white/70 hover:text-white transition-colors pointer-events-auto"
                >
                  {showPassword ? (
                    <LuEyeClosed size={18} />
                  ) : (
                    <FiEye size={18} />
                  )}
                </button>
              }
              wrapperClassName={
                errors.password ? "ring-2 ring-red-400 rounded-full" : ""
              }
            />
            {errors.password && (
              <p className="text-red-400 text-[12px] pl-4">
                {errors.password.message}
              </p>
            )}
          </div>

          {/* Forgot Password */}
          <div className="text-right">
            <Link
              to="/forgot-password"
              className="text-white/80 hover:text-white text-[13px] sm:text-[14px] font-normal transition-colors"
            >
              Forgot password?
            </Link>
          </div>

          {/* Submit */}
          <Button
            type="submit"
            variant="gradient"
            color="primary"
            disabled={loading}
            className="w-full h-[46px] sm:h-[50px] text-[14px] sm:text-[15px] mt-2 !bg-blue-500/50"
          >
            {loading ? "Please Wait..." : "Login"}
          </Button>
        </form>

        {/* Create Account */}
        <div className="text-center pt-4 ">
          <p className="text-white/80 text-[12px] sm:text-[13px] font-normal mr-44 whitespace-nowrap">
            Don&apos;t have an account?{" "}
            <Link
              to="/enter-access-code"
              className="text-white hover:underline font-semibold"
            >
              Create One
            </Link>
          </p>
        </div>
      </div>
    </div>
  );

  const rightSection = (
    <div className="hidden lg:block lg:w-1/2 relative">
      <div className="absolute left-[5%] top-[15%] z-20">
        <img
          src={leftCoin}
          alt="Defa Coin"
          className="w-[80px] xl:w-[100px] h-auto"
        />
      </div>
      <div className="absolute right-[10%] bottom-[28%] z-20">
        <img
          src={rightCoin}
          alt="Defa Coin"
          className="w-[90px] xl:w-[110px] h-auto"
        />
      </div>
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 z-10 w-[420px] xl:w-[520px] 2xl:w-[580px]">
        <img
          src={yieldHand}
          alt="Yield Time"
          className="w-full h-auto object-contain object-bottom"
          style={{ maxHeight: "95vh" }}
        />
      </div>
    </div>
  );

  const mobileCoins = (
    <div className="lg:hidden absolute inset-0 pointer-events-none overflow-hidden">
      <img
        src={leftCoin}
        alt=""
        className="absolute top-4 right-4 w-12 sm:w-14 opacity-40"
      />
      <img
        src={rightCoin}
        alt=""
        className="absolute bottom-6 left-4 w-12 sm:w-14 opacity-40"
      />
    </div>
  );

  return (
    <>
      <LoadingOverlay isLoading={loading} status="Please Wait..." />
      <div className="relative min-h-screen w-full flex flex-col lg:flex-row overflow-hidden">
        {mobileCoins}
        {loginForm}
        {rightSection}
      </div>
    </>
  );
};

export default LoginPage;
