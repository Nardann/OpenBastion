import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { NotificationProvider } from './context/NotificationContext';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Terminal from './pages/Terminal';
import RdpSession from './pages/RdpSession';
import Profile from './pages/Profile';
import AdminLayout from './components/AdminLayout';
import AdminDashboard from './pages/AdminDashboard';
import AdminMachines from './pages/AdminMachines';
import AdminLogs from './pages/AdminLogs';
import AdminUsers from './pages/AdminUsers';
import AdminProviders from './pages/AdminProviders';
import { Loader2, ShieldCheck, Lock } from 'lucide-react';

const ProtectedRoute: React.FC<{ children: React.ReactNode; adminOnly?: boolean }> = ({ children, adminOnly }) => {
  const { user, loading, sudo } = useAuth();
  const [sudoCode, setSudoCode] = React.useState('');
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

  // Handle Admin Mode Elevation (Sudo)
  if (adminOnly && user.role === 'ADMIN' && !user.isAdminMode) {
    const handleSudo = async (e: React.FormEvent) => {
      e.preventDefault();
      setError('');
      setElevating(true);
      try {
        await sudo(sudoCode.trim() || undefined);
      } catch (err: any) {
        setError(err.response?.data?.message || 'Code invalide');
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
            <h2 className="text-xl font-bold text-text-main">Mode Administrateur</h2>
            <p className="text-sm text-text-secondary mt-2">
              Une élévation de privilèges est requise pour accéder à cette zone.
            </p>
          </div>

          <form onSubmit={handleSudo} className="space-y-6">
            {error && (
              <div className="p-3 bg-danger/10 border border-danger/20 text-danger text-xs font-bold rounded-lg text-center">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <label className="text-[10px] font-bold text-text-secondary uppercase tracking-widest px-1">
                {user.isOtpEnabled ? 'Code OTP de vérification' : 'Confirmer l\'accès'}
              </label>
              <div className="relative group">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary group-focus-within:text-primary transition-colors">
                  <Lock size={16} />
                </div>
                {user.isOtpEnabled ? (
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
                  <div className="p-4 bg-background-app rounded-lg border border-border-light text-center text-xs text-text-secondary">
                    Cliquez sur le bouton ci-dessous pour activer le mode administrateur.
                  </div>
                )}
              </div>
            </div>

            <button
              disabled={elevating}
              type="submit"
              className="w-full btn-primary h-12 flex items-center justify-center gap-2 font-bold shadow-lg shadow-primary/20"
            >
              {elevating ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                'Activer le mode admin'
              )}
            </button>
            
            <button
              type="button"
              onClick={() => window.history.back()}
              className="w-full text-[10px] font-bold text-text-secondary uppercase hover:text-text-main transition-colors"
            >
              Annuler
            </button>
          </form>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

const App: React.FC = () => {
  return (
    <ThemeProvider>
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
                  <Terminal />
                </ProtectedRoute>
              }
            />
            <Route
              path="/rdp/:id"
              element={
                <ProtectedRoute>
                  <RdpSession />
                </ProtectedRoute>
              }
            />
            
            {/* Administration Routes */}
            <Route
              path="/profile"
              element={
                <ProtectedRoute>
                  <Profile />
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
              <Route path="sessions" element={<div className="p-8 font-sans"><h1 className="text-2xl font-bold text-text-main">Sessions Enregistrées</h1><p className="text-text-secondary mt-4">Le lecteur vidéo de sessions arrive prochainement.</p></div>} />
            </Route>
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </NotificationProvider>
    </ThemeProvider>
  );
};

export default App;
