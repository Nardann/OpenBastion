import React, { createContext, useContext, useState, useEffect } from 'react';
import api from '../services/api';

interface User {
  id: string;
  email: string;
  username?: string;
  role: 'ADMIN' | 'USER';
  authMethod: string;
  requiresPasswordChange: boolean;
  isOtpEnabled: boolean;
  isAdminMode: boolean;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (
    identifier: string,
    pass: string,
    method: string,
  ) => Promise<{
    requiresOtp: boolean;
    tempToken?: string;
    requiresPasswordChange?: boolean;
  }>;
  loginOtp: (tempToken: string, code: string) => Promise<void>;
  sudo: (code?: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAuth();

    const handleUnauthorized = () => {
      setUser(null);
    };

    window.addEventListener('auth:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('auth:unauthorized', handleUnauthorized);
  }, []);

  const checkAuth = async () => {
    try {
      const response = await api.get('/auth/me');
      setUser(response.data as any);
    } catch (error) {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  const login = async (identifier: string, password: string, authMethod: string) => {
    const response = await api.post('/auth/login', { identifier, password, authMethod });
    const data = response.data as any;
    if (data.requiresOtp) {
      return { requiresOtp: true, tempToken: data.tempToken };
    }
    setUser(data.user);
    return { requiresOtp: false, requiresPasswordChange: data.requiresPasswordChange || false };
  };

  const loginOtp = async (tempToken: string, code: string) => {
    const response = await api.post('/auth/login-otp', { tempToken, code });
    setUser(response.data.user);
  };

  const sudo = async (code?: string) => {
    await api.post('/auth/sudo', { code });
    await checkAuth();
  };

  const logout = async () => {
    await api.post('/auth/logout');
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{ user, loading, login, loginOtp, sudo, logout, checkAuth }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
