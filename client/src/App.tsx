import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { NotificationProvider } from './context/NotificationContext';
import { LangProvider, useLang } from './context/LangContext';
import AdminSettings from './pages/AdminSettings';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Session from './pages/Session';
import Profile from './pages/Profile';
import AdminLayout from './components/AdminLayout';
import AdminDashboard from './pages/AdminDashboard';
import AdminMachines from './pages/AdminMachines';
import AdminLogs from './pages/AdminLogs';
import AdminUsers from './pages/AdminUsers';
import AdminProviders from './pages/AdminProviders';
import AdminRecordings from './pages/AdminRecordings';
import UserHistory from './pages/UserHistory';
import { Loader2, ShieldCheck, Lock, Globe, User as UserIcon } from 'lucide-react';

const ProtectedRoute: React.FC<{ children: React.ReactNode; adminOnly?: boolean }> = ({ children, adminOnly }) => {
  const { user, loading, sudo } = useAuth();
  const { t } = useLang();
  const [sudoCode, setSudoCode] = React.useState('');
  const [sudoPassword, setSudoPassword] = React.useState('');
  const [elevating, setElevating] = React.useState(false);
  const [error, setError] = React.useState('');

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background-app">
        <Loader2 className="w-12 h-12 text-primary animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" />;
  }

  if (adminOnly && user.role !== 'ADMIN') {
    return <Navigate to="/" />;
  }

  if (adminOnly && user.role === 'ADMIN' && !user.isAdminMode) {
    // Decide which credential the modal asks for.
    //   OTP is allowed regardless of auth method when enabled.
    //   Otherwise: LOCAL → password, LDAP → identifier+password,
    //   OIDC → browser-driven re-auth via /auth/sudo/oidc/.../start.
    type SudoMode = 'OTP' | 'LOCAL_PASSWORD' | 'LDAP_REBIND' | 'OIDC_REAUTH' | 'OIDC_NO_PROVIDER';
    let sudoMode: SudoMode;
    if (user.isOtpEnabled) sudoMode = 'OTP';
    else if (user.authMethod === 'LOCAL') sudoMode = 'LOCAL_PASSWORD';
    else if (user.authMethod === 'LDAP') sudoMode = 'LDAP_REBIND';
    else if (user.authMethod === 'OIDC' && user.authProviderId) sudoMode = 'OIDC_REAUTH';
    else sudoMode = 'OIDC_NO_PROVIDER';

    const handleOidcRedirect = () => {
      if (!user.authProviderId) return;
      // Full-page navigation — the OIDC handshake needs to set Lax
      // cookies on a top-level GET, which a fetch() can't do.
      window.location.href = `/api/auth/sudo/oidc/${user.authProviderId}/start`;
    };

    const handleSudo = async (e: React.FormEvent) => {
      e.preventDefault();
      setError('');
      setElevating(true);
      try {
        const args: { code?: string; password?: string } = {};
        if (sudoMode === 'OTP' && sudoCode.trim()) args.code = sudoCode.trim();
        if (sudoMode === 'LOCAL_PASSWORD' && sudoPassword) args.password = sudoPassword;
        if (sudoMode === 'LDAP_REBIND' && sudoPassword) args.password = sudoPassword;
        // Note: no `identifier` field sent. The backend reads it from
        // the JWT-bound user record so a caller can't pivot to another
        // LDAP account by typing a colleague's credentials.
        await sudo(args);
        setSudoPassword('');
      } catch (err: any) {
        setError(err.response?.data?.message || t('common.error'));
      } finally {
        setElevating(false);
      }
    };

    return (
      <div className="min-h-screen flex items-center justify-center bg-background-app p-4">
        <div className="w-full max-w-md bg-background-surface border border-border-light rounded-2xl shadow-xl p-8 animate-in zoom-in-95 duration-300">
          <div className="text-center mb-8">
            <div className="inline-flex p-4 rounded-full bg-primary/10 mb-4 text-primary">
              <ShieldCheck size={32} />
            </div>
            <h2 className="text-xl font-bold text-text-main">{t('sudo.title')}</h2>
            <p className="text-sm text-text-secondary mt-2">
              {t('sudo.subtitle')}
            </p>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-danger/10 border border-danger/20 text-danger text-xs font-bold rounded-lg text-center">
              {error}
            </div>
          )}

          {sudoMode === 'OIDC_REAUTH' && (
            <div className="space-y-6">
              <div className="p-4 bg-primary/5 border border-primary/20 rounded-lg text-text-secondary text-xs leading-relaxed">
                {t('sudo.oidcHint')}
              </div>
              <button
                onClick={handleOidcRedirect}
                className="w-full btn-primary h-12 flex items-center justify-center gap-2 font-bold shadow-lg shadow-primary/20"
              >
                <Globe size={18} />
                {t('sudo.oidcButton')}
              </button>
              <button
                type="button"
                onClick={() => window.history.back()}
                className="w-full t-eyebrow hover:text-text-main transition-colors"
              >
                {t('sudo.cancel')}
              </button>
            </div>
          )}

          {sudoMode === 'OIDC_NO_PROVIDER' && (
            <div className="space-y-6">
              <div className="p-4 bg-danger/10 border border-danger/20 text-danger text-xs font-medium rounded-lg">
                {t('sudo.oidcNoProvider')}
              </div>
              <button
                type="button"
                onClick={() => window.history.back()}
                className="w-full t-eyebrow hover:text-text-main transition-colors"
              >
                {t('sudo.cancel')}
              </button>
            </div>
          )}

          {(sudoMode === 'OTP' || sudoMode === 'LOCAL_PASSWORD' || sudoMode === 'LDAP_REBIND') && (
            <form onSubmit={handleSudo} className="space-y-6">
              {sudoMode === 'LDAP_REBIND' && (
                <div className="space-y-2">
                  <label className="t-eyebrow px-1">{t('sudo.ldapIdentifierLabel')}</label>
                  {/*
                   * Read-only display of the stored identifier — the
                   * backend uses this exact handle for the LDAP re-bind
                   * regardless of what the client sends, so showing
                   * the user *what* will be checked is honest and
                   * removes the temptation to type someone else's
                   * username.
                   */}
                  <div className="flex items-center gap-3 px-3 py-2 bg-background-app border border-border-light rounded-lg">
                    <UserIcon size={16} className="text-text-secondary" />
                    <span className="text-sm font-mono text-text-main">
                      {user.username || user.email}
                    </span>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <label className="t-eyebrow px-1">
                  {sudoMode === 'OTP'
                    ? t('sudo.otpLabel')
                    : sudoMode === 'LDAP_REBIND'
                    ? t('sudo.ldapPasswordLabel')
                    : t('sudo.passwordLabel')}
                </label>
                <div className="relative group">
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary group-focus-within:text-primary transition-colors">
                    <Lock size={16} />
                  </div>
                  {sudoMode === 'OTP' ? (
                    <input
                      required
                      autoFocus
                      maxLength={6}
                      className="form-input input-with-icon h-11 text-center text-lg tracking-[0.5em] font-mono"
                      placeholder="000000"
                      value={sudoCode}
                      onChange={(e) => setSudoCode(e.target.value)}
                    />
                  ) : (
                    <input
                      required
                      autoFocus={sudoMode === 'LOCAL_PASSWORD' || sudoMode === 'LDAP_REBIND'}
                      type="password"
                      autoComplete="current-password"
                      className="form-input input-with-icon h-11"
                      placeholder={t('sudo.passwordPlaceholder')}
                      value={sudoPassword}
                      onChange={(e) => setSudoPassword(e.target.value)}
                    />
                  )}
                </div>
                {sudoMode !== 'OTP' && (
                  <p className="text-[11px] text-text-secondary px-1 pt-1">
                    {t('sudo.otpRecommendation')}
                  </p>
                )}
              </div>

              <button
                disabled={elevating}
                type="submit"
                className="w-full btn-primary h-12 flex items-center justify-center gap-2 font-bold shadow-lg shadow-primary/20"
              >
                {elevating ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  t('sudo.activate')
                )}
              </button>

              <button
                type="button"
                onClick={() => window.history.back()}
                className="w-full t-eyebrow hover:text-text-main transition-colors"
              >
                {t('sudo.cancel')}
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

const App: React.FC = () => {
  return (
    <ThemeProvider>
      <LangProvider>
      <NotificationProvider>
        <AuthProvider>
          <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <Dashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/session/:id"
              element={
                <ProtectedRoute>
                  <Session />
                </ProtectedRoute>
              }
            />
            <Route
              path="/rdp/:id"
              element={
                <ProtectedRoute>
                  <Session />
                </ProtectedRoute>
              }
            />
            <Route
              path="/profile"
              element={
                <ProtectedRoute>
                  <Profile />
                </ProtectedRoute>
              }
            />
            <Route
              path="/history"
              element={
                <ProtectedRoute>
                  <UserHistory />
                </ProtectedRoute>
              }
            />
            <Route
              path="/administration"
              element={
                <ProtectedRoute adminOnly>
                  <AdminLayout />
                </ProtectedRoute>
              }
            >
              <Route index element={<AdminDashboard />} />
              <Route path="machines" element={<AdminMachines />} />
              <Route path="logs" element={<AdminLogs />} />
              <Route path="users" element={<AdminUsers />} />
              <Route path="auth" element={<AdminProviders />} />
              <Route path="recordings" element={<AdminRecordings />} />
              <Route path="settings" element={<AdminSettings />} />
            </Route>
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </NotificationProvider>
      </LangProvider>
    </ThemeProvider>
  );
};

export default App;
