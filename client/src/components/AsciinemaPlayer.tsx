import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { Play, Pause, RotateCcw, FastForward, Download } from 'lucide-react';
import 'xterm/css/xterm.css';

const SEEK_STEP = 10;
const EXPORT_FPS = 24;
const EXPORT_FONT_SIZE = 13;
const EXPORT_FG = '#d4d4d4';
const EXPORT_BG = '#1e1e1e';

interface CastHeader {
  version: number;
  width: number;
  height: number;
  timestamp?: number;
  title?: string;
}

type CastEvent = [number, 'o' | 'i', string];

interface Props {
  castUrl: string;
  /** Displayed in the export HUD (top-right overlay). */
  hudUser?: string;
  /** Displayed in the export HUD (top-right overlay). */
  hudMachine?: string;
}

const SPEEDS = [0.5, 1, 1.5, 2, 4];

const AsciinemaPlayer: React.FC<Props> = ({ castUrl, hudUser, hudMachine }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [header, setHeader] = useState<CastHeader | null>(null);
  const [events, setEvents] = useState<CastEvent[]>([]);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speedIdx, setSpeedIdx] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const playStartRef = useRef<{ wallTime: number; castOffset: number } | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const term = new Terminal({ convertEol: true, scrollback: 1000, fontSize: 13, lineHeight: 1.2 });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    const ro = new ResizeObserver(() => fit.fit());
    ro.observe(containerRef.current);
    return () => { ro.disconnect(); term.dispose(); };
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(castUrl, { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        const lines = text.trim().split('\n');
        const h = JSON.parse(lines[0]) as CastHeader;
        const evts = lines.slice(1).map((l) => JSON.parse(l) as CastEvent);
        setHeader(h);
        setEvents(evts);
        setDuration(evts.length ? evts[evts.length - 1][0] : 0);
        if (termRef.current && fitRef.current) {
          fitRef.current.fit();
        }
        setLoading(false);
      })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, [castUrl]);

  const clearSchedule = useCallback(() => {
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
  }, []);

  const stop = useCallback(() => {
    clearSchedule();
    setPlaying(false);
    playStartRef.current = null;
  }, [clearSchedule]);

  const play = useCallback((fromOffset = 0) => {
    if (!events.length || !termRef.current) return;
    clearSchedule();
    termRef.current.reset();

    // Reconstruct terminal state up to fromOffset instantly
    events
      .filter((e) => e[1] === 'o' && e[0] < fromOffset)
      .forEach(([, , data]) => termRef.current?.write(data));

    const speed = SPEEDS[speedIdx];
    const wallStart = Date.now();
    playStartRef.current = { wallTime: wallStart, castOffset: fromOffset };

    const pending = events.filter((e) => e[1] === 'o' && e[0] >= fromOffset);
    pending.forEach(([ts, , data]) => {
      const delay = ((ts - fromOffset) / speed) * 1000;
      const id = setTimeout(() => termRef.current?.write(data), delay);
      timeoutsRef.current.push(id);
    });

    const endDelay = ((duration - fromOffset) / speed) * 1000;
    const endId = setTimeout(() => stop(), endDelay);
    timeoutsRef.current.push(endId);

    tickRef.current = setInterval(() => {
      if (!playStartRef.current) return;
      const wall = (Date.now() - playStartRef.current.wallTime) / 1000;
      setElapsed(Math.min(fromOffset + wall * speed, duration));
    }, 200);

    setPlaying(true);
    setElapsed(fromOffset);
  }, [events, duration, speedIdx, clearSchedule, stop]);

  const handlePlayPause = () => {
    if (playing) { stop(); }
    else { play(elapsed >= duration ? 0 : elapsed); }
  };

  const handleRestart = () => {
    stop();
    setElapsed(0);
    termRef.current?.reset();
  };

  const handleSpeedCycle = () => {
    const next = (speedIdx + 1) % SPEEDS.length;
    setSpeedIdx(next);
    if (playing) { play(elapsed); }
  };

  const seekTo = useCallback((target: number) => {
    const clamped = Math.max(0, Math.min(target, duration));
    if (!termRef.current) return;

    clearSchedule();
    termRef.current.reset();

    // Reconstruct terminal state at clamped instantly
    events
      .filter((e) => e[1] === 'o' && e[0] <= clamped)
      .forEach(([, , data]) => termRef.current?.write(data));

    setElapsed(clamped);

    if (playing) {
      // Resume playback from this position
      const speed = SPEEDS[speedIdx];
      playStartRef.current = { wallTime: Date.now(), castOffset: clamped };

      events
        .filter((e) => e[1] === 'o' && e[0] > clamped)
        .forEach(([ts, , data]) => {
          const delay = ((ts - clamped) / speed) * 1000;
          timeoutsRef.current.push(setTimeout(() => termRef.current?.write(data), delay));
        });

      const endDelay = ((duration - clamped) / speed) * 1000;
      timeoutsRef.current.push(setTimeout(() => stop(), endDelay));

      tickRef.current = setInterval(() => {
        if (!playStartRef.current) return;
        const wall = (Date.now() - playStartRef.current.wallTime) / 1000;
        setElapsed(Math.min(clamped + wall * speed, duration));
      }, 200);
    }
  }, [duration, events, playing, speedIdx, clearSchedule, stop]);

  const handleSeekBarClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    seekTo(ratio * duration);
  };

  const handleSeekBack = () => seekTo(elapsed - SEEK_STEP);
  const handleSeekForward = () => seekTo(elapsed + SEEK_STEP);

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  const handleExport = useCallback(async () => {
    if (!events.length || !header || exporting) return;
    setExporting(true);
    setExportProgress(0);

    const cols = header.width;
    const rows = header.height;
    const fSize = EXPORT_FONT_SIZE;

    // The terminal must intersect the viewport so xterm's IntersectionObserver
    // marks it as visible and actually renders its canvas.  We clip it to 1×1 px
    // (overflow:hidden on the wrapper) so nothing is visible to the user.
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;overflow:hidden;z-index:1;pointer-events:none;';
    document.body.appendChild(wrapper);
    const hiddenDiv = document.createElement('div');
    hiddenDiv.style.cssText = `width:${cols * 10}px;height:${rows * 20}px;`;
    wrapper.appendChild(hiddenDiv);

    const recTerm = new Terminal({
      cols, rows, fontSize: fSize, lineHeight: 1.2, convertEol: true,
      theme: { background: EXPORT_BG, foreground: EXPORT_FG },
    });
    recTerm.open(hiddenDiv);

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      setTimeout(() => {
        try { recTerm.dispose(); } catch (_) {}
        if (wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);
      }, 150);
      setExporting(false);
      setExportProgress(0);
    };

    try {
      // Use canvas addon so xterm handles all ANSI color rendering itself
      const { CanvasAddon } = await import('xterm-addon-canvas');
      recTerm.loadAddon(new CanvasAddon());

      // Wait two animation frames for xterm to initialise its canvas layer
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

      const xtermCanvas = hiddenDiv.querySelector('canvas') as HTMLCanvasElement | null;
      if (!xtermCanvas) throw new Error('xterm canvas not found');

      // Round up to H.264 macroblock multiples of 16
      const mb = (n: number) => Math.max(16, Math.ceil(n / 16) * 16);
      const cw = mb(xtermCanvas.width);
      const ch = mb(xtermCanvas.height);

      // Encoder canvas (may be slightly larger than xterm canvas due to alignment)
      // Base canvas: xterm content only (updated via RAF when terminal changes)
      const baseCanvas = document.createElement('canvas');
      baseCanvas.width = cw;
      baseCanvas.height = ch;
      const baseCtx = baseCanvas.getContext('2d')!;

      // Encoder canvas: base + HUD overlay (recomposed every frame, no RAF needed)
      const encCanvas = document.createElement('canvas');
      encCanvas.width = cw;
      encCanvas.height = ch;
      const ctx = encCanvas.getContext('2d')!;

      const writeAndWait = (data: string): Promise<void> =>
        new Promise<void>((resolve) => recTerm.write(data, resolve));

      // Snapshot xterm canvas → baseCanvas (two RAFs: xterm renders in #1, we copy in #2)
      const captureBase = () =>
        new Promise<void>((r) =>
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              baseCtx.fillStyle = EXPORT_BG;
              baseCtx.fillRect(0, 0, cw, ch);
              baseCtx.drawImage(xtermCanvas, 0, 0);
              r();
            }),
          ),
        );

      // Draw semi-transparent HUD on top-right of encCanvas
      const drawHud = (frameTime: number) => {
        const lines: string[] = [];
        if (hudUser) lines.push(`User : ${hudUser}`);
        if (hudMachine) lines.push(`Machine : ${hudMachine}`);
        if (header.timestamp) {
          const d = new Date((header.timestamp + frameTime) * 1000);
          lines.push(d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'medium' }));
        }
        if (lines.length === 0) return;

        const fontSize = Math.max(13, Math.round(ch * 0.025));
        const hPad = Math.round(fontSize * 0.8);
        const vPad = Math.round(fontSize * 0.55);
        const lineH = Math.round(fontSize * 1.45);

        ctx.save();
        ctx.font = `${fontSize}px "Courier New", Courier, monospace`;
        const maxW = Math.max(...lines.map((l) => ctx.measureText(l).width));
        const boxW = maxW + hPad * 2;
        const boxH = lines.length * lineH + vPad * 2;
        const boxX = cw - boxW - hPad;
        const boxY = vPad;

        const radius = Math.round(fontSize * 0.4);
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = '#000000';
        ctx.beginPath();
        ctx.moveTo(boxX + radius, boxY);
        ctx.lineTo(boxX + boxW - radius, boxY);
        ctx.arcTo(boxX + boxW, boxY, boxX + boxW, boxY + radius, radius);
        ctx.lineTo(boxX + boxW, boxY + boxH - radius);
        ctx.arcTo(boxX + boxW, boxY + boxH, boxX + boxW - radius, boxY + boxH, radius);
        ctx.lineTo(boxX + radius, boxY + boxH);
        ctx.arcTo(boxX, boxY + boxH, boxX, boxY + boxH - radius, radius);
        ctx.lineTo(boxX, boxY + radius);
        ctx.arcTo(boxX, boxY, boxX + radius, boxY, radius);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.textBaseline = 'top';
        lines.forEach((line, i) => ctx.fillText(line, boxX + hPad, boxY + vPad + i * lineH));
        ctx.restore();
      };

      // Compose base + HUD into encCanvas for the given frame time (no RAF needed)
      const renderFrame = (frameTime: number) => {
        ctx.drawImage(baseCanvas, 0, 0);
        drawHud(frameTime);
      };

      // Group cast events by the video frame they fall in
      const totalFrames = Math.ceil(duration * EXPORT_FPS);
      const frameEvents: string[][] = Array.from({ length: totalFrames + 1 }, () => []);
      events.filter((e) => e[1] === 'o').forEach(([ts, , data]) => {
        frameEvents[Math.min(Math.floor(ts * EXPORT_FPS), totalFrames)].push(data);
      });

      const { Muxer, ArrayBufferTarget } = await import('mp4-muxer');
      const target = new ArrayBufferTarget();

      const candidateCodecs = ['avc1.640034', 'avc1.64002a', 'avc1.420034', 'avc1.42002a'];
      let chosenCodec = candidateCodecs[0];
      for (const c of candidateCodecs) {
        const { supported } = await VideoEncoder.isConfigSupported({ codec: c, width: cw, height: ch });
        if (supported) { chosenCodec = c; break; }
      }

      const muxer = new Muxer({
        target,
        video: { codec: 'avc', width: cw, height: ch },
        fastStart: 'in-memory',
      });

      const encoder = new VideoEncoder({
        output: (chunk, meta) => muxer.addVideoChunk(chunk, meta ?? {}),
        error: (e) => { console.error('VideoEncoder:', e); cleanup(); },
      });
      encoder.configure({ codec: chosenCodec, width: cw, height: ch, framerate: EXPORT_FPS, bitrate: 2_000_000 });

      recTerm.reset();
      await captureBase(); // initial blank frame

      for (let fi = 0; fi <= totalFrames; fi++) {
        const batch = frameEvents[fi].join('');
        if (batch) {
          // Terminal content changed: update base canvas (needs RAF for xterm render)
          await writeAndWait(batch);
          recTerm.refresh(0, rows - 1);
          await captureBase();
        }
        // Recompose base + HUD with current frame timestamp (no RAF — pure canvas ops)
        renderFrame(fi / EXPORT_FPS);

        const ts = Math.round((fi / EXPORT_FPS) * 1_000_000);
        const vf = new VideoFrame(encCanvas, { timestamp: ts, duration: Math.round(1_000_000 / EXPORT_FPS) });
        encoder.encode(vf, { keyFrame: fi % (EXPORT_FPS * 2) === 0 });
        vf.close();

        if (fi % EXPORT_FPS === 0) {
          setExportProgress(fi / totalFrames);
          await new Promise<void>((r) => setTimeout(r, 0));
        }
      }

      await encoder.flush();
      muxer.finalize();

      const blob = new Blob([target.buffer], { type: 'video/mp4' });
      cleanup();

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(header.title ?? 'session').replace(/\s+/g, '-')}.mp4`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Export failed:', e);
      cleanup();
    }
  }, [events, header, duration, hudUser, hudMachine, exporting]);

  return (
    <div className="flex flex-col gap-2 bg-black rounded-lg overflow-hidden border border-border-light">
      {loading && <div className="p-4 text-text-secondary text-sm">Chargement de l'enregistrement…</div>}
      {error && <div className="p-4 text-danger text-sm">Erreur : {error}</div>}

      {header && (
        <div className="px-3 py-1 bg-background-surface border-b border-border-light flex items-center justify-between text-xs text-text-secondary">
          <span>{header.title}</span>
          <span>{header.width}×{header.height}</span>
        </div>
      )}

      <div ref={containerRef} className="p-2" style={{ height: '340px' }} />

      {exporting && (
        <div className="px-4 py-2 bg-background-surface border-t border-border-light flex items-center gap-3">
          <span className="text-xs text-text-secondary">Export en cours…</span>
          <div className="flex-1 h-2 bg-background-app rounded overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-500"
              style={{ width: `${exportProgress * 100}%` }}
            />
          </div>
          <span className="text-xs text-text-secondary tabular-nums">{Math.round(exportProgress * 100)}%</span>
        </div>
      )}

      <div className="px-4 py-2 bg-background-surface border-t border-border-light flex items-center gap-3">
        <button onClick={handlePlayPause} disabled={exporting} className="btn-icon" title={playing ? 'Pause' : 'Lecture'}>
          {playing ? <Pause size={18} /> : <Play size={18} />}
        </button>
        <button onClick={handleRestart} disabled={exporting} className="btn-icon" title="Redémarrer">
          <RotateCcw size={16} />
        </button>
        <button onClick={handleSpeedCycle} disabled={exporting} className="btn-icon flex items-center gap-1 text-xs" title="Vitesse">
          <FastForward size={16} />{SPEEDS[speedIdx]}×
        </button>
        <span className="text-xs text-text-secondary tabular-nums">
          {fmt(elapsed)} / {fmt(duration)}
        </span>
        <div
          className="flex-1 h-3 bg-background-app rounded overflow-hidden cursor-pointer group"
          onClick={handleSeekBarClick}
          title="Cliquer pour naviguer"
        >
          <div
            className="h-full bg-primary group-hover:bg-primary/80 transition-all"
            style={{ width: duration > 0 ? `${(elapsed / duration) * 100}%` : '0%' }}
          />
        </div>
        <button onClick={handleSeekBack} disabled={exporting} className="btn-icon text-xs tabular-nums" title="-10s">
          -10s
        </button>
        <button onClick={handleSeekForward} disabled={exporting} className="btn-icon text-xs tabular-nums" title="+10s">
          +10s
        </button>
        <button
          onClick={handleExport}
          disabled={exporting || !events.length}
          className="btn-icon"
          title="Exporter en vidéo"
        >
          <Download size={16} />
        </button>
      </div>
    </div>
  );
};

export default AsciinemaPlayer;
