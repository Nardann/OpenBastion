import React, { useState, useEffect } from 'react';
import {
  Database,
  Globe,
  Save,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Loader2
} from 'lucide-react';
import api from '../services/api';
import { useLang } from '../context/LangContext';

interface Provider {
  id: string;
  name: string;
  type: 'LDAP' | 'OIDC';
  enabled: boolean;
  config: any;
}

const AdminProviders: React.FC = () => {
  const { t } = useLang();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  const [ldapConfig, setLdapConfig] = useState({
    url: '',
    searchBase: '',
    bindDn: '',
    bindPassword: '',
    searchFilter: '(uid={{username}})'
  });

  const [oidcConfig, setOidcConfig] = useState({
    issuer: '',
    clientId: '',
    clientSecret: '',
    callbackUrl: `${window.location.origin}/api/auth/oidc/callback`
  });

  useEffect(() => {
    fetchProviders();
  }, []);

  const fetchProviders = async () => {
    try {
      setLoading(true);
      const res = await api.get('/auth/admin/providers');
      const data = res.data as Provider[];
      setProviders(data);

      const ldap = data.find(p => p.type === 'LDAP');
      if (ldap) {
        setLdapConfig({ ...ldapConfig, ...ldap.config });
      }

      const oidc = data.find(p => p.type === 'OIDC');
      if (oidc) {
        setOidcConfig({ ...oidcConfig, ...oidc.config });
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (type: 'LDAP' | 'OIDC', config: any) => {
    try {
      setSaving(type);
      setMessage(null);

      await api.post('/auth/providers/upsert', {
        type,
        config,
        enabled: true
      });

      setMessage({
        type: 'success',
        text: type === 'LDAP' ? t('adminProviders.ldap.saveSuccess') : t('adminProviders.oidc.saveSuccess')
      });
      fetchProviders();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || t('adminProviders.saveError') });
    } finally {
      setSaving(null);
    }
  };

  const toggleProvider = async (type: 'LDAP' | 'OIDC', currentState: boolean) => {
    try {
      setSaving(type + '-toggle');
      await api.post('/auth/providers/upsert', {
        type,
        enabled: !currentState
      });
      fetchProviders();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const ldapProvider = providers.find(p => p.type === 'LDAP');
  const oidcProvider = providers.find(p => p.type === 'OIDC');

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-text-main">{t('adminProviders.title')}</h1>
          <p className="text-text-secondary mt-1">{t('adminProviders.subtitle')}</p>
        </div>
      </div>

      {message && (
        <div className={`p-4 rounded-xl border flex items-center gap-3 animate-in slide-in-from-top-2 ${
          message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'
        }`}>
          {message.type === 'success' ? <CheckCircle2 size={20} /> : <XCircle size={20} />}
          <p className="text-sm font-medium">{message.text}</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* LDAP Configuration */}
        <div className="bg-background-surface border border-border-light rounded-xl overflow-hidden shadow-sm flex flex-col">
          <div className="p-6 border-b border-border-light bg-background-app flex justify-between items-center">
            <div className="flex items-center gap-3">
              <Database className="text-orange-500" size={24} />
              <h2 className="text-xl font-bold text-text-main">{t('adminProviders.ldap.title')}</h2>
            </div>
            <button
              onClick={() => toggleProvider('LDAP', !!ldapProvider?.enabled)}
              className={`px-3 py-1 text-[10px] font-bold rounded-full uppercase tracking-wider transition-all ${
                ldapProvider?.enabled
                  ? 'bg-green-100 text-green-700 border border-green-200'
                  : 'bg-background-surface text-text-secondary border border-border-light'
              }`}
            >
              {ldapProvider?.enabled ? t('adminProviders.ldap.active') : t('adminProviders.ldap.inactive')}
            </button>
          </div>
          <div className="p-6 space-y-4 flex-1">
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-widest text-text-secondary">{t('adminProviders.ldap.url')}</label>
              <input
                type="text"
                placeholder={t('adminProviders.ldap.urlPlaceholder')}
                className="form-input text-sm"
                value={ldapConfig.url}
                onChange={e => setLdapConfig({...ldapConfig, url: e.target.value})}
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-widest text-text-secondary">{t('adminProviders.ldap.baseDn')}</label>
              <input
                type="text"
                placeholder={t('adminProviders.ldap.baseDnPlaceholder')}
                className="form-input text-sm"
                value={ldapConfig.searchBase}
                onChange={e => setLdapConfig({...ldapConfig, searchBase: e.target.value})}
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-widest text-text-secondary">{t('adminProviders.ldap.bindDn')}</label>
              <input
                type="text"
                placeholder={t('adminProviders.ldap.bindDnPlaceholder')}
                className="form-input text-sm"
                value={ldapConfig.bindDn}
                onChange={e => setLdapConfig({...ldapConfig, bindDn: e.target.value})}
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-widest text-text-secondary">{t('adminProviders.ldap.bindPassword')}</label>
              <input
                type="password"
                placeholder="••••••••••••••••"
                className="form-input text-sm"
                value={ldapConfig.bindPassword}
                onChange={e => setLdapConfig({...ldapConfig, bindPassword: e.target.value})}
              />
            </div>
          </div>
          <div className="p-4 bg-background-app border-t border-border-light">
            <button
              onClick={() => handleSave('LDAP', ldapConfig)}
              disabled={!!saving}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              {saving === 'LDAP' ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
              {t('adminProviders.ldap.save')}
            </button>
          </div>
        </div>

        {/* OIDC Configuration */}
        <div className="bg-background-surface border border-border-light rounded-xl overflow-hidden shadow-sm flex flex-col">
          <div className="p-6 border-b border-border-light bg-background-app flex justify-between items-center">
            <div className="flex items-center gap-3">
              <Globe className="text-purple-500" size={24} />
              <h2 className="text-xl font-bold text-text-main">{t('adminProviders.oidc.title')}</h2>
            </div>
            <button
              onClick={() => toggleProvider('OIDC', !!oidcProvider?.enabled)}
              className={`px-3 py-1 text-[10px] font-bold rounded-full uppercase tracking-wider transition-all ${
                oidcProvider?.enabled
                  ? 'bg-green-100 text-green-700 border border-green-200'
                  : 'bg-background-surface text-text-secondary border border-border-light'
              }`}
            >
              {oidcProvider?.enabled ? t('adminProviders.ldap.active') : t('adminProviders.ldap.inactive')}
            </button>
          </div>
          <div className="p-6 space-y-4 flex-1">
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-widest text-text-secondary">{t('adminProviders.oidc.issuer')}</label>
              <input
                type="text"
                placeholder={t('adminProviders.oidc.issuerPlaceholder')}
                className="form-input text-sm"
                value={oidcConfig.issuer}
                onChange={e => setOidcConfig({...oidcConfig, issuer: e.target.value})}
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-widest text-text-secondary">{t('adminProviders.oidc.clientId')}</label>
              <input
                type="text"
                placeholder={t('adminProviders.oidc.clientIdPlaceholder')}
                className="form-input text-sm"
                value={oidcConfig.clientId}
                onChange={e => setOidcConfig({...oidcConfig, clientId: e.target.value})}
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-widest text-text-secondary">{t('adminProviders.oidc.clientSecret')}</label>
              <input
                type="password"
                placeholder="••••••••••••••••"
                className="form-input text-sm"
                value={oidcConfig.clientSecret}
                onChange={e => setOidcConfig({...oidcConfig, clientSecret: e.target.value})}
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-widest text-text-secondary">{t('adminProviders.oidc.callbackUrl')}</label>
              <input
                type="text"
                className="form-input text-sm"
                value={oidcConfig.callbackUrl}
                onChange={e => setOidcConfig({...oidcConfig, callbackUrl: e.target.value})}
              />
              <p className="text-[10px] text-text-secondary italic">
                {t('adminProviders.oidc.callbackHint')}
              </p>
            </div>
          </div>
          <div className="p-4 bg-background-app border-t border-border-light">
            <button
              onClick={() => handleSave('OIDC', oidcConfig)}
              disabled={!!saving}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              {saving === 'OIDC' ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
              {t('adminProviders.oidc.save')}
            </button>
          </div>
        </div>
      </div>

      <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 flex gap-3 text-primary">
        <AlertCircle size={20} />
        <div className="space-y-1">
          <p className="text-sm font-bold uppercase tracking-wider">{t('adminProviders.oidc.jit')}</p>
          <p className="text-xs opacity-80">
            {t('adminProviders.jitDesc')}
          </p>
        </div>
      </div>
    </div>
  );
};

export default AdminProviders;
