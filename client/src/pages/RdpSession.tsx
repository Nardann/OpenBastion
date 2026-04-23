import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
import Guacamole from 'guacamole-common-js';
import {
  Monitor,
  Shield,
  ChevronLeft,
  Loader2,
  ClipboardX,
  AlertCircle,
} from 'lucide-react';

import { useAuth } from '../context/AuthContext';
import { SocketIoTunnel } from '../lib/guacSocketIoTunnel';

type Status = 'connecting' | 'connected' | 'error' | 'closed';

const RdpSession: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();

  const containerRef = useRef<HTMLDivElement>(null);
  const clientRef = useRef<Guacamole.Client | null>(null);
  const socketRef = useRef<Socket | null>(null);

  const [status, setStatus] = useState<Status>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [allowCopyPaste, setAllowCopyPaste] = useState(true);

  useEffect(() => {
    if (!id || !containerRef.current) return;

    const container = containerRef.current;

    // Compute initial display size. guacd clamps sensible bounds.
    const width = Math.max(640, Math.min(container.clientWidth, 2560));
    const height = Math.max(480, Math.min(container.clientHeight, 1440));

    // --- Socket.IO transport on the /rdp namespace ---------------------------
    const socket = io('/rdp', {
      path: '/api/socket.io',
      withCredentials: true,
      // Guacamole protocol frames are UTF-8 strings; binary disabled keeps
      // the same wire format as WebSocketTunnel would use.
      transports: ['websocket'],
    });
    socketRef.current = socket;

    // --- Guacamole pipeline --------------------------------------------------
    const tunnel = new SocketIoTunnel(socket, {
      machineId: id,
      width,
      height,
    });
    const client = new Guacamole.Client(tunnel);
    clientRef.current = client;

    const display = client.getDisplay();
    const displayElement = display.getElement();
    displayElement.style.margin = '0 auto';
    container.innerHTML = '';
    container.appendChild(displayElement);

    // --- Lifecycle callbacks -------------------------------------------------
    client.onstatechange = (state: number) => {
      // Guacamole.Client.State: 0=IDLE 1=CONNECTING 2=WAITING 3=CONNECTED 4=DISCONNECTING 5=DISCONNECTED
      if (state === 3) setStatus('connected');
      if (state === 5) setStatus('closed');
    };
    client.onerror = (guacError: Guacamole.Status) => {
      setError(guacError.message || 'RDP error');
      setStatus('error');
    };

    // Security flag from backend (clipboard policy)
    socket.on('security-settings', (s: { allowCopyPaste: boolean }) => {
      setAllowCopyPaste(s.allowCopyPaste);
    });

    // --- Input: mouse --------------------------------------------------------
    const mouse = new Guacamole.Mouse(displayElement);
    const handleMouseState = (state: Guacamole.Mouse.State) => {
      client.sendMouseState(state);
    };
    mouse.onmousedown = handleMouseState;
    mouse.onmouseup = handleMouseState;
    mouse.onmousemove = handleMouseState;

    // --- Input: keyboard -----------------------------------------------------
    const keyboard = new Guacamole.Keyboard(document);
    keyboard.onkeydown = (keysym: number) => {
      client.sendKeyEvent(1, keysym);
    };
    keyboard.onkeyup = (keysym: number) => {
      client.sendKeyEvent(0, keysym);
    };

    // --- Clipboard blocking (respects machine.allowCopyPaste) ----------------
    const blockClipboard = (e: ClipboardEvent) => {
      if (!allowCopyPaste) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener('paste', blockClipboard, true);
    document.addEventListener('copy', blockClipboard, true);
    document.addEventListener('cut', blockClipboard, true);

    // --- Resize on window resize --------------------------------------------
    const handleResize = () => {
      const w = Math.max(640, Math.min(container.clientWidth, 2560));
      const h = Math.max(480, Math.min(container.clientHeight, 1440));
      socket.emit('resize', { width: w, height: h });
    };
    window.addEventListener('resize', handleResize);

    // --- Start the tunnel ----------------------------------------------------
    client.connect('');

    return () => {
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('paste', blockClipboard, true);
      document.removeEventListener('copy', blockClipboard, true);
      document.removeEventListener('cut', blockClipboard, true);
      try {
        client.disconnect();
      } catch {
        /* noop */
      }
      socket.disconnect();
    };
  }, [id]);

  return (
    <div className="h-screen flex flex-col bg-[#0f172a] text-slate-300">
      <div className="h-12 border-b border-slate-800 px-4 flex items-center justify-between bg-slate-900/50">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/')}
            className="p-1 hover:bg-slate-800 rounded transition-colors"
            title="Retour"
          >
            <ChevronLeft size={20} />
          </button>
          <div className="flex items-center gap-2">
            <Monitor size={18} className="text-primary" />
            <span className="font-mono text-sm font-bold uppercase tracking-tight">
              Bastion Remote Desktop
            </span>
          </div>
          <div
            className={`w-2 h-2 rounded-full ${
              status === 'connected'
                ? 'bg-green-500 animate-pulse'
                : 'bg-orange-500'
            }`}
          />
        </div>

        <div className="flex items-center gap-4">
          {!allowCopyPaste && (
            <div className="flex items-center gap-2 px-3 py-1 bg-red-500/10 border border-red-500/20 rounded-full text-red-500 text-[10px] font-bold uppercase animate-pulse">
              <ClipboardX size={12} /> Mode Isolé
            </div>
          )}
          <div className="flex items-center gap-2 text-xs opacity-50">
            <Shield size={14} /> <span>{user?.email}</span>
          </div>
        </div>
      </div>

      <div className="flex-1 relative overflow-hidden bg-black">
        {status === 'connecting' && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-900/80 backdrop-blur-sm">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
          </div>
        )}
        {status === 'error' && (
          <div className="absolute inset-0 z-20 flex items-center justify-center backdrop-blur-md">
            <div className="bg-slate-800 border border-red-500/50 p-8 rounded-2xl max-w-md text-center space-y-4 shadow-2xl">
              <AlertCircle className="w-12 h-12 text-red-500 mx-auto" />
              <h2 className="text-xl font-bold">Échec de session RDP</h2>
              <p className="text-sm font-mono opacity-70">{error}</p>
              <button
                onClick={() => navigate('/')}
                className="w-full py-2 bg-primary text-white rounded-lg font-bold"
              >
                Quitter
              </button>
            </div>
          </div>
        )}
        <div
          ref={containerRef}
          className="h-full w-full flex items-center justify-center"
          tabIndex={0}
        />
      </div>
    </div>
  );
};

export default RdpSession;
