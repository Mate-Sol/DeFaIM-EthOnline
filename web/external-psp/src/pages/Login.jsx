import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { FaLock, FaEnvelope, FaBuilding } from 'react-icons/fa';

const Login = () => {
    const navigate = useNavigate();
    const { login, register } = useAuth();

    const [isLogin, setIsLogin] = useState(true);
    const [formData, setFormData] = useState({
        email: '',
        password: '',
        companyName: ''
    });
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleChange = (e) => {
        setFormData({
            ...formData,
            [e.target.name]: e.target.value
        });
        setError('');
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            let result;

            if (isLogin) {
                result = await login(formData.email, formData.password);
            } else {
                if (!formData.companyName) {
                    setError('Company name is required');
                    setLoading(false);
                    return;
                }
                result = await register(formData.email, formData.password, formData.companyName);
            }

            if (result.success) {
                navigate('/dashboard');
            } else {
                setError(result.error || 'Authentication failed');
            }
        } catch (err) {
            setError(err.message || 'An error occurred');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center p-4">
            {/* Background decorations */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute top-20 left-20 w-72 h-72 bg-primary-500/10 rounded-full blur-3xl"></div>
                <div className="absolute bottom-20 right-20 w-96 h-96 bg-accent-500/10 rounded-full blur-3xl"></div>
            </div>

            <div className="relative w-full max-w-md">
                {/* Logo/Header */}
                <div className="text-center mb-8">
                    <div className="inline-block p-4 bg-gradient-green rounded-2xl mb-4 shadow-green-lg">
                        <FaBuilding className="text-4xl text-white" />
                    </div>
                    <h1 className="text-4xl font-bold text-gradient mb-2">External PSP Portal</h1>
                    <p className="text-dark-400">Manage your order book and financing</p>
                </div>

                {/* Login/Register Card */}
                <div className="card p-8">
                    <div className="mb-6">
                        <h2 className="text-2xl font-bold text-white mb-2">
                            {isLogin ? 'Welcome Back' : 'Create Account'}
                        </h2>
                        <p className="text-dark-400 text-sm">
                            {isLogin ? 'Sign in to access your account' : 'Register to get started'}
                        </p>
                    </div>

                    {error && (
                        <div className="mb-4 p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-300 text-sm">
                            {error}
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-4">
                        {!isLogin && (
                            <div className="form-group">
                                <label className="label">
                                    <FaBuilding className="inline mr-2" />
                                    Company Name
                                </label>
                                <input
                                    type="text"
                                    name="companyName"
                                    value={formData.companyName}
                                    onChange={handleChange}
                                    className="input"
                                    placeholder="Enter your company name"
                                    required={!isLogin}
                                />
                            </div>
                        )}

                        <div className="form-group">
                            <label className="label">
                                <FaEnvelope className="inline mr-2" />
                                Email Address
                            </label>
                            <input
                                type="email"
                                name="email"
                                value={formData.email}
                                onChange={handleChange}
                                className="input"
                                placeholder="Enter your email"
                                required
                            />
                        </div>

                        <div className="form-group">
                            <label className="label">
                                <FaLock className="inline mr-2" />
                                Password
                            </label>
                            <input
                                type="password"
                                name="password"
                                value={formData.password}
                                onChange={handleChange}
                                className="input"
                                placeholder="Enter your password"
                                required
                                minLength={6}
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="btn-primary w-full"
                        >
                            {loading ? (
                                <span className="flex items-center justify-center">
                                    <div className="spinner mr-2"></div>
                                    Processing...
                                </span>
                            ) : (
                                isLogin ? 'Sign In' : 'Create Account'
                            )}
                        </button>
                    </form>

                    <div className="mt-6 text-center">
                        <button
                            onClick={() => {
                                setIsLogin(!isLogin);
                                setError('');
                                setFormData({ email: '', password: '', companyName: '' });
                            }}
                            className="text-primary-400 hover:text-primary-300 text-sm transition-colors"
                        >
                            {isLogin ? "Don't have an account? Register" : 'Already have an account? Sign in'}
                        </button>
                    </div>

                    {!isLogin && (
                        <div className="mt-6 p-4 bg-primary-900/20 border border-primary-700 rounded-lg">
                            <p className="text-xs text-primary-300">
                                <strong>Note:</strong> After registration, you'll receive API credentials to integrate with CredMate.
                            </p>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="mt-6 text-center text-dark-400 text-sm">
                    <p>External Payment Service Provider Portal</p>
                    <p className="mt-1">Integrated with CredMate Financing Platform</p>
                </div>
            </div>
        </div>
    );
};

export default Login;
