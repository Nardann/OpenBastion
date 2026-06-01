import React, { createContext, useContext, useState, useEffect } from 'react';
import api from '../services/api';

interface User {
  id: string;
  email: string;
  username?: string;
  role: 'ADMIN' | 'USER';
  authMethod: string;
  // The OIDC/LDAP provider that owns this account. Null for LOCAL users.
  // Needed by the sudo modal so an OIDC admin can re-authenticate against
  // the exact provider that issued their account.
  authProviderId?: string | null;
  requiresPasswordChange: boolean;
  isOtpEnabled: boolean;
  isAdminMode: boolean;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  /**
   * Multi-provider login. `providerId` is either the literal string
   * `'local'` (built-in account) or the UUID of an enabled AuthProvider.
   */
  login: (
    providerId: string,
    identifier: string,
    pass: string,
  ) => Promise<{
    requiresOtp: boolean;
    tempToken?: string;
    requiresPasswordChange?: boolean;
  }>;
  loginOtp: (tempToken: string, code: string) => Promise<void>;
  /**
   * Step-up to admin mode. Accepts:
   *  - `{ code }`     — TOTP (any auth method).
   *  - `{ password }` — LOCAL password OR LDAP re-bind password. For
   *                     LDAP the backend uses the JWT-bound identifier,
   *                     never one supplied by the client.
   * OIDC users without OTP must NOT call this — the modal redirects them
   * to `/api/auth/sudo/oidc/:providerId/start` instead (browser-driven).
   */
  sudo: (args?: { code?: string; password?: string }) => Promise<void>;
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

  const login = async (providerId: string, identifier: string, password: string) => {
    const response = await api.post('/auth/login', { providerId, identifier, password });
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

  const sudo = async (args?: { code?: string; password?: string }) => {
    const body: { code?: string; password?: string } = {};
    if (args?.code) body.code = args.code;
    if (args?.password) body.password = args.password;
    await api.post('/auth/sudo', body);
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
