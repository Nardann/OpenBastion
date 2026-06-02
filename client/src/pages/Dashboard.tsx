import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { Server, Terminal as TerminalIcon, Monitor, LogOut, ShieldCheck, User as UserIcon, Settings, Sun, Moon, FolderOpen, X, Globe, History, Pencil, ToggleLeft, ToggleRight, Users2, Search, Plus, Trash2, ShieldAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { useLang, AVAILABLE_LANGS } from '../context/LangContext';

interface Machine {
  id: string;
  name: string;
  ip: string;
  port: number;
  protocol: string;
  description?: string;
  machineGroupId?: string;
  machineGroup?: { id: string; name: string };
  /** Caller's effective access level on this machine ('OWNER' enables editing). */
  accessLevel?: 'OPERATOR' | 'OWNER' | 'ADMIN' | null;
  sshFingerprint?: string;
  allowTunneling?: boolean;
  allowRebound?: boolean;
  allowCopyPaste?: boolean;
  rdpSecurity?: string;
  rdpDomain?: string;
  rdpIgnoreCert?: boolean;
}

interface EditForm {
  name: string;
  ip: string;
  port: number;
  description: string;
  sshFingerprint: string;
  username: string;
  password: string;
  privateKey: string;
  allowTunneling: boolean;
  allowRebound: boolean;
  allowCopyPaste: boolean;
  rdpSecurity: 'ANY' | 'RDP' | 'TLS' | 'NLA';
  rdpIgnoreCert: boolean;
  rdpDomain: string;
}

interface MachineGroup {
  id: string;
  name: string;
}

const Dashboard: React.FC = () => {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { lang, setLang, t } = useLang();
  const [machines, setMachines] = useState<Machine[]>([]);
  const [allMachines, setAllMachines] = useState<Machine[]>([]);
  const [machineGroups, setMachineGroups] = useState<MachineGroup[]>([]);
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Owner edit mode ──────────────────────────────────────────────────────
  const [editMode, setEditMode] = useState(false);
  const [editingMachine, setEditingMachine] = useState<Machine | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const canEdit = (m: Machine) => m.accessLevel === 'OWNER' || m.accessLevel === 'ADMIN';
  const ownsAny = allMachines.some(canEdit);

  // ── Owner permission management ──────────────────────────────────────────
  const [permMachine, setPermMachine] = useState<Machine | null>(null);
  const [permList, setPermList] = useState<any[]>([]);
  const [permTargetType, setPermTargetType] = useState<'user' | 'group'>('user');
  const [permQuery, setPermQuery] = useState('');
  const [permSuggestions, setPermSuggestions] = useState<any[]>([]);
  const [permTarget, setPermTarget] = useState<any>(null);
  const [permLevel, setPermLevel] = useState<'OPERATOR' | 'OWNER'>('OPERATOR');
  const [permError, setPermError] = useState<string | null>(null);

  const fetchPermissions = async (machineId: string) => {
    try {
      const res = await api.get(`/permissions/machine/${machineId}`);
      setPermList(res.data as any);
    } catch (err) {
      console.error('Failed to fetch permissions', err);
    }
  };

  const openPerms = (machine: Machine) => {
    setPermMachine(machine);
    setPermTargetType('user');
    setPermQuery('');
    setPermSuggestions([]);
    setPermTarget(null);
    setPermLevel('OPERATOR');
    setPermError(null);
    fetchPermissions(machine.id);
  };

  const closePerms = () => {
    setPermMachine(null);
    setPermList([]);
    setPermTarget(null);
    setPermQuery('');
    setPermSuggestions([]);
    setPermError(null);
  };

  useEffect(() => {
    if (permQuery.trim().length < 1) {
      setPermSuggestions([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const base = permTargetType === 'user'
          ? `/permissions/directory/users`
          : `/permissions/directory/groups`;
        const res = await api.get(`${base}?q=${encodeURIComponent(permQuery.trim())}`);
        const all = res.data as any[];
        setPermSuggestions(all.map(item => ({
          id: item.id,
          label: permTargetType === 'user' ? (item.username || item.email) : item.name,
          subLabel: permTargetType === 'user' ? item.email : item.description,
        })));
      } catch (err) { console.error(err); }
    }, 300);
    return () => clearTimeout(timer);
  }, [permQuery, permTargetType]);

  const handlePermSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!permMachine || !permTarget) return;
    setPermError(null);
    try {
      const data: any = { level: permLevel, machineId: permMachine.id };
      if (permTargetType === 'user') data.userId = permTarget.id;
      else data.groupId = permTarget.id;
      await api.post('/permissions', data);
      setPermTarget(null);
      setPermQuery('');
      setPermSuggestions([]);
      await fetchPermissions(permMachine.id);
    } catch (err: any) {
      setPermError(err?.response?.data?.message || err?.message || t('dashboard.editError'));
    }
  };

  const handlePermDelete = async (id: string) => {
    if (!permMachine) return;
    setPermError(null);
    try {
      await api.delete(`/permissions/${id}`);
      await fetchPermissions(permMachine.id);
    } catch (err: any) {
      setPermError(err?.response?.data?.message || err?.message || t('dashboard.editError'));
    }
  };

  const fetchData = async () => {
    try {
      const [machinesRes, groupsRes] = await Promise.all([
        api.get('/machines'),
        api.get('/machine-groups')
      ]);
      setAllMachines(machinesRes.data as any);
      setMachines(machinesRes.data as any);
      setMachineGroups(groupsRes.data as any);
    } catch (error) {
      console.error('Failed to fetch data', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const openEdit = (machine: Machine) => {
    setEditingMachine(machine);
    setEditError(null);
    setEditForm({
      name: machine.name,
      ip: machine.ip,
      port: machine.port,
      description: machine.description || '',
      sshFingerprint: machine.sshFingerprint || '',
      username: '',
      password: '',
      privateKey: '',
      allowTunneling: !!machine.allowTunneling,
      allowRebound: !!machine.allowRebound,
      allowCopyPaste: !!machine.allowCopyPaste,
      rdpSecurity: (machine.rdpSecurity as any) || 'NLA',
      rdpIgnoreCert: !!machine.rdpIgnoreCert,
      rdpDomain: machine.rdpDomain || '',
    });
  };

  const closeEdit = () => {
    setEditingMachine(null);
    setEditForm(null);
    setEditError(null);
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMachine || !editForm) return;
    setSaving(true);
    setEditError(null);
    try {
      const isRdp = editingMachine.protocol === 'RDP';
      const payload: any = {
        name: editForm.name,
        ip: editForm.ip,
        port: Number(editForm.port),
        description: editForm.description,
        allowTunneling: editForm.allowTunneling,
        allowRebound: editForm.allowRebound,
        allowCopyPaste: editForm.allowCopyPaste,
      };
      if (editForm.username) payload.username = editForm.username;
      if (editForm.password) payload.password = editForm.password;
      if (isRdp) {
        payload.rdpSecurity = editForm.rdpSecurity;
        payload.rdpIgnoreCert = editForm.rdpIgnoreCert;
        if (editForm.rdpDomain) payload.rdpDomain = editForm.rdpDomain;
      } else {
        if (editForm.sshFingerprint) payload.sshFingerprint = editForm.sshFingerprint;
        if (editForm.privateKey) payload.privateKey = editForm.privateKey;
      }
      await api.patch(`/machines/${editingMachine.id}`, payload);
      closeEdit();
      await fetchData();
    } catch (err: any) {
      setEditError(err?.response?.data?.message || err?.message || t('dashboard.editError'));
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (selectedGroups.length === 0) {
      setMachines(allMachines);
    } else {
      setMachines(
        allMachines.filter(m =>
          selectedGroups.includes(m.machineGroupId || 'ungrouped') ||
          (m.machineGroupId && selectedGroups.includes(m.machineGroupId))
        )
      );
    }
  }, [selectedGroups, allMachines]);

  const toggleGroupFilter = (groupId: string) => {
    setSelectedGroups(prev =>
      prev.includes(groupId)
        ? prev.filter(id => id !== groupId)
        : [...prev, groupId]
    );
  };

  const cycleLang = () => {
    const idx = AVAILABLE_LANGS.findIndex(l => l.code === lang);
    const next = AVAILABLE_LANGS[(idx + 1) % AVAILABLE_LANGS.length];
    setLang(next.code);
  };

  return (
    <div className="min-h-screen bg-background-app text-text-main font-sans transition-colors duration-300">
      <header className="bg-background-surface border-b border-border-light sticky top-0 z-50 shadow-sm transition-colors duration-300">
        <div className="max-w-7xl mx-auto px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ShieldCheck className="w-6 h-6 text-primary" />
            <span className="font-display text-xl font-bold tracking-tight text-text-main">{t('nav.brand')}</span>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={cycleLang}
              className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center text-text-secondary hover:text-primary transition-colors"
              aria-label={`${t('common.language')}: ${lang.toUpperCase()}`}
            >
              <Globe size={18} />
            </button>
            <button
              onClick={toggleTheme}
              className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center text-text-secondary hover:text-primary transition-colors mr-2"
              aria-label={theme === 'light' ? t('common.darkMode') : t('common.lightMode')}
            >
              {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
            </button>

            {ownsAny && user?.role !== 'ADMIN' && (
              <button
                onClick={() => setEditMode((v) => !v)}
                className={`flex items-center gap-2 text-sm font-medium transition-colors ${editMode ? 'text-primary' : 'text-text-secondary hover:text-primary'}`}
                title={t('dashboard.editMode')}
              >
                {editMode ? <ToggleRight className="w-5 h-5" /> : <ToggleLeft className="w-5 h-5" />}
                {t('dashboard.editMode')}
              </button>
            )}

            <Link
              to="/history"
              className="flex items-center gap-2 text-text-secondary hover:text-primary transition-colors text-sm font-medium"
            >
              <History className="w-4 h-4" />
              {t('nav.history')}
            </Link>

            {user?.role === 'ADMIN' && (
              <Link
                to="/administration"
                className="flex items-center gap-2 text-text-secondary hover:text-primary transition-colors text-sm font-medium mr-4"
              >
                <Settings className="w-4 h-4" />
                {t('nav.administration')}
              </Link>
            )}

            <Link to="/profile" className="flex items-center gap-2 group">
              <div className="text-right hidden sm:block">
                <p className="text-sm font-medium text-text-main group-hover:text-primary transition-colors">{user?.username || user?.email}</p>
              </div>
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-white transition-all">
                <UserIcon size={16} />
              </div>
            </Link>

            <button
              onClick={logout}
              className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center text-text-secondary hover:text-danger rounded-md transition-colors"
              aria-label={t('nav.logout')}
            >
              <LogOut size={20} />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-8 py-10">
        <div className="mb-10 fade-up">
          <h1 className="t-h1 text-text-main mb-1">{t('dashboard.title')}</h1>
          <p className="text-text-secondary text-sm">{t('dashboard.subtitle')}</p>
        </div>

        {machineGroups.length > 0 && (
          <div className="mb-8 p-6 bg-background-surface border border-border-light rounded-lg">
            <div className="flex items-center gap-3 mb-4">
              <FolderOpen size={20} className="text-primary" />
              <h2 className="font-bold text-text-main">{t('dashboard.filterByGroup')}</h2>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {machineGroups.map(group => (
                <button
                  key={group.id}
                  onClick={() => toggleGroupFilter(group.id)}
                  className={`px-4 py-2 rounded-lg border transition-all text-sm font-medium flex items-center gap-2 justify-center ${
                    selectedGroups.includes(group.id)
                      ? 'bg-primary/10 border-primary/50 text-primary'
                      : 'bg-background-app border-border-light text-text-secondary hover:border-primary/30 hover:text-text-main'
                  }`}
                >
                  <FolderOpen size={14} />
                  {group.name}
                </button>
              ))}
            </div>
            {selectedGroups.length > 0 && (
              <button
                onClick={() => setSelectedGroups([])}
                className="mt-4 flex items-center gap-2 text-xs font-bold text-primary uppercase hover:opacity-75 transition-opacity"
              >
                <X size={14} />
                {t('dashboard.resetFilters')}
              </button>
            )}
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-48 bg-background-surface animate-pulse rounded-lg border border-border-light shadow-sm" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {machines.map((machine) => (
              <div
                key={machine.id}
                className="group bg-background-surface p-6 rounded-lg border border-border-light shadow-sm flex flex-col card-lift rail-ambre"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="p-3 bg-primary/5 rounded-lg text-primary">
                    <Server className="w-6 h-6" />
                  </div>
                  <div className="flex items-center gap-2">
                    {editMode && canEdit(machine) && (
                      <>
                        <button
                          onClick={() => openEdit(machine)}
                          className="p-1.5 rounded-md text-text-secondary hover:text-primary hover:bg-primary/10 transition-colors"
                          title={t('dashboard.editMachine')}
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => openPerms(machine)}
                          className="p-1.5 rounded-md text-text-secondary hover:text-primary hover:bg-primary/10 transition-colors"
                          title={t('dashboard.managePerms')}
                        >
                          <ShieldCheck className="w-4 h-4" />
                        </button>
                      </>
                    )}
                    <span className="pill-badge bg-primary/10 text-primary text-[10px] uppercase font-bold tracking-wider">
                      {machine.protocol}
                    </span>
                  </div>
                </div>

                <h3 className="text-lg font-bold text-text-main mb-1">{machine.name}</h3>
                <div className="flex items-center gap-2 mb-4">
                  <span className="dot-live" />
                  <span className="text-xs font-mono text-text-secondary">{machine.ip}:{machine.port}</span>
                </div>

                {machine.machineGroup && (
                  <div className="flex items-center gap-2 mb-4 px-2 py-1 bg-primary/5 rounded w-fit text-[10px]">
                    <FolderOpen size={12} className="text-primary" />
                    <span className="text-primary font-bold">{machine.machineGroup.name}</span>
                  </div>
                )}

                {machine.description && (
                  <p className="text-sm text-text-secondary mb-6 line-clamp-2 flex-grow">{machine.description}</p>
                )}

                {editMode ? (
                  <button
                    type="button"
                    disabled
                    aria-disabled="true"
                    className="btn-primary flex items-center justify-center gap-2 w-full text-sm opacity-40 cursor-not-allowed pointer-events-none"
                  >
                    {machine.protocol === 'RDP' ? (
                      <Monitor className="w-4 h-4" />
                    ) : (
                      <TerminalIcon className="w-4 h-4" />
                    )}
                    {machine.protocol === 'RDP'
                      ? t('rdp.title')
                      : t('terminal.title')}
                  </button>
                ) : (
                  <Link
                    to={machine.protocol === 'RDP' ? `/rdp/${machine.id}` : `/session/${machine.id}`}
                    state={{ machineName: machine.name, protocol: machine.protocol }}
                    className="btn-primary flex items-center justify-center gap-2 w-full text-sm"
                  >
                    {machine.protocol === 'RDP' ? (
                      <Monitor className="w-4 h-4" />
                    ) : (
                      <TerminalIcon className="w-4 h-4" />
                    )}
                    {machine.protocol === 'RDP'
                      ? t('rdp.title')
                      : t('terminal.title')}
                  </Link>
                )}
              </div>
            ))}

            {machines.length === 0 && (
              <div className="col-span-full py-20 text-center bg-background-surface border border-dashed border-border-light rounded-lg">
                <Server className="w-12 h-12 text-neutral mx-auto mb-4 opacity-30" />
                <p className="text-text-secondary font-medium">{t('dashboard.noMachines')}</p>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Owner edit modal */}
      {editingMachine && editForm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-background-surface w-full max-w-2xl p-8 rounded-2xl border border-border-light shadow-2xl my-auto">
            <div className="flex justify-between items-center mb-8">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-primary/10 rounded-2xl text-primary border border-primary/20">
                  <Pencil size={24} />
                </div>
                <div>
                  <h2 className="t-h1 text-text-main leading-none">{t('dashboard.editMachine')}</h2>
                  <p className="t-eyebrow mt-1.5">{editingMachine.name} • {editingMachine.protocol}</p>
                </div>
              </div>
              <button onClick={closeEdit} className="p-2 hover:bg-background-app rounded-full text-text-secondary transition-colors"><X size={24} /></button>
            </div>

            <form onSubmit={handleEditSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="t-eyebrow ml-1">{t('adminMachines.modal.nameLabel')}</label>
                <input type="text" className="form-input w-full h-11" required value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} />
              </div>
              <div className="grid grid-cols-4 gap-3">
                <div className="col-span-3 space-y-2">
                  <label className="t-eyebrow ml-1">{t('adminMachines.modal.host')}</label>
                  <input type="text" className="form-input w-full h-11 font-mono text-sm" required value={editForm.ip} onChange={e => setEditForm({ ...editForm, ip: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <label className="t-eyebrow ml-1">{t('adminMachines.modal.port')}</label>
                  <input type="number" className="form-input w-full h-11 font-mono text-sm text-center" required value={editForm.port} onChange={e => setEditForm({ ...editForm, port: parseInt(e.target.value) })} />
                </div>
              </div>

              <div className="md:col-span-2 space-y-2">
                <label className="t-eyebrow ml-1">{t('adminMachines.modal.description')}</label>
                <textarea className="form-input w-full h-20 py-3 resize-none" value={editForm.description} onChange={e => setEditForm({ ...editForm, description: e.target.value })} />
              </div>

              <div className="space-y-2">
                <label className="t-eyebrow ml-1">{t('adminMachines.modal.username')}</label>
                <input type="text" className="form-input w-full h-11" placeholder={t('adminMachines.modal.passwordPlaceholderEdit')} value={editForm.username} onChange={e => setEditForm({ ...editForm, username: e.target.value })} />
              </div>
              <div className="space-y-2">
                <label className="t-eyebrow ml-1">{t('adminMachines.modal.passwordLabel')}</label>
                <input type="password" name="new-password" className="form-input w-full h-11" placeholder={t('adminMachines.modal.passwordPlaceholderEdit')} value={editForm.password} onChange={e => setEditForm({ ...editForm, password: e.target.value })} />
              </div>

              {editingMachine.protocol === 'SSH' && (
                <>
                  <div className="md:col-span-2 space-y-2">
                    <label className="t-eyebrow ml-1">{t('adminMachines.modal.fingerprint')}</label>
                    <input type="text" className="form-input w-full h-11 text-[10px] font-mono" value={editForm.sshFingerprint} onChange={e => setEditForm({ ...editForm, sshFingerprint: e.target.value })} />
                  </div>
                  <div className="md:col-span-2 space-y-2">
                    <label className="t-eyebrow ml-1">{t('adminMachines.modal.privateKey')}</label>
                    <textarea className="form-input w-full h-20 text-[9px] font-mono py-3 resize-none" placeholder={t('adminMachines.modal.privateKeyPlaceholder')} value={editForm.privateKey} onChange={e => setEditForm({ ...editForm, privateKey: e.target.value })} />
                  </div>
                </>
              )}

              {editingMachine.protocol === 'RDP' && (
                <>
                  <div className="space-y-2">
                    <label className="t-eyebrow ml-1">{t('adminMachines.modal.rdpSecurity')}</label>
                    <select className="form-input w-full h-11 font-medium" value={editForm.rdpSecurity} onChange={e => setEditForm({ ...editForm, rdpSecurity: e.target.value as any })}>
                      <option value="NLA">{t('adminMachines.modal.rdpNla')}</option>
                      <option value="TLS">{t('adminMachines.modal.rdpTls')}</option>
                      <option value="RDP">{t('adminMachines.modal.rdpRdp')}</option>
                      <option value="ANY">{t('adminMachines.modal.rdpAny')}</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="t-eyebrow ml-1">{t('adminMachines.modal.rdpDomain')}</label>
                    <input type="text" className="form-input w-full h-11 font-medium" value={editForm.rdpDomain} onChange={e => setEditForm({ ...editForm, rdpDomain: e.target.value })} />
                  </div>
                </>
              )}

              <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-3 gap-3 pt-4 border-t border-border-light">
                {([
                  { id: 'allowTunneling', label: t('adminMachines.modal.tunneling') },
                  { id: 'allowRebound', label: t('adminMachines.modal.rebound') },
                  { id: 'allowCopyPaste', label: t('adminMachines.modal.clipboard') },
                ] as const).map(opt => (
                  <div key={opt.id} className="flex items-center justify-between p-3 bg-background-app rounded-xl border border-border-light">
                    <span className="text-[10px] font-bold text-text-main uppercase tracking-tight">{opt.label}</span>
                    <button
                      type="button"
                      onClick={() => setEditForm({ ...editForm, [opt.id]: !(editForm as any)[opt.id] })}
                      className={`transition-all transform active:scale-90 ${(editForm as any)[opt.id] ? 'text-primary' : 'text-text-secondary opacity-20'}`}
                    >
                      {(editForm as any)[opt.id] ? <ToggleRight size={28} /> : <ToggleLeft size={28} />}
                    </button>
                  </div>
                ))}
              </div>

              {editError && (
                <div className="md:col-span-2 text-danger text-sm">{editError}</div>
              )}

              <div className="md:col-span-2 flex justify-end gap-3 mt-2">
                <button type="button" onClick={closeEdit} className="btn-secondary px-8 py-3 text-xs font-bold uppercase tracking-widest">{t('common.cancel')}</button>
                <button type="submit" disabled={saving} className="btn-primary px-10 py-3 text-xs font-bold uppercase tracking-widest disabled:opacity-50">
                  {saving ? '…' : t('adminMachines.modal.save')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Owner permission-management modal */}
      {permMachine && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-background-surface w-full max-w-2xl p-8 rounded-2xl border border-border-light shadow-2xl my-auto">
            <div className="flex justify-between items-center mb-8">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-primary/10 rounded-2xl text-primary border border-primary/20">
                  <ShieldCheck size={24} />
                </div>
                <div>
                  <h2 className="t-h1 text-text-main leading-none">{t('common.permissions')}</h2>
                  <p className="t-eyebrow mt-1.5">{permMachine.name} • {permMachine.ip}</p>
                </div>
              </div>
              <button onClick={closePerms} className="p-2 hover:bg-background-app rounded-full text-text-secondary transition-colors"><X size={24} /></button>
            </div>

            <form onSubmit={handlePermSubmit} className="space-y-5 mb-8">
              <h3 className="t-eyebrow text-primary">{t('adminMachines.perm.title')}</h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="t-eyebrow ml-1">{t('adminMachines.perm.entityType')}</label>
                  <select
                    className="form-input w-full h-10 text-xs"
                    value={permTargetType}
                    onChange={e => { setPermTargetType(e.target.value as any); setPermTarget(null); setPermQuery(''); setPermSuggestions([]); }}
                  >
                    <option value="user">{t('adminMachines.perm.user')}</option>
                    <option value="group">{t('adminMachines.perm.group')}</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="t-eyebrow ml-1">{permTargetType === 'user' ? t('adminMachines.perm.user') : t('adminMachines.perm.group')}</label>
                  {permTarget ? (
                    <div className="flex items-center justify-between w-full h-10 bg-primary/10 border border-primary/30 rounded-lg px-4">
                      <span className="text-sm font-bold text-primary flex items-center gap-2">
                        {permTargetType === 'user' ? <UserIcon size={14} /> : <Users2 size={14} />}
                        {permTarget.label}
                      </span>
                      <button type="button" onClick={() => setPermTarget(null)} className="text-primary hover:bg-primary/20 rounded-full p-1 transition-colors">
                        <X size={16} />
                      </button>
                    </div>
                  ) : (
                    <div className="relative group">
                      <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-text-secondary group-focus-within:text-primary transition-colors">
                        <Search size={16} />
                      </div>
                      <input
                        type="text"
                        className="form-input input-with-icon text-xs h-10 w-full"
                        placeholder={permTargetType === 'user' ? t('adminMachines.perm.userSearch') : t('adminMachines.perm.groupSearch')}
                        value={permQuery}
                        onChange={e => setPermQuery(e.target.value)}
                      />
                      {permSuggestions.length > 0 && (
                        <div className="absolute z-20 w-full mt-2 bg-background-surface border border-border-light rounded-xl shadow-xl overflow-hidden py-1">
                          {permSuggestions.map(s => (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => { setPermTarget(s); setPermSuggestions([]); setPermQuery(''); }}
                              className="w-full px-4 py-2.5 text-left hover:bg-primary/5 flex flex-col border-b border-border-light last:border-0 transition-colors"
                            >
                              <span className="text-sm font-bold text-text-main">{s.label}</span>
                              {s.subLabel && <span className="text-[10px] text-text-secondary mt-0.5">{s.subLabel}</span>}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-col md:flex-row items-end gap-4">
                <div className="flex-1 w-full space-y-1.5">
                  <label className="t-eyebrow ml-1">{t('adminMachines.perm.level')}</label>
                  <div className="grid grid-cols-2 gap-2">
                    {(['OPERATOR', 'OWNER'] as const).map((lvl) => (
                      <button
                        key={lvl}
                        type="button"
                        onClick={() => setPermLevel(lvl)}
                        className={`py-2 rounded-lg text-[10px] font-bold transition-all border ${
                          permLevel === lvl
                            ? 'bg-primary text-white border-primary shadow-sm shadow-primary/20'
                            : 'bg-background-surface text-text-secondary border-border-light hover:border-primary/30'
                        }`}
                      >
                        {lvl === 'OPERATOR' ? t('adminMachines.perm.operator') : t('adminMachines.perm.owner')}
                      </button>
                    ))}
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={!permTarget}
                  className="btn-primary h-10 px-8 text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-50 disabled:grayscale transition-all w-full md:w-auto"
                >
                  <Plus size={14} /> {t('adminMachines.perm.grant')}
                </button>
              </div>
            </form>

            {permError && (
              <div className="text-danger text-sm mb-4">{permError}</div>
            )}

            <div className="space-y-4">
              <h3 className="t-eyebrow px-1">{t('adminMachines.perm.list')}</h3>
              <div className="bg-background-app rounded-xl border border-border-light divide-y divide-border-light">
                {permList.length === 0 ? (
                  <div className="text-center py-12 px-6">
                    <ShieldAlert size={32} className="mx-auto text-text-secondary opacity-10 mb-3" />
                    <p className="text-xs text-text-secondary italic">{t('adminMachines.perm.empty')}</p>
                  </div>
                ) : (
                  permList.map((perm) => {
                    const isSelf = perm.user && perm.user.id === user?.id;
                    return (
                      <div key={perm.id} className="flex items-center justify-between p-4 hover:bg-background-surface transition-colors group">
                        <div className="flex items-center gap-4">
                          <div className={`p-2.5 rounded-xl border ${perm.user ? 'bg-primary/5 text-primary border-primary/10' : 'bg-secondary/5 text-secondary border-secondary/10'}`}>
                            {perm.user ? <UserIcon size={18} /> : <Users2 size={18} />}
                          </div>
                          <div>
                            <p className="text-sm font-bold text-text-main">
                              {perm.user ? (perm.user.username || perm.user.email) : (perm.group?.name || t('common.none'))}
                            </p>
                            <div className="flex items-center gap-2 mt-1">
                              <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-tighter ${
                                perm.level === 'OWNER' ? 'bg-danger/10 text-danger border border-danger/20' :
                                perm.level === 'OPERATOR' ? 'bg-success/10 text-success border border-success/20' :
                                'bg-primary/10 text-primary border border-primary/20'
                              }`}>
                                {perm.level === 'OWNER' ? t('adminMachines.perm.owner') : t('adminMachines.perm.operator')}
                              </span>
                              <span className="text-[9px] text-text-secondary opacity-60">• {perm.user ? t('adminMachines.perm.individual') : t('adminMachines.perm.group')}</span>
                            </div>
                          </div>
                        </div>
                        {!isSelf && (
                          <button
                            onClick={() => handlePermDelete(perm.id)}
                            className="p-2.5 text-text-secondary hover:text-danger hover:bg-danger/5 rounded-xl opacity-0 group-hover:opacity-100 transition-all"
                            title={t('common.delete')}
                          >
                            <Trash2 size={18} />
                          </button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
