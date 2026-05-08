import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { History, Video, X, ChevronLeft, ChevronRight, ArrowLeft } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LangContext';
import api from '../services/api';
import AsciinemaPlayer from '../components/AsciinemaPlayer';

interface Recording {
  id: string;
  sessionId: string;
  machineId: string;
  machineName: string | null;
  sizeBytes: number;
  startedAt: string;
  endedAt: string | null;
}

interface PageData {
  total: number;
  page: number;
  items: Recording[];
}

const PAGE_SIZE = 20;

const UserHistory: React.FC = () => {
  const { user } = useAuth();
  const { t } = useLang();
  const [data, setData] = useState<PageData | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Recording | null>(null);

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

  return (
    <div className="min-h-screen bg-background-app text-text-main font-sans">
      <header className="bg-background-surface border-b border-border-light sticky top-0 z-50 shadow-sm">
        <div className="max-w-7xl mx-auto px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <History className="w-5 h-5 text-primary" />
            <span className="text-lg font-bold text-text-main">{t('history.title')}</span>
          </div>
          <Link
            to="/"
            className="flex items-center gap-2 text-sm text-text-secondary hover:text-primary transition-colors"
          >
            <ArrowLeft size={16} />
            {t('history.backToDashboard')}
          </Link>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-8 py-10 space-y-6">
        <div>
          <h1 className="t-h1 text-text-main mb-1">{t('history.title')}</h1>
          <p className="text-text-secondary text-sm">
            {t('history.subtitle')}
          </p>
        </div>

        {/* Player modal */}
        {selected && (
          <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
            <div className="w-full max-w-5xl bg-background-surface rounded-xl shadow-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border-light">
                <span className="text-sm font-medium text-text-main">
                  {t('history.session')} {selected.sessionId.slice(0, 8)}…
                </span>
                <button onClick={() => setSelected(null)} className="text-text-secondary hover:text-text-main">
                  <X size={20} />
                </button>
              </div>
              <div className="p-4">
                <AsciinemaPlayer
                  castUrl={`/api/recordings/${selected.id}/stream`}
                  hudUser={user?.username ?? user?.email ?? undefined}
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
                  <td colSpan={6} className="px-4 py-8 text-center text-text-secondary">
                    {t('common.loading')}
                  </td>
                </tr>
              )}
              {!loading && data?.items.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-text-secondary">
                    {t('history.empty')}
                  </td>
                </tr>
              )}
              {!loading && data?.items.map((rec) => (
                <tr key={rec.id} className="border-b border-border-light hover:bg-background-app transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-text-secondary rail-ambre">
                    {rec.sessionId.slice(0, 8)}…
                  </td>
                  <td className="px-4 py-3 text-text-main text-sm">
                    {rec.machineName ?? rec.machineId.slice(0, 8) + '…'}
                  </td>
                  <td className="px-4 py-3 text-text-secondary">{fmt(rec.startedAt)}</td>
                  <td className="px-4 py-3 text-text-secondary">
                    {rec.endedAt
                      ? fmt(rec.endedAt)
                      : <span className="t-eyebrow-ambre">{t('history.inProgress')}</span>}
                  </td>
                  <td className="px-4 py-3 text-text-secondary">{fmtSize(rec.sizeBytes)}</td>
                  <td className="px-4 py-3 text-right">
                    {rec.endedAt && (
                      <button
                        onClick={() => setSelected(rec)}
                        className="btn-secondary text-xs py-1 px-3 flex items-center gap-1 ml-auto"
                      >
                        <Video size={14} />
                        {t('history.replay')}
                      </button>
                    )}
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
      </main>
    </div>
  );
};

export default UserHistory;
