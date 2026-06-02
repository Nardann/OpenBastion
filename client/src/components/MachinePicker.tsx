import React, { useEffect, useRef, useState } from 'react';
import { X, Loader2, Server, Terminal, Monitor } from 'lucide-react';
import api from '../services/api';
import { useLang } from '../context/LangContext';

interface Machine {
  id: string;
  name: string;
  ip: string;
  port: number;
  protocol: string;
  machineGroup?: { id: string; name: string };
}

interface Props {
  onSelect: (machine: { id: string; name: string; protocol: string }) => void;
  onClose: () => void;
}

const MachinePicker: React.FC<Props> = ({ onSelect, onClose }) => {
  const { t } = useLang();
  const [machines, setMachines] = useState<Machine[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api
      .get<Machine[]>('/machines')
      .then((res) => setMachines(res.data as Machine[]))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Auto-focus search when modal opens
  useEffect(() => {
    const t = setTimeout(() => searchRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const filtered = machines.filter(
    (m) =>
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.ip.includes(search),
  );

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-slate-900 border border-slate-700/80 rounded-2xl overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700/80">
          <div className="flex items-center gap-2.5">
            <Terminal size={15} className="text-primary" />
            <h2 className="text-sm font-bold text-white uppercase tracking-widest">
              {t('terminal.newSession')}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-white transition-colors p-1 rounded"
          >
            <X size={16} />
          </button>
        </div>

        {/* Search */}
        <div className="px-5 py-3 border-b border-slate-800">
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`${t('common.search')}…`}
            className="w-full bg-slate-800 text-white placeholder-slate-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50 border border-slate-700 focus:border-primary/50"
          />
        </div>

        {/* Machine list */}
        <div className="p-4 max-h-80 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-center text-slate-500 py-10 text-sm">
              {t('dashboard.noMachines')}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {filtered.map((machine) => (
                <button
                  key={machine.id}
                  onClick={() => onSelect({ id: machine.id, name: machine.name, protocol: machine.protocol })}
                  className="text-left p-3.5 rounded-xl border border-slate-700/80 hover:border-primary/50 hover:bg-primary/5 transition-all group"
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    {machine.protocol === 'RDP' ? (
                    <Monitor size={13} className="text-blue-400 group-hover:text-blue-300 transition-colors shrink-0" />
                  ) : (
                    <Server size={13} className="text-slate-500 group-hover:text-primary transition-colors shrink-0" />
                  )}
                    <span className="font-bold text-sm text-white truncate">
                      {machine.name}
                    </span>
                    <span className={`ml-auto text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${
                      machine.protocol === 'RDP'
                        ? 'bg-blue-500/20 text-blue-400'
                        : 'bg-green-500/20 text-green-400'
                    }`}>
                      {machine.protocol === 'RDP' ? t('terminal.protocolRDP') : t('terminal.protocolSSH')}
                    </span>
                  </div>
                  <span className="font-mono text-xs text-slate-500">
                    {machine.ip}:{machine.port}
                  </span>
                  {machine.machineGroup && (
                    <div className="mt-2">
                      <span className="text-[10px] text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded font-mono">
                        {machine.machineGroup.name}
                      </span>
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MachinePicker;
