import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { ShieldCheck, Mail, Lock, LogIn, Database, User as UserIcon, Sun, Moon, Globe } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { useNotification } from '../context/NotificationContext';
import { useLang } from '../context/LangContext';
import api from '../services/api';

interface AuthProvider {
  id: string;
  name: string;
  type: 'LDAP' | 'OIDC';
  enabled: boolean;
}

const Login: React.FC = () => {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [requiresOtp, setRequiresOtp] = useState(false);
  const [tempToken, setTempToken] = useState('');
  const [authMethod, setAuthMethod] = useState<'LOCAL' | 'LDAP'>('LOCAL');
  const [providers, setProviders] = useState<AuthProvider[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, loginOtp } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { notify } = useNotification();
  const { t } = useLang();
  const navigate = useNavigate();

  useEffect(() => {
    fetchProviders();
  }, []);

  const fetchProviders = async () => {
    try {
      const res = await api.get('/auth/providers');
      setProviders(res.data as AuthProvider[]);
    } catch (err) {
      console.error('Failed to fetch auth providers', err);
    }
  };

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
        notify({
          type: 'error',
          title: t('notifications.passwordExpired.title'),
          message: t('notifications.passwordExpired.message'),
          duration: 10000,
        });
        navigate('/profile');
      } else {
        navigate('/');
      }
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || t('login.badCredentials'));
    } finally {
      setLoading(false);
    }
  };

  const handleOidcLogin = () => {
    window.location.href = '/api/auth/oidc/login';
  };

  const isLdapEnabled = providers.some(p => p.type === 'LDAP' && p.enabled);
  const isOidcEnabled = providers.some(p => p.type === 'OIDC' && p.enabled);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background-app p-4 relative overflow-hidden transition-colors duration-300">
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
          <p className="text-text-secondary font-medium uppercase tracking-[0.1em] text-[10px] mt-1">{t('login.subtitle')}</p>
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
                {isLdapEnabled && (
                  <div className="flex p-1 bg-background-app rounded-lg border border-border-light">
                    <button
                      type="button"
                      onClick={() => setAuthMethod('LOCAL')}
                      className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-[10px] font-bold transition-all ${authMethod === 'LOCAL' ? 'bg-background-surface text-primary shadow-sm border border-border-light' : 'text-text-secondary hover:text-text-main'}`}
                    >
                      <UserIcon size={14} /> {t('login.methodLocal')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setAuthMethod('LDAP')}
                      className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-[10px] font-bold transition-all ${authMethod === 'LDAP' ? 'bg-background-surface text-primary shadow-sm border border-border-light' : 'text-text-secondary hover:text-text-main'}`}
                    >
                      <Database size={14} /> {t('login.methodLdap')}
                    </button>
                  </div>
                )}

                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-text-secondary uppercase tracking-widest px-1">{t('login.identifier')}</label>
                  <div className="relative group">
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary group-focus-within:text-primary transition-colors">
                      <Mail size={16} />
                    </div>
                    <input
                      required
                      className="form-input input-with-icon h-11 text-sm"
                      placeholder={authMethod === 'LOCAL' ? t('login.identifierPlaceholder') : t('login.identifierPlaceholderLdap')}
                      value={identifier}
                      onChange={(e) => setIdentifier(e.target.value)}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-text-secondary uppercase tracking-widest px-1">{t('login.password')}</label>
                  <div className="relative group">
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary group-focus-within:text-primary transition-colors">
                      <Lock size={16} />
                    </div>
                    <input
                      required
                      type="password"
                      className="form-input input-with-icon h-11 text-sm"
                      placeholder={t('login.passwordPlaceholder')}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </div>
                </div>
              </>
            ) : (
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-text-secondary uppercase tracking-widest px-1">{t('login.otpCode')}</label>
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
                  {t('login.otpHint')}
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
                  {requiresOtp ? t('login.verifyOtp') : t('login.submit')}
                </>
              )}
            </button>

            {isOidcEnabled && !requiresOtp && (
              <div className="space-y-4">
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t border-border-light"></span>
                  </div>
                  <div className="relative flex justify-center text-[10px] uppercase font-bold tracking-widest">
                    <span className="bg-background-surface px-2 text-text-secondary">{t('login.ssoLabel')}</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleOidcLogin}
                  className="w-full h-11 flex items-center justify-center gap-3 bg-background-app border border-border-light text-text-main text-xs font-bold rounded-lg hover:bg-background-surface hover:border-primary/50 transition-all shadow-sm"
                >
                  <Globe size={16} className="text-primary" />
                  {t('login.ssoButton')}
                </button>
              </div>
            )}

            {requiresOtp && (
              <button
                type="button"
                onClick={() => setRequiresOtp(false)}
                className="w-full text-[10px] font-bold text-text-secondary uppercase hover:text-text-main transition-colors"
              >
                {t('login.back')}
              </button>
            )}
          </form>
        </div>

        <p className="text-center mt-8 text-text-secondary text-[10px] font-medium uppercase tracking-widest">
          {t('login.footer')}
        </p>
      </div>
    </div>
  );
};

export default Login;
