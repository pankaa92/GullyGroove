import type { Track } from '../types/music';

export interface HookRange {
  startSec: number;
  endSec: number;
}

const CUSTOM_HOOKS_STORAGE_KEY = 'gg_custom_hooks_v1';
export const MIN_HOOK_SPAN_SEC = 8;

export const CROSSFADE_DEFAULT_MS = 1500;
export const CROSSFADE_MIN_MS = 1200;
export const CROSSFADE_MAX_MS = 2400;
export const CROSSFADE_TICK_MS = 40;
export const FULL_SONG_CUTOFF_LEAD_SEC = 2;

/**
 * Bajao.party BPM-matched equal-power crossfade duration:
 * 1 bar (4 beats) = 240,000 / bpm ms, clamped to [1200ms, 2400ms], default 1500ms.
 */
export function getBpmCrossfadeMs(bpm?: number): number {
  if (!bpm || !Number.isFinite(bpm) || bpm <= 0) return CROSSFADE_DEFAULT_MS;
  const barMs = (240 * 1000) / bpm;
  return Math.min(CROSSFADE_MAX_MS, Math.max(CROSSFADE_MIN_MS, Math.round(barMs)));
}

/**
 * Detects slow/constrained network or device conditions matching bajao.party:
 * Used for adaptive 6s pre-roll lead and lower YouTube playback quality ('tiny').
 */
export function isLiteConnection(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    hardwareConcurrency?: number;
    connection?: {
      saveData?: boolean;
      effectiveType?: string;
      downlink?: number;
      rtt?: number;
    };
  };
  const conn = nav.connection;
  return Boolean(
    conn?.saveData === true ||
      (conn?.effectiveType &&
        ['slow-2g', '2g', '3g'].includes(conn.effectiveType)) ||
      (nav.deviceMemory !== undefined && nav.deviceMemory <= 2) ||
      (nav.hardwareConcurrency !== undefined && nav.hardwareConcurrency <= 2) ||
      (conn?.downlink !== undefined &&
        conn.downlink > 0 &&
        conn.downlink < 1.5) ||
      (conn?.rtt !== undefined && conn.rtt >= 600)
  );
}

/**
 * Network/device-adaptive pre-roll lead window matching bajao.party:
 * 3s on normal connections, 6s on slow/lite connections.
 */
export function getPrerollLeadSec(): number {
  return isLiteConnection() ? 6 : 3;
}

function roundTenth(val: number): number {
  return Math.round(val * 10) / 10;
}

export function getDefaultHookWindow(
  durationSec: number,
  track?: Track | null
): HookRange {
  const safeDur = Math.max(20, Math.round(durationSec || track?.durationSec || 218));

  if (
    track?.hookStartSec !== undefined &&
    track?.hookEndSec !== undefined &&
    Number.isFinite(track.hookStartSec) &&
    Number.isFinite(track.hookEndSec) &&
    track.hookEndSec - track.hookStartSec >= MIN_HOOK_SPAN_SEC &&
    track.hookEndSec <= safeDur + 1
  ) {
    const startSec = Math.max(0, roundTenth(track.hookStartSec));
    const endSec = Math.min(
      safeDur,
      Math.max(startSec + MIN_HOOK_SPAN_SEC, roundTenth(track.hookEndSec))
    );
    return { startSec, endSec };
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
    Math.min(safeDur - MIN_HOOK_SPAN_SEC, roundTenth(startSec))
  );
  const clampedEnd = Math.max(
    clampedStart + MIN_HOOK_SPAN_SEC,
    Math.min(safeDur, roundTenth(endSec))
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
