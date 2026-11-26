import { AudioLines, Check, RotateCcw, Scissors } from 'lucide-react';
import { memo, useMemo, useRef } from 'react';
import { formatDuration } from '../utils/format';
import {
  clampHookWindow,
  generateWaveformBars,
  MIN_HOOK_SPAN_SEC,
} from '../utils/hookTiming';

interface StudioWaveformScrubberProps {
  trackId: string;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  bpm?: number;
  hookMode: boolean;
  hookStartSec: number;
  hookEndSec: number;
  hasCustomHook: boolean;
  onSeek: (seconds: number) => void;
  onUpdateHook: (startSec: number, endSec: number) => void;
  onResetHook: () => void;
}

export const StudioWaveformScrubber = memo(function StudioWaveformScrubber({
  trackId,
  currentTime,
  duration,
  isPlaying,
  bpm,
  hookMode,
  hookStartSec,
  hookEndSec,
  hasCustomHook,
  onSeek,
  onUpdateHook,
  onResetHook,
}: StudioWaveformScrubberProps) {
  const waveContainerRef = useRef<HTMLDivElement | null>(null);
  const bars = useMemo(() => generateWaveformBars(trackId, 56), [trackId]);

  const safeDur = Math.max(20, duration || 218);
  const progressRatio = Math.max(0, Math.min(1, currentTime / safeDur));
  const hookStartPct = Math.max(0, Math.min(100, (hookStartSec / safeDur) * 100));
  const hookEndPct = Math.max(hookStartPct, Math.min(100, (hookEndSec / safeDur) * 100));
  const hookSpanSec = Math.max(MIN_HOOK_SPAN_SEC, Math.round(hookEndSec - hookStartSec));
  const safeBpm = Math.max(70, Math.min(180, bpm || 110));
  const beatMs = Math.round(60000 / safeBpm);

  const seekFromPointer = (clientX: number) => {
    const el = waveContainerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    onSeek(ratio * safeDur);
  };

  const handleStartChange = (nextStart: number) => {
    const clamped = clampHookWindow(
      nextStart,
      Math.max(hookEndSec, nextStart + MIN_HOOK_SPAN_SEC),
      safeDur
    );
    onUpdateHook(clamped.startSec, clamped.endSec);
  };

  const handleEndChange = (nextEnd: number) => {
    const clamped = clampHookWindow(
      Math.min(hookStartSec, nextEnd - MIN_HOOK_SPAN_SEC),
      nextEnd,
      safeDur
    );
    onUpdateHook(clamped.startSec, clamped.endSec);
  };

  return (
    <div className="rounded-2xl bg-[#0D0F22]/85 border border-violet-400/25 p-2.5 sm:p-3 space-y-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_12px_32px_-16px_rgba(91,33,182,0.55)]">
      {/* Hook Card Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600/35 to-cyan-500/25 border border-violet-400/35 text-violet-300 shadow-[0_0_16px_-4px_rgba(139,92,246,0.65)]">
            <AudioLines className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <p className="text-xs sm:text-[13px] font-semibold text-white leading-tight truncate">
              Hook Mode
            </p>
            <p className="text-[11px] font-mono-tabular text-slate-400 leading-tight mt-0.5 truncate">
              {formatDuration(hookStartSec)} – {formatDuration(hookEndSec)} · {hookSpanSec} sec
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {hasCustomHook ? (
            <button
              type="button"
              onClick={onResetHook}
              className="inline-flex h-8 items-center gap-1 px-2.5 rounded-lg bg-white/[0.05] border border-white/[0.08] text-[11px] font-medium text-slate-300 hover:text-white transition-colors whitespace-nowrap"
              title="Reset to default song hook"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset</span>
            </button>
          ) : null}

          <button
            type="button"
            onClick={() => onSeek(hookStartSec)}
            title="Jump to hook start"
            className="inline-flex h-8 items-center gap-1.5 px-2.5 sm:px-3 rounded-xl bg-gradient-to-r from-violet-600/90 to-blue-500/90 border border-violet-300/35 text-[11px] font-semibold text-white shadow-[0_4px_16px_-4px_rgba(124,58,237,0.65)] hover:opacity-95 transition-opacity whitespace-nowrap shrink-0"
          >
            <Check className="w-3 h-3" />
            <span>{hasCustomHook ? 'Custom Hook' : 'Hook Selected'}</span>
          </button>
        </div>
      </div>

      {/* Classic Bar Audio Waveform & Highlighted Hook Window */}
      <div
        ref={waveContainerRef}
        role="slider"
        tabIndex={0}
        aria-label="Audio progress waveform"
        aria-valuemin={0}
        aria-valuemax={Math.round(safeDur)}
        aria-valuenow={Math.round(currentTime)}
        onClick={(e) => seekFromPointer(e.clientX)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') onSeek(Math.min(safeDur, currentTime + 5));
          else if (e.key === 'ArrowLeft') onSeek(Math.max(0, currentTime - 5));
        }}
        className="gg-waveform-well relative h-12 sm:h-13 w-full rounded-xl bg-[#070813]/95 border border-white/[0.08] px-2 pt-2 pb-1.5 flex items-end gap-[2px] cursor-pointer select-none overflow-hidden focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet-400"
      >
        {/* Subtle Classic Baseline Floor */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-2 bottom-1.5 h-px bg-white/[0.12]"
        />

        {/* Classic Hook Window Highlight Bracket */}
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute inset-y-1 border-x-2 transition-opacity duration-200 ${
            hookMode
              ? 'bg-gradient-to-b from-violet-500/18 via-violet-500/10 to-cyan-400/20 border-l-violet-400 border-r-cyan-300 opacity-100'
              : 'bg-violet-500/[0.06] border-l-violet-400/40 border-r-cyan-400/40 opacity-65'
          }`}
          style={{
            left: `${hookStartPct}%`,
            width: `${Math.max(2.5, hookEndPct - hookStartPct)}%`,
          }}
        >
          <span className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-violet-400 to-cyan-300" />
          <span className="absolute -top-0.5 -left-[4px] h-2 w-1.5 rounded-xs bg-violet-300 shadow-[0_0_6px_rgba(167,139,250,0.9)]" />
          <span className="absolute -top-0.5 -right-[4px] h-2 w-1.5 rounded-xs bg-cyan-300 shadow-[0_0_6px_rgba(56,189,248,0.9)]" />
        </div>

        {/* Classic Vertical Playhead Line */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-1 z-[3] w-[2px] -translate-x-1/2 bg-white shadow-[0_0_8px_rgba(255,255,255,0.85)]"
          style={{ left: `${progressRatio * 100}%` }}
        />

        {bars.map((height, idx) => {
          const barPct = ((idx + 0.5) / bars.length) * 100;
          const isPlayed = barPct <= progressRatio * 100;
          const inHook = barPct >= hookStartPct && barPct <= hookEndPct;
          const barDurationMs =
            idx % 3 === 0
              ? beatMs
              : idx % 3 === 1
                ? Math.round(beatMs * 0.88)
                : Math.round(beatMs * 1.14);
          const barDelayMs = -((idx * 137) % barDurationMs);

          return (
            <span
              key={idx}
              aria-hidden="true"
              className={`relative z-[1] flex-1 rounded-t-[1.5px] rounded-b-none transition-colors duration-150 ${
                inHook
                  ? isPlayed
                    ? 'bg-gradient-to-t from-violet-500 via-fuchsia-400 to-cyan-300'
                    : 'bg-gradient-to-t from-violet-500/85 to-cyan-400/80'
                  : isPlayed
                    ? 'bg-gradient-to-t from-violet-600/85 to-blue-400/85'
                    : 'bg-slate-600/45 hover:bg-violet-400/60'
              } ${
                isPlaying
                  ? inHook
                    ? 'gg-wave-classic-hook'
                    : 'gg-wave-classic-bar'
                  : ''
              }`}
              style={{
                height: `${Math.max(18, Math.round(height * (isPlaying ? 76 : 96)))}%`,
                animationDuration: isPlaying ? `${barDurationMs}ms` : undefined,
                animationDelay: isPlaying ? `${barDelayMs}ms` : undefined,
              }}
            />
          );
        })}
      </div>

      {/* Dual Hook Handles & Time Readout */}
      <div className="space-y-1">
        <div className="relative h-3.5 flex items-center">
          <div className="absolute left-0 right-0 h-1 rounded-full bg-white/10" />
          <div
            className="absolute h-1 rounded-full bg-gradient-to-r from-fuchsia-500 via-violet-500 to-cyan-400"
            style={{
              left: `${hookStartPct}%`,
              width: `${Math.max(2, hookEndPct - hookStartPct)}%`,
            }}
          />
          <input
            type="range"
            aria-label="Hook start time"
            min={0}
            max={Math.max(MIN_HOOK_SPAN_SEC, Math.floor(safeDur) - MIN_HOOK_SPAN_SEC)}
            step={1}
            value={Math.round(hookStartSec)}
            onChange={(e) => handleStartChange(Number(e.target.value))}
            className="gg-dual-range absolute inset-0 w-full pointer-events-none"
          />
          <input
            type="range"
            aria-label="Hook end time"
            min={MIN_HOOK_SPAN_SEC}
            max={Math.max(20, Math.floor(safeDur))}
            step={1}
            value={Math.round(hookEndSec)}
            onChange={(e) => handleEndChange(Number(e.target.value))}
            className="gg-dual-range absolute inset-0 w-full pointer-events-none"
          />
        </div>

        <div className="flex items-center justify-between gap-1.5 text-[10px] sm:text-[11px] font-mono-tabular">
          <button
            type="button"
            onClick={() => onSeek(hookStartSec)}
            className="inline-flex items-center gap-1 text-violet-300 hover:text-white transition-colors shrink-0"
            title="Jump to hook start"
          >
            <Scissors className="w-3 h-3" />
            <span>Start {formatDuration(hookStartSec)}</span>
          </button>

          <span className="text-slate-400 font-sans text-center truncate">
            Drag handles to adjust hook
          </span>

          <button
            type="button"
            onClick={() => onSeek(hookEndSec)}
            className="text-cyan-300 hover:text-white transition-colors shrink-0"
            title="Jump to hook end"
          >
            End {formatDuration(hookEndSec)}
          </button>
        </div>
      </div>
    </div>
  );
});
