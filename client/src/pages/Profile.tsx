import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  User,
  Mail,
  Lock,
  Shield,
  Save,
  CheckCircle2,
  UserCircle,
  LogOut,
  ShieldAlert,
  AlertTriangle,
  QrCode,
  Smartphone,
  Home,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useLang } from '../context/LangContext';
import api from '../services/api';

const Profile: React.FC = () => {
  const { user, checkAuth } = useAuth();
  const { t } = useLang();
  const [formData, setFormData] = useState({
    email: '',
    username: '',
    currentPassword: '',
    password: '',
    confirmPassword: ''
  });
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);

  const [otpLoading, setOtpLoading] = useState(false);
  const [otpStep, setOtpStep] = useState<'idle' | 'enabling' | 'disabling'>('idle');
  const [qrCode, setQrCode] = useState('');
  const [otpCode, setOtpCode] = useState('');

  useEffect(() => {
    if (user) {
      setFormData(prev => ({
        ...prev,
        email: user.email || '',
        username: user.username || ''
      }));
    }
  }, [user]);

  const handleRevokeSessions = async () => {
    if (!confirm(t('profile.security.revokeConfirm'))) return;
    try {
      setLoading(true);
      await api.post('/users/me/revoke-tokens');
      alert(t('profile.security.revokeSuccess'));
      window.location.reload();
    } catch (err: any) {
      setError(t('profile.security.revokeError'));
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateOtp = async () => {
    try {
      setOtpLoading(true);
      const res = await api.post('/auth/otp/generate');
      setQrCode(res.data.qrCode);
      setOtpStep('enabling');
    } catch (err: any) {
      setError(t('profile.otp.genError'));
    } finally {
      setOtpLoading(false);
    }
  };

  const handleEnableOtp = async () => {
    try {
      setOtpLoading(true);
      await api.post('/auth/otp/enable', { code: otpCode });
      await checkAuth();
      setOtpStep('idle');
      setQrCode('');
      setOtpCode('');
      setSuccess(true);
    } catch (err: any) {
      alert(err.response?.data?.message || t('profile.otp.invalidCode'));
    } finally {
      setOtpLoading(false);
    }
  };

  const handleDisableOtp = async () => {
    try {
      setOtpLoading(true);
      await api.post('/auth/otp/disable', { code: otpCode });
      await checkAuth();
      setOtpStep('idle');
      setOtpCode('');
      setSuccess(true);
    } catch (err: any) {
      alert(err.response?.data?.message || t('profile.otp.invalidCode'));
    } finally {
      setOtpLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess(false);

    if (formData.password) {
      if (!formData.currentPassword) {
        setError(t('profile.account.passwordRequired'));
        return;
      }
      if (formData.password !== formData.confirmPassword) {
        setError(t('profile.account.passwordMismatch'));
        return;
      }
      if (!showConfirm) {
        setShowConfirm(true);
        return;
      }
    }

    try {
      setLoading(true);

      if (formData.password) {
        await api.post('/auth/change-password', {
          currentPassword: formData.currentPassword,
          password: formData.password
        });
      }

      const updateData: any = {
        email: formData.email,
        username: formData.username
      };

      await api.patch('/users/me', updateData);

      setSuccess(true);
      setShowConfirm(false);
      setFormData(prev => ({ ...prev, currentPassword: '', password: '', confirmPassword: '' }));
      await checkAuth();
    } catch (err: any) {
      setError(err.message || t('profile.account.saveError'));
      setShowConfirm(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-8 space-y-8 animate-in fade-in duration-500 text-sans">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-text-main">
            {t('profile.title')}
          </h1>
          <p className="text-text-secondary mt-1 text-sm uppercase tracking-widest font-medium">
            {t('profile.subtitle')}
          </p>
        </div>
        <Link
          to="/"
          className="flex items-center justify-center gap-2 px-4 py-2 bg-background-surface border border-border-light text-text-main text-xs font-bold rounded-lg hover:border-primary/50 transition-all shadow-sm w-fit"
        >
          <Home size={14} className="text-primary" />
          {t('profile.backHome')}
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-1 space-y-6">
          <div className="bg-background-surface border border-border-light rounded-xl p-8 flex flex-col items-center text-center shadow-sm">
            <div className="w-24 h-24 rounded-full bg-primary/10 flex items-center justify-center text-primary mb-4 border border-primary/20">
              <UserCircle size={48} />
            </div>
            <h2 className="font-bold text-lg text-text-main break-all">{user?.email}</h2>
            <div className="mt-2 flex items-center gap-1.5 px-3 py-1 bg-background-app rounded-full text-[10px] font-bold uppercase text-text-secondary">
              <Shield size={12} /> {user?.role}
            </div>
          </div>

          <div className="bg-background-surface border border-border-light rounded-xl p-6 shadow-sm">
            <h3 className="text-xs font-bold uppercase tracking-widest text-primary mb-6 flex items-center gap-2">
              <Smartphone size={14} /> {t('profile.otp.title')}
            </h3>

            {user?.isOtpEnabled ? (
              <div className="space-y-4">
                <div className="p-3 bg-green-50 border border-green-100 rounded-lg flex items-center gap-3 text-green-700">
                  <CheckCircle2 size={16} />
                  <p className="text-[10px] font-bold uppercase">{t('profile.otp.enabled')}</p>
                </div>

                {otpStep === 'disabling' ? (
                  <div className="space-y-3 animate-in fade-in zoom-in-95">
                    <input
                      autoFocus
                      type="text"
                      maxLength={6}
                      className="w-full text-center text-lg font-mono tracking-[0.3em] py-2 bg-background-app border border-border-light rounded-md"
                      placeholder="000000"
                      value={otpCode}
                      onChange={e => setOtpCode(e.target.value)}
                    />
                    <button
                      onClick={handleDisableOtp}
                      disabled={otpLoading || otpCode.length !== 6}
                      className="w-full py-2 bg-danger text-white text-xs font-bold rounded-lg hover:bg-danger/90 disabled:opacity-50"
                    >
                      {t('profile.otp.disable')}
                    </button>
                    <button onClick={() => setOtpStep('idle')} className="w-full text-[10px] font-bold text-text-secondary uppercase">{t('common.cancel')}</button>
                  </div>
                ) : (
                  <button
                    onClick={() => setOtpStep('disabling')}
                    className="w-full py-2 bg-background-app border border-border-light text-text-main text-xs font-bold rounded-lg hover:bg-background-surface transition-all"
                  >
                    {t('profile.otp.disable')}
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                {otpStep === 'idle' ? (
                  <>
                    <p className="text-[11px] text-text-secondary">{t('profile.otp.description')}</p>
                    <button
                      onClick={handleGenerateOtp}
                      disabled={otpLoading}
                      className="w-full flex items-center justify-center gap-2 py-2 bg-primary text-white text-xs font-bold rounded-lg hover:bg-primary-hover transition-all"
                    >
                      <QrCode size={14} /> {t('profile.otp.enable')}
                    </button>
                  </>
                ) : (
                  <div className="space-y-4 animate-in fade-in zoom-in-95">
                    {qrCode && <img src={qrCode} alt="QR Code" className="w-40 h-40 mx-auto border-4 border-white rounded-lg shadow-sm" />}
                    <p className="text-[10px] text-text-secondary text-center">{t('profile.otp.scanHint')}</p>
                    <input
                      autoFocus
                      type="text"
                      maxLength={6}
                      className="w-full text-center text-lg font-mono tracking-[0.3em] py-2 bg-background-app border border-border-light rounded-md"
                      placeholder="000000"
                      value={otpCode}
                      onChange={e => setOtpCode(e.target.value)}
                    />
                    <button
                      onClick={handleEnableOtp}
                      disabled={otpLoading || otpCode.length !== 6}
                      className="w-full py-2 bg-primary text-white text-xs font-bold rounded-lg hover:bg-primary-hover disabled:opacity-50"
                    >
                      {t('profile.otp.verify')}
                    </button>
                    <button onClick={() => setOtpStep('idle')} className="w-full text-[10px] font-bold text-text-secondary uppercase">{t('common.cancel')}</button>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="bg-background-surface border border-border-light rounded-xl p-6 shadow-sm text-center">
            <h3 className="text-xs font-bold uppercase tracking-widest text-primary mb-4 flex items-center justify-center gap-2">
              <Shield size={14} /> {t('profile.security.title')}
            </h3>
            <p className="text-xs text-text-secondary mb-4">
              {t('profile.security.revokeHint')}
            </p>
            <button
              onClick={handleRevokeSessions}
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-red-50 text-red-600 hover:bg-red-100 text-xs font-bold rounded-lg transition-all"
            >
              <LogOut size={14} /> {t('profile.security.revokeAll')}
            </button>
          </div>
        </div>

        <div className="md:col-span-2">
          <div className="bg-background-surface border border-border-light rounded-xl shadow-sm overflow-hidden">
            <div className="p-6 border-b border-border-light bg-background-app flex justify-between items-center">
              <h3 className="font-bold flex items-center gap-2 text-text-main">
                <User size={18} className="text-primary" />
                {t('profile.account.title')}
              </h3>
            </div>

            <form onSubmit={handleSubmit} className="p-8 space-y-6">
              {success && (
                <div className="p-4 bg-green-50 border border-green-200 rounded-xl flex items-center gap-3 text-green-700 animate-in zoom-in-95 duration-200">
                  <CheckCircle2 size={20} />
                  <p className="text-sm font-medium">{t('profile.account.updateSuccess')}</p>
                </div>
              )}

              {error && (
                <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-center gap-3 text-red-700 animate-in shake duration-300">
                  <ShieldAlert size={20} />
                  <p className="text-sm font-medium">{error}</p>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-widest text-text-secondary">{t('profile.account.email')}</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-3 h-4 w-4 text-text-secondary" />
                    <input
                      required
                      type="email"
                      autoComplete="email"
                      className="w-full pl-10 pr-4 py-2 bg-background-app border border-border-light rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
                      value={formData.email}
                      onChange={e => setFormData({...formData, email: e.target.value})}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-widest text-text-secondary">{t('profile.account.username')}</label>
                  <div className="relative">
                    <User className="absolute left-3 top-3 h-4 w-4 text-text-secondary" />
                    <input
                      type="text"
                      autoComplete="username"
                      className="w-full pl-10 pr-4 py-2 bg-background-app border border-border-light rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
                      placeholder={t('profile.account.usernameHint')}
                      value={formData.username}
                      onChange={e => setFormData({...formData, username: e.target.value})}
                    />
                  </div>
                </div>
              </div>

              <div className="pt-6 border-t border-border-light">
                <h4 className="text-xs font-bold uppercase tracking-widest text-primary mb-6">{t('profile.account.changePassword')}</h4>

                <div className="mb-6 space-y-2">
                  <label className="text-xs font-bold uppercase tracking-widest text-text-secondary">{t('profile.account.currentPassword')}</label>
                  <div className="relative">
                    <Shield size={16} className="absolute left-3 top-3 h-4 w-4 text-text-secondary" />
                    <input
                      type="password"
                      autoComplete="current-password"
                      className={`w-full pl-10 pr-4 py-2 bg-background-app border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all ${error.includes('actuel') ? 'border-red-500' : 'border-border-light'}`}
                      placeholder={t('profile.account.currentPasswordHint')}
                      value={formData.currentPassword}
                      onChange={e => setFormData({...formData, currentPassword: e.target.value})}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-widest text-text-secondary">{t('profile.account.newPassword')}</label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-3 h-4 w-4 text-text-secondary" />
                      <input
                        type="password"
                        autoComplete="new-password"
                        className="w-full pl-10 pr-4 py-2 bg-background-app border border-border-light rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
                        value={formData.password}
                        onChange={e => setFormData({...formData, password: e.target.value})}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-widest text-text-secondary">{t('profile.account.confirmPassword')}</label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-3 h-4 w-4 text-text-secondary" />
                      <input
                        type="password"
                        autoComplete="new-password"
                        className="w-full pl-10 pr-4 py-2 bg-background-app border border-border-light rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
                        value={formData.confirmPassword}
                        onChange={e => setFormData({...formData, confirmPassword: e.target.value})}
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-end pt-4 gap-4">
                {showConfirm ? (
                  <div className="flex items-center gap-4 bg-primary/5 p-2 pr-4 rounded-xl border border-primary/20 animate-in zoom-in-95">
                    <p className="text-xs font-bold text-primary flex items-center gap-2">
                      <AlertTriangle size={14} /> {t('profile.account.confirmChange')}
                    </p>
                    <button
                      type="submit"
                      disabled={loading}
                      className="bg-primary text-white text-xs px-4 py-2 rounded-lg font-bold hover:bg-primary-hover transition-all"
                    >
                      {t('profile.account.saveYes')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowConfirm(false)}
                      className="text-text-secondary text-xs font-bold hover:text-text-main"
                    >
                      {t('profile.account.saveNo')}
                    </button>
                  </div>
                ) : (
                  <button
                    disabled={loading}
                    type="submit"
                    className="btn-primary flex items-center gap-2 disabled:opacity-50"
                  >
                    {loading ? t('profile.account.saving') : <><Save size={18} /> {t('profile.account.save')}</>}
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Profile;
