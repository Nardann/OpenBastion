import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LangContext';
import { Terminal as TerminalIcon, Shield, ChevronLeft, ClipboardX, Plus, X } from 'lucide-react';
import api from '../services/api';
import TerminalPane, { type SessionStatus } from '../components/TerminalPane';
import MachinePicker from '../components/MachinePicker';

// ── Layout types ──────────────────────────────────────────────────────────────

type Layout = 'single' | 'split-h' | 'split-v' | 'triple' | 'triple-v' | 'quad';

const LAYOUT_SLOTS: Record<Layout, number> = {
  single: 1, 'split-h': 2, 'split-v': 2, triple: 3, 'triple-v': 3, quad: 4,
};

const LAYOUT_KEYS: Record<Layout, string> = {
  single:     'terminal.layoutSingle',
  'split-h':  'terminal.layoutSplitH',
  'split-v':  'terminal.layoutSplitV',
  triple:     'terminal.layoutTriple',
  'triple-v': 'terminal.layoutTripleV',
  quad:       'terminal.layoutQuad',
};

// ── Split ratios (percentage positions of each divider) ───────────────────────

interface Splits {
  splitH:     number; // split-h  → col divider  (% from left)
  splitV:     number; // split-v  → row divider  (% from top)
  tripleMain: number; // triple   → col divider  (% from left)
  tripleRow:  number; // triple   → row divider on right side (% from top)
  tripleVLeft:  number; // triple-v → left col divider  (% from left)
  tripleVRight: number; // triple-v → right col divider (% from left)
  quadCol:    number; // quad     → col divider  (% from left)
  quadRow:    number; // quad     → row divider  (% from top)
}

const DEFAULT_SPLITS: Splits = {
  splitH: 50, splitV: 50,
  tripleMain: 62, tripleRow: 50,
  tripleVLeft: 33, tripleVRight: 66,
  quadCol: 50, quadRow: 50,
};

type SplitKey = keyof Splits;

// ── Absolute-positioned pane styles with dynamic splits ───────────────────────
//
//  All panes are always mounted (key = session.id, stable).
//  Position is driven purely by inline CSS — no CSS grid — so React never
//  unmounts a pane on layout/split change and sockets stay connected.
//  The 1 px divider is the parent #1e293b background peeking through the
//  0.5 px gap left on each shared edge.

function getPaneStyle(
  layout: Layout,
  slotIndex: number,
  isVisible: boolean,
  s: Splits,
): React.CSSProperties {
  const hidden: React.CSSProperties = {
    position: 'absolute', inset: 0, visibility: 'hidden', pointerEvents: 'none',
  };
  if (!isVisible) return hidden;

  const G = 0.5; // half-gap in px

  /* helpers ─────────────────────────────────────────────────────────────── */
  const colW   = (pct: number) => `calc(${pct}% - ${G}px)`;       // width of left col
  const colWR  = (pct: number) => `calc(${100 - pct}% - ${G}px)`; // width of right col
  const colS   = (pct: number) => `calc(${pct}% + ${G}px)`;       // left edge of right col
  const rowH   = (pct: number) => `calc(${pct}% - ${G}px)`;       // height of top row
  const rowHB  = (pct: number) => `calc(${100 - pct}% - ${G}px)`; // height of bottom row
  const rowS   = (pct: number) => `calc(${pct}% + ${G}px)`;       // top edge of bottom row

  switch (layout) {
    case 'single':
      return { position: 'absolute', inset: 0 };

    case 'split-h':
      return slotIndex === 0
        ? { position: 'absolute', top: 0, bottom: 0, left: 0, width: colW(s.splitH) }
        : { position: 'absolute', top: 0, bottom: 0, right: 0, width: colWR(s.splitH) };

    case 'split-v':
      return slotIndex === 0
        ? { position: 'absolute', left: 0, right: 0, top: 0, height: rowH(s.splitV) }
        : { position: 'absolute', left: 0, right: 0, bottom: 0, height: rowHB(s.splitV) };

    case 'triple':
      if (slotIndex === 0) return { position: 'absolute', top: 0, bottom: 0, left: 0, width: colW(s.tripleMain) };
      if (slotIndex === 1) return { position: 'absolute', top: 0, left: colS(s.tripleMain), right: 0, height: rowH(s.tripleRow) };
      return                      { position: 'absolute', bottom: 0, left: colS(s.tripleMain), right: 0, height: rowHB(s.tripleRow) };

    case 'triple-v':
      if (slotIndex === 0)
        return { position: 'absolute', top: 0, bottom: 0, left: 0, width: colW(s.tripleVLeft) };
      if (slotIndex === 1)
        return { position: 'absolute', top: 0, bottom: 0, left: colS(s.tripleVLeft), right: `calc(${100 - s.tripleVRight}% + ${G}px)` };
      return   { position: 'absolute', top: 0, bottom: 0, right: 0, width: colWR(s.tripleVRight) };

    case 'quad': {
      const c = slotIndex % 2, r = Math.floor(slotIndex / 2);
      return {
        position: 'absolute',
        ...(c === 0 ? { left: 0, width: colW(s.quadCol) } : { left: colS(s.quadCol), right: 0 }),
        ...(r === 0 ? { top: 0, height: rowH(s.quadRow) } : { top: rowS(s.quadRow), bottom: 0 }),
      };
    }
  }
}

// ── Resizer / drag-handle component ──────────────────────────────────────────

interface ResizerProps {
  /** 'col' = vertical divider line, dragged left-right.
   *  'row' = horizontal divider line, dragged up-down.       */
  axis: 'col' | 'row';
  /** Position of the centre of the drag handle (percentage). */
  position: number;
  /** For a partial-width row resizer (triple layout): constrain left edge. */
  leftEdge?: string;
  /** Fires when the user starts dragging. */
  onDragStart: (e: React.MouseEvent) => void;
  /** Keeps handle highlighted while a drag is in progress. */
  active: boolean;
}

const Resizer: React.FC<ResizerProps> = ({ axis, position, leftEdge, onDragStart, active }) => {
  const [hover, setHover] = useState(false);
  const lit = hover || active;

  const wrapStyle: React.CSSProperties =
    axis === 'col'
      ? {
          position: 'absolute',
          top: 0, bottom: 0,
          left: `calc(${position}% - 4px)`,
          width: '8px',
          cursor: 'col-resize',
          zIndex: 60,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }
      : {
          position: 'absolute',
          left: leftEdge ?? '0', right: '0',
          top: `calc(${position}% - 4px)`,
          height: '8px',
          cursor: 'row-resize',
          zIndex: 60,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        };

  const knobStyle: React.CSSProperties =
    axis === 'col'
      ? {
          width: '2px', height: '36px', borderRadius: '1px',
          backgroundColor: lit ? 'rgba(99,102,241,0.75)' : 'transparent',
          boxShadow: lit ? '0 0 6px rgba(99,102,241,0.35)' : 'none',
          transition: 'background-color 0.12s, box-shadow 0.12s',
        }
      : {
          height: '2px', width: '36px', borderRadius: '1px',
          backgroundColor: lit ? 'rgba(99,102,241,0.75)' : 'transparent',
          boxShadow: lit ? '0 0 6px rgba(99,102,241,0.35)' : 'none',
          transition: 'background-color 0.12s, box-shadow 0.12s',
        };

  return (
    <div
      style={wrapStyle}
      onMouseDown={onDragStart}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div style={knobStyle} />
    </div>
  );
};

// ── Layout icons (inline SVG) ─────────────────────────────────────────────────

const LayoutIcon = ({ id, size = 16 }: { id: Layout; size?: number }) => {
  const w = size, h = Math.round(size * 0.75);
  switch (id) {
    case 'single':
      return <svg width={w} height={h} viewBox="0 0 16 12" fill="currentColor"><rect x="0" y="0" width="16" height="12" rx="1.5" /></svg>;
    case 'split-h':
      return <svg width={w} height={h} viewBox="0 0 16 12" fill="currentColor"><rect x="0" y="0" width="7" height="12" rx="1.5" /><rect x="9" y="0" width="7" height="12" rx="1.5" /></svg>;
    case 'split-v':
      return <svg width={w} height={h} viewBox="0 0 16 12" fill="currentColor"><rect x="0" y="0" width="16" height="5" rx="1.5" /><rect x="0" y="7" width="16" height="5" rx="1.5" /></svg>;
    case 'triple':
      return <svg width={w} height={h} viewBox="0 0 16 12" fill="currentColor"><rect x="0" y="0" width="9" height="12" rx="1.5" /><rect x="11" y="0" width="5" height="5" rx="1" /><rect x="11" y="7" width="5" height="5" rx="1" /></svg>;
    case 'triple-v':
      return <svg width={w} height={h} viewBox="0 0 16 12" fill="currentColor"><rect x="0" y="0" width="4" height="12" rx="1" /><rect x="6" y="0" width="4" height="12" rx="1" /><rect x="12" y="0" width="4" height="12" rx="1" /></svg>;
    case 'quad':
      return <svg width={w} height={h} viewBox="0 0 16 12" fill="currentColor"><rect x="0" y="0" width="7" height="5" rx="1" /><rect x="9" y="0" width="7" height="5" rx="1" /><rect x="0" y="7" width="7" height="5" rx="1" /><rect x="9" y="7" width="7" height="5" rx="1" /></svg>;
  }
};

// ── Session type ──────────────────────────────────────────────────────────────

interface Session {
  id: string;
  machineId: string;
  machineName: string;
  status: SessionStatus;
  allowCopyPaste: boolean;
}

// ── Terminal component ────────────────────────────────────────────────────────

const Terminal: React.FC = () => {
  const { id: initialMachineId } = useParams<{ id: string }>();
  const location = useLocation();
  const { user } = useAuth();
  const { t } = useLang();
  const navigate = useNavigate();

  const [sessions, setSessions]         = useState<Session[]>([]);
  const [focusedId, setFocusedId]       = useState<string>('');
  const [layout, setLayout]             = useState<Layout>('single');
  const [splits, setSplits]             = useState<Splits>(DEFAULT_SPLITS);
  const [showPicker, setShowPicker]     = useState(false);
  const [showLayoutMenu, setShowLayoutMenu] = useState(false);
  /** 'col' | 'row' while a drag is active, null otherwise. */
  const [dragging, setDragging]         = useState<'col' | 'row' | null>(null);

  const layoutMenuRef = useRef<HTMLDivElement>(null);
  const paneAreaRef   = useRef<HTMLDivElement>(null);

  /* ── Close layout menu on outside click ─────────────────────────────────── */
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (layoutMenuRef.current && !layoutMenuRef.current.contains(e.target as Node))
        setShowLayoutMenu(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  /* ── Bootstrap first session from route param ───────────────────────────── */
  useEffect(() => {
    if (!initialMachineId) return;
    const machineName = (location.state as { machineName?: string } | null)?.machineName;
    const tabId = crypto.randomUUID();
    setSessions([{
      id: tabId, machineId: initialMachineId,
      machineName: machineName ?? `${initialMachineId.slice(0, 8)}…`,
      status: 'connecting', allowCopyPaste: true,
    }]);
    setFocusedId(tabId);
    if (!machineName) {
      api.get<{ name: string }>(`/machines/${initialMachineId}`)
        .then(res => setSessions(prev =>
          prev.map(s => s.id === tabId ? { ...s, machineName: res.data.name } : s)))
        .catch(() => {});
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Drag-to-resize logic ────────────────────────────────────────────────── */
  const startDrag = (key: SplitKey, axis: 'col' | 'row', minPct = 12, maxPct = 88) =>
    (e: React.MouseEvent) => {
      e.preventDefault();
      setDragging(axis);

      const rect = paneAreaRef.current?.getBoundingClientRect();
      if (!rect) return;

      const containerSize = axis === 'col' ? rect.width : rect.height;
      const startMouse    = axis === 'col' ? e.clientX : e.clientY;
      const startRatio    = splits[key];

      const onMove = (ev: MouseEvent) => {
        const current = axis === 'col' ? ev.clientX : ev.clientY;
        const deltaPct = ((current - startMouse) / containerSize) * 100;
        setSplits(prev => ({ ...prev, [key]: Math.min(maxPct, Math.max(minPct, startRatio + deltaPct)) }));
      };

      const onUp = () => {
        setDragging(null);
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    };

  /* ── Session helpers ─────────────────────────────────────────────────────── */
  const addSession = (machine: { id: string; name: string }) => {
    const tabId = crypto.randomUUID();
    setSessions(prev => [...prev, {
      id: tabId, machineId: machine.id, machineName: machine.name,
      status: 'connecting', allowCopyPaste: true,
    }]);
    setFocusedId(tabId);
    setShowPicker(false);
  };

  const closeSession = (sessionId: string) => {
    const remaining = sessions.filter(s => s.id !== sessionId);
    if (remaining.length === 0) { navigate('/'); return; }
    if (focusedId === sessionId) {
      const idx = sessions.findIndex(s => s.id === sessionId);
      setFocusedId(remaining[Math.max(0, Math.min(idx, remaining.length - 1))].id);
    }
    setSessions(remaining);
  };

  const selectTab = (sessionId: string) => {
    setFocusedId(sessionId);
    if (layout !== 'single') {
      const N = LAYOUT_SLOTS[layout];
      const idx = sessions.findIndex(s => s.id === sessionId);
      if (idx >= N) {
        setSessions(prev => {
          const next = [...prev];
          [next[0], next[idx]] = [next[idx], next[0]];
          return next;
        });
      }
    }
  };

  const changeLayout = (newLayout: Layout) => {
    const N = LAYOUT_SLOTS[newLayout];
    const idx = sessions.findIndex(s => s.id === focusedId);
    if (newLayout !== 'single' && idx >= N) {
      setSessions(prev => {
        const next = [...prev];
        [next[0], next[idx]] = [next[idx], next[0]];
        return next;
      });
    }
    setLayout(newLayout);
    setShowLayoutMenu(false);
  };

  const updateStatus    = (id: string, s: SessionStatus) =>
    setSessions(prev => prev.map(x => x.id === id ? { ...x, status: s }          : x));
  const updateCopyPaste = (id: string, a: boolean)       =>
    setSessions(prev => prev.map(x => x.id === id ? { ...x, allowCopyPaste: a }  : x));

  const focusedSession = sessions.find(s => s.id === focusedId);
  const N = LAYOUT_SLOTS[layout];

  /* ── Render ──────────────────────────────────────────────────────────────── */
  return (
    <div className="h-screen flex flex-col bg-[#0f172a] text-slate-300 overflow-hidden">

      {/* ── Tab / nav bar ────────────────────────────────────────────────── */}
      <div className="h-11 flex items-stretch border-b border-slate-800 bg-slate-950 shrink-0">

        <button onClick={() => navigate('/')} title={t('nav.backToPortal')}
          className="px-3 flex items-center border-r border-slate-800 text-slate-500 hover:text-white hover:bg-slate-800/60 transition-colors shrink-0">
          <ChevronLeft size={16} />
        </button>

        <div className="px-4 flex items-center gap-2 border-r border-slate-800 shrink-0">
          <TerminalIcon size={13} className="text-primary" />
          <span className="font-mono text-[11px] font-bold uppercase tracking-widest text-primary">Bastion</span>
        </div>

        {/* Session tabs */}
        <div className="flex items-stretch flex-1 overflow-x-auto">
          {sessions.map(session => {
            const isActive = session.id === focusedId;
            return (
              <button key={session.id} onClick={() => selectTab(session.id)}
                className={`relative h-full flex items-center gap-2 px-4 text-xs font-mono border-r border-slate-800 shrink-0 max-w-[200px] min-w-0 group transition-colors ${
                  isActive ? 'bg-[#0f172a] text-slate-200' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/50'
                }`}>
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  session.status === 'connected'  ? 'bg-green-500' :
                  session.status === 'connecting' ? 'bg-amber-400 animate-pulse' :
                  session.status === 'error'      ? 'bg-red-500' : 'bg-slate-600'
                }`} />
                <span className="truncate flex-1 text-left">{session.machineName}</span>
                <button
                  type="button"
                  aria-label={t('terminal.closeTab')}
                  onClick={e => { e.stopPropagation(); closeSession(session.id); }}
                  className="shrink-0 opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:text-white p-1 rounded transition-all focus-visible:opacity-100 focus-visible:outline focus-visible:outline-1 focus-visible:outline-slate-500">
                  <X size={11} />
                </button>
                {isActive && <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-primary" />}
              </button>
            );
          })}
        </div>

        {/* Add session */}
        <button onClick={() => setShowPicker(true)} title={t('terminal.newSession')}
          className="px-4 flex items-center border-l border-slate-800 text-slate-500 hover:text-white hover:bg-slate-800/60 transition-colors shrink-0">
          <Plus size={15} />
        </button>

        {/* Layout switcher */}
        <div ref={layoutMenuRef} className="relative border-l border-slate-800 shrink-0">
          <button onClick={() => setShowLayoutMenu(v => !v)} title={t('terminal.layout')}
            className={`h-full px-3 flex items-center transition-colors ${
              showLayoutMenu ? 'text-primary bg-slate-800/60' : 'text-slate-500 hover:text-white hover:bg-slate-800/60'
            }`}>
            <LayoutIcon id={layout} size={16} />
          </button>

          {showLayoutMenu && (
            <div className="absolute top-full right-0 mt-1 bg-slate-900 border border-slate-700/80 rounded-xl p-2 shadow-2xl z-50 min-w-[176px]">
              <p className="text-[10px] text-slate-600 uppercase tracking-widest font-bold mb-1.5 px-2">{t('terminal.layout')}</p>
              {(['single', 'split-h', 'split-v', 'triple', 'triple-v', 'quad'] as Layout[]).map(id => (
                <button key={id} onClick={() => changeLayout(id)}
                  className={`w-full flex items-center gap-3 px-2.5 py-2 rounded-lg text-xs transition-colors ${
                    layout === id ? 'bg-primary/15 text-primary' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                  }`}>
                  <LayoutIcon id={id} size={18} />
                  <span className="font-medium">{t(LAYOUT_KEYS[id])}</span>
                  {layout === id && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-primary" />}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right: isolated-mode badge + user */}
        <div className="flex items-center gap-3 px-4 border-l border-slate-800 shrink-0">
          {focusedSession && !focusedSession.allowCopyPaste && (
            <div className="flex items-center gap-1.5 px-2 py-0.5 bg-red-500/10 border border-red-500/20 rounded-full text-red-400 text-[10px] font-bold uppercase animate-pulse">
              <ClipboardX size={10} /> {t('terminal.isolatedMode')}
            </div>
          )}
          <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
            <Shield size={12} />
            <span className="hidden lg:inline max-w-[160px] truncate">{user?.email}</span>
          </div>
        </div>
      </div>

      {/* ── Pane area ────────────────────────────────────────────────────── */}
      <div
        ref={paneAreaRef}
        className="flex-1 relative overflow-hidden"
        style={{ backgroundColor: '#1e293b' }}
      >
        {/* Terminal panes — always mounted, position driven by CSS */}
        {sessions.map((session, i) => {
          const isVisible = layout === 'single' ? session.id === focusedId : i < N;
          const isFocused = session.id === focusedId;
          return (
            <div
              key={session.id}
              style={{
                ...getPaneStyle(layout, i, isVisible, splits),
                // Disable pointer events on panes while dragging so the mouse
                // doesn't get captured by the terminal canvas.
                ...(dragging ? { pointerEvents: 'none' } : {}),
              }}
              onClick={() => layout !== 'single' && setFocusedId(session.id)}
              className={layout !== 'single' && isVisible && isFocused && N > 1
                ? 'ring-1 ring-inset ring-primary/30' : ''}
            >
              <TerminalPane
                machineId={session.machineId}
                isActive={isVisible}
                onStatusChange={s => updateStatus(session.id, s)}
                onCopyPasteChange={a => updateCopyPaste(session.id, a)}
                onCloseRequest={() => closeSession(session.id)}
              />
            </div>
          );
        })}

        {/* Empty slot placeholders */}
        {layout !== 'single' && Array.from(
          { length: Math.max(0, N - sessions.length) },
          (_, i) => {
            const slotIndex = sessions.length + i;
            return (
              <div key={`empty-${slotIndex}`}
                style={getPaneStyle(layout, slotIndex, true, splits)}
                className="flex flex-col items-center justify-center gap-3 bg-[#080e1a] cursor-default">
                <button onClick={() => setShowPicker(true)}
                  className="flex flex-col items-center gap-2.5 text-slate-700 hover:text-slate-500 transition-colors group">
                  <div className="w-12 h-12 rounded-2xl border border-slate-800 flex items-center justify-center group-hover:border-slate-600 transition-colors">
                    <Plus size={20} />
                  </div>
                  <span className="text-[11px] font-mono">{t('terminal.newSession')}</span>
                </button>
              </div>
            );
          },
        )}

        {/* ── Resizers ─────────────────────────────────────────────────── */}
        {layout === 'split-h' && (
          <Resizer axis="col" position={splits.splitH} active={dragging === 'col'}
            onDragStart={startDrag('splitH', 'col')} />
        )}

        {layout === 'split-v' && (
          <Resizer axis="row" position={splits.splitV} active={dragging === 'row'}
            onDragStart={startDrag('splitV', 'row')} />
        )}

        {layout === 'triple' && (<>
          {/* Vertical divider between main and right side */}
          <Resizer axis="col" position={splits.tripleMain} active={dragging === 'col'}
            onDragStart={startDrag('tripleMain', 'col')} />
          {/* Horizontal divider within the right side only */}
          <Resizer axis="row" position={splits.tripleRow} active={dragging === 'row'}
            leftEdge={`calc(${splits.tripleMain}% + 0.5px)`}
            onDragStart={startDrag('tripleRow', 'row')} />
        </>)}

        {layout === 'triple-v' && (<>
          {/* Left vertical divider */}
          <Resizer axis="col" position={splits.tripleVLeft} active={dragging === 'col'}
            onDragStart={startDrag('tripleVLeft', 'col', 10, splits.tripleVRight - 10)} />
          {/* Right vertical divider */}
          <Resizer axis="col" position={splits.tripleVRight} active={dragging === 'col'}
            onDragStart={startDrag('tripleVRight', 'col', splits.tripleVLeft + 10, 90)} />
        </>)}

        {layout === 'quad' && (<>
          <Resizer axis="col" position={splits.quadCol} active={dragging === 'col'}
            onDragStart={startDrag('quadCol', 'col')} />
          <Resizer axis="row" position={splits.quadRow} active={dragging === 'row'}
            onDragStart={startDrag('quadRow', 'row')} />
        </>)}

        {/*
          Drag-capture overlay: sits on top of all panes while dragging so the
          terminal canvas never steals the mousemove/mouseup events, and the
          cursor stays consistent across the whole screen.
        */}
        {dragging && (
          <div
            className="absolute inset-0 z-[200]"
            style={{ cursor: dragging === 'col' ? 'col-resize' : 'row-resize' }}
          />
        )}
      </div>

      {/* Machine picker modal */}
      {showPicker && (
        <MachinePicker onSelect={addSession} onClose={() => setShowPicker(false)} />
      )}
    </div>
  );
};

export default Terminal;
