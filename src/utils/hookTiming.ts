import type { Track } from '../types/music';

export interface HookRange {
  startSec: number;
  endSec: number;
}

const CUSTOM_HOOKS_STORAGE_KEY = 'gg_custom_hooks_v1';
const MIN_HOOK_SPAN_SEC = 10;

export function getDefaultHookWindow(
  durationSec: number,
  track?: Track | null
): HookRange {
  const safeDur = Math.max(30, Math.round(durationSec || track?.durationSec || 218));

  if (
    track?.hookStartSec !== undefined &&
    track?.hookEndSec !== undefined &&
    Number.isFinite(track.hookStartSec) &&
    Number.isFinite(track.hookEndSec) &&
    track.hookEndSec - track.hookStartSec >= MIN_HOOK_SPAN_SEC &&
    track.hookEndSec <= safeDur
  ) {
    return {
      startSec: Math.max(0, Math.round(track.hookStartSec)),
      endSec: Math.min(safeDur, Math.round(track.hookEndSec)),
    };
  }

  const startSec = Math.min(
    Math.max(12, Math.round(safeDur * 0.22)),
    Math.max(12, safeDur - 35)
  );
  const spanSec = Math.min(64, Math.max(25, Math.round(safeDur * 0.3)));
  const endSec = Math.min(safeDur - 3, startSec + spanSec);

  return {
    startSec,
    endSec: Math.max(startSec + MIN_HOOK_SPAN_SEC, endSec),
  };
}

export function clampHookWindow(
  startSec: number,
  endSec: number,
  durationSec: number
): HookRange {
  const safeDur = Math.max(20, Math.round(durationSec || 218));
  const clampedStart = Math.max(
    0,
    Math.min(safeDur - MIN_HOOK_SPAN_SEC, Math.round(startSec))
  );
  const clampedEnd = Math.max(
    clampedStart + MIN_HOOK_SPAN_SEC,
    Math.min(safeDur, Math.round(endSec))
  );
  return { startSec: clampedStart, endSec: clampedEnd };
}

export function loadCustomHooks(): Record<string, HookRange> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(CUSTOM_HOOKS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, HookRange>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function saveCustomHooksMap(map: Record<string, HookRange>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CUSTOM_HOOKS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore storage quota errors
  }
}

/**
 * Generates deterministic studio waveform bar heights (0.22..1.0) per track ID.
 */
export function generateWaveformBars(seedId: string, count = 48): number[] {
  let hash = 2166136261;
  for (let i = 0; i < seedId.length; i += 1) {
    hash ^= seedId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  const bars: number[] = [];
  for (let i = 0; i < count; i += 1) {
    hash ^= (i + 1) * 0x9e3779b1;
    hash = Math.imul(hash, 0x85ebca6b);
    const norm = ((hash >>> 0) % 1000) / 1000;
    // Musical envelope: build toward chorus drops around 25%-70%
    const pos = i / Math.max(1, count - 1);
    const energy = 0.72 + 0.28 * Math.sin(pos * Math.PI);
    const height = Math.max(0.2, Math.min(1, (0.26 + norm * 0.74) * energy));
    bars.push(Number(height.toFixed(3)));
  }
  return bars;
}
