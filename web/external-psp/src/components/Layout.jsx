import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
    FaHome,
    FaBook,
    FaChartLine,
    FaSignOutAlt,
    FaUser,
    FaBars,
    FaTimes
} from 'react-icons/fa';
import { useState } from 'react';

const Layout = ({ children }) => {
    const { user, logout } = useAuth();
    const location = useLocation();
    const navigate = useNavigate();
    const [sidebarOpen, setSidebarOpen] = useState(false);

    const handleLogout = () => {
        logout();
        navigate('/login');
    };

    const navItems = [
        { path: '/dashboard', icon: FaHome, label: 'Dashboard' },
        { path: '/simulate-deposit', icon: FaBook, label: 'Deposit Request' },
        { path: '/loan-request', icon: FaChartLine, label: 'Request Liquidity' },
    ];

    const isActive = (path) => {
        return location.pathname === path || location.pathname.startsWith(path + '/');
    };

    return (
        <div className="min-h-screen flex">
            {/* Mobile Sidebar Overlay */}
            {sidebarOpen && (
                <div
                    className="fixed inset-0 bg-black/50 z-40 lg:hidden"
                    onClick={() => setSidebarOpen(false)}
                />
            )}

            {/* Sidebar */}
            <aside
                className={`fixed lg:static inset-y-0 left-0 z-50 w-64 bg-dark-900 border-r border-dark-700 transform transition-transform duration-300 ease-in-out ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
                    }`}
            >
                <div className="flex flex-col h-full">
                    {/* Logo */}
                    <div className="p-6 border-b border-dark-700">
                        <div className="flex items-center justify-between">
                            <div>
                                <h1 className="text-xl font-bold text-gradient">External PSP</h1>
                                <p className="text-xs text-dark-400 mt-1">Payment Portal</p>
                            </div>
                            <button
                                onClick={() => setSidebarOpen(false)}
                                className="lg:hidden text-dark-400 hover:text-white"
                            >
                                <FaTimes />
                            </button>
                        </div>
                    </div>

                    {/* User Info */}
                    <div className="p-4 border-b border-dark-700">
                        <div className="flex items-center space-x-3">
                            <div className="p-2 bg-gradient-green rounded-lg">
                                <FaUser className="text-white" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-white truncate">
                                    {user?.companyName}
                                </p>
                                <p className="text-xs text-dark-400 truncate">{user?.email}</p>
                            </div>
                        </div>
                    </div>

                    {/* Navigation */}
                    <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
                        {navItems.map((item) => (
                            <Link
                                key={item.path}
                                to={item.path}
                                onClick={() => setSidebarOpen(false)}
                                className={`flex items-center space-x-3 px-4 py-3 rounded-lg transition-all duration-200 ${isActive(item.path)
                                        ? 'bg-gradient-green text-white shadow-green'
                                        : 'text-dark-300 hover:bg-dark-800 hover:text-white'
                                    }`}
                            >
                                <item.icon className="text-lg" />
                                <span className="font-medium">{item.label}</span>
                            </Link>
                        ))}
                    </nav>

                    {/* Logout */}
                    <div className="p-4 border-t border-dark-700">
                        <button
                            onClick={handleLogout}
                            className="flex items-center space-x-3 px-4 py-3 w-full text-dark-300 hover:bg-dark-800 hover:text-red-400 rounded-lg transition-all duration-200"
                        >
                            <FaSignOutAlt className="text-lg" />
                            <span className="font-medium">Logout</span>
                        </button>
                    </div>
                </div>
            </aside>

            {/* Main Content */}
            <div className="flex-1 flex flex-col min-h-screen">
                {/* Top Bar (Mobile) */}
                <header className="lg:hidden bg-dark-900 border-b border-dark-700 p-4">
                    <div className="flex items-center justify-between">
                        <button
                            onClick={() => setSidebarOpen(true)}
                            className="text-dark-400 hover:text-white"
                        >
                            <FaBars className="text-xl" />
                        </button>
                        <h1 className="text-lg font-bold text-gradient">External PSP</h1>
                        <div className="w-6"></div> {/* Spacer for centering */}
                    </div>
                </header>

                {/* Page Content */}
                <main className="flex-1 overflow-x-hidden">
                    {children}
                </main>

                {/* Footer */}
                <footer className="bg-dark-900 border-t border-dark-700 p-4">
                    <div className="text-center text-dark-400 text-sm">
                        <p>External PSP Portal © 2026 - Integrated with CredMate</p>
                    </div>
                </footer>
            </div>
        </div>
    );
};

export default Layout;
