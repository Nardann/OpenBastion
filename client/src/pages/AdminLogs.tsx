import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  FileText,
  User as UserIcon,
  Globe,
  RefreshCw,
  Search,
  Activity,
  UserCheck,
  Server,
  Lock,
  Terminal,
  Settings,
  X,
  Info,
  ChevronRight,
  Clock,
  Fingerprint,
  Shield,
  ShieldCheck,
  Users as UsersIcon,
  Layers,
  Tag,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../services/api';
import { formatDate } from '../services/utils';
import { useLang } from '../context/LangContext';

type EntityType =
  | 'user'
  | 'machine'
  | 'machineGroup'
  | 'group'
  | 'permission'
  | 'provider'
  | 'recording';

interface AuditLogMetadataEntities {
  users?: string[];
  machines?: string[];
  machineGroups?: string[];
  groups?: string[];
  permissions?: string[];
  providers?: string[];
  recordings?: string[];
}

interface AuditLog {
  id: string;
  action: string;
  category: string;
  timestamp: string;
  authMethod: string;
  ipAddress: string;
  user?: { id?: string; email: string; username?: string; role: string };
  userSnapshot?: { email?: string; username?: string; role?: string };
  metadata?: any;
}

interface ResolvedEntity {
  id: string;
  label: string;
  deleted: boolean;
}

type ResolvedMap = Record<string, ResolvedEntity>;

const ENTITY_META: Record<EntityType, {
  field: keyof AuditLogMetadataEntities;
  // i18n leaf under adminLogs.chip
  i18nKey: string;
  Icon: React.ComponentType<any>;
  color: string;
}> = {
  user: { field: 'users', i18nKey: 'user', Icon: UserIcon, color: 'text-primary bg-primary/10 border-primary/20' },
  machine: { field: 'machines', i18nKey: 'machine', Icon: Server, color: 'text-blue-600 bg-blue-50 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700' },
  machineGroup: { field: 'machineGroups', i18nKey: 'machineGroup', Icon: Layers, color: 'text-cyan-700 bg-cyan-50 border-cyan-200 dark:bg-cyan-900/30 dark:text-cyan-300 dark:border-cyan-700' },
  group: { field: 'groups', i18nKey: 'group', Icon: UsersIcon, color: 'text-emerald-700 bg-emerald-50 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700' },
  permission: { field: 'permissions', i18nKey: 'permission', Icon: Shield, color: 'text-orange-700 bg-orange-50 border-orange-200 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-700' },
  provider: { field: 'providers', i18nKey: 'provider', Icon: ShieldCheck, color: 'text-purple-700 bg-purple-50 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-700' },
  recording: { field: 'recordings', i18nKey: 'recording', Icon: Tag, color: 'text-slate-700 bg-slate-100 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-600' },
};

const AdminLogs: React.FC = () => {
  const { t } = useLang();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);
  const [resolved, setResolved] = useState<Record<EntityType, ResolvedMap>>({
    user: {}, machine: {}, machineGroup: {}, group: {}, permission: {}, provider: {}, recording: {},
  });
  const [activeFilterLabel, setActiveFilterLabel] = useState<string | null>(null);

  const activeCategory = searchParams.get('category') ?? '';
  const entityType = (searchParams.get('entityType') ?? '') as EntityType | '';
  const entityId = searchParams.get('entityId') ?? '';

  const CATEGORIES = [
    { id: '', label: t('adminLogs.tabs.all'), icon: <Activity size={14} /> },
    { id: 'AUTH', label: t('adminLogs.tabs.security'), icon: <Lock size={14} /> },
    { id: 'USER', label: t('adminLogs.tabs.users'), icon: <UserCheck size={14} /> },
    { id: 'GROUP', label: t('adminLogs.tabs.groups'), icon: <UserIcon size={14} /> },
    { id: 'MACHINE', label: t('adminLogs.tabs.machines'), icon: <Server size={14} /> },
    { id: 'MACHINE_GROUP', label: t('adminLogs.tabs.machineGroups'), icon: <Layers size={14} /> },
    { id: 'PERMISSION', label: t('adminLogs.tabs.permissions'), icon: <Shield size={14} /> },
    { id: 'TERMINAL', label: t('adminLogs.tabs.ssh'), icon: <Terminal size={14} /> },
    { id: 'RECORDING', label: t('adminLogs.tabs.recording'), icon: <Tag size={14} /> },
    { id: 'SYSTEM', label: t('adminLogs.tabs.system'), icon: <Settings size={14} /> },
  ];

  const buildQuery = useCallback(() => {
    const qs = new URLSearchParams();
    if (activeCategory) qs.set('category', activeCategory);
    if (entityType && entityId) {
      qs.set('entityType', entityType);
      qs.set('entityId', entityId);
    }
    return qs.toString();
  }, [activeCategory, entityType, entityId]);

  /**
   * Pull every entity referenced in any log row's metadata.entities block,
   * then resolve them in one shot. Without this batch step the chip text
   * would just show `user:abcd1234` which is useless.
   */
  const collectEntityIds = useCallback((rows: AuditLog[]) => {
    const acc: Record<EntityType, Set<string>> = {
      user: new Set(), machine: new Set(), machineGroup: new Set(),
      group: new Set(), permission: new Set(), provider: new Set(), recording: new Set(),
    };
    for (const row of rows) {
      const ents = row.metadata?.entities as AuditLogMetadataEntities | undefined;
      if (!ents) continue;
      (ents.users ?? []).forEach((id) => acc.user.add(id));
      (ents.machines ?? []).forEach((id) => acc.machine.add(id));
      (ents.machineGroups ?? []).forEach((id) => acc.machineGroup.add(id));
      (ents.groups ?? []).forEach((id) => acc.group.add(id));
      (ents.permissions ?? []).forEach((id) => acc.permission.add(id));
      (ents.providers ?? []).forEach((id) => acc.provider.add(id));
      (ents.recordings ?? []).forEach((id) => acc.recording.add(id));
    }
    return acc;
  }, []);

  const fetchLogs = useCallback(async () => {
    try {
      setLoading(true);
      const qs = buildQuery();
      const response = await api.get(`/audit/logs${qs ? '?' + qs : ''}`);
      const items = (response.data?.items ?? []) as AuditLog[];
      setLogs(items);
    } catch (error) {
      console.error('Failed to fetch logs', error);
    } finally {
      setLoading(false);
    }
  }, [buildQuery]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Resolve referenced entities once logs are loaded.
  useEffect(() => {
    const wanted = collectEntityIds(logs);
    const q = new URLSearchParams();
    let any = false;
    if (wanted.user.size) { q.set('users', Array.from(wanted.user).join(',')); any = true; }
    if (wanted.machine.size) { q.set('machines', Array.from(wanted.machine).join(',')); any = true; }
    if (wanted.machineGroup.size) { q.set('machineGroups', Array.from(wanted.machineGroup).join(',')); any = true; }
    if (wanted.group.size) { q.set('groups', Array.from(wanted.group).join(',')); any = true; }
    if (wanted.permission.size) { q.set('permissions', Array.from(wanted.permission).join(',')); any = true; }
    if (wanted.provider.size) { q.set('providers', Array.from(wanted.provider).join(',')); any = true; }
    if (wanted.recording.size) { q.set('recordings', Array.from(wanted.recording).join(',')); any = true; }
    if (!any) {
      setResolved({ user: {}, machine: {}, machineGroup: {}, group: {}, permission: {}, provider: {}, recording: {} });
      return;
    }
    api.get(`/audit/entities/resolve?${q.toString()}`)
      .then((res) => {
        const d = res.data as Record<string, ResolvedEntity[]>;
        const toMap = (arr: ResolvedEntity[] | undefined): ResolvedMap => Object.fromEntries((arr ?? []).map((e) => [e.id, e]));
        setResolved({
          user: toMap(d.users),
          machine: toMap(d.machines),
          machineGroup: toMap(d.machineGroups),
          group: toMap(d.groups),
          permission: toMap(d.permissions),
          provider: toMap(d.providers),
          recording: toMap(d.recordings),
        });
      })
      .catch((e) => console.error('Failed to resolve entities', e));
  }, [logs, collectEntityIds]);

  // Compute label for the active entity filter (shown as a removable pill).
  useEffect(() => {
    if (!entityType || !entityId) {
      setActiveFilterLabel(null);
      return;
    }
    const map = resolved[entityType as EntityType];
    if (map[entityId]) {
      setActiveFilterLabel(map[entityId].label);
      return;
    }
    // The active filter id may not be in any visible row's metadata —
    // resolve it on its own so the breadcrumb shows a real label.
    const q = new URLSearchParams();
    q.set(ENTITY_META[entityType as EntityType].field, entityId);
    api.get(`/audit/entities/resolve?${q.toString()}`)
      .then((res) => {
        const arr = (res.data as Record<string, ResolvedEntity[]>)[ENTITY_META[entityType as EntityType].field];
        const e = arr?.find((x) => x.id === entityId);
        setActiveFilterLabel(e?.label ?? entityId.slice(0, 8));
      })
      .catch(() => setActiveFilterLabel(entityId.slice(0, 8)));
  }, [entityType, entityId, resolved]);

  const setCategory = (cat: string) => {
    const next = new URLSearchParams(searchParams);
    if (cat) next.set('category', cat);
    else next.delete('category');
    setSearchParams(next);
  };

  const setEntityFilter = (type: EntityType, id: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('entityType', type);
    next.set('entityId', id);
    setSearchParams(next);
    setSelectedLog(null);
  };

  const clearEntityFilter = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('entityType');
    next.delete('entityId');
    setSearchParams(next);
  };

  const filteredLogs = useMemo(() => {
    if (!searchTerm) return logs;
    const lower = searchTerm.toLowerCase();
    return logs.filter((log) =>
      log.action.toLowerCase().includes(lower) ||
      log.user?.email?.toLowerCase().includes(lower) ||
      log.user?.username?.toLowerCase().includes(lower) ||
      log.userSnapshot?.email?.toLowerCase().includes(lower) ||
      log.ipAddress?.includes(searchTerm),
    );
  }, [logs, searchTerm]);

  const entityListFor = (log: AuditLog) => {
    const out: Array<{ type: EntityType; id: string; label: string; deleted: boolean }> = [];
    const ents = log.metadata?.entities as AuditLogMetadataEntities | undefined;
    if (!ents) return out;
    const actorId = log.user?.id ?? null;
    (['user', 'machine', 'machineGroup', 'group', 'permission', 'provider', 'recording'] as EntityType[]).forEach((type) => {
      const field = ENTITY_META[type].field;
      const ids = (ents[field] ?? []);
      for (const id of ids) {
        // Skip the acting user — they're already rendered as the row's actor.
        if (type === 'user' && id === actorId) continue;
        const r = resolved[type][id];
        out.push({ type, id, label: r?.label ?? `${type}:${id.slice(0, 8)}`, deleted: !!r?.deleted });
      }
    });
    return out;
  };

  const handleViewActorActivity = (log: AuditLog) => {
    if (log.user?.id) {
      setEntityFilter('user', log.user.id);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="t-h1 text-text-main fade-up">{t('adminLogs.title')}</h1>
          <p className="text-text-secondary mt-1 text-sm">{t('adminLogs.subtitle')}</p>
        </div>
        <button
          onClick={fetchLogs}
          className="btn-secondary flex items-center gap-2 text-sm"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          {t('adminLogs.refresh')}
        </button>
      </div>

      {entityType && entityId && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-primary/5 border border-primary/20 animate-in slide-in-from-top-2">
          <span className="text-xs font-bold uppercase tracking-wider text-primary">
            {t('adminLogs.filter.activeLabel')}
          </span>
          <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${ENTITY_META[entityType as EntityType].color}`}>
            {React.createElement(ENTITY_META[entityType as EntityType].Icon, { size: 12 })}
            {t(`adminLogs.chip.${ENTITY_META[entityType as EntityType].i18nKey}` as any)} · {activeFilterLabel ?? '…'}
          </span>
          <button
            onClick={clearEntityFilter}
            className="ml-auto text-xs font-bold text-primary hover:text-text-main flex items-center gap-1 transition-colors"
          >
            <X size={12} /> {t('adminLogs.filter.clear')}
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-1 space-y-1">
          {CATEGORIES.map(cat => (
            <button
              key={cat.id}
              onClick={() => setCategory(cat.id)}
              className={`flex items-center gap-3 w-full px-4 py-2.5 rounded-md text-sm font-medium transition-all ${activeCategory === cat.id ? 'bg-primary/10 text-primary' : 'hover:bg-background-app text-text-secondary hover:text-text-main'}`}
            >
              {cat.icon}
              {cat.label}
            </button>
          ))}
        </div>

        <div className="lg:col-span-3 space-y-4">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral" size={16} />
            <input
              type="text"
              placeholder={t('adminLogs.searchPlaceholder')}
              className="form-input input-with-icon w-full text-sm shadow-sm"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>

          <div className="card-subtle overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead className="table-header border-b border-border-light">
                  <tr>
                    <th className="px-6 py-4">{t('adminLogs.cols.action')}</th>
                    <th className="px-6 py-4">{t('adminLogs.cols.user')}</th>
                    <th className="px-6 py-4">{t('adminLogs.cols.relatedEntities')}</th>
                    <th className="px-6 py-4 text-right">{t('adminLogs.cols.details')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-light">
                  {!loading && filteredLogs.map((log) => {
                    const entities = entityListFor(log);
                    const actorLabel = log.user?.username || log.user?.email || log.userSnapshot?.email || t('adminLogs.detail.systemActor');
                    return (
                      <tr
                        key={log.id}
                        onClick={() => setSelectedLog(log)}
                        className="group hover:bg-background-app transition-colors cursor-pointer align-top"
                      >
                        <td className="px-6 py-4 rail-ambre">
                          <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-md ${log.category === 'AUTH' ? 'bg-warning/10 text-warning' : 'bg-primary/10 text-primary'}`}>
                              <FileText size={16} />
                            </div>
                            <div>
                              <p className="font-bold text-sm text-text-main">{log.action}</p>
                              <p className="text-[10px] text-text-secondary flex items-center gap-1 font-mono">
                                <Clock size={10} /> {formatDate(log.timestamp)}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <button
                            type="button"
                            disabled={!log.user?.id}
                            onClick={(e) => { e.stopPropagation(); handleViewActorActivity(log); }}
                            title={log.user?.id ? t('adminLogs.chip.filterByActor') : undefined}
                            className={`flex items-center gap-3 text-left ${log.user?.id ? 'hover:opacity-90 cursor-pointer' : 'cursor-default'}`}
                          >
                            <div className="w-8 h-8 rounded-full bg-background-app flex items-center justify-center text-[10px] font-bold border border-border-light text-text-secondary">
                              {actorLabel[0].toUpperCase()}
                            </div>
                            <div>
                              <p className="text-sm font-medium text-text-main leading-none">{actorLabel}</p>
                              <span className="text-[9px] text-text-secondary font-mono">{log.ipAddress}</span>
                            </div>
                          </button>
                        </td>
                        <td className="px-6 py-4 max-w-[260px]">
                          {entities.length === 0 ? (
                            <span className="text-xs text-text-secondary italic">—</span>
                          ) : (
                            <div className="flex flex-wrap gap-1.5">
                              {entities.slice(0, 4).map((e) => (
                                <EntityChip
                                  key={`${e.type}:${e.id}`}
                                  type={e.type}
                                  id={e.id}
                                  label={e.label}
                                  deleted={e.deleted}
                                  onClick={(ev) => { ev.stopPropagation(); setEntityFilter(e.type, e.id); }}
                                />
                              ))}
                              {entities.length > 4 && (
                                <span className="text-[10px] text-text-secondary self-center">+{entities.length - 4}</span>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <ChevronRight size={18} className="text-neutral opacity-0 group-hover:opacity-100 transition-opacity inline" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!loading && filteredLogs.length === 0 && (
              <div className="p-20 text-center text-text-secondary italic text-sm">{t('adminLogs.noLogs')}</div>
            )}
            {loading && (
              <div className="p-20 text-center">
                <RefreshCw className="w-8 h-8 text-primary animate-spin mx-auto" />
              </div>
            )}
          </div>
        </div>
      </div>

      {selectedLog && (
        <LogDetailModal
          log={selectedLog}
          onClose={() => setSelectedLog(null)}
          entities={entityListFor(selectedLog)}
          onSelectEntity={(type, id) => setEntityFilter(type, id)}
          onNavigateUser={(uid) => { navigate(`/administration/users?focus=${uid}`); setSelectedLog(null); }}
          onNavigateMachine={(mid) => { navigate(`/administration/machines?focus=${mid}`); setSelectedLog(null); }}
        />
      )}
    </div>
  );
};

const EntityChip: React.FC<{
  type: EntityType;
  id: string;
  label: string;
  deleted: boolean;
  onClick: (e: React.MouseEvent) => void;
}> = ({ type, label, deleted, onClick }) => {
  const meta = ENTITY_META[type];
  const Icon = meta.Icon;
  return (
    <button
      type="button"
      onClick={onClick}
      title={label + (deleted ? ' (supprimé)' : '')}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wider transition-opacity hover:opacity-80 max-w-[180px] ${meta.color} ${deleted ? 'line-through opacity-60' : ''}`}
    >
      <Icon size={10} />
      <span className="truncate">{label}</span>
    </button>
  );
};

const LogDetailModal: React.FC<{
  log: AuditLog;
  entities: Array<{ type: EntityType; id: string; label: string; deleted: boolean }>;
  onClose: () => void;
  onSelectEntity: (type: EntityType, id: string) => void;
  onNavigateUser: (id: string) => void;
  onNavigateMachine: (id: string) => void;
}> = ({ log, entities, onClose, onSelectEntity, onNavigateUser, onNavigateMachine }) => {
  const { t } = useLang();

  // Strip the entities block from the displayed metadata — we render it
  // as chips above instead of dumping it into the JSON tree.
  const detailMetadata = useMemo(() => {
    if (!log.metadata) return null;
    const { entities: _omit, ...rest } = log.metadata;
    return Object.keys(rest).length > 0 ? rest : null;
  }, [log.metadata]);

  return (
    <div className="fixed inset-0 bg-text-main/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-background-surface w-full max-w-2xl rounded-lg border border-border-light shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="p-6 border-b border-border-light bg-background-app flex justify-between items-center">
          <div className="flex items-center gap-3 text-primary">
            <Info size={24} />
            <h2 className="text-xl font-bold text-text-main">{t('adminLogs.detail.title')}</h2>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-background-surface rounded-full text-text-secondary transition-colors"><X size={20} /></button>
        </div>

        <div className="p-8 space-y-8 max-h-[70vh] overflow-y-auto custom-scrollbar">
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-1">
              <p className="t-eyebrow">{t('adminLogs.detail.action')}</p>
              <p className="text-sm font-bold text-text-main bg-primary/5 p-2 rounded-md border border-primary/10">{log.action}</p>
            </div>
            <div className="space-y-1">
              <p className="t-eyebrow">{t('adminLogs.detail.category')}</p>
              <p className="pill-badge bg-background-app text-text-main border border-border-light inline-block px-3 py-1 mt-1">{log.category || 'SYSTEM'}</p>
            </div>
            <div className="space-y-1">
              <p className="t-eyebrow">{t('adminLogs.detail.timestamp')}</p>
              <p className="text-sm font-mono flex items-center gap-2 text-text-main"><Clock size={14} className="text-neutral" /> {new Date(log.timestamp).toLocaleString()}</p>
            </div>
            <div className="space-y-1">
              <p className="t-eyebrow">{t('adminLogs.detail.ip')}</p>
              <p className="text-sm font-mono flex items-center gap-2 text-text-main"><Globe size={14} className="text-neutral" /> {log.ipAddress}</p>
            </div>
          </div>

          <div className="pt-6 border-t border-border-light space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-widest text-primary flex items-center gap-2">
              <UserIcon size={14} /> {t('adminLogs.detail.actor')}
            </h3>
            <div className="bg-background-app rounded-lg p-4 flex items-center gap-4 border border-border-light">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xl border border-primary/20">
                {(log.user?.username || log.user?.email || 'S')[0].toUpperCase()}
              </div>
              <div className="flex-1">
                <p className="font-bold text-text-main">{log.user?.username || t('adminLogs.detail.systemActor')}</p>
                <p className="text-xs text-text-secondary font-mono">{log.user?.email || 'internal@bastion.local'}</p>
              </div>
              <div className="text-right space-y-2">
                <span className="pill-badge bg-primary text-white text-[10px] font-bold uppercase">
                  {log.user?.role || t('adminLogs.detail.systemActor')}
                </span>
                <p className="t-eyebrow mt-1">{log.authMethod || t('adminLogs.detail.internalIp')}</p>
                {log.user?.id && (
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={() => onSelectEntity('user', log.user!.id!)}
                      className="text-[10px] font-bold uppercase tracking-wider text-primary hover:underline"
                    >
                      {t('adminLogs.detail.actions.filterByActor')}
                    </button>
                    <button
                      onClick={() => onNavigateUser(log.user!.id!)}
                      className="text-[10px] font-bold uppercase tracking-wider text-text-secondary hover:text-primary hover:underline"
                    >
                      {t('adminLogs.detail.actions.openProfile')}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {entities.length > 0 && (
            <div className="pt-6 border-t border-border-light space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-widest text-primary flex items-center gap-2">
                <Layers size={14} /> {t('adminLogs.detail.relatedEntities')}
              </h3>
              <ul className="space-y-2">
                {entities.map((e) => {
                  const meta = ENTITY_META[e.type];
                  const Icon = meta.Icon;
                  return (
                    <li key={`${e.type}:${e.id}`} className="flex items-center gap-3 p-3 rounded-md bg-background-app border border-border-light">
                      <span className={`p-1.5 rounded ${meta.color}`}>
                        <Icon size={14} />
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] uppercase tracking-wider font-bold text-text-secondary">
                          {t(`adminLogs.chip.${meta.i18nKey}` as any)}
                        </p>
                        <p className={`text-sm font-medium truncate ${e.deleted ? 'line-through text-text-secondary' : 'text-text-main'}`}>
                          {e.label}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => onSelectEntity(e.type, e.id)}
                          className="text-[10px] font-bold uppercase tracking-wider text-primary hover:underline"
                        >
                          {t('adminLogs.detail.actions.viewActivity')}
                        </button>
                        {e.type === 'user' && !e.deleted && (
                          <button
                            onClick={() => onNavigateUser(e.id)}
                            className="text-[10px] font-bold uppercase tracking-wider text-text-secondary hover:text-primary hover:underline"
                          >
                            {t('adminLogs.detail.actions.openProfile')}
                          </button>
                        )}
                        {e.type === 'machine' && !e.deleted && (
                          <button
                            onClick={() => onNavigateMachine(e.id)}
                            className="text-[10px] font-bold uppercase tracking-wider text-text-secondary hover:text-primary hover:underline"
                          >
                            {t('adminLogs.detail.actions.openMachine')}
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {detailMetadata && (
            <div className="pt-6 border-t border-border-light space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-widest text-primary flex items-center gap-2">
                <Fingerprint size={14} /> {t('adminLogs.detail.metadata')}
              </h3>
              <div className="bg-[#0E2E5C] dark:bg-[#1C1200] rounded-lg p-6 border border-[rgba(14,46,92,0.3)] dark:border-[rgba(245,165,36,0.15)] shadow-inner">
                <pre className="text-[11px] text-[#A8C4E8] dark:text-[#F5A524] font-mono overflow-x-auto">
                  {JSON.stringify(detailMetadata, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </div>

        <div className="p-6 bg-background-app border-t border-border-light flex justify-end">
          <button onClick={onClose} className="btn-primary text-sm px-8">
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AdminLogs;
