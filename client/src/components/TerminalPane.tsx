import React, { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import { io } from 'socket.io-client';
import { Loader2, AlertCircle } from 'lucide-react';
import { useLang } from '../context/LangContext';
import 'xterm/css/xterm.css';

export type SessionStatus = 'connecting' | 'connected' | 'error' | 'closed';

interface TerminalPaneProps {
  machineId: string;
  isActive: boolean;
  onStatusChange: (status: SessionStatus) => void;
  onCopyPasteChange: (allowed: boolean) => void;
  onCloseRequest: () => void;
}

const TerminalPane: React.FC<TerminalPaneProps> = ({
  machineId,
  isActive,
  onStatusChange,
  onCopyPasteChange,
  onCloseRequest,
}) => {
  const { t } = useLang();
  const terminalRef = useRef<HTMLDivElement>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const allowCopyPasteRef = useRef(true);
  const statusRef = useRef<SessionStatus>('connecting');

  // Keep callback refs fresh so socket handlers always call the latest version
  const onStatusChangeRef = useRef(onStatusChange);
  const onCopyPasteChangeRef = useRef(onCopyPasteChange);
  const onCloseRequestRef = useRef(onCloseRequest);
  useEffect(() => { onStatusChangeRef.current = onStatusChange; }, [onStatusChange]);
  useEffect(() => { onCopyPasteChangeRef.current = onCopyPasteChange; }, [onCopyPasteChange]);
  useEffect(() => { onCloseRequestRef.current = onCloseRequest; }, [onCloseRequest]);

  const [status, setStatus] = useState<SessionStatus>('connecting');
  const [error, setError] = useState<string | null>(null);

  const updateStatus = (s: SessionStatus) => {
    if (statusRef.current === s) return;
    statusRef.current = s;
    setStatus(s);
    onStatusChangeRef.current(s);
  };

  // Main effect: xterm + socket setup (runs once per machineId)
  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new XTerm({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: '"Cascadia Code", Menlo, monospace',
      theme: { background: '#0f172a', foreground: '#f8fafc' },
    });

    term.attachCustomKeyEventHandler((event) => {
      if (!allowCopyPasteRef.current) {
        if ((event.ctrlKey || event.metaKey) && event.key === 'v') return false;
        if (event.shiftKey && event.key === 'Insert') return false;
      }
      return true;
    });

    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(terminalRef.current);

    const socket = io('/terminal', { path: '/api/socket.io', withCredentials: true });

    socket.on('connect', () => {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          fitAddon.fit();
          socket.emit('start-session', { machineId, cols: term.cols, rows: term.rows });
        }),
      );
    });

    socket.on('security-settings', (settings: { allowCopyPaste: boolean }) => {
      allowCopyPasteRef.current = settings.allowCopyPaste;
      onCopyPasteChangeRef.current(settings.allowCopyPaste);
      if (!settings.allowCopyPaste) {
        term.writeln(`\r\n\x1b[33m⚠️  ${t('terminal.clipboardDisabled')}\x1b[0m`);
      }
    });

    socket.on('output', (data: string) => {
      term.write(data);
      if (statusRef.current === 'connecting') updateStatus('connected');
    });

    socket.on('error', (err: string) => {
      setError(err);
      updateStatus('error');
    });

    socket.on('closed', () => updateStatus('closed'));

    term.onData((data) => socket.emit('input', data));
    term.onResize((size) => socket.emit('resize', size));

    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height ?? 0;
      if (h > 0) fitAddon.fit();
    });
    ro.observe(terminalRef.current);

    const blockEvent = (e: Event) => {
      if (!allowCopyPasteRef.current) {
        e.preventDefault();
        e.stopPropagation();
        term.writeln(`\r\n\x1b[31m${t('terminal.actionBlocked')}\x1b[0m`);
      }
    };
    const blockContextMenu = (e: MouseEvent) => {
      if (!allowCopyPasteRef.current) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    const container = terminalRef.current;
    container.addEventListener('paste', blockEvent, true);
    container.addEventListener('contextmenu', blockContextMenu, true);
    document.addEventListener('paste', blockEvent, true);

    return () => {
      ro.disconnect();
      socket.disconnect();
      term.dispose();
      container.removeEventListener('paste', blockEvent, true);
      container.removeEventListener('contextmenu', blockContextMenu, true);
      document.removeEventListener('paste', blockEvent, true);
    };
  }, [machineId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-fit when this pane becomes the active tab
  useEffect(() => {
    if (isActive && fitAddonRef.current) {
      requestAnimationFrame(() => fitAddonRef.current?.fit());
    }
  }, [isActive]);

  return (
    <div className="absolute inset-0">
      {/* Connecting overlay */}
      {status === 'connecting' && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-900/80 backdrop-blur-sm">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      )}

      {/* Error / closed overlay */}
      {(status === 'error' || status === 'closed') && (
        <div className="absolute inset-0 z-20 flex items-center justify-center backdrop-blur-md">
          <div className="bg-slate-800 border border-red-500/30 p-8 rounded-2xl max-w-md text-center space-y-4 shadow-2xl">
            <AlertCircle className="w-12 h-12 text-red-500 mx-auto" />
            <h2 className="text-xl font-bold text-white">
              {status === 'error' ? t('terminal.sessionError') : t('terminal.sessionClosed')}
            </h2>
            {error && (
              <p className="text-sm font-mono text-slate-400 bg-slate-900 px-3 py-2 rounded">{error}</p>
            )}
            <button
              onClick={() => onCloseRequestRef.current()}
              className="w-full py-2 bg-primary text-white rounded-lg font-bold hover:bg-primary/90 transition-colors"
            >
              {t('terminal.closeTab')}
            </button>
          </div>
        </div>
      )}

      <div ref={terminalRef} className="absolute inset-0" />
    </div>
  );
};

export default TerminalPane;
