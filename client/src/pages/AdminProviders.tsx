import React, { useState, useEffect, useMemo } from 'react';
import {
  Database,
  Globe,
  Save,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Loader2,
  Plus,
  Pencil,
  Trash2,
  User as UserIcon,
  X,
} from 'lucide-react';
import api from '../services/api';
import { useLang } from '../context/LangContext';

type ProviderType = 'LDAP' | 'OIDC';

interface LdapConfig {
  url: string;
  searchBase: string;
  bindDn?: string;
  bindPassword?: string;
  searchFilter?: string;
  isActiveDirectory?: boolean;
  /** Attribute on user entry holding group memberships. Default: `memberOf`. */
  groupsAttribute?: string;
  /** Subtree for reverse group search (fallback when memberOf is empty). */
  groupsSearchBase?: string;
  /** Filter for the reverse search. {{userDn}} is substituted. */
  groupsSearchFilter?: string;
  /** Auto-create + attach groups from LDAP on every login. Default: true. */
  syncGroups?: boolean;
}

interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes?: string[];
  /**
   * Lab opt-in: skip TLS verification + accept private-IP issuers. Used
   * for self-hosted IdPs on a LAN (Authentik / Keycloak with a
   * self-signed cert). Off by default; the UI surfaces a red warning.
   */
  allowInsecureTls?: boolean;
  /** Userinfo claim that carries group memberships. Default: `groups`. */
  groupsClaim?: string;
  /** Auto-create + attach groups from the IdP on every login. Default: true. */
  syncGroups?: boolean;
}

interface Provider {
  id: string;
  name: string;
  type: ProviderType;
  enabled: boolean;
  config: Partial<LdapConfig & OidcConfig>;
}

const EMPTY_LDAP: LdapConfig = {
  url: '',
  searchBase: '',
  bindDn: '',
  bindPassword: '',
  searchFilter: '(uid={{username}})',
  groupsAttribute: 'memberOf',
  syncGroups: true,
};

const EMPTY_OIDC: OidcConfig = {
  issuer: '',
  clientId: '',
  clientSecret: '',
  redirectUri: `${window.location.origin}/api/auth/oidc/callback`,
  groupsClaim: 'groups',
  syncGroups: true,
};

type EditorState =
  | { mode: 'closed' }
  | { mode: 'create'; type: ProviderType; name: string; config: any }
  | { mode: 'edit'; id: string; type: ProviderType; name: string; config: any };

const AdminProviders: React.FC = () => {
  const { t } = useLang();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const [editor, setEditor] = useState<EditorState>({ mode: 'closed' });
  const [deleteTarget, setDeleteTarget] = useState<Provider | null>(null);

  useEffect(() => {
    fetchProviders();
  }, []);

  const fetchProviders = async () => {
    try {
      setLoading(true);
      const res = await api.get('/auth/admin/providers');
      setProviders(res.data as Provider[]);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const openCreate = (type: ProviderType) => {
    setEditor({
      mode: 'create',
      type,
      name: '',
      config: type === 'LDAP' ? { ...EMPTY_LDAP } : { ...EMPTY_OIDC },
    });
  };

  const openEdit = (p: Provider) => {
    setEditor({
      mode: 'edit',
      id: p.id,
      type: p.type,
      name: p.name,
      config: { ...(p.type === 'LDAP' ? EMPTY_LDAP : EMPTY_OIDC), ...p.config },
    });
  };

  const closeEditor = () => setEditor({ mode: 'closed' });

  const submitEditor = async () => {
    if (editor.mode === 'closed') return;
    if (!editor.name.trim()) {
      setMessage({ type: 'error', text: t('common.required') });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      if (editor.mode === 'create') {
        await api.post('/auth/admin/providers', {
          name: editor.name.trim(),
          type: editor.type,
          config: editor.config,
          enabled: true,
        });
      } else {
        await api.patch(`/auth/admin/providers/${editor.id}`, {
          name: editor.name.trim(),
          config: editor.config,
        });
      }
      setMessage({ type: 'success', text: t('adminProviders.saveSuccess') });
      closeEditor();
      await fetchProviders();
    } catch (err: any) {
      const status = err?.response?.status;
      const text = status === 409
        ? t('adminProviders.nameConflict')
        : (err?.response?.data?.message || err.message || t('adminProviders.saveError'));
      setMessage({ type: 'error', text });
    } finally {
      setSaving(false);
    }
  };

  const toggleProvider = async (p: Provider) => {
    setActionBusy(p.id);
    setMessage(null);
    try {
      await api.patch(`/auth/admin/providers/${p.id}`, { enabled: !p.enabled });
      await fetchProviders();
    } catch (err: any) {
      setMessage({
        type: 'error',
        text: err?.response?.data?.message || t('adminProviders.saveError'),
      });
    } finally {
      setActionBusy(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setActionBusy(deleteTarget.id);
    setMessage(null);
    try {
      await api.delete(`/auth/admin/providers/${deleteTarget.id}`);
      setMessage({ type: 'success', text: t('adminProviders.delete.success') });
      setDeleteTarget(null);
      await fetchProviders();
    } catch (err: any) {
      const status = err?.response?.status;
      const text = status === 409
        ? t('adminProviders.delete.blocked')
        : (err?.response?.data?.message || t('adminProviders.saveError'));
      setMessage({ type: 'error', text });
    } finally {
      setActionBusy(null);
    }
  };

  const sortedProviders = useMemo(() => {
    return [...providers].sort((a, b) => {
      if (a.type !== b.type) return a.type.localeCompare(b.type);
      return a.name.localeCompare(b.name);
    });
  }, [providers]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const typeIcon = (type: ProviderType | 'LOCAL') => {
    if (type === 'LOCAL') return <UserIcon size={18} />;
    if (type === 'LDAP') return <Database size={18} className="text-orange-500" />;
    return <Globe size={18} className="text-purple-500" />;
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex justify-between items-start gap-4 flex-wrap">
        <div>
          <h1 className="t-h1 text-text-main fade-up">{t('adminProviders.title')}</h1>
          <p className="text-text-secondary mt-1">{t('adminProviders.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => openCreate('LDAP')} className="btn-secondary flex items-center gap-2">
            <Plus size={16} /> LDAP
          </button>
          <button onClick={() => openCreate('OIDC')} className="btn-primary flex items-center gap-2">
            <Plus size={16} /> OIDC
          </button>
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

      <div className="bg-background-surface border border-border-light rounded-xl overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-background-app text-text-secondary text-[11px] uppercase tracking-wider">
            <tr>
              <th className="text-left px-6 py-3 font-bold">{t('adminProviders.cols.name')}</th>
              <th className="text-left px-6 py-3 font-bold">{t('adminProviders.cols.type')}</th>
              <th className="text-left px-6 py-3 font-bold">{t('adminProviders.cols.status')}</th>
              <th className="text-right px-6 py-3 font-bold">{t('adminProviders.cols.actions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-light">
            <tr className="bg-background-app/40">
              <td className="px-6 py-4 flex items-center gap-3 text-text-secondary">
                <span className="p-2 rounded-md bg-background-surface border border-border-light">
                  {typeIcon('LOCAL')}
                </span>
                <div className="flex flex-col">
                  <span className="font-semibold">{t('adminProviders.localRow.name')}</span>
                  <span className="text-[11px]">{t('adminProviders.localRow.hint')}</span>
                </div>
              </td>
              <td className="px-6 py-4 text-text-secondary text-xs uppercase">LOCAL</td>
              <td className="px-6 py-4">
                <span className="px-3 py-1 text-[10px] font-bold rounded-full uppercase tracking-wider bg-green-100 text-green-700 border border-green-200">
                  {t('adminProviders.status.active')}
                </span>
              </td>
              <td className="px-6 py-4 text-right text-text-secondary italic text-xs">—</td>
            </tr>

            {sortedProviders.length === 0 && (
              <tr>
                <td colSpan={4} className="px-6 py-10 text-center text-text-secondary italic">
                  {t('adminProviders.empty')}
                </td>
              </tr>
            )}

            {sortedProviders.map((p) => (
              <tr key={p.id} className="hover:bg-background-app/30 transition-colors">
                <td className="px-6 py-4 flex items-center gap-3">
                  <span className="p-2 rounded-md bg-background-app border border-border-light">
                    {typeIcon(p.type)}
                  </span>
                  <span className="font-semibold text-text-main">{p.name}</span>
                </td>
                <td className="px-6 py-4 text-text-secondary text-xs uppercase">{p.type}</td>
                <td className="px-6 py-4">
                  <span className={`px-3 py-1 text-[10px] font-bold rounded-full uppercase tracking-wider border ${
                    p.enabled
                      ? 'bg-green-100 text-green-700 border-green-200'
                      : 'bg-background-app text-text-secondary border-border-light'
                  }`}>
                    {p.enabled ? t('adminProviders.status.active') : t('adminProviders.status.inactive')}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => openEdit(p)}
                      disabled={actionBusy === p.id}
                      title={t('adminProviders.actions.edit')}
                      className="p-2 rounded-md text-text-secondary hover:text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      onClick={() => toggleProvider(p)}
                      disabled={actionBusy === p.id}
                      title={p.enabled ? t('adminProviders.actions.disable') : t('adminProviders.actions.enable')}
                      className="px-3 py-1.5 text-[11px] font-bold uppercase rounded-md border border-border-light hover:border-primary hover:text-primary transition-colors disabled:opacity-50"
                    >
                      {actionBusy === p.id
                        ? <Loader2 size={12} className="animate-spin" />
                        : (p.enabled ? t('adminProviders.actions.disable') : t('adminProviders.actions.enable'))}
                    </button>
                    <button
                      onClick={() => setDeleteTarget(p)}
                      disabled={actionBusy === p.id}
                      title={t('adminProviders.actions.delete')}
                      className="p-2 rounded-md text-text-secondary hover:text-danger hover:bg-danger/10 transition-colors disabled:opacity-50"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 flex gap-3 text-primary">
        <AlertCircle size={20} />
        <div className="space-y-1">
          <p className="text-sm font-bold uppercase tracking-wider">{t('adminProviders.oidc.jit')}</p>
          <p className="text-xs opacity-80">{t('adminProviders.jitDesc')}</p>
        </div>
      </div>

      {editor.mode !== 'closed' && (
        <ProviderEditorModal
          editor={editor}
          saving={saving}
          onChange={setEditor}
          onCancel={closeEditor}
          onSubmit={submitEditor}
        />
      )}

      {deleteTarget && (
        <DeleteConfirmModal
          target={deleteTarget}
          busy={actionBusy === deleteTarget.id}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  );
};

interface EditorProps {
  editor: Exclude<EditorState, { mode: 'closed' }>;
  saving: boolean;
  onChange: (s: EditorState) => void;
  onCancel: () => void;
  onSubmit: () => void;
}

const ProviderEditorModal: React.FC<EditorProps> = ({ editor, saving, onChange, onCancel, onSubmit }) => {
  const { t } = useLang();

  const updateConfig = (patch: Record<string, unknown>) => {
    onChange({ ...editor, config: { ...editor.config, ...patch } });
  };

  const updateName = (name: string) => onChange({ ...editor, name });

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 animate-in fade-in" role="dialog" aria-modal="true">
      <div className="bg-background-surface border border-border-light rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-border-light bg-background-app">
          <div className="flex items-center gap-3">
            {editor.type === 'LDAP'
              ? <Database className="text-orange-500" size={22} />
              : <Globe className="text-purple-500" size={22} />}
            <h2 className="text-lg font-bold text-text-main">
              {editor.mode === 'create' ? t('adminProviders.modal.createTitle') : t('adminProviders.modal.editTitle')}
            </h2>
          </div>
          <button onClick={onCancel} className="p-2 text-text-secondary hover:text-text-main transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-widest text-text-secondary">
              {t('adminProviders.modal.typeLabel')}
            </label>
            <input
              type="text"
              disabled
              value={editor.type}
              className="form-input text-sm bg-background-app cursor-not-allowed"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-widest text-text-secondary">
              {t('adminProviders.modal.nameLabel')}
            </label>
            <input
              type="text"
              required
              placeholder={t('adminProviders.modal.namePlaceholder')}
              className="form-input text-sm"
              value={editor.name}
              onChange={(e) => updateName(e.target.value)}
            />
          </div>

          {editor.type === 'LDAP' ? (
            <>
              <ConfigInput
                label={t('adminProviders.ldap.url')}
                placeholder={t('adminProviders.ldap.urlPlaceholder')}
                value={editor.config.url ?? ''}
                onChange={(v) => updateConfig({ url: v })}
              />
              <ConfigInput
                label={t('adminProviders.ldap.baseDn')}
                placeholder={t('adminProviders.ldap.baseDnPlaceholder')}
                value={editor.config.searchBase ?? ''}
                onChange={(v) => updateConfig({ searchBase: v })}
              />
              <ConfigInput
                label={t('adminProviders.ldap.bindDn')}
                placeholder={t('adminProviders.ldap.bindDnPlaceholder')}
                value={editor.config.bindDn ?? ''}
                onChange={(v) => updateConfig({ bindDn: v })}
              />
              <ConfigInput
                label={t('adminProviders.ldap.bindPassword')}
                placeholder="••••••••••••••••"
                type="password"
                value={editor.config.bindPassword ?? ''}
                onChange={(v) => updateConfig({ bindPassword: v })}
              />

              <div className="p-4 border border-primary/20 bg-primary/5 rounded-lg space-y-4">
                <p className="text-xs font-bold uppercase tracking-widest text-primary">
                  {t('adminProviders.ldap.groupsSection')}
                </p>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-0.5 w-4 h-4 accent-primary"
                    checked={editor.config.syncGroups !== false}
                    onChange={(e) => updateConfig({ syncGroups: e.target.checked })}
                  />
                  <div className="flex-1">
                    <p className="text-sm font-bold text-text-main">
                      {t('adminProviders.ldap.syncGroupsLabel')}
                    </p>
                    <p className="text-[11px] text-text-secondary mt-1 leading-relaxed">
                      {t('adminProviders.ldap.syncGroupsHint')}
                    </p>
                  </div>
                </label>
                <ConfigInput
                  label={t('adminProviders.ldap.groupsAttribute')}
                  placeholder="memberOf"
                  value={editor.config.groupsAttribute ?? 'memberOf'}
                  onChange={(v) => updateConfig({ groupsAttribute: v })}
                  hint={t('adminProviders.ldap.groupsAttributeHint')}
                />
                <ConfigInput
                  label={t('adminProviders.ldap.groupsSearchBase')}
                  placeholder="ou=groups,dc=domain,dc=local"
                  value={editor.config.groupsSearchBase ?? ''}
                  onChange={(v) => updateConfig({ groupsSearchBase: v })}
                  hint={t('adminProviders.ldap.groupsSearchBaseHint')}
                />
                <ConfigInput
                  label={t('adminProviders.ldap.groupsSearchFilter')}
                  placeholder="(&(objectClass=groupOfNames)(member={{userDn}}))"
                  value={editor.config.groupsSearchFilter ?? ''}
                  onChange={(v) => updateConfig({ groupsSearchFilter: v })}
                  hint={t('adminProviders.ldap.groupsSearchFilterHint')}
                />
              </div>
            </>
          ) : (
            <>
              <ConfigInput
                label={t('adminProviders.oidc.issuer')}
                placeholder={t('adminProviders.oidc.issuerPlaceholder')}
                value={editor.config.issuer ?? ''}
                onChange={(v) => updateConfig({ issuer: v })}
              />
              <ConfigInput
                label={t('adminProviders.oidc.clientId')}
                placeholder={t('adminProviders.oidc.clientIdPlaceholder')}
                value={editor.config.clientId ?? ''}
                onChange={(v) => updateConfig({ clientId: v })}
              />
              <ConfigInput
                label={t('adminProviders.oidc.clientSecret')}
                placeholder="••••••••••••••••"
                type="password"
                value={editor.config.clientSecret ?? ''}
                onChange={(v) => updateConfig({ clientSecret: v })}
              />
              <ConfigInput
                label={t('adminProviders.oidc.callbackUrl')}
                value={editor.config.redirectUri ?? ''}
                onChange={(v) => updateConfig({ redirectUri: v })}
                hint={t('adminProviders.oidc.callbackHint')}
              />

              <div className="p-4 border border-danger/30 bg-danger/5 rounded-lg space-y-3">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-0.5 w-4 h-4 accent-danger"
                    checked={!!editor.config.allowInsecureTls}
                    onChange={(e) => updateConfig({ allowInsecureTls: e.target.checked })}
                  />
                  <div className="flex-1">
                    <p className="text-sm font-bold text-danger uppercase tracking-wider">
                      {t('adminProviders.oidc.labMode')}
                    </p>
                    <p className="text-[11px] text-text-secondary mt-1 leading-relaxed">
                      {t('adminProviders.oidc.labModeHint')}
                    </p>
                  </div>
                </label>
              </div>

              <div className="p-4 border border-primary/20 bg-primary/5 rounded-lg space-y-4">
                <p className="text-xs font-bold uppercase tracking-widest text-primary">
                  {t('adminProviders.oidc.groupsSection')}
                </p>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-0.5 w-4 h-4 accent-primary"
                    checked={editor.config.syncGroups !== false}
                    onChange={(e) => updateConfig({ syncGroups: e.target.checked })}
                  />
                  <div className="flex-1">
                    <p className="text-sm font-bold text-text-main">
                      {t('adminProviders.oidc.syncGroupsLabel')}
                    </p>
                    <p className="text-[11px] text-text-secondary mt-1 leading-relaxed">
                      {t('adminProviders.oidc.syncGroupsHint')}
                    </p>
                  </div>
                </label>
                <ConfigInput
                  label={t('adminProviders.oidc.groupsClaim')}
                  placeholder="groups"
                  value={editor.config.groupsClaim ?? 'groups'}
                  onChange={(v) => updateConfig({ groupsClaim: v })}
                  hint={t('adminProviders.oidc.groupsClaimHint')}
                />
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 p-6 border-t border-border-light bg-background-app">
          <button onClick={onCancel} className="btn-secondary">
            {t('adminProviders.modal.cancel')}
          </button>
          <button onClick={onSubmit} disabled={saving} className="btn-primary flex items-center gap-2">
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {t('adminProviders.modal.save')}
          </button>
        </div>
      </div>
    </div>
  );
};

const ConfigInput: React.FC<{
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  hint?: string;
}> = ({ label, value, onChange, placeholder, type = 'text', hint }) => (
  <div className="space-y-2">
    <label className="text-xs font-bold uppercase tracking-widest text-text-secondary">{label}</label>
    <input
      type={type}
      className="form-input text-sm"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
    {hint && <p className="text-[10px] text-text-secondary italic">{hint}</p>}
  </div>
);

const DeleteConfirmModal: React.FC<{
  target: Provider;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}> = ({ target, busy, onCancel, onConfirm }) => {
  const { t } = useLang();
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 animate-in fade-in" role="dialog" aria-modal="true">
      <div className="bg-background-surface border border-border-light rounded-xl shadow-2xl w-full max-w-md">
        <div className="p-6 border-b border-border-light">
          <h3 className="text-lg font-bold text-text-main flex items-center gap-2">
            <Trash2 size={20} className="text-danger" />
            {t('adminProviders.delete.title')}
          </h3>
        </div>
        <div className="p-6 space-y-2">
          <p className="text-sm text-text-main font-semibold">{target.name}</p>
          <p className="text-xs text-text-secondary">{t('adminProviders.delete.confirm')}</p>
        </div>
        <div className="flex items-center justify-end gap-3 p-4 border-t border-border-light bg-background-app">
          <button onClick={onCancel} className="btn-secondary">
            {t('adminProviders.modal.cancel')}
          </button>
          <button onClick={onConfirm} disabled={busy} className="btn-danger flex items-center gap-2">
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
            {t('adminProviders.actions.delete')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AdminProviders;
