import React, { useState, useEffect, useCallback } from 'react';
import { Video, X, ChevronLeft, ChevronRight, Pin } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LangContext';
import AsciinemaPlayer from '../components/AsciinemaPlayer';

interface Recording {
  id: string;
  sessionId: string;
  userId: string;
  machineId: string;
  machineName: string | null;
  sizeBytes: number;
  startedAt: string;
  endedAt: string | null;
  pinned: boolean;
  user: { id: string; email: string; username: string | null } | null;
}

interface PageData {
  total: number;
  page: number;
  items: Recording[];
}

const PAGE_SIZE = 20;

const AdminRecordings: React.FC = () => {
  const { user } = useAuth();
  const { t } = useLang();
  const [data, setData] = useState<PageData | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Recording | null>(null);
  const [pinningIds, setPinningIds] = useState<Set<string>>(new Set());

  const load = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const res = await api.get<PageData>(`/recordings?page=${p}&limit=${PAGE_SIZE}`);
      setData(res.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(page); }, [load, page]);

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });

  const fmtSize = (b: number) =>
    b > 1_000_000 ? `${(b / 1_000_000).toFixed(1)} MB` : `${(b / 1_000).toFixed(0)} KB`;

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1;

  const handleTogglePin = async (rec: Recording) => {
    if (pinningIds.has(rec.id)) return;
    setPinningIds(prev => new Set(prev).add(rec.id));
    try {
      const res = await api.patch<{ id: string; pinned: boolean }>(`/recordings/${rec.id}/pin`);
      setData(prev => prev ? {
        ...prev,
        items: prev.items.map(r => r.id === rec.id ? { ...r, pinned: res.data.pinned } : r),
      } : prev);
    } catch {
      // silently ignore
    } finally {
      setPinningIds(prev => { const n = new Set(prev); n.delete(rec.id); return n; });
    }
  };

  const isAdmin = user?.role === 'ADMIN';

  return (
    <div className="space-y-6">
      <h1 className="t-h1 text-text-main flex items-center gap-2 fade-up">
        <Video size={24} className="text-primary" />
        {t('adminRecordings.title')}
      </h1>

      {selected && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="w-full max-w-5xl bg-background-surface rounded-xl shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border-light">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-text-main">
                  {t('history.session')} {selected.sessionId.slice(0, 8)}…
                </span>
                <span className="text-xs text-text-secondary">
                  {t('adminRecordings.user')} : {selected.user?.username ?? selected.user?.email ?? selected.userId}
                </span>
              </div>
              <button onClick={() => setSelected(null)} className="text-text-secondary hover:text-text-main">
                <X size={20} />
              </button>
            </div>
            <div className="p-4">
              <AsciinemaPlayer
                castUrl={`/api/recordings/${selected.id}/stream`}
                hudUser={selected.user?.username ?? selected.user?.email ?? undefined}
                hudMachine={selected.machineName ?? undefined}
              />
            </div>
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-light text-text-secondary text-xs uppercase">
              <th className="px-4 py-3 text-left">{t('history.col.session')}</th>
              <th className="px-4 py-3 text-left">{t('adminRecordings.colUser')}</th>
              <th className="px-4 py-3 text-left">{t('history.col.machine')}</th>
              <th className="px-4 py-3 text-left">{t('history.col.start')}</th>
              <th className="px-4 py-3 text-left">{t('history.col.end')}</th>
              <th className="px-4 py-3 text-left">{t('history.col.size')}</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-text-secondary">
                  {t('common.loading')}
                </td>
              </tr>
            )}
            {!loading && data?.items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-text-secondary">
                  {t('history.empty')}
                </td>
              </tr>
            )}
            {!loading && data?.items.map((rec) => (
              <tr key={rec.id} className="border-b border-border-light hover:bg-background-app transition-colors">
                <td className="px-4 py-3 font-mono text-xs text-text-secondary rail-ambre">
                  <span className="flex items-center gap-1.5">
                    {rec.pinned && <Pin size={10} className="text-warning fill-warning shrink-0" />}
                    {rec.sessionId.slice(0, 8)}…
                  </span>
                </td>
                <td className="px-4 py-3 text-text-main text-sm">
                  {rec.user?.username ?? rec.user?.email ?? rec.userId.slice(0, 8) + '…'}
                </td>
                <td className="px-4 py-3 text-text-main">{rec.machineName ?? rec.machineId.slice(0, 8) + '…'}</td>
                <td className="px-4 py-3 text-text-secondary">{fmt(rec.startedAt)}</td>
                <td className="px-4 py-3 text-text-secondary">
                  {rec.endedAt ? fmt(rec.endedAt) : <span className="t-eyebrow-ambre">{t('history.inProgress')}</span>}
                </td>
                <td className="px-4 py-3 text-text-secondary">{fmtSize(rec.sizeBytes)}</td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center gap-2 justify-end">
                    {isAdmin && (
                      <button
                        onClick={() => handleTogglePin(rec)}
                        disabled={pinningIds.has(rec.id)}
                        title={rec.pinned ? t('adminRecordings.unpin') : t('adminRecordings.pin')}
                        className={`p-1.5 rounded-md transition-all disabled:opacity-40 ${
                          rec.pinned
                            ? 'text-warning bg-warning/10 hover:bg-warning/20'
                            : 'text-text-secondary hover:text-warning hover:bg-warning/10'
                        }`}
                      >
                        <Pin size={14} className={rec.pinned ? 'fill-warning' : ''} />
                      </button>
                    )}
                    {rec.endedAt && (
                      <button
                        onClick={() => setSelected(rec)}
                        className="btn-secondary text-xs py-1 px-3 flex items-center gap-1"
                      >
                        <Video size={14} />
                        {t('history.replay')}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-border-light flex items-center justify-between">
            <span className="text-xs text-text-secondary">
              {data?.total} {t('history.recordings')} — {t('history.page')} {page}/{totalPages}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="btn-icon"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="btn-icon"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminRecordings;
