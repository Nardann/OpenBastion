import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  ShieldCheck,
  Mail,
  Lock,
  LogIn,
  Database,
  User as UserIcon,
  Sun,
  Moon,
  Globe,
  ChevronRight,
  ArrowLeft,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { useNotification } from '../context/NotificationContext';
import { useLang } from '../context/LangContext';
import api from '../services/api';

type ProviderType = 'LOCAL' | 'LDAP' | 'OIDC';

interface AuthProvider {
  id: string;
  name: string;
  type: ProviderType;
  enabled: boolean;
  issuerHost?: string;
}

const LOCAL_PROVIDER: AuthProvider = {
  id: 'local',
  name: 'Local',
  type: 'LOCAL',
  enabled: true,
};

const Login: React.FC = () => {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [requiresOtp, setRequiresOtp] = useState(false);
  const [tempToken, setTempToken] = useState('');
  const [providers, setProviders] = useState<AuthProvider[]>([LOCAL_PROVIDER]);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
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
      const list = res.data as AuthProvider[];
      // Backend always returns Local first; fall back defensively if it
      // doesn't (e.g., older API on a partial deploy).
      const hasLocal = list.some((p) => p.type === 'LOCAL');
      setProviders(hasLocal ? list : [LOCAL_PROVIDER, ...list]);
      // Auto-select if only one provider is available — avoids an extra
      // click on minimal installs.
      if (list.length === 1) setSelectedProviderId(list[0]!.id);
    } catch (err) {
      console.error('Failed to fetch auth providers', err);
    }
  };

  const selectedProvider = useMemo<AuthProvider | null>(() => {
    if (!selectedProviderId) return null;
    return providers.find((p) => p.id === selectedProviderId) ?? null;
  }, [providers, selectedProviderId]);

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

      if (!selectedProvider) {
        setError(t('login.providerSelect'));
        return;
      }

      const res = await login(selectedProvider.id, identifier, password);
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

  const handleOidcLogin = (provider: AuthProvider) => {
    window.location.href = `/api/auth/oidc/${provider.id}/login`;
  };

  const providerIcon = (type: ProviderType) => {
    if (type === 'LOCAL') return <UserIcon size={18} />;
    if (type === 'LDAP') return <Database size={18} />;
    return <Globe size={18} />;
  };

  const providerTypeLabel = (type: ProviderType) => {
    return (t(`login.providerType.${type}` as any) as string) || type;
  };

  const renderProviderPicker = () => (
    <div className="space-y-4">
      <p className="t-eyebrow px-1">{t('login.providerSelect')}</p>
      <ul className="space-y-2" role="list">
        {providers.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => {
                setError('');
                setSelectedProviderId(p.id);
                if (p.type === 'OIDC') handleOidcLogin(p);
              }}
              className="w-full flex items-center justify-between gap-3 p-4 rounded-lg border border-border-light bg-background-app hover:bg-background-surface hover:border-primary/50 transition-all group text-left"
            >
              <span className="flex items-center gap-3">
                <span className="p-2 rounded-md bg-primary/10 text-primary group-hover:bg-primary group-hover:text-white transition-colors">
                  {providerIcon(p.type)}
                </span>
                <span className="flex flex-col">
                  <span className="text-sm font-semibold text-text-main">{p.name}</span>
                  <span className="text-[11px] text-text-secondary">
                    {providerTypeLabel(p.type)}
                    {p.issuerHost ? ` · ${p.issuerHost}` : ''}
                  </span>
                </span>
              </span>
              <ChevronRight size={16} className="text-text-secondary group-hover:text-primary transition-colors" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );

  const renderCredentialsForm = () => (
    <>
      <button
        type="button"
        onClick={() => {
          setSelectedProviderId(null);
          setError('');
        }}
        className="flex items-center gap-2 text-xs font-bold text-text-secondary uppercase tracking-wider hover:text-primary transition-colors"
      >
        <ArrowLeft size={14} />
        {t('login.backToProviders')}
      </button>

      <div className="flex items-center gap-3 p-3 bg-background-app rounded-lg border border-border-light">
        <span className="p-2 rounded-md bg-primary/10 text-primary">
          {providerIcon(selectedProvider!.type)}
        </span>
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-text-main">{selectedProvider!.name}</span>
          <span className="text-[11px] text-text-secondary">
            {providerTypeLabel(selectedProvider!.type)}
          </span>
        </div>
      </div>

      <div className="space-y-2">
        <label htmlFor="login-identifier" className="t-eyebrow px-1">{t('login.identifier')}</label>
        <div className="relative group">
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary group-focus-within:text-primary transition-colors" aria-hidden="true">
            <Mail size={16} />
          </div>
          <input
            id="login-identifier"
            required
            autoFocus
            autoComplete="username"
            className="form-input input-with-icon h-11 text-sm"
            placeholder={selectedProvider!.type === 'LOCAL'
              ? t('login.identifierPlaceholder')
              : t('login.identifierPlaceholderLdap')}
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-2">
        <label htmlFor="login-password" className="t-eyebrow px-1">{t('login.password')}</label>
        <div className="relative group">
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary group-focus-within:text-primary transition-colors" aria-hidden="true">
            <Lock size={16} />
          </div>
          <input
            id="login-password"
            required
            type="password"
            autoComplete="current-password"
            className="form-input input-with-icon h-11 text-sm"
            placeholder={t('login.passwordPlaceholder')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
      </div>
    </>
  );

  const renderOtpForm = () => (
    <div className="space-y-2">
      <label htmlFor="login-otp" className="t-eyebrow px-1">{t('login.otpCode')}</label>
      <div className="relative group">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary group-focus-within:text-primary transition-colors" aria-hidden="true">
          <ShieldCheck size={16} />
        </div>
        <input
          id="login-otp"
          required
          autoFocus
          autoComplete="one-time-code"
          inputMode="numeric"
          pattern="\d{6}"
          className="form-input input-with-icon h-11 text-center text-lg tracking-[0.5em] font-mono"
          placeholder="000000"
          maxLength={6}
          value={otpCode}
          onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
        />
      </div>
      <p className="text-xs text-text-secondary mt-2 text-center">
        {t('login.otpHint')}
      </p>
    </div>
  );

  const showCredentialsForm = !requiresOtp && selectedProvider && selectedProvider.type !== 'OIDC';
  const showProviderPicker = !requiresOtp && !selectedProvider;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background-app bg-composite p-4 relative overflow-hidden transition-colors duration-300">
      <div className="absolute top-8 right-8">
        <button
          onClick={toggleTheme}
          aria-label={theme === 'light' ? t('common.darkMode') : t('common.lightMode')}
          className="p-3 bg-background-surface border border-border-light rounded-xl text-text-secondary hover:text-primary transition-all shadow-sm"
        >
          {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
        </button>
      </div>

      <div className="w-full max-w-md z-10">
        <div className="text-center mb-10 fade-up">
          <div className="inline-flex p-4 rounded-2xl bg-primary/10 border border-primary/20 mb-4 bg-primary-halo">
            <ShieldCheck className="w-10 h-10 text-primary" />
          </div>
          <h1 className="t-h1 text-text-main">Open-Bastion</h1>
          <p className="t-eyebrow mt-1">{t('login.subtitle')}</p>
        </div>

        <div className="bg-background-surface border border-border-light rounded-xl shadow-lg p-10 rule-ambre-top fade-up fade-up-1">
          <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <div className="p-4 bg-danger/10 border border-danger/20 text-danger rounded-lg text-sm font-medium animate-in slide-in-from-top-2">
                {error}
              </div>
            )}

            {showProviderPicker && renderProviderPicker()}
            {showCredentialsForm && renderCredentialsForm()}
            {requiresOtp && renderOtpForm()}

            {(showCredentialsForm || requiresOtp) && (
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
            )}

            {requiresOtp && (
              <button
                type="button"
                onClick={() => setRequiresOtp(false)}
                className="w-full text-xs font-bold text-text-secondary uppercase hover:text-text-main transition-colors py-1"
              >
                {t('login.back')}
              </button>
            )}
          </form>
        </div>

        <p className="text-center mt-8 t-eyebrow">
          {t('login.footer')}
        </p>
      </div>
    </div>
  );
};

export default Login;
