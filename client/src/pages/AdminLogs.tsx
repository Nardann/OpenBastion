import React, { useEffect, useState } from 'react';
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
  Shield
} from 'lucide-react';
import api from '../services/api';
import { formatDate } from '../services/utils';
import { useLang } from '../context/LangContext';

interface AuditLog {
  id: string;
  action: string;
  category: string;
  timestamp: string;
  authMethod: string;
  ipAddress: string;
  user?: { email: string; username?: string; role: string };
  metadata?: any;
}

const AdminLogs: React.FC = () => {
  const { t } = useLang();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);

  const CATEGORIES = [
    { id: '', label: t('adminLogs.tabs.all'), icon: <Activity size={14} /> },
    { id: 'AUTH', label: t('adminLogs.tabs.security'), icon: <Lock size={14} /> },
    { id: 'USER', label: t('adminLogs.tabs.users'), icon: <UserCheck size={14} /> },
    { id: 'GROUP', label: t('adminLogs.tabs.groups'), icon: <UserIcon size={14} /> },
    { id: 'MACHINE', label: t('adminLogs.tabs.machines'), icon: <Server size={14} /> },
    { id: 'PERMISSION', label: t('adminLogs.tabs.permissions'), icon: <Shield size={14} /> },
    { id: 'TERMINAL', label: t('adminLogs.tabs.ssh'), icon: <Terminal size={14} /> },
    { id: 'SYSTEM', label: t('adminLogs.tabs.system'), icon: <Settings size={14} /> },
  ];

  const fetchLogs = async () => {
    try {
      setLoading(true);
      const url = activeCategory ? `/audit/logs?category=${activeCategory}` : '/audit/logs';
      const response = await api.get(url);
      setLogs(response.data?.items || []);
    } catch (error) {
      console.error('Failed to fetch logs', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [activeCategory]);

  const filteredLogs = logs.filter(log =>
    log.action.toLowerCase().includes(searchTerm.toLowerCase()) ||
    log.user?.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    log.user?.username?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    log.ipAddress?.includes(searchTerm)
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-text-main">{t('adminLogs.title')}</h1>
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

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-1 space-y-1">
          {CATEGORIES.map(cat => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
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
                    <th className="px-6 py-4 text-right">{t('adminLogs.cols.details')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-light">
                  {!loading && filteredLogs.map((log) => (
                    <tr
                      key={log.id}
                      onClick={() => setSelectedLog(log)}
                      className="group hover:bg-background-app transition-colors cursor-pointer"
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className={`p-2 rounded-md ${log.category === 'AUTH' ? 'bg-warning/10 text-warning' : 'bg-primary/10 text-primary'}`}>
                            <FileText size={16} />
                          </div>
                          <div>
                            <p className="font-bold text-sm text-text-main truncate max-w-[200px]">{log.action}</p>
                            <p className="text-[10px] text-text-secondary flex items-center gap-1 font-mono">
                              <Clock size={10} /> {formatDate(log.timestamp)}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-background-app flex items-center justify-center text-[10px] font-bold border border-border-light text-text-secondary">
                            {(log.user?.username || log.user?.email || 'S')[0].toUpperCase()}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-text-main leading-none">{log.user?.username || log.user?.email || t('adminLogs.detail.systemActor')}</p>
                            <span className="text-[9px] text-text-secondary font-mono">{log.ipAddress}</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <ChevronRight size={18} className="text-neutral opacity-0 group-hover:opacity-100 transition-opacity inline" />
                      </td>
                    </tr>
                  ))}
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
        <div className="fixed inset-0 bg-text-main/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-background-surface w-full max-w-2xl rounded-lg border border-border-light shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-border-light bg-background-app flex justify-between items-center">
              <div className="flex items-center gap-3 text-primary">
                <Info size={24} />
                <h2 className="text-xl font-bold text-text-main">{t('adminLogs.detail.title')}</h2>
              </div>
              <button onClick={() => setSelectedLog(null)} className="p-2 hover:bg-background-surface rounded-full text-text-secondary transition-colors"><X size={20} /></button>
            </div>

            <div className="p-8 space-y-8 max-h-[70vh] overflow-y-auto custom-scrollbar">
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-1">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('adminLogs.detail.action')}</p>
                  <p className="text-sm font-bold text-text-main bg-primary/5 p-2 rounded-md border border-primary/10">{selectedLog.action}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('adminLogs.detail.category')}</p>
                  <p className="pill-badge bg-background-app text-text-main border border-border-light inline-block px-3 py-1 mt-1">{selectedLog.category || 'SYSTEM'}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('adminLogs.detail.timestamp')}</p>
                  <p className="text-sm font-mono flex items-center gap-2 text-text-main"><Clock size={14} className="text-neutral" /> {new Date(selectedLog.timestamp).toLocaleString()}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('adminLogs.detail.ip')}</p>
                  <p className="text-sm font-mono flex items-center gap-2 text-text-main"><Globe size={14} className="text-neutral" /> {selectedLog.ipAddress}</p>
                </div>
              </div>

              <div className="pt-6 border-t border-border-light space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-widest text-primary flex items-center gap-2">
                  <UserIcon size={14} /> {t('adminLogs.detail.actor')}
                </h3>
                <div className="bg-background-app rounded-lg p-4 flex items-center gap-4 border border-border-light">
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xl border border-primary/20">
                    {(selectedLog.user?.username || selectedLog.user?.email || 'S')[0].toUpperCase()}
                  </div>
                  <div className="flex-1">
                    <p className="font-bold text-text-main">{selectedLog.user?.username || t('adminLogs.detail.systemActor')}</p>
                    <p className="text-xs text-text-secondary font-mono">{selectedLog.user?.email || 'internal@bastion.local'}</p>
                  </div>
                  <div className="text-right">
                    <span className="pill-badge bg-primary text-white text-[10px] font-bold uppercase">
                      {selectedLog.user?.role || t('adminLogs.detail.systemActor')}
                    </span>
                    <p className="text-[10px] mt-1 text-text-secondary uppercase font-medium">{selectedLog.authMethod || t('adminLogs.detail.internalIp')}</p>
                  </div>
                </div>
              </div>

              {selectedLog.metadata && (
                <div className="pt-6 border-t border-border-light space-y-3">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-primary flex items-center gap-2">
                    <Fingerprint size={14} /> {t('adminLogs.detail.metadata')}
                  </h3>
                  <div className="bg-text-main rounded-lg p-6 border border-border-light shadow-inner">
                    <pre className="text-[11px] text-success font-mono overflow-x-auto">
                      {JSON.stringify(selectedLog.metadata, null, 2)}
                    </pre>
                  </div>
                </div>
              )}
            </div>

            <div className="p-6 bg-background-app border-t border-border-light flex justify-end">
              <button
                onClick={() => setSelectedLog(null)}
                className="btn-primary text-sm px-8"
              >
                {t('common.close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminLogs;
