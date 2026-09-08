import { createContext, useContext, useState, useEffect } from 'react';
import api from '../utils/api';

const AuthContext = createContext(null);

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within AuthProvider');
    }
    return context;
};

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Check if user is already logged in
        const token = sessionStorage.getItem('externalPspToken');
        const storedUser = sessionStorage.getItem('externalPspUser');

        if (token && storedUser) {
            setUser(JSON.parse(storedUser));
        }

        setLoading(false);
    }, []);

    const login = async (email, password) => {
        try {
            const response = await api.post('/auth/login', {
                email,
                password,
            });

            const { token, user: userData } = response.data;

            sessionStorage.setItem('externalPspToken', token);
            sessionStorage.setItem('externalPspUser', JSON.stringify({
                ...userData,
                password: password
            }));

            setUser({
                ...userData,
                password: password
            });

            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    };

    const register = async (email, password, companyName) => {
        try {
            const response = await api.post('/external-psp/auth/register', {
                email,
                password,
                companyName,
            });

            const { user: userData } = response.data;

            // Auto-login after registration
            return await login(email, password);
        } catch (error) {
            return { success: false, error: error.message };
        }
    };

    const logout = () => {
        sessionStorage.removeItem('externalPspToken');
        sessionStorage.removeItem('externalPspUser');
        setUser(null);
    };

    const value = {
        user,
        loading,
        login,
        register,
        logout,
        isAuthenticated: !!user,
    };

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
