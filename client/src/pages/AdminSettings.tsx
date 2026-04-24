import React, { useEffect, useState } from 'react';
import { Globe, Save, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import api from '../services/api';
import { useLang, AVAILABLE_LANGS } from '../context/LangContext';
import type { Lang } from '../context/LangContext';

const AdminSettings: React.FC = () => {
  const { t, setLang } = useLang();
  const [selectedLang, setSelectedLang] = useState<Lang>('fr');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    api.get('/settings/public')
      .then(res => {
        const lang = (res.data as any).defaultLang as Lang;
        if (lang) setSelectedLang(lang);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
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
        <h1 className="text-2xl font-bold tracking-tight text-text-main">{t('adminSettings.title')}</h1>
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
            onClick={handleSave}
            disabled={saving}
            className="btn-primary w-full flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
            {t('adminSettings.language.save')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AdminSettings;
