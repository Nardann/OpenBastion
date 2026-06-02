import React, { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import Guacamole from 'guacamole-common-js';
import { Loader2, AlertCircle } from 'lucide-react';
import { SocketIoTunnel } from '../lib/guacSocketIoTunnel';
import { useLang } from '../context/LangContext';
import type { SessionStatus } from './TerminalPane';

interface Props {
  machineId: string;
  isActive: boolean;
  onStatusChange: (s: SessionStatus) => void;
  onCopyPasteChange: (allowed: boolean) => void;
  onCloseRequest: () => void;
}

const RdpPane: React.FC<Props> = ({
  machineId,
  isActive,
  onStatusChange,
  onCopyPasteChange,
}) => {
  const { t } = useLang();
  const containerRef = useRef<HTMLDivElement>(null);
  const clientRef    = useRef<Guacamole.Client | null>(null);
  const socketRef    = useRef<Socket | null>(null);
  const statusRef    = useRef<SessionStatus>('connecting');

  const setStatus = (s: SessionStatus) => {
    statusRef.current = s;
    onStatusChange(s);
  };

  useEffect(() => {
    if (!machineId || !containerRef.current) return;

    const container = containerRef.current;

    const roundDown4 = (n: number) => Math.floor(n / 4) * 4;
    const width  = roundDown4(Math.max(640, Math.min(container.clientWidth  || 1280, 2560)));
    const height = roundDown4(Math.max(480, Math.min(container.clientHeight || 800,  1440)));

    const socket = io('/rdp', {
      path: '/api/socket.io',
      withCredentials: true,
      transports: ['websocket'],
    });
    socketRef.current = socket;

    const tunnel = new SocketIoTunnel(socket, { machineId, width, height });
    const client = new Guacamole.Client(tunnel);
    clientRef.current = client;

    const display = client.getDisplay();
    const displayElement = display.getElement();
    displayElement.style.position = 'absolute';
    displayElement.style.top  = '0';
    displayElement.style.left = '0';
    container.style.cursor = 'none';
    container.innerHTML = '';
    container.appendChild(displayElement);
    (display as unknown as { scale: (s: number) => void }).scale(1);

    client.onstatechange = (state: number) => {
      if (state === 3) setStatus('connected');
      if (state === 5) setStatus('closed');
    };
    client.onerror = () => setStatus('error');

    socket.on('security-settings', (s: { allowCopyPaste: boolean }) => {
      onCopyPasteChange(s.allowCopyPaste);
    });

    const mouse    = new Guacamole.Mouse(displayElement);
    const handleMouse = (state: Guacamole.Mouse.State) => client.sendMouseState(state);
    mouse.onmousedown = handleMouse;
    mouse.onmouseup   = handleMouse;
    mouse.onmousemove = handleMouse;

    const keyboard = new Guacamole.Keyboard(document);
    keyboard.onkeydown = (k: number) => client.sendKeyEvent(1, k);
    keyboard.onkeyup   = (k: number) => client.sendKeyEvent(0, k);

    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const handleResize = () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const w = roundDown4(Math.max(640, Math.min(container.clientWidth,  2560)));
        const h = roundDown4(Math.max(480, Math.min(container.clientHeight, 1440)));
        socket.emit('resize', { width: w, height: h });
      }, 80);
    };
    const ro = new ResizeObserver(handleResize);
    ro.observe(container);
    window.addEventListener('resize', handleResize);

    client.connect('');

    return () => {
      ro.disconnect();
      window.removeEventListener('resize', handleResize);
      if (resizeTimer) clearTimeout(resizeTimer);
      try { client.disconnect(); } catch { /* noop */ }
      socket.disconnect();
    };
  }, [machineId]); // eslint-disable-line react-hooks/exhaustive-deps

  const status = statusRef.current;

  return (
    <div className="relative w-full h-full bg-black overflow-hidden">
      {status === 'connecting' && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-900/80 backdrop-blur-sm">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      )}
      {status === 'error' && (
        <div className="absolute inset-0 z-20 flex items-center justify-center backdrop-blur-md">
          <div className="bg-slate-800 border border-red-500/50 p-8 rounded-2xl max-w-md text-center space-y-4 shadow-2xl">
            <AlertCircle className="w-12 h-12 text-red-500 mx-auto" />
            <h2 className="text-xl font-bold text-white">{t('rdp.sessionError')}</h2>
          </div>
        </div>
      )}
      <div ref={containerRef} className="absolute inset-0" tabIndex={isActive ? 0 : -1} />
    </div>
  );
};

export default RdpPane;
