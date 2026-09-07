import { User, Mail, Lock, EyeOff, Eye } from 'lucide-react';
import { useState } from 'react';

const AccountInfo = ({ data, onChange }) => {
  const [showPassword, setShowPassword] = useState(false);

  const handleChange = (field) => (e) => {
    onChange({ ...data, [field]: e.target.value });
   
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-12 h-12 bg-brand-gradient rounded-lg flex items-center justify-center">
          <User className="w-6 h-6 text-white" />
        </div>
        <div>
          <h2 className="text-xl font-semibold">Account Information</h2>
          <p className="text-gray-500 text-sm">Create your admin account for the portal</p>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* <div className="md:col-span-2">
          <label className="input-label">Company Name *</label>
          <div className="relative">
            <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              value={data.segmentId || ''}
              onChange={handleChange('segmentId')}
              className="input-field pl-10"
              placeholder="NOVA"
              required
            />
          </div>
        </div> */}
        <div className="">
          <label className="input-label">Full Name *</label>
          <div className="relative">
            <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              value={data.name || ''}
              onChange={handleChange('name')}
              className="input-field pl-10"
              placeholder="Enter your name"
              required
            />
          </div>
        </div>

        <div>
          <label className="input-label">Email Address *</label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="email"
              value={data.email || ''}
              onChange={handleChange('email')}
              className="input-field pl-10"
              placeholder="Enter your email"
              required
            />
          </div>
        </div>

        <div>
          <label className="input-label">Password *</label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type={showPassword ? 'text' : 'password'}
              value={data.password || ''}
              onChange={handleChange('password')}
              className="input-field pl-10"
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
          <p className="text-xs text-gray-500 mt-2">Minimum 8 characters with a mix of letters and numbers</p>
        </div>
        <div>
          <label className="input-label">Confirm Password *</label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type={showPassword ? 'text' : 'password'}
              value={data.confirmPassword || ''}
              onChange={handleChange('confirmPassword')}
              className="input-field pl-10"
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
          {/* <p className="text-xs text-gray-500 mt-2">Minimum 8 characters with a mix of letters and numbers</p> */}
        </div>
      </div>

      {/* <div className="p-4 bg-brand-purple/5 border border-brand-purple/10 rounded-lg mt-6">
        <p className="text-sm text-brand-purple italic">
          <strong>Note:</strong> These credentials will be used for your initial login once your partner profile is verified.
        </p>
      </div> */}
    </div>
  );
};

export default AccountInfo;
