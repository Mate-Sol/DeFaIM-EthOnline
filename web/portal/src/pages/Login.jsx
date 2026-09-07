import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { CreditCard, Mail, Lock, Loader2, AlertCircle, Eye, EyeOff, Briefcase, CheckCircle2 } from 'lucide-react';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);

    const result = await login(email, password);

    if (result.success) {
      // Role-based redirection
      const roleRedirects = {
        PSP: '/psp/dashboard',
        CRO: '/admin/cro',
        CFO: '/admin/cfo',
        CAD: '/admin/cad',
        KAM: '/admin/kam',
        VIEW_ONLY_ADMIN: '/admin/super-admin',
        LEGAL_ADMIN: '/admin/legal'
      };
      let redirectTo = location.state?.from?.pathname;

      if (!redirectTo) {
        if (result.user.role === 'PSP' && (result.user.creditLineStatus === 'NeedMoreInfo' || result.user.isExpired)) {
          redirectTo = '/psp/onboarding';
        } else {
          redirectTo = roleRedirects[result.user.role] || '/';
        }
      }

      navigate(redirectTo, { replace: true });
    } else {
      setError(result.error);
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* Left Panel - Branding */}
      <div className="hidden lg:flex lg:w-1/2 bg-brand-gradient items-center justify-center p-12 relative overflow-hidden">
        {/* Decorative elements */}
        <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none">
          <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-white rounded-full blur-[120px]"></div>
          <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-white rounded-full blur-[120px]"></div>
        </div>

        <div className="text-white text-center max-w-lg z-10">
          <div className="flex flex-col items-center justify-center gap-6 mb-10">
            <img src="/main-defa-logo.svg" className="h-14 w-auto" alt="DeFa" />
            <div className="flex items-center gap-2 px-5 py-2 bg-white/10 backdrop-blur-md rounded-full border border-white/20 text-white text-sm font-medium shadow-xl">
              <Briefcase className="w-4 h-4" />
              PayMate
            </div>
          </div>

          <h1 className="text-xl font-bold mb-10 leading-tight px-4 text-white/90">
            The Liquidity Engine for Payment Service Providers
          </h1>

          <div className="space-y-6 text-left mx-auto max-w-lg">
            <div className="flex items-center gap-4 group">
              <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center backdrop-blur-md border border-white/30 group-hover:bg-white/40 transition-all shadow-lg">
                <CheckCircle2 className="w-6 h-6 text-white" />
              </div>
              <span className="text-lg text-white font-medium">Prefunding infrastructure to enable your settlement operations</span>
            </div>
            <div className="flex items-center gap-4 group">
              <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center backdrop-blur-md border border-white/30 group-hover:bg-white/40 transition-all shadow-lg">
                <CheckCircle2 className="w-6 h-6 text-white" />
              </div>
              <span className="text-lg text-white font-medium">Scale into new corridors and markets</span>
            </div>
            <div className="flex items-center gap-4 group">
              <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center backdrop-blur-md border border-white/30 group-hover:bg-white/40 transition-all shadow-lg">
                <CheckCircle2 className="w-6 h-6 text-white" />
              </div>
              <span className="text-lg text-white font-medium">Flexible pre-funding that grows with your volume</span>
            </div>
          </div>
        </div>
      </div>

      {/* Right Panel - Login Form */}
      <div className="flex-1 flex items-center justify-center p-8 bg-gray-50">
        <div className="w-full max-w-md">
          {/* Mobile Logo — SVG asset is white (designed for the dark left
              panel above the lg breakpoint). On the mobile viewport it
              sits on bg-gray-50, so we invert() it to render dark. */}
          <div className="lg:hidden flex flex-col items-center justify-center gap-4 mb-8">
            <img src="/main-defa-logo.svg" className="h-24 w-auto invert" alt="DeFa" />
            <div className="flex items-center gap-2 px-4 py-1.5 bg-brand-purple/10 rounded-full border border-brand-purple/20 text-brand-purple text-xs font-bold uppercase tracking-wider">
              <Briefcase className="w-3.5 h-3.5" />
              PayMate
            </div>
          </div>

          <div className="card p-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Welcome Back</h2>
            <p className="text-gray-600 mb-8">Sign in to access your liquidity dashboard</p>

            {error && (
              <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3 text-red-700">
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label className="input-label">Email Address</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="input-field pl-11"
                    placeholder="you@example.com"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="input-label">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="input-field pl-11 pr-11"
                    placeholder="••••••••"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 focus:outline-none"
                  >
                    {showPassword ? (
                      <EyeOff className="w-5 h-5" />
                    ) : (
                      <Eye className="w-5 h-5" />
                    )}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between text-sm">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" className="w-4 h-4 rounded border-gray-300 text-brand-purple focus:ring-brand-purple" />
                  <span className="text-gray-600">Remember me</span>
                </label>
                <button
                  type="button"
                  onClick={() => navigate('/forgot-password')}
                  className="text-brand-purple hover:underline"
                >
                  Forgot password?
                </button>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="btn-brand w-full flex items-center justify-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  'Sign In'
                )}
              </button>
            </form>


          </div>

          <p className="text-center text-gray-600 mt-6">
         Ready to scale your payments business?{' '}
            <a href="/register" className="text-brand-purple hover:underline font-medium">
              Register Now
            </a>
          </p>
        </div>
      </div>
    </div>
  );
};

export default Login;
