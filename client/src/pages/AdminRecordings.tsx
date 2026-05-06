import React, { useState, useEffect, useCallback } from 'react';
import { Video, X, ChevronLeft, ChevronRight } from 'lucide-react';
import api from '../services/api';
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
  user: { id: string; email: string; username: string | null } | null;
}

interface PageData {
  total: number;
  page: number;
  items: Recording[];
}

const PAGE_SIZE = 20;

const AdminRecordings: React.FC = () => {
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
    <div className="space-y-6">
      <h1 className="t-h1 text-text-main flex items-center gap-2 fade-up">
        <Video size={24} className="text-primary" />
        Enregistrements de sessions
      </h1>

      {selected && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="w-full max-w-5xl bg-background-surface rounded-xl shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border-light">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-text-main">
                  Session {selected.sessionId.slice(0, 8)}…
                </span>
                <span className="text-xs text-text-secondary">
                  Utilisateur : {selected.user?.username ?? selected.user?.email ?? selected.userId}
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
              <th className="px-4 py-3 text-left">Session</th>
              <th className="px-4 py-3 text-left">Utilisateur</th>
              <th className="px-4 py-3 text-left">Machine</th>
              <th className="px-4 py-3 text-left">Début</th>
              <th className="px-4 py-3 text-left">Fin</th>
              <th className="px-4 py-3 text-left">Taille</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-text-secondary">
                  Chargement…
                </td>
              </tr>
            )}
            {!loading && data?.items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-text-secondary">
                  Aucun enregistrement disponible.
                </td>
              </tr>
            )}
            {!loading && data?.items.map((rec) => (
              <tr key={rec.id} className="border-b border-border-light hover:bg-background-app transition-colors">
                <td className="px-4 py-3 font-mono text-xs text-text-secondary rail-ambre">
                  {rec.sessionId.slice(0, 8)}…
                </td>
                <td className="px-4 py-3 text-text-main text-sm">
                  {rec.user?.username ?? rec.user?.email ?? rec.userId.slice(0, 8) + '…'}
                </td>
                <td className="px-4 py-3 text-text-main">{rec.machineName ?? rec.machineId.slice(0, 8) + '…'}</td>
                <td className="px-4 py-3 text-text-secondary">{fmt(rec.startedAt)}</td>
                <td className="px-4 py-3 text-text-secondary">
                  {rec.endedAt ? fmt(rec.endedAt) : <span className="t-eyebrow-ambre">En cours</span>}
                </td>
                <td className="px-4 py-3 text-text-secondary">{fmtSize(rec.sizeBytes)}</td>
                <td className="px-4 py-3 text-right">
                  {rec.endedAt && (
                    <button
                      onClick={() => setSelected(rec)}
                      className="btn-secondary text-xs py-1 px-3 flex items-center gap-1 ml-auto"
                    >
                      <Video size={14} />
                      Rejouer
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
              {data?.total} enregistrements — page {page}/{totalPages}
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
