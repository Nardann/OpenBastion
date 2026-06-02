import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate, useLocation, useMatch } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LangContext';
import {
  Terminal as TerminalIcon, Shield, ChevronLeft, ClipboardX,
  Plus, X, Monitor, WifiOff,
} from 'lucide-react';
import api from '../services/api';
import TerminalPane, { type SessionStatus } from '../components/TerminalPane';
import RdpPane from '../components/RdpPane';
import MachinePicker from '../components/MachinePicker';

// ── Layout ────────────────────────────────────────────────────────────────────

type Layout = 'single' | 'split-h' | 'split-v' | 'triple' | 'triple-v' | 'quad';

const LAYOUT_SLOTS: Record<Layout, number> = {
  single: 1, 'split-h': 2, 'split-v': 2, triple: 3, 'triple-v': 3, quad: 4,
};
const LAYOUT_KEYS: Record<Layout, string> = {
  single: 'terminal.layoutSingle', 'split-h': 'terminal.layoutSplitH',
  'split-v': 'terminal.layoutSplitV', triple: 'terminal.layoutTriple',
  'triple-v': 'terminal.layoutTripleV', quad: 'terminal.layoutQuad',
};

interface Splits {
  splitH: number; splitV: number;
  tripleMain: number; tripleRow: number;
  tripleVLeft: number; tripleVRight: number;
  quadCol: number; quadRow: number;
}
const DEFAULT_SPLITS: Splits = {
  splitH: 50, splitV: 50, tripleMain: 62, tripleRow: 50,
  tripleVLeft: 33, tripleVRight: 66, quadCol: 50, quadRow: 50,
};
type SplitKey = keyof Splits;

// ── Data model ────────────────────────────────────────────────────────────────

interface Session {
  id: string; machineId: string; machineName: string;
  protocol: 'ssh' | 'rdp'; status: SessionStatus; allowCopyPaste: boolean;
}
interface Group {
  id: string; layout: Layout; splits: Splits;
  sessions: Session[]; focusedSessionId: string;
}

const makeSession = (machineId: string, machineName: string, protocol: 'ssh' | 'rdp'): Session => ({
  id: crypto.randomUUID(), machineId, machineName, protocol,
  status: 'connecting', allowCopyPaste: true,
});
const makeGroup = (session?: Session): Group => ({
  id: crypto.randomUUID(), layout: 'single', splits: { ...DEFAULT_SPLITS },
  sessions: session ? [session] : [], focusedSessionId: session?.id ?? '',
});

// ── Pane positioning ──────────────────────────────────────────────────────────

function getPaneStyle(layout: Layout, i: number, visible: boolean, s: Splits): React.CSSProperties {
  const hidden: React.CSSProperties = { position: 'absolute', inset: 0, visibility: 'hidden', pointerEvents: 'none' };
  if (!visible) return hidden;
  const G = 0.5;
  const cW  = (p: number) => `calc(${p}% - ${G}px)`;
  const cWR = (p: number) => `calc(${100 - p}% - ${G}px)`;
  const cS  = (p: number) => `calc(${p}% + ${G}px)`;
  const rH  = (p: number) => `calc(${p}% - ${G}px)`;
  const rHB = (p: number) => `calc(${100 - p}% - ${G}px)`;
  const rS  = (p: number) => `calc(${p}% + ${G}px)`;
  switch (layout) {
    case 'single':   return { position: 'absolute', inset: 0 };
    case 'split-h':  return i === 0
      ? { position: 'absolute', top: 0, bottom: 0, left: 0, width: cW(s.splitH) }
      : { position: 'absolute', top: 0, bottom: 0, right: 0, width: cWR(s.splitH) };
    case 'split-v':  return i === 0
      ? { position: 'absolute', left: 0, right: 0, top: 0, height: rH(s.splitV) }
      : { position: 'absolute', left: 0, right: 0, bottom: 0, height: rHB(s.splitV) };
    case 'triple':
      if (i === 0) return { position: 'absolute', top: 0, bottom: 0, left: 0, width: cW(s.tripleMain) };
      if (i === 1) return { position: 'absolute', top: 0, left: cS(s.tripleMain), right: 0, height: rH(s.tripleRow) };
      return              { position: 'absolute', bottom: 0, left: cS(s.tripleMain), right: 0, height: rHB(s.tripleRow) };
    case 'triple-v':
      if (i === 0) return { position: 'absolute', top: 0, bottom: 0, left: 0, width: cW(s.tripleVLeft) };
      if (i === 1) return { position: 'absolute', top: 0, bottom: 0, left: cS(s.tripleVLeft), right: `calc(${100 - s.tripleVRight}% + ${G}px)` };
      return              { position: 'absolute', top: 0, bottom: 0, right: 0, width: cWR(s.tripleVRight) };
    case 'quad': {
      const c = i % 2, r = Math.floor(i / 2);
      return {
        position: 'absolute',
        ...(c === 0 ? { left: 0, width: cW(s.quadCol) } : { left: cS(s.quadCol), right: 0 }),
        ...(r === 0 ? { top: 0, height: rH(s.quadRow) } : { top: rS(s.quadRow), bottom: 0 }),
      };
    }
  }
}

// ── Resizer ───────────────────────────────────────────────────────────────────

const Resizer: React.FC<{
  axis: 'col' | 'row'; position: number; leftEdge?: string;
  onDragStart: (e: React.MouseEvent) => void; active: boolean;
}> = ({ axis, position, leftEdge, onDragStart, active }) => {
  const [hover, setHover] = useState(false);
  const lit = hover || active;
  const w: React.CSSProperties = axis === 'col'
    ? { position: 'absolute', top: 0, bottom: 0, left: `calc(${position}% - 4px)`, width: '8px', cursor: 'col-resize', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center' }
    : { position: 'absolute', left: leftEdge ?? '0', right: '0', top: `calc(${position}% - 4px)`, height: '8px', cursor: 'row-resize', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center' };
  const k: React.CSSProperties = axis === 'col'
    ? { width: '2px', height: '36px', borderRadius: '1px', backgroundColor: lit ? 'rgba(99,102,241,0.75)' : 'transparent', boxShadow: lit ? '0 0 6px rgba(99,102,241,0.35)' : 'none', transition: 'background-color 0.12s, box-shadow 0.12s' }
    : { height: '2px', width: '36px', borderRadius: '1px', backgroundColor: lit ? 'rgba(99,102,241,0.75)' : 'transparent', boxShadow: lit ? '0 0 6px rgba(99,102,241,0.35)' : 'none', transition: 'background-color 0.12s, box-shadow 0.12s' };
  return (
    <div style={w} onMouseDown={onDragStart} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div style={k} />
    </div>
  );
};

// ── Layout icon ───────────────────────────────────────────────────────────────

const LayoutIcon = ({ id, size = 16 }: { id: Layout; size?: number }) => {
  const w = size, h = Math.round(size * 0.75);
  switch (id) {
    case 'single':   return <svg width={w} height={h} viewBox="0 0 16 12" fill="currentColor"><rect x="0" y="0" width="16" height="12" rx="1.5" /></svg>;
    case 'split-h':  return <svg width={w} height={h} viewBox="0 0 16 12" fill="currentColor"><rect x="0" y="0" width="7" height="12" rx="1.5" /><rect x="9" y="0" width="7" height="12" rx="1.5" /></svg>;
    case 'split-v':  return <svg width={w} height={h} viewBox="0 0 16 12" fill="currentColor"><rect x="0" y="0" width="16" height="5" rx="1.5" /><rect x="0" y="7" width="16" height="5" rx="1.5" /></svg>;
    case 'triple':   return <svg width={w} height={h} viewBox="0 0 16 12" fill="currentColor"><rect x="0" y="0" width="9" height="12" rx="1.5" /><rect x="11" y="0" width="5" height="5" rx="1" /><rect x="11" y="7" width="5" height="5" rx="1" /></svg>;
    case 'triple-v': return <svg width={w} height={h} viewBox="0 0 16 12" fill="currentColor"><rect x="0" y="0" width="4" height="12" rx="1" /><rect x="6" y="0" width="4" height="12" rx="1" /><rect x="12" y="0" width="4" height="12" rx="1" /></svg>;
    case 'quad':     return <svg width={w} height={h} viewBox="0 0 16 12" fill="currentColor"><rect x="0" y="0" width="7" height="5" rx="1" /><rect x="9" y="0" width="7" height="5" rx="1" /><rect x="0" y="7" width="7" height="5" rx="1" /><rect x="9" y="7" width="7" height="5" rx="1" /></svg>;
  }
};

// ── Drag ghost ────────────────────────────────────────────────────────────────

const Ghost: React.FC<{ x: number; y: number; label: string; protocol: 'ssh' | 'rdp' }> = ({ x, y, label, protocol }) => (
  <div
    className="fixed z-[9999] pointer-events-none select-none"
    style={{ left: x + 14, top: y - 14, transform: 'rotate(2deg)' }}
  >
    <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-800 border border-primary/40 rounded-lg shadow-xl text-xs font-mono text-slate-200 max-w-[180px]">
      {protocol === 'rdp'
        ? <Monitor size={10} className="text-blue-400 shrink-0" />
        : <TerminalIcon size={10} className="text-slate-400 shrink-0" />
      }
      <span className="truncate">{label}</span>
    </div>
  </div>
);

// ── Main component ────────────────────────────────────────────────────────────

const SessionPage: React.FC = () => {
  const { id: initialMachineId } = useParams<{ id: string }>();
  const location   = useLocation();
  const isRdpRoute = !!useMatch('/rdp/:id');
  const { user }   = useAuth();
  const { t }      = useLang();
  const navigate   = useNavigate();

  const [groups, setGroups]           = useState<Group[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<string>('');
  const [showPicker, setShowPicker]   = useState(false);
  const [layoutMenuGroupId, setLayoutMenuGroupId] = useState<string | null>(null);
  const [paneDragging, setPaneDragging] = useState<'col' | 'row' | null>(null);

  // ── Drag-and-drop state ──────────────────────────────────────────────────
  const [drag, setDrag] = useState<{
    sessionId: string; fromGroupId: string;
    x: number; y: number;
    label: string; protocol: 'ssh' | 'rdp';
  } | null>(null);
  const [mergeTargetId, setMergeTargetId]   = useState<string | null>(null); // cross-group merge target
  const [reorderTargetId, setReorderTargetId] = useState<string | null>(null); // same-group reorder target
  const [dropZoneActive, setDropZoneActive] = useState<number | null>(null);

  const mergeTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reorderTargetRef = useRef<string | null>(null);
  const dragRef          = useRef(drag);
  const layoutMenuRef  = useRef<HTMLDivElement>(null);
  const paneAreaRef    = useRef<HTMLDivElement>(null);

  useEffect(() => { dragRef.current = drag; }, [drag]);

  // ── Init ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!initialMachineId) return;
    const state = location.state as { machineName?: string; protocol?: string } | null;
    const machineName = state?.machineName ?? `${initialMachineId.slice(0, 8)}…`;
    const protocol: 'ssh' | 'rdp' =
      isRdpRoute || state?.protocol?.toUpperCase() === 'RDP' ? 'rdp' : 'ssh';
    const session = makeSession(initialMachineId, machineName, protocol);
    const group   = makeGroup(session);
    setGroups([group]);
    setActiveGroupId(group.id);
    if (!state?.machineName) {
      api.get<{ name: string }>(`/machines/${initialMachineId}`)
        .then(res => updateSessionField(group.id, session.id, 'machineName', res.data.name))
        .catch(() => {});
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Close layout menu on outside click
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (layoutMenuRef.current && !layoutMenuRef.current.contains(e.target as Node))
        setLayoutMenuGroupId(null);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  // ── Generic updaters ─────────────────────────────────────────────────────
  const updateGroup = useCallback((groupId: string, patch: Partial<Group>) =>
    setGroups(prev => prev.map(g => g.id === groupId ? { ...g, ...patch } : g)), []);

  const updateSessionField = useCallback(<K extends keyof Session>(
    groupId: string, sessionId: string, key: K, value: Session[K],
  ) => setGroups(prev => prev.map(g =>
    g.id !== groupId ? g : { ...g, sessions: g.sessions.map(s => s.id === sessionId ? { ...s, [key]: value } : s) },
  )), []);

  // ── Session/group CRUD ───────────────────────────────────────────────────
  const addSession = (machine: { id: string; name: string; protocol: string }) => {
    const protocol: 'ssh' | 'rdp' = machine.protocol.toUpperCase() === 'RDP' ? 'rdp' : 'ssh';
    const session = makeSession(machine.id, machine.name, protocol);
    setGroups(prev => prev.map(g => {
      if (g.id !== activeGroupId) return g;
      const sessions = [...g.sessions, session];
      const N = LAYOUT_SLOTS[g.layout];
      const upgrades: Layout[] = ['single', 'split-h', 'split-v', 'triple', 'triple-v', 'quad'];
      const layout = sessions.length > N
        ? (upgrades.find(l => LAYOUT_SLOTS[l] >= sessions.length) ?? 'quad')
        : g.layout;
      return { ...g, sessions, focusedSessionId: session.id, layout };
    }));
    setShowPicker(false);
  };

  const closeSession = useCallback((groupId: string, sessionId: string) => {
    setGroups(prev => {
      const group = prev.find(g => g.id === groupId);
      if (!group) return prev;
      const remaining = group.sessions.filter(s => s.id !== sessionId);
      if (remaining.length === 0) {
        const newGroups = prev.filter(g => g.id !== groupId);
        if (newGroups.length === 0) { navigate('/'); return prev; }
        setActiveGroupId(a => a === groupId ? newGroups[0].id : a);
        return newGroups;
      }
      const focused = group.focusedSessionId === sessionId
        ? remaining[Math.max(0, group.sessions.findIndex(s => s.id === sessionId) - 1)]?.id ?? remaining[0].id
        : group.focusedSessionId;
      const bestLayout = (n: number): Layout => {
        if (n <= 1) return 'single';
        if (n === 2) return 'split-h';
        if (n === 3) return 'triple';
        return 'quad';
      };
      const layout = bestLayout(remaining.length);
      return prev.map(g => g.id !== groupId ? g : { ...g, sessions: remaining, focusedSessionId: focused, layout });
    });
  }, [navigate]);

  const changeLayout = (groupId: string, layout: Layout) => {
    const group = groups.find(g => g.id === groupId);
    if (!group) return;
    const N = LAYOUT_SLOTS[layout];
    const idx = group.sessions.findIndex(s => s.id === group.focusedSessionId);
    if (layout !== 'single' && idx >= N) {
      setGroups(prev => prev.map(g => {
        if (g.id !== groupId) return g;
        const next = [...g.sessions];
        [next[0], next[idx]] = [next[idx], next[0]];
        return { ...g, sessions: next, layout };
      }));
    } else {
      updateGroup(groupId, { layout });
    }
    setLayoutMenuGroupId(null);
  };

  // ── Drag-and-drop ─────────────────────────────────────────────────────────
  const clearMerge = useCallback(() => {
    if (mergeTimerRef.current) { clearTimeout(mergeTimerRef.current); mergeTimerRef.current = null; }
    setMergeTargetId(null);
    setReorderTargetId(null);
    reorderTargetRef.current = null;
  }, []);

  const executeMerge = useCallback((
    fromGroupId: string, draggedSessionId: string,
    toGroupId: string,
  ) => {
    if (fromGroupId === toGroupId) return;
    setGroups(prev => {
      const fromGroup = prev.find(g => g.id === fromGroupId);
      const toGroup   = prev.find(g => g.id === toGroupId);
      if (!fromGroup || !toGroup) return prev;
      const session = fromGroup.sessions.find(s => s.id === draggedSessionId);
      if (!session) return prev;

      const fromSessions = fromGroup.sessions.filter(s => s.id !== draggedSessionId);
      const toSessions   = [...toGroup.sessions, session];

      const bestLayout = (count: number): Layout => {
        if (count <= 1) return 'single';
        if (count === 2) return 'split-h';
        if (count === 3) return 'triple';
        return 'quad';
      };
      const upgrades: Layout[] = ['single', 'split-h', 'split-v', 'triple', 'triple-v', 'quad'];
      const toLayout = toSessions.length > LAYOUT_SLOTS[toGroup.layout]
        ? (upgrades.find(l => LAYOUT_SLOTS[l] >= toSessions.length) ?? 'quad')
        : toGroup.layout;
      const fromLayout = bestLayout(fromSessions.length);

      return prev
        .filter(g => !(g.id === fromGroupId && fromSessions.length === 0))
        .map(g => {
          if (g.id === fromGroupId) return { ...g, sessions: fromSessions, focusedSessionId: fromSessions[0]?.id ?? '', layout: fromLayout };
          if (g.id === toGroupId) return { ...g, sessions: toSessions, layout: toLayout, focusedSessionId: session.id };
          return g;
        });
    });
    setActiveGroupId(toGroupId);
  }, []);

  const executeDropToZone = useCallback((
    fromGroupId: string, draggedSessionId: string, zonePosition: number,
  ) => {
    setGroups(prev => {
      const fromGroup = prev.find(g => g.id === fromGroupId);
      if (!fromGroup) return prev;
      const session = fromGroup.sessions.find(s => s.id === draggedSessionId);
      if (!session) return prev;

      const fromSessions = fromGroup.sessions.filter(s => s.id !== draggedSessionId);
      const isSolo = fromSessions.length === 0;

      // Downgrade layout of source group based on remaining session count
      const bestLayout = (count: number): Layout => {
        if (count <= 1) return 'single';
        if (count === 2) return 'split-h';
        if (count === 3) return 'triple';
        if (count === 4) return 'quad';
        return 'quad';
      };

      let next = prev.map(g => {
        if (g.id !== fromGroupId || isSolo) return g;
        const newLayout = bestLayout(fromSessions.length);
        return {
          ...g,
          sessions: fromSessions,
          focusedSessionId: fromSessions[0]?.id ?? '',
          layout: newLayout,
        };
      }).filter(g => !(g.id === fromGroupId && isSolo));

      // Insert extracted session as new solo group at target position
      const newGroup = isSolo ? { ...fromGroup, layout: 'single' as Layout } : makeGroup(session);
      const pos = Math.min(zonePosition, next.length);
      next = [...next.slice(0, pos), newGroup, ...next.slice(pos)];

      return next;
    });
  }, []);

  const startSessionDrag = (
    e: React.PointerEvent,
    sessionId: string, fromGroupId: string,
    label: string, protocol: 'ssh' | 'rdp',
  ) => {
    e.preventDefault();
    const startX = e.clientX, startY = e.clientY;
    let started = false;

    const onMove = (ev: PointerEvent) => {
      if (!started) {
        if (Math.abs(ev.clientX - startX) > 6 || Math.abs(ev.clientY - startY) > 6) {
          started = true;
          setDrag({ sessionId, fromGroupId, x: ev.clientX, y: ev.clientY, label, protocol });
        }
        return;
      }
      setDrag(prev => prev ? { ...prev, x: ev.clientX, y: ev.clientY } : null);
    };

    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);

      const d = dragRef.current;
      if (d) {
        setDrag(null);

        // Reorder within same group
        const reorderTarget = reorderTargetRef.current;
        if (reorderTarget) {
          setGroups(prev => prev.map(g => {
            if (g.id !== d.fromGroupId) return g;
            const sessions = [...g.sessions];
            const fromIdx = sessions.findIndex(s => s.id === d.sessionId);
            const toIdx   = sessions.findIndex(s => s.id === reorderTarget);
            if (fromIdx === -1 || toIdx === -1) return g;
            const [moved] = sessions.splice(fromIdx, 1);
            sessions.splice(toIdx, 0, moved);
            return { ...g, sessions };
          }));
          clearMerge();
          return;
        }

        // Drop to zone (extract from group)
        setDropZoneActive(dz => {
          if (dz !== null) executeDropToZone(d.fromGroupId, d.sessionId, dz);
          return null;
        });
        clearMerge();
      }
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  };

  const onSessionPointerEnter = (targetSessionId: string, targetGroupId: string) => {
    const d = dragRef.current;
    if (!d || d.sessionId === targetSessionId) return;

    clearMerge();

    if (d.fromGroupId === targetGroupId) {
      // Same group → reorder on drop
      reorderTargetRef.current = targetSessionId;
      setReorderTargetId(targetSessionId);
    } else {
      // Different group → merge after 500ms
      setMergeTargetId(targetSessionId);
      mergeTimerRef.current = setTimeout(() => {
        const current = dragRef.current;
        if (current) {
          executeMerge(current.fromGroupId, current.sessionId, targetGroupId);
          setDrag(null);
          clearMerge();
        }
      }, 500);
    }
  };

  const onSessionPointerLeave = () => {
    if (!dragRef.current) return;
    clearMerge();
  };

  const onDropZoneEnter = (pos: number) => {
    if (!dragRef.current) return;
    clearMerge();
    setDropZoneActive(pos);
  };

  const onDropZoneLeave = () => { setDropZoneActive(null); };

  // ── Pane split drag ───────────────────────────────────────────────────────
  const startPaneDrag = (groupId: string, key: SplitKey, axis: 'col' | 'row', minPct = 12, maxPct = 88) =>
    (e: React.MouseEvent) => {
      e.preventDefault();
      setPaneDragging(axis);
      const rect = paneAreaRef.current?.getBoundingClientRect();
      if (!rect) return;
      const size  = axis === 'col' ? rect.width : rect.height;
      const start = axis === 'col' ? e.clientX : e.clientY;
      const group = groups.find(g => g.id === groupId);
      const base  = group?.splits[key] ?? 50;
      const onMove = (ev: MouseEvent) => {
        const delta = (((axis === 'col' ? ev.clientX : ev.clientY) - start) / size) * 100;
        setGroups(prev => prev.map(g =>
          g.id !== groupId ? g : { ...g, splits: { ...g.splits, [key]: Math.min(maxPct, Math.max(minPct, base + delta)) } },
        ));
      };
      const onUp = () => {
        setPaneDragging(null);
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    };

  // ── Derived ───────────────────────────────────────────────────────────────
  const activeGroup    = groups.find(g => g.id === activeGroupId);
  const focusedSession = activeGroup?.sessions.find(s => s.id === activeGroup.focusedSessionId);
  const N = activeGroup ? LAYOUT_SLOTS[activeGroup.layout] : 1;
  const isDragging = drag !== null;


  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="h-screen flex flex-row bg-[#0f172a] text-slate-300 overflow-hidden select-none">
      {/* Merge fill animation */}
      <style>{`
        @keyframes merge-fill { from { transform: scaleX(0); } to { transform: scaleX(1); } }
        @keyframes banner-in  { from { opacity: 0; transform: translateY(8px) scale(0.97); } to { opacity: 1; transform: translateY(0) scale(1); } }
      `}</style>

      {/* Drag ghost */}
      {drag && <Ghost x={drag.x} y={drag.y} label={drag.label} protocol={drag.protocol} />}

      {/* ── Left sidebar ───────────────────────────────────────────────── */}
      <div className="w-52 flex flex-col border-r border-slate-800 bg-slate-950 shrink-0">

        {/* Logo + back */}
        <div className="h-11 flex items-center gap-2 px-3 border-b border-slate-800 shrink-0">
          <button onClick={() => navigate('/')} title={t('nav.backToPortal')}
            className="p-1 text-slate-500 hover:text-white hover:bg-slate-800/60 rounded transition-colors shrink-0">
            <ChevronLeft size={15} />
          </button>
          <TerminalIcon size={13} className="text-primary shrink-0" />
          <span className="font-mono text-[11px] font-bold uppercase tracking-widest text-primary truncate">{t('terminal.appName')}</span>
        </div>

        {/* Groups list */}
        <div className="flex-1 overflow-y-auto py-2 px-2 space-y-1">

          {groups.map((group, gi) => {
            const isActiveGroup = group.id === activeGroupId;
            const isMulti       = group.sessions.length > 1;

            return (
              <React.Fragment key={group.id}>
                {/* ── Drop zone before this group ── */}
                <div
                  className="relative flex items-center justify-center mx-1 transition-all duration-150"
                  style={{ height: isDragging ? 28 : 6 }}
                  onPointerEnter={() => isDragging && onDropZoneEnter(gi)}
                  onPointerLeave={onDropZoneLeave}
                >
                  <div className="w-full rounded-full transition-all duration-150"
                    style={{ height: 3, backgroundColor: dropZoneActive === gi ? 'rgba(99,102,241,0.7)' : 'transparent',
                      boxShadow: dropZoneActive === gi ? '0 0 8px rgba(99,102,241,0.4)' : 'none' }} />
                </div>

                {/* ── Group cluster ── */}
                <div className={`relative rounded-xl transition-all ${
                  isMulti ? `p-1 ${isActiveGroup ? 'bg-slate-800/60 ring-1 ring-primary/20' : 'bg-slate-900/60 hover:bg-slate-800/30'}` : ''
                }`}>

                  {/* Layout picker — only for multi-session groups */}
                  {isMulti && (
                    <div ref={isActiveGroup ? layoutMenuRef : undefined} className="relative">
                      <div className="flex items-center justify-between px-1 mb-1">
                        <div className="flex gap-0.5">
                          {group.sessions.map(s => (
                            <span key={s.id} className={`w-1 h-1 rounded-full ${
                              s.status === 'connected' ? 'bg-green-500' :
                              s.status === 'connecting' ? 'bg-amber-400 animate-pulse' :
                              s.status === 'error' ? 'bg-red-400' : 'bg-slate-600'
                            }`} />
                          ))}
                        </div>
                        <button
                          onClick={() => { setActiveGroupId(group.id); setLayoutMenuGroupId(prev => prev === group.id ? null : group.id); }}
                          className={`p-1 rounded transition-colors ${
                            layoutMenuGroupId === group.id ? 'text-primary' : 'text-slate-600 hover:text-slate-300'
                          }`}>
                          <LayoutIcon id={group.layout} size={12} />
                        </button>
                      </div>

                      {layoutMenuGroupId === group.id && (
                        <div className="absolute right-0 top-full mt-1 bg-slate-900 border border-slate-700/80 rounded-xl p-2 shadow-2xl z-50 min-w-[170px]">
                          <p className="text-[10px] text-slate-600 uppercase tracking-widest font-bold mb-1.5 px-2">{t('terminal.layout')}</p>
                          {(['single', 'split-h', 'split-v', 'triple', 'triple-v', 'quad'] as Layout[]).map(id => (
                            <button key={id} onClick={() => changeLayout(group.id, id)}
                              className={`w-full flex items-center gap-3 px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                                group.layout === id ? 'bg-primary/15 text-primary' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                              }`}>
                              <LayoutIcon id={id} size={16} />
                              <span className="font-medium">{t(LAYOUT_KEYS[id])}</span>
                              {group.layout === id && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-primary" />}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Sessions */}
                  {group.sessions.map(session => {
                    const isFocused       = isActiveGroup && session.id === group.focusedSessionId;
                    const isBeingDragged  = drag?.sessionId === session.id;
                    const isMergeTarget   = mergeTargetId === session.id;
                    const isReorderTarget = reorderTargetId === session.id;

                    return (
                      <div
                        key={session.id}
                        data-session-id={session.id}
                        data-group-id={group.id}
                        className="relative"
                        onPointerEnter={() => onSessionPointerEnter(session.id, group.id)}
                        onPointerLeave={onSessionPointerLeave}
                      >
                        {/* Merge countdown fill */}
                        {isMergeTarget && (
                          <div
                            key={`merge-${session.id}`}
                            className="absolute inset-0 rounded-lg overflow-hidden pointer-events-none z-10"
                          >
                            <div
                              className="absolute inset-0 bg-primary/30 origin-left rounded-lg"
                              style={{ animation: 'merge-fill 0.5s linear forwards' }}
                            />
                          </div>
                        )}

                        {/* Reorder drop indicator */}
                        {isReorderTarget && (
                          <div className="absolute inset-x-1 -top-px h-0.5 rounded-full bg-primary/70 pointer-events-none z-10" />
                        )}

                        <button
                          className={`relative w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-mono group/s transition-all ${
                            isBeingDragged  ? 'opacity-30' :
                            isFocused       ? 'bg-slate-700 text-slate-200' :
                            isMergeTarget   ? 'text-white' :
                            isReorderTarget ? 'bg-slate-800/70 text-slate-300' :
                            'text-slate-500 hover:text-slate-300 hover:bg-slate-800/50'
                          } ${isDragging && !isBeingDragged ? 'cursor-grab' : 'cursor-grab'}`}
                          style={{ pointerEvents: isBeingDragged ? 'none' : 'auto' }}
                          onPointerDown={e => startSessionDrag(e, session.id, group.id, session.machineName, session.protocol)}
                          onClick={() => { setActiveGroupId(group.id); updateGroup(group.id, { focusedSessionId: session.id }); }}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                            session.status === 'connected'  ? 'bg-green-500' :
                            session.status === 'connecting' ? 'bg-amber-400 animate-pulse' :
                            session.status === 'error'      ? 'bg-red-500' : 'bg-slate-600'
                          }`} />
                          {session.protocol === 'rdp'
                            ? <Monitor size={9} className="shrink-0 text-blue-400" />
                            : <TerminalIcon size={9} className="shrink-0 text-slate-500" />
                          }
                          <span className="truncate flex-1 text-left">{session.machineName}</span>
                          <button
                            type="button"
                            onPointerDown={e => e.stopPropagation()}
                            onClick={e => { e.stopPropagation(); closeSession(group.id, session.id); }}
                            className="shrink-0 opacity-0 group-hover/s:opacity-50 hover:!opacity-100 hover:text-red-400 p-0.5 rounded transition-all">
                            <X size={9} />
                          </button>
                          {isFocused && <span className="absolute left-0 top-1 bottom-1 w-[2px] bg-primary rounded-r" />}
                        </button>
                      </div>
                    );
                  })}
                </div>

                {/* ── Drop zone after this group (last group only, others covered by next group's top zone) ── */}
                {gi === groups.length - 1 && (
                  <div
                    className="relative flex items-center justify-center mx-1 transition-all duration-150"
                    style={{ height: isDragging ? 28 : 6 }}
                    onPointerEnter={() => isDragging && onDropZoneEnter(groups.length)}
                    onPointerLeave={onDropZoneLeave}
                  >
                    <div className="w-full rounded-full transition-all duration-150"
                      style={{ height: 3, backgroundColor: dropZoneActive === groups.length ? 'rgba(99,102,241,0.7)' : 'transparent',
                        boxShadow: dropZoneActive === groups.length ? '0 0 8px rgba(99,102,241,0.4)' : 'none' }} />
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>

        {/* Add session */}
        <div className="px-2 pb-1.5 shrink-0">
          <button onClick={() => setShowPicker(true)}
            className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs text-slate-500 hover:text-white hover:bg-slate-800/60 transition-colors">
            <Plus size={12} />
            <span>{t('terminal.newSession')}</span>
          </button>
        </div>

        {/* User + isolated badge */}
        <div className="px-3 py-2.5 border-t border-slate-800 shrink-0 space-y-1.5">
          {focusedSession && !focusedSession.allowCopyPaste && (
            <div className="flex items-center gap-1.5 px-2 py-1 bg-red-500/10 border border-red-500/20 rounded-full text-red-400 text-[10px] font-bold uppercase animate-pulse">
              <ClipboardX size={9} /> {t('terminal.isolatedMode')}
            </div>
          )}
          <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
            <Shield size={11} />
            <span className="truncate">{user?.email}</span>
          </div>
        </div>
      </div>

      {/* ── Pane area ─────────────────────────────────────────────────────── */}
      <div
        ref={paneAreaRef}
        className="flex-1 relative overflow-hidden"
        style={{ backgroundColor: '#1e293b' }}
      >
        {activeGroup && (<>
          {activeGroup.sessions.map((session, i) => {
            const isVisible = activeGroup.layout === 'single'
              ? session.id === activeGroup.focusedSessionId : i < N;
            const isFocused = session.id === activeGroup.focusedSessionId;
            return (
              <div
                key={session.id}
                style={{ ...getPaneStyle(activeGroup.layout, i, isVisible, activeGroup.splits), ...(paneDragging ? { pointerEvents: 'none' } : {}) }}
                onClick={() => activeGroup.layout !== 'single' && updateGroup(activeGroup.id, { focusedSessionId: session.id })}
                className={activeGroup.layout !== 'single' && isVisible && isFocused && N > 1 ? 'ring-1 ring-inset ring-primary/30' : ''}
              >
                {session.protocol === 'rdp' ? (
                  <RdpPane machineId={session.machineId} isActive={isVisible}
                    onStatusChange={s => updateSessionField(activeGroup.id, session.id, 'status', s)}
                    onCopyPasteChange={a => updateSessionField(activeGroup.id, session.id, 'allowCopyPaste', a)}
                    onCloseRequest={() => closeSession(activeGroup.id, session.id)} />
                ) : (
                  <TerminalPane machineId={session.machineId} isActive={isVisible}
                    onStatusChange={s => updateSessionField(activeGroup.id, session.id, 'status', s)}
                    onCopyPasteChange={a => updateSessionField(activeGroup.id, session.id, 'allowCopyPaste', a)}
                    onCloseRequest={() => closeSession(activeGroup.id, session.id)} />
                )}

                {/* ── Connection-lost banner, centred inside this specific pane ── */}
                {(session.status === 'error' || session.status === 'closed') && isVisible && (
                  <div className="absolute inset-0 z-[300] flex items-center justify-center pointer-events-none">
                    <div
                      className="pointer-events-auto flex items-center gap-4 px-5 py-4 rounded-2xl shadow-2xl border"
                      style={{
                        background: 'rgba(15,23,42,0.92)',
                        backdropFilter: 'blur(12px)',
                        borderColor: session.status === 'error' ? 'rgba(239,68,68,0.35)' : 'rgba(100,116,139,0.35)',
                        animation: 'banner-in 0.25s cubic-bezier(0.16,1,0.3,1) both',
                      }}
                    >
                      <div className={`flex items-center justify-center w-9 h-9 rounded-xl shrink-0 ${
                        session.status === 'error' ? 'bg-red-500/15' : 'bg-slate-700/60'
                      }`}>
                        <WifiOff size={16} className={session.status === 'error' ? 'text-red-400' : 'text-slate-400'} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-white leading-tight">
                          {session.status === 'error' ? t('terminal.connectionLost') : t('terminal.sessionClosed')}
                        </p>
                        <p className="text-xs text-slate-400 truncate max-w-[220px] mt-0.5">
                          {session.machineName}
                        </p>
                      </div>
                      <button
                        onClick={e => { e.stopPropagation(); closeSession(activeGroup.id, session.id); }}
                        className="shrink-0 ml-2 p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-slate-700 transition-colors"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* Empty slots */}
          {activeGroup.layout !== 'single' && Array.from({ length: Math.max(0, N - activeGroup.sessions.length) }, (_, i) => {
            const si = activeGroup.sessions.length + i;
            return (
              <div key={`empty-${si}`} style={getPaneStyle(activeGroup.layout, si, true, activeGroup.splits)}
                className="flex flex-col items-center justify-center gap-3 bg-[#080e1a]">
                <button onClick={() => setShowPicker(true)}
                  className="flex flex-col items-center gap-2.5 text-slate-700 hover:text-slate-500 transition-colors group">
                  <div className="w-12 h-12 rounded-2xl border border-slate-800 flex items-center justify-center group-hover:border-slate-600 transition-colors">
                    <Plus size={20} />
                  </div>
                  <span className="text-[11px] font-mono">{t('terminal.newSession')}</span>
                </button>
              </div>
            );
          })}

          {/* Resizers */}
          {activeGroup.layout === 'split-h' && (
            <Resizer axis="col" position={activeGroup.splits.splitH} active={paneDragging === 'col'}
              onDragStart={startPaneDrag(activeGroup.id, 'splitH', 'col')} />
          )}
          {activeGroup.layout === 'split-v' && (
            <Resizer axis="row" position={activeGroup.splits.splitV} active={paneDragging === 'row'}
              onDragStart={startPaneDrag(activeGroup.id, 'splitV', 'row')} />
          )}
          {activeGroup.layout === 'triple' && (<>
            <Resizer axis="col" position={activeGroup.splits.tripleMain} active={paneDragging === 'col'}
              onDragStart={startPaneDrag(activeGroup.id, 'tripleMain', 'col')} />
            <Resizer axis="row" position={activeGroup.splits.tripleRow} active={paneDragging === 'row'}
              leftEdge={`calc(${activeGroup.splits.tripleMain}% + 0.5px)`}
              onDragStart={startPaneDrag(activeGroup.id, 'tripleRow', 'row')} />
          </>)}
          {activeGroup.layout === 'triple-v' && (<>
            <Resizer axis="col" position={activeGroup.splits.tripleVLeft} active={paneDragging === 'col'}
              onDragStart={startPaneDrag(activeGroup.id, 'tripleVLeft', 'col', 10, activeGroup.splits.tripleVRight - 10)} />
            <Resizer axis="col" position={activeGroup.splits.tripleVRight} active={paneDragging === 'col'}
              onDragStart={startPaneDrag(activeGroup.id, 'tripleVRight', 'col', activeGroup.splits.tripleVLeft + 10, 90)} />
          </>)}
          {activeGroup.layout === 'quad' && (<>
            <Resizer axis="col" position={activeGroup.splits.quadCol} active={paneDragging === 'col'}
              onDragStart={startPaneDrag(activeGroup.id, 'quadCol', 'col')} />
            <Resizer axis="row" position={activeGroup.splits.quadRow} active={paneDragging === 'row'}
              onDragStart={startPaneDrag(activeGroup.id, 'quadRow', 'row')} />
          </>)}

          {paneDragging && (
            <div className="absolute inset-0 z-[200]" style={{ cursor: paneDragging === 'col' ? 'col-resize' : 'row-resize' }} />
          )}

        </>)}
      </div>

      {showPicker && (
        <MachinePicker onSelect={addSession} onClose={() => setShowPicker(false)} />
      )}
    </div>
  );
};

export default SessionPage;
