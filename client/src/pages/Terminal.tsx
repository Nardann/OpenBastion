import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import { io, Socket } from 'socket.io-client';
import { useAuth } from '../context/AuthContext';
import { Terminal as TerminalIcon, Shield, ChevronLeft, Loader2, ClipboardX, AlertCircle } from 'lucide-react';
import { useLang } from '../context/LangContext';
import 'xterm/css/xterm.css';

const Terminal: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { t } = useLang();
  const navigate = useNavigate();
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'error' | 'closed'>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [allowCopyPaste, setAllowCopyPaste] = useState(true);

  const allowCopyPasteRef = useRef(true);

  useEffect(() => {
    if (!id || !terminalRef.current) return;

    const term = new XTerm({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: '"Cascadia Code", Menlo, monospace',
      theme: {
        background: '#0f172a',
        foreground: '#f8fafc',
      }
    });

    term.attachCustomKeyEventHandler((event) => {
      if (!allowCopyPasteRef.current) {
        if ((event.ctrlKey || event.metaKey) && event.key === 'v') return false;
        if (event.shiftKey && event.key === 'Insert') return false;
      }
      return true;
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(terminalRef.current);
    fitAddon.fit();
    xtermRef.current = term;

    const socket = io('/terminal', {
      path: '/api/socket.io',
      withCredentials: true,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('start-session', {
        machineId: id,
        cols: term.cols,
        rows: term.rows
      });
    });

    socket.on('security-settings', (settings: { allowCopyPaste: boolean }) => {
      setAllowCopyPaste(settings.allowCopyPaste);
      allowCopyPasteRef.current = settings.allowCopyPaste;
      if (!settings.allowCopyPaste) {
        term.writeln('\r\n\x1b[33m⚠️  SÉCURITÉ : Copier-coller désactivé.\x1b[0m');
      }
    });

    socket.on('output', (data: string) => {
      term.write(data);
      setStatus('connected');
    });

    socket.on('error', (err: string) => {
      setError(err);
      setStatus('error');
    });

    socket.on('closed', () => {
      setStatus('closed');
    });

    term.onData((data) => {
      socket.emit('input', data);
    });

    term.onResize((size) => {
      socket.emit('resize', size);
    });

    const handleResize = () => fitAddon.fit();
    window.addEventListener('resize', handleResize);

    const blockEvent = (e: Event) => {
      if (!allowCopyPasteRef.current) {
        e.preventDefault();
        e.stopPropagation();
        term.writeln('\r\n\x1b[31m[ACTION BLOQUÉE PAR LE BASTION]\x1b[0m');
      }
    };

    const blockContextMenu = (e: MouseEvent) => {
      if (!allowCopyPasteRef.current) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    const container = terminalRef.current;
    if (container) {
      container.addEventListener('paste', blockEvent, true);
      container.addEventListener('contextmenu', blockContextMenu, true);
      document.addEventListener('paste', blockEvent, true);
    }

    return () => {
      socket.disconnect();
      term.dispose();
      window.removeEventListener('resize', handleResize);
      if (container) {
        container.removeEventListener('paste', blockEvent, true);
        container.removeEventListener('contextmenu', blockContextMenu, true);
      }
      document.removeEventListener('paste', blockEvent, true);
    };
    // CRITICAL: We only depend on 'id'. Changing security settings won't restart the socket.
  }, [id]);

  return (
    <div className="h-screen flex flex-col bg-[#0f172a] text-slate-300">
      <div className="h-12 border-b border-slate-800 px-4 flex items-center justify-between bg-slate-900/50">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/')} className="p-1 hover:bg-slate-800 rounded transition-colors">
            <ChevronLeft size={20} />
          </button>
          <div className="flex items-center gap-2">
            <TerminalIcon size={18} className="text-primary" />
            <span className="font-mono text-sm font-bold uppercase tracking-tight">{t('terminal.title')}</span>
          </div>
          <div className={`w-2 h-2 rounded-full ${status === 'connected' ? 'bg-green-500 animate-pulse' : 'bg-orange-500'}`} />
        </div>

        <div className="flex items-center gap-4">
          {!allowCopyPaste && (
            <div className="flex items-center gap-2 px-3 py-1 bg-red-500/10 border border-red-500/20 rounded-full text-red-500 text-[10px] font-bold uppercase animate-pulse">
              <ClipboardX size={12} /> {t('terminal.isolatedMode')}
            </div>
          )}
          <div className="flex items-center gap-2 text-xs opacity-50">
            <Shield size={14} /> <span>{user?.email}</span>
          </div>
        </div>
      </div>

      <div className="flex-1 relative overflow-hidden p-4">
        {status === 'connecting' && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-900/80 backdrop-blur-sm">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
          </div>
        )}

        {status === 'error' && (
          <div className="absolute inset-0 z-20 flex items-center justify-center backdrop-blur-md">
            <div className="bg-slate-800 border border-red-500/50 p-8 rounded-2xl max-w-md text-center space-y-4 shadow-2xl">
              <AlertCircle className="w-12 h-12 text-red-500 mx-auto" />
              <h2 className="text-xl font-bold">{t('terminal.sessionError')}</h2>
              <p className="text-sm font-mono opacity-70">{error}</p>
              <button onClick={() => navigate('/')} className="w-full py-2 bg-primary text-white rounded-lg font-bold">{t('terminal.quit')}</button>
            </div>
          </div>
        )}
        <div ref={terminalRef} className="h-full w-full" />
      </div>
    </div>
  );
};

export default Terminal;
