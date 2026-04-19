import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { ShieldCheck, Mail, Lock, LogIn, Database, User as UserIcon, Sun, Moon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';

const Login: React.FC = () => {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [requiresOtp, setRequiresOtp] = useState(false);
  const [tempToken, setTempToken] = useState('');
  const [authMethod, setAuthMethod] = useState<'LOCAL' | 'LDAP'>('LOCAL');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, loginOtp } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (requiresOtp) {
        await loginOtp(tempToken, otpCode);
        navigate('/');
        return;
      }

      const res = await login(identifier, password, authMethod);
      if (res.requiresOtp) {
        setRequiresOtp(true);
        setTempToken(res.tempToken || '');
      } else if (res.requiresPasswordChange) {
        navigate('/profile');
      } else {
        navigate('/');
      }
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Identifiants ou méthode incorrects');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background-app p-4 relative overflow-hidden transition-colors duration-300">
      {/* Theme Toggle in Login */}
      <div className="absolute top-8 right-8">
        <button
          onClick={toggleTheme}
          className="p-3 bg-background-surface border border-border-light rounded-xl text-text-secondary hover:text-primary transition-all shadow-sm"
        >
          {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
        </button>
      </div>

      <div className="w-full max-w-md z-10 animate-in fade-in zoom-in-95 duration-500">
        <div className="text-center mb-10">
          <div className="inline-flex p-4 rounded-2xl bg-primary/10 border border-primary/20 mb-4">
            <ShieldCheck className="w-10 h-10 text-primary" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-text-main">Open-Bastion</h1>
          <p className="text-text-secondary font-medium uppercase tracking-[0.1em] text-[10px] mt-1">Accès Souverain & Sécurisé</p>
        </div>

        <div className="bg-background-surface border border-border-light rounded-xl shadow-lg p-10">
          <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <div className="p-4 bg-danger/10 border border-danger/20 text-danger rounded-lg text-sm font-medium animate-in slide-in-from-top-2">
                {error}
              </div>
            )}

            {!requiresOtp ? (
              <>
                {/* Auth Method Selector */}
                <div className="flex p-1 bg-background-app rounded-lg border border-border-light">
                  <button
                    type="button"
                    onClick={() => setAuthMethod('LOCAL')}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-xs font-bold transition-all ${authMethod === 'LOCAL' ? 'bg-background-surface text-primary shadow-sm border border-border-light' : 'text-text-secondary hover:text-text-main'}`}
                  >
                    <UserIcon size={14} /> LOCAL
                  </button>
                  <button
                    type="button"
                    onClick={() => setAuthMethod('LDAP')}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-xs font-bold transition-all ${authMethod === 'LDAP' ? 'bg-background-surface text-primary shadow-sm border border-border-light' : 'text-text-secondary hover:text-text-main'}`}
                  >
                    <Database size={14} /> LDAP / AD
                  </button>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-text-secondary uppercase tracking-widest px-1">Identifiant</label>
                  <div className="relative group">
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary group-focus-within:text-primary transition-colors">
                      <Mail size={16} />
                    </div>
                    <input
                      required
                      className="form-input input-with-icon h-11 text-sm"
                      placeholder={authMethod === 'LOCAL' ? "Email ou Pseudo" : "Nom d'utilisateur LDAP"}
                      value={identifier}
                      onChange={(e) => setIdentifier(e.target.value)}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-text-secondary uppercase tracking-widest px-1">Mot de passe</label>
                  <div className="relative group">
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary group-focus-within:text-primary transition-colors">
                      <Lock size={16} />
                    </div>
                    <input
                      required
                      type="password"
                      className="form-input input-with-icon h-11 text-sm"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </div>
                </div>
              </>
            ) : (
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-text-secondary uppercase tracking-widest px-1">Code OTP</label>
                <div className="relative group">
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary group-focus-within:text-primary transition-colors">
                    <ShieldCheck size={16} />
                  </div>
                  <input
                    required
                    autoFocus
                    className="form-input input-with-icon h-11 text-center text-lg tracking-[0.5em] font-mono"
                    placeholder="000000"
                    maxLength={6}
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value)}
                  />
                </div>
                <p className="text-[10px] text-text-secondary mt-2 text-center">
                  Entrez le code généré par votre application d'authentification.
                </p>
              </div>
            )}

            <button
              disabled={loading}
              type="submit"
              className="w-full btn-primary h-12 flex items-center justify-center gap-2 shadow-md shadow-primary/20 disabled:opacity-50"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <LogIn size={18} />
                  {requiresOtp ? 'Vérifier le code' : 'Connexion'}
                </>
              )}
            </button>
            {requiresOtp && (
              <button
                type="button"
                onClick={() => setRequiresOtp(false)}
                className="w-full text-[10px] font-bold text-text-secondary uppercase hover:text-text-main transition-colors"
              >
                Retour
              </button>
            )}
          </form>
        </div>

        <p className="text-center mt-8 text-text-secondary text-[10px] font-medium uppercase tracking-widest">
          &copy; 2026 BASTION NODE - PAM SOUVERAIN
        </p>
      </div>
    </div>
  );
};

export default Login;
