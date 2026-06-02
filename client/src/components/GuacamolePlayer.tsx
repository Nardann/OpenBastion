import React, { useEffect, useRef, useState, useCallback } from 'react';
import Guacamole from 'guacamole-common-js';
import { Loader2, AlertCircle, Play, Pause, RotateCcw, FastForward, Download } from 'lucide-react';

// guacamole-common-js 1.5 ships SessionRecording at runtime but has no TS typings for it.
// Also, SessionRecording v1.5 has a bug: when given a Blob directly, it never assigns
// recordingBlob = source, causing undefined.slice() errors. We work around this by using
// the tunnel code path instead (which is correct), feeding instructions from the fetched
// file through a fake static tunnel.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const GuacRecording: any = (Guacamole as any).SessionRecording;

const SPEEDS = [0.5, 1, 1.5, 2, 4];
const SEEK_STEP = 10;        // seconds for the -10s / +10s buttons
const EXPORT_FPS = 12;       // RDP frames are sparse; 12fps keeps files small

interface Props {
  streamUrl: string;        // URL to .guac recording stream
  /** Displayed in the HUD overlay (top-right) and burned into the export. */
  hudUser?: string;
  hudMachine?: string;
  /** ISO start date of the recording — drives the live clock in the HUD. */
  startedAt?: string;
  /** Used as the export filename. */
  title?: string;
}

/**
 * Build a fake Guacamole.Tunnel that replays a .guac recording text.
 * guacamole-common-js 1.5 SessionRecording has a bug with the Blob path
 * (recordingBlob never assigned), but the tunnel path works correctly.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildFakeTunnel(text: string): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tunnel: any = new (Guacamole as any).Tunnel();
  setTimeout(() => {
    try {
      const parser = new Guacamole.Parser();
      parser.oninstruction = (opcode: string, args: string[]) => {
        if (tunnel.oninstruction) tunnel.oninstruction(opcode, args);
      };
      parser.receive(text);
    } catch (e) {
      if (tunnel.onerror) tunnel.onerror({ message: (e as Error).message });
    }
    if (tunnel.onstatechange) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tunnel.onstatechange((Guacamole as any).Tunnel.State.CLOSED);
    }
  }, 0);
  tunnel.connect = () => {};
  tunnel.disconnect = () => {};
  return tunnel;
}

const GuacamolePlayer: React.FC<Props> = ({ streamUrl, hudUser, hudMachine, startedAt, title }) => {
  const displayRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);     // seconds
  const [currentTime, setCurrentTime] = useState(0); // seconds
  const [speedIdx, setSpeedIdx] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recordingRef = useRef<any>(null);
  const fitRef = useRef<(() => void) | null>(null);
  // Playback driver: we never call recording.play() (it has no speed control).
  // Instead we run an interval that seeks to "anchorPos + elapsed*speed", which
  // supports arbitrary playback speed and fast-forward.
  const loopRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const anchorRef = useRef<{ wall: number; pos: number } | null>(null);
  const speedRef = useRef(SPEEDS[speedIdx]);
  const playingRef = useRef(false);

  const clearLoop = useCallback(() => {
    if (loopRef.current) { clearInterval(loopRef.current); loopRef.current = null; }
    anchorRef.current = null;
  }, []);

  const stopPlayback = useCallback(() => {
    clearLoop();
    playingRef.current = false;
    setPlaying(false);
  }, [clearLoop]);

  const startPlayback = useCallback((fromSec: number) => {
    const rec = recordingRef.current;
    if (!rec) return;
    clearLoop();
    const durMs = rec.getDuration();
    if (fromSec * 1000 >= durMs) fromSec = 0; // restart if at the end
    anchorRef.current = { wall: Date.now(), pos: fromSec * 1000 };
    playingRef.current = true;
    setPlaying(true);
    loopRef.current = setInterval(() => {
      const a = anchorRef.current;
      const r = recordingRef.current;
      if (!a || !r) return;
      const target = a.pos + (Date.now() - a.wall) * speedRef.current;
      if (target >= durMs) {
        try { r.seek(Math.round(durMs), () => {}); } catch { /* ignore */ }
        setCurrentTime(durMs / 1000);
        setProgress(1);
        stopPlayback();
        return;
      }
      try { r.seek(Math.round(target), () => {}); } catch { /* ignore */ }
    }, 100);
  }, [clearLoop, stopPlayback]);

  useEffect(() => {
    if (!displayRef.current) return;
    let disposed = false;

    fetch(streamUrl, { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then((text) => {
        if (disposed) return;

        const tunnel = buildFakeTunnel(text);
        const recording = new GuacRecording(tunnel);

        const display = recording.getDisplay();
        const el = display.getElement();
        el.style.display = 'block';
        if (displayRef.current) {
          displayRef.current.innerHTML = '';
          displayRef.current.appendChild(el);
        }

        // Scale the absolutely-positioned canvases to fit the container width
        // (CSS max-* would only clip them). Capped at 480px tall.
        const MAX_H = 480;
        const fitDisplay = () => {
          const w = display.getWidth();
          const h = display.getHeight();
          if (!w || !h) return;
          const containerW = displayRef.current?.clientWidth || w;
          const scale = Math.min(containerW / w, MAX_H / h, 1);
          if (scale > 0 && isFinite(scale)) display.scale(scale);
        };
        fitRef.current = fitDisplay;
        display.onresize = () => { if (!disposed) fitDisplay(); };

        recording.onprogress = (_d: number, current: number) => {
          if (disposed) return;
          const dur = recording.getDuration();
          if (dur > 0) {
            setDuration(dur / 1000);
            if (!playingRef.current) {
              setProgress(current / dur);
              setCurrentTime(current / 1000);
            }
          }
        };

        // Fires as playback advances through frames (during our seek loop too).
        recording.onseek = (millis: number) => {
          if (disposed) return;
          const dur = recording.getDuration();
          setCurrentTime(millis / 1000);
          if (dur > 0) setProgress(millis / dur);
        };

        recording.onload = () => {
          if (!disposed) {
            fitDisplay();
            setDuration(recording.getDuration() / 1000);
            setStatus('ready');
          }
        };

        recording.onerror = (msg: string) => {
          console.warn('[GuacamolePlayer] recording error (non-fatal):', msg);
        };

        recordingRef.current = recording;
      })
      .catch((e) => {
        if (!disposed) { setError(e.message); setStatus('error'); }
      });

    return () => {
      disposed = true;
      clearLoop();
      recordingRef.current = null;
    };
  }, [streamUrl, clearLoop]);

  // Refit on window resize.
  useEffect(() => {
    const onResize = () => fitRef.current?.();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const handlePlayPause = () => {
    if (playing) stopPlayback();
    else startPlayback(currentTime >= duration ? 0 : currentTime);
  };

  const handleRestart = () => {
    const rec = recordingRef.current;
    if (!rec) return;
    stopPlayback();
    try { rec.seek(0, () => {}); } catch { /* ignore */ }
    setCurrentTime(0);
    setProgress(0);
  };

  const handleSpeedCycle = () => {
    const next = (speedIdx + 1) % SPEEDS.length;
    setSpeedIdx(next);
    speedRef.current = SPEEDS[next];
    if (playingRef.current) startPlayback(currentTime); // re-anchor at new speed
  };

  const seekToSec = (sec: number) => {
    const rec = recordingRef.current;
    if (!rec) return;
    const clamped = Math.max(0, Math.min(sec, duration));
    try { rec.seek(Math.round(clamped * 1000), () => {}); } catch { /* ignore */ }
    setCurrentTime(clamped);
    setProgress(duration > 0 ? clamped / duration : 0);
    if (playingRef.current) startPlayback(clamped); // re-anchor
  };

  const handleSeekBar = (e: React.ChangeEvent<HTMLInputElement>) => {
    seekToSec(parseFloat(e.target.value) * duration);
  };
  const handleSeekBack = () => seekToSec(currentTime - SEEK_STEP);
  const handleSeekForward = () => seekToSec(currentTime + SEEK_STEP);

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  // ── HUD lines (burned into the export only — no live overlay) ────────────
  const buildHudLines = (atSec: number): string[] => {
    const lines: string[] = [];
    if (hudUser) lines.push(`User : ${hudUser}`);
    if (hudMachine) lines.push(`Machine : ${hudMachine}`);
    if (startedAt) {
      const base = new Date(startedAt).getTime();
      if (!isNaN(base)) {
        lines.push(new Date(base + atSec * 1000).toLocaleString(undefined, {
          dateStyle: 'short', timeStyle: 'medium',
        }));
      }
    }
    return lines;
  };

  // ── Export to MP4 ───────────────────────────────────────────────────────
  const handleExport = useCallback(async () => {
    const rec = recordingRef.current;
    if (!rec || exporting) return;
    stopPlayback();
    setExporting(true);
    setExportProgress(0);

    const seekAsync = (ms: number) =>
      new Promise<void>((resolve) => {
        try { rec.seek(ms, () => resolve()); } catch { resolve(); }
      });
    // Let queued image decodes / draws settle onto the layer canvases.
    const settle = () =>
      new Promise<void>((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 25))),
      );

    try {
      const display = rec.getDisplay();
      const durMs = rec.getDuration();

      await seekAsync(0);
      await settle();
      let snap: HTMLCanvasElement = display.flatten();
      const mb = (n: number) => Math.max(16, Math.ceil(n / 16) * 16);
      const cw = mb(snap.width || 1280);
      const ch = mb(snap.height || 720);

      const encCanvas = document.createElement('canvas');
      encCanvas.width = cw;
      encCanvas.height = ch;
      const ctx = encCanvas.getContext('2d')!;

      const drawHud = (atSec: number) => {
        const lines = buildHudLines(atSec);
        if (lines.length === 0) return;
        const fontSize = Math.max(13, Math.round(ch * 0.022));
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
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = '#000000';
        ctx.fillRect(boxX, boxY, boxW, boxH);
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#ffffff';
        ctx.textBaseline = 'top';
        lines.forEach((l, i) => ctx.fillText(l, boxX + hPad, boxY + vPad + i * lineH));
        ctx.restore();
      };

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
        error: (e) => console.error('VideoEncoder:', e),
      });
      encoder.configure({ codec: chosenCodec, width: cw, height: ch, framerate: EXPORT_FPS, bitrate: 4_000_000 });

      const totalFrames = Math.max(1, Math.ceil((durMs / 1000) * EXPORT_FPS));
      for (let fi = 0; fi <= totalFrames; fi++) {
        const tMs = Math.min((fi / EXPORT_FPS) * 1000, durMs);
        await seekAsync(tMs);
        await settle();
        snap = display.flatten();
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, cw, ch);
        if (snap.width && snap.height) ctx.drawImage(snap, 0, 0);
        drawHud(tMs / 1000);

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
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(title ?? 'rdp-session').replace(/\s+/g, '-')}.mp4`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('RDP export failed:', e);
    } finally {
      setExporting(false);
      setExportProgress(0);
      fitRef.current?.(); // restore display scale after flatten() snapshots
    }
  }, [exporting, stopPlayback, hudUser, hudMachine, startedAt, title]);

  return (
    <div className="flex flex-col bg-black rounded-xl overflow-hidden">
      {/* Display area */}
      <div className="relative flex items-center justify-center" style={{ minHeight: 400, background: '#111' }}>
        {status === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="w-8 h-8 text-white animate-spin" />
          </div>
        )}
        {status === 'error' && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center space-y-2">
              <AlertCircle className="w-10 h-10 text-red-500 mx-auto" />
              <p className="text-white text-sm">{error ?? 'Playback error'}</p>
            </div>
          </div>
        )}

        <div
          ref={displayRef}
          className="w-full flex items-center justify-center overflow-hidden"
          style={{ minHeight: 400 }}
        />
      </div>

      {/* Export progress */}
      {exporting && (
        <div className="px-4 py-2 bg-zinc-900 border-t border-zinc-800 flex items-center gap-3">
          <span className="text-xs text-slate-400">Export en cours…</span>
          <div className="flex-1 h-2 bg-zinc-800 rounded overflow-hidden">
            <div className="h-full bg-primary transition-all duration-300" style={{ width: `${exportProgress * 100}%` }} />
          </div>
          <span className="text-xs text-slate-400 tabular-nums">{Math.round(exportProgress * 100)}%</span>
        </div>
      )}

      {/* Playback controls */}
      {status === 'ready' && (
        <div className="px-4 py-3 bg-zinc-900 flex items-center gap-3">
          <button onClick={handlePlayPause} disabled={exporting} className="text-white hover:text-primary transition-colors p-1 disabled:opacity-40" title={playing ? 'Pause' : 'Lecture'}>
            {playing ? <Pause size={20} /> : <Play size={20} />}
          </button>
          <button onClick={handleRestart} disabled={exporting} className="text-slate-400 hover:text-white transition-colors p-1 disabled:opacity-40" title="Redémarrer">
            <RotateCcw size={16} />
          </button>
          <button onClick={handleSpeedCycle} disabled={exporting} className="text-slate-400 hover:text-white transition-colors p-1 flex items-center gap-1 text-xs disabled:opacity-40" title="Vitesse">
            <FastForward size={16} />{SPEEDS[speedIdx]}×
          </button>
          <span className="text-xs text-slate-400 font-mono tabular-nums">
            {fmt(currentTime)} / {fmt(duration)}
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.0001}
            value={progress}
            onChange={handleSeekBar}
            disabled={exporting}
            className="flex-1 h-1.5 rounded-full appearance-none cursor-pointer accent-primary bg-slate-700 disabled:opacity-40"
          />
          <button onClick={handleSeekBack} disabled={exporting} className="text-slate-400 hover:text-white transition-colors p-1 text-xs tabular-nums disabled:opacity-40" title={`-${SEEK_STEP}s`}>
            -{SEEK_STEP}s
          </button>
          <button onClick={handleSeekForward} disabled={exporting} className="text-slate-400 hover:text-white transition-colors p-1 text-xs tabular-nums disabled:opacity-40" title={`+${SEEK_STEP}s`}>
            +{SEEK_STEP}s
          </button>
          <button onClick={handleExport} disabled={exporting} className="text-slate-400 hover:text-white transition-colors p-1 disabled:opacity-40" title="Exporter en vidéo">
            <Download size={16} />
          </button>
        </div>
      )}
    </div>
  );
};

export default GuacamolePlayer;
