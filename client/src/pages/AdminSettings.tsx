import React, { useEffect, useState } from 'react';
import { Globe, Save, CheckCircle2, XCircle, Loader2, Lock, Eye, EyeOff, Clock, Trash2 } from 'lucide-react';
import api from '../services/api';
import { useLang, AVAILABLE_LANGS } from '../context/LangContext';
import type { Lang } from '../context/LangContext';

type RetentionUnit = 'hour' | 'day' | 'month' | 'year';

const RETENTION_UNITS: RetentionUnit[] = ['hour', 'day', 'month', 'year'];

const AdminSettings: React.FC = () => {
  const { t, setLang } = useLang();
  const [selectedLang, setSelectedLang] = useState<Lang>('fr');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMessage, setPwMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Retention state
  const [retentionValue, setRetentionValue] = useState<number>(30);
  const [retentionUnit, setRetentionUnit] = useState<RetentionUnit>('day');
  const [retentionEnabled, setRetentionEnabled] = useState(false);
  const [retentionSaving, setRetentionSaving] = useState(false);
  const [retentionMessage, setRetentionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const [pubRes, retRes] = await Promise.all([
          api.get('/settings/public'),
          api.get('/settings/recording-retention'),
        ]);
        const lang = (pubRes.data as any).defaultLang as Lang;
        if (lang) setSelectedLang(lang);

        const ret = retRes.data as { value: number | null; unit: string | null };
        if (ret.value && ret.unit) {
          setRetentionEnabled(true);
          setRetentionValue(ret.value);
          setRetentionUnit(ret.unit as RetentionUnit);
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    };
    fetchSettings();
  }, []);

  const handleSaveLang = async () => {
    try {
      setSaving(true);
      setMessage(null);
      await api.patch('/settings/lang', { lang: selectedLang });
      setLang(selectedLang);
      setMessage({ type: 'success', text: t('adminSettings.language.saveSuccess') });
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || t('adminSettings.language.saveError') });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveRetention = async () => {
    try {
      setRetentionSaving(true);
      setRetentionMessage(null);
      await api.patch('/settings/recording-retention', { value: retentionValue, unit: retentionUnit });
      setRetentionEnabled(true);
      setRetentionMessage({ type: 'success', text: t('adminSettings.retention.saveSuccess') });
    } catch (err: any) {
      setRetentionMessage({ type: 'error', text: err.message || t('adminSettings.retention.saveError') });
    } finally {
      setRetentionSaving(false);
    }
  };

  const handleClearRetention = async () => {
    try {
      setRetentionSaving(true);
      setRetentionMessage(null);
      await api.delete('/settings/recording-retention');
      setRetentionEnabled(false);
      setRetentionValue(30);
      setRetentionUnit('day');
      setRetentionMessage({ type: 'success', text: t('adminSettings.retention.clearSuccess') });
    } catch (err: any) {
      setRetentionMessage({ type: 'error', text: err.message || t('adminSettings.retention.saveError') });
    } finally {
      setRetentionSaving(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwMessage(null);

    if (newPassword.length < 12) {
      setPwMessage({ type: 'error', text: t('adminSettings.password.tooShort') });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwMessage({ type: 'error', text: t('adminSettings.password.mismatch') });
      return;
    }

    try {
      setPwSaving(true);
      await api.post('/auth/change-password', {
        currentPassword,
        password: newPassword,
      });
      setPwMessage({ type: 'success', text: t('adminSettings.password.saveSuccess') });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setPwMessage({ type: 'error', text: err.message || t('adminSettings.password.saveError') });
    } finally {
      setPwSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div>
        <h1 className="t-h1 text-text-main">{t('adminSettings.title')}</h1>
        <p className="text-text-secondary mt-1 text-sm">{t('adminSettings.subtitle')}</p>
      </div>

      {message && (
        <div className={`p-4 rounded-xl border flex items-center gap-3 animate-in slide-in-from-top-2 ${
          message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'
        }`}>
          {message.type === 'success' ? <CheckCircle2 size={20} /> : <XCircle size={20} />}
          <p className="text-sm font-medium">{message.text}</p>
        </div>
      )}

      {/* Language settings */}
      <div className="bg-background-surface border border-border-light rounded-xl overflow-hidden shadow-sm max-w-lg">
        <div className="p-6 border-b border-border-light bg-background-app flex items-center gap-3">
          <Globe className="text-primary" size={20} />
          <div>
            <h2 className="font-bold text-text-main">{t('adminSettings.language.title')}</h2>
            <p className="text-xs text-text-secondary mt-0.5">{t('adminSettings.language.subtitle')}</p>
          </div>
        </div>

        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {AVAILABLE_LANGS.map(l => (
              <button
                key={l.code}
                type="button"
                onClick={() => setSelectedLang(l.code)}
                className={`py-3 rounded-lg border text-sm font-bold transition-all ${
                  selectedLang === l.code
                    ? 'bg-primary/10 border-primary/50 text-primary'
                    : 'bg-background-app border-border-light text-text-secondary hover:border-primary/30 hover:text-text-main'
                }`}
              >
                {t(`adminSettings.language.${l.code}`) || l.label}
              </button>
            ))}
          </div>

          <button
            onClick={handleSaveLang}
            disabled={saving}
            className="btn-primary w-full flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
            {t('adminSettings.language.save')}
          </button>
        </div>
      </div>

      {/* Recording retention */}
      <div className="bg-background-surface border border-border-light rounded-xl overflow-hidden shadow-sm max-w-lg">
        <div className="p-6 border-b border-border-light bg-background-app flex items-center gap-3">
          <Clock className="text-primary" size={20} />
          <div>
            <h2 className="font-bold text-text-main">{t('adminSettings.retention.title')}</h2>
            <p className="text-xs text-text-secondary mt-0.5">{t('adminSettings.retention.subtitle')}</p>
          </div>
          {retentionEnabled && (
            <span className="ml-auto text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full bg-warning/10 text-warning border border-warning/20">
              {t('adminSettings.retention.active')}
            </span>
          )}
        </div>

        <div className="p-6 space-y-6">
          {retentionMessage && (
            <div className={`p-3 rounded-lg border flex items-center gap-2 text-sm ${
              retentionMessage.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'
            }`}>
              {retentionMessage.type === 'success' ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
              {retentionMessage.text}
            </div>
          )}

          {/* Value slider */}
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <label className="t-eyebrow">{t('adminSettings.retention.value')}</label>
              <span className="text-2xl font-bold text-primary font-mono w-14 text-right">{retentionValue}</span>
            </div>
            <input
              type="range"
              min={1}
              max={365}
              value={retentionValue}
              onChange={e => setRetentionValue(Number(e.target.value))}
              className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-primary bg-background-app"
            />
            <div className="flex justify-between text-[10px] text-text-secondary font-mono">
              <span>1</span>
              <span>90</span>
              <span>180</span>
              <span>270</span>
              <span>365</span>
            </div>
          </div>

          {/* Unit picker */}
          <div className="space-y-2">
            <label className="t-eyebrow">{t('adminSettings.retention.unit')}</label>
            <div className="grid grid-cols-4 gap-2">
              {RETENTION_UNITS.map(unit => (
                <button
                  key={unit}
                  type="button"
                  onClick={() => setRetentionUnit(unit)}
                  className={`py-2 rounded-lg border text-xs font-bold transition-all ${
                    retentionUnit === unit
                      ? 'bg-primary/10 border-primary/50 text-primary'
                      : 'bg-background-app border-border-light text-text-secondary hover:border-primary/30 hover:text-text-main'
                  }`}
                >
                  {t(`adminSettings.retention.${unit}`)}
                </button>
              ))}
            </div>
          </div>

          {/* Summary */}
          <div className="p-3 bg-background-app rounded-lg border border-border-light text-sm text-text-secondary">
            {t('adminSettings.retention.summary')
              .replace('{value}', String(retentionValue))
              .replace('{unit}', t(`adminSettings.retention.${retentionUnit}`))}
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={handleSaveRetention}
              disabled={retentionSaving}
              className="btn-primary flex-1 flex items-center justify-center gap-2"
            >
              {retentionSaving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
              {t('adminSettings.retention.save')}
            </button>
            {retentionEnabled && (
              <button
                onClick={handleClearRetention}
                disabled={retentionSaving}
                title={t('adminSettings.retention.clear')}
                className="btn-secondary px-4 flex items-center gap-2 text-danger hover:bg-danger/5 hover:border-danger/30"
              >
                <Trash2 size={16} />
                {t('adminSettings.retention.clear')}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Admin password change */}
      <div className="bg-background-surface border border-border-light rounded-xl overflow-hidden shadow-sm max-w-lg">
        <div className="p-6 border-b border-border-light bg-background-app flex items-center gap-3">
          <Lock className="text-primary" size={20} />
          <div>
            <h2 className="font-bold text-text-main">{t('adminSettings.password.title')}</h2>
            <p className="text-xs text-text-secondary mt-0.5">{t('adminSettings.password.subtitle')}</p>
          </div>
        </div>

        <form onSubmit={handleChangePassword} className="p-6 space-y-4">
          {pwMessage && (
            <div className={`p-3 rounded-lg border flex items-center gap-2 text-sm ${
              pwMessage.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'
            }`}>
              {pwMessage.type === 'success' ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
              {pwMessage.text}
            </div>
          )}

          <div className="space-y-1">
            <label className="t-eyebrow px-1">{t('adminSettings.password.current')}</label>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                value={currentPassword}
                onChange={e => setCurrentPassword(e.target.value)}
                required
                className="form-input w-full pr-10"
                autoComplete="current-password"
              />
              <button type="button" onClick={() => setShowPw(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary">
                {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div className="space-y-1">
            <label className="t-eyebrow px-1">{t('adminSettings.password.new')}</label>
            <input
              type={showPw ? 'text' : 'password'}
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              required
              minLength={12}
              className="form-input w-full"
              autoComplete="new-password"
            />
          </div>

          <div className="space-y-1">
            <label className="t-eyebrow px-1">{t('adminSettings.password.confirm')}</label>
            <input
              type={showPw ? 'text' : 'password'}
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              required
              className="form-input w-full"
              autoComplete="new-password"
            />
          </div>

          <button
            type="submit"
            disabled={pwSaving}
            className="btn-primary w-full flex items-center justify-center gap-2"
          >
            {pwSaving ? <Loader2 size={18} className="animate-spin" /> : <Lock size={18} />}
            {t('adminSettings.password.save')}
          </button>
        </form>
      </div>
    </div>
  );
};

export default AdminSettings;
