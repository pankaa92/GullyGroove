import { RotateCcw, Scissors } from 'lucide-react';
import { memo, useMemo, useRef } from 'react';
import { formatDuration } from '../utils/format';
import { clampHookWindow, generateWaveformBars, MIN_HOOK_SPAN_SEC } from '../utils/hookTiming';

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
  const bars = useMemo(() => generateWaveformBars(trackId, 48), [trackId]);

  const safeDur = Math.max(20, duration || 218);
  const progressRatio = Math.max(0, Math.min(1, currentTime / safeDur));
  const hookStartPct = Math.max(0, Math.min(100, (hookStartSec / safeDur) * 100));
  const hookEndPct = Math.max(hookStartPct, Math.min(100, (hookEndSec / safeDur) * 100));
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
    <div className="space-y-1">
      {/* Interactive 48-bar Beat-Reactive Waveform & Hook Scrubber */}
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
        className="gg-waveform-well relative h-9 sm:h-10 w-full rounded-xl bg-[#0A0A12] border border-white/[0.07] px-2 py-1 flex items-center gap-[3px] cursor-pointer select-none overflow-hidden focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet-500"
      >
        {/* Active Hook Window Overlay Band */}
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute inset-y-0 transition-opacity duration-200 border-x ${
            hookMode
              ? 'bg-gradient-to-r from-violet-600/20 via-blue-500/20 to-violet-600/20 border-violet-400/60 opacity-100'
              : 'bg-violet-500/[0.08] border-violet-400/25 opacity-70'
          }`}
          style={{
            left: `${hookStartPct}%`,
            width: `${Math.max(2, hookEndPct - hookStartPct)}%`,
          }}
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
          const barDelayMs = -(((idx * 137) % barDurationMs));

          return (
            <span
              key={idx}
              aria-hidden="true"
              className={`relative z-[1] flex-1 rounded-full transition-colors duration-150 ${
                isPlayed
                  ? 'bg-gradient-to-t from-violet-500 to-blue-400'
                  : inHook
                    ? isPlaying
                      ? 'bg-gradient-to-t from-violet-400/75 to-blue-400/70'
                      : 'bg-violet-400/45'
                    : 'bg-white/20 hover:bg-white/35'
              } ${
                isPlaying
                  ? inHook
                    ? 'gg-wave-beat-hook'
                    : 'gg-wave-beat-bar'
                  : ''
              }`}
              style={{
                height: `${Math.round(height * (isPlaying ? 74 : 96))}%`,
                animationDuration: isPlaying ? `${barDurationMs}ms` : undefined,
                animationDelay: isPlaying ? `${barDelayMs}ms` : undefined,
              }}
            />
          );
        })}
      </div>

      {/* Dual Hook Handles & Time Readout */}
      <div className="space-y-0.5">
        {/* Dual Range Track for Hook Start & Hook End */}
        <div className="relative h-3.5 flex items-center">
          <div className="absolute left-0 right-0 h-1 rounded-full bg-white/10" />
          <div
            className="absolute h-1 rounded-full bg-gradient-to-r from-violet-500 to-blue-500"
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

        {/* Clean Unboxed Metadata Row */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] sm:text-[11px] font-mono-tabular">
          <button
            type="button"
            onClick={() => onSeek(hookStartSec)}
            className="inline-flex items-center gap-1.5 text-violet-300 hover:text-white transition-colors"
            title="Jump to hook start"
          >
            <Scissors className="w-3 h-3" />
            <span>Start {formatDuration(hookStartSec)}</span>
          </button>

          <span className="text-slate-400 font-sans hidden sm:inline">
            Drag handles to set your hook ·{' '}
            <span className="font-mono-tabular text-slate-200">
              {formatDuration(currentTime)} / {formatDuration(safeDur)}
            </span>
          </span>

          <div className="flex items-center gap-3">
            {hasCustomHook ? (
              <button
                type="button"
                onClick={onResetHook}
                className="inline-flex items-center gap-1 text-slate-400 hover:text-white transition-colors"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset</span>
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => onSeek(hookEndSec)}
              className="text-blue-300 hover:text-white transition-colors"
              title="Jump to hook end"
            >
              End {formatDuration(hookEndSec)}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});
