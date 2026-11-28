import type { Track } from '../types/music';

export interface HookRange {
  startSec: number;
  endSec: number;
}

const CUSTOM_HOOKS_STORAGE_KEY = 'gg_custom_hooks_v1';
export const MIN_HOOK_SPAN_SEC = 8;

export const CROSSFADE_DEFAULT_SEC = 8;
export const CROSSFADE_MIN_SEC = 2;
export const CROSSFADE_MAX_SEC = 12;
export const DJ_CROSSFADE_DEFAULT_SEC = 12;
export const DJ_CROSSFADE_MIN_SEC = 10;
export const DJ_CROSSFADE_MAX_SEC = 16;

export const CROSSFADE_DEFAULT_MS = CROSSFADE_DEFAULT_SEC * 1000;
export const CROSSFADE_MIN_MS = 1200;
export const CROSSFADE_MAX_MS = DJ_CROSSFADE_MAX_SEC * 1000;
export const CROSSFADE_TICK_MS = 40;
export const MANUAL_SWITCH_FADE_MS = 240;
export const FULL_SONG_CUTOFF_LEAD_SEC = 5;
export const DEFAULT_ENTRY_START_SEC = 25;

const CROSSFADE_SETTINGS_STORAGE_KEY = 'gg_crossfade_settings_v2';

export interface CrossfadeSettings {
  crossfadeSec: number;
  djMode: boolean;
  djCrossfadeSec: number;
}

export const DEFAULT_CROSSFADE_SETTINGS: CrossfadeSettings = {
  crossfadeSec: CROSSFADE_DEFAULT_SEC,
  djMode: true,
  djCrossfadeSec: DJ_CROSSFADE_DEFAULT_SEC,
};

export function clampCrossfadeSettings(
  raw?: Partial<CrossfadeSettings> | null
): CrossfadeSettings {
  const crossfadeSec =
    typeof raw?.crossfadeSec === 'number' && Number.isFinite(raw.crossfadeSec)
      ? Math.max(CROSSFADE_MIN_SEC, Math.min(CROSSFADE_MAX_SEC, Math.round(raw.crossfadeSec)))
      : CROSSFADE_DEFAULT_SEC;
  const djMode = typeof raw?.djMode === 'boolean' ? raw.djMode : true;
  const djCrossfadeSec =
    typeof raw?.djCrossfadeSec === 'number' && Number.isFinite(raw.djCrossfadeSec)
      ? Math.max(DJ_CROSSFADE_MIN_SEC, Math.min(DJ_CROSSFADE_MAX_SEC, Math.round(raw.djCrossfadeSec)))
      : DJ_CROSSFADE_DEFAULT_SEC;
  return { crossfadeSec, djMode, djCrossfadeSec };
}

export function loadCrossfadeSettings(): CrossfadeSettings {
  if (typeof window === 'undefined') return DEFAULT_CROSSFADE_SETTINGS;
  try {
    const raw = window.localStorage.getItem(CROSSFADE_SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_CROSSFADE_SETTINGS;
    return clampCrossfadeSettings(JSON.parse(raw) as Partial<CrossfadeSettings>);
  } catch {
    return DEFAULT_CROSSFADE_SETTINGS;
  }
}

export function saveCrossfadeSettings(settings: CrossfadeSettings): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      CROSSFADE_SETTINGS_STORAGE_KEY,
      JSON.stringify(clampCrossfadeSettings(settings))
    );
  } catch {
    // ignore storage quota errors
  }
}

/**
 * Automatic end-of-track crossfade duration (default 8s, or extended 10s-16s in DJ Mode).
 * When BPM is available, nudges smoothly within +/-350ms to land cleanly on a musical phrase.
 */
export function getAutoCrossfadeMs(
  settings: CrossfadeSettings,
  bpm?: number
): number {
  const safe = clampCrossfadeSettings(settings);
  const baseSec = safe.djMode ? safe.djCrossfadeSec : safe.crossfadeSec;
  const baseMs = baseSec * 1000;
  if (!bpm || !Number.isFinite(bpm) || bpm <= 0) return baseMs;
  const beatMs = 60000 / bpm;
  const barMs = beatMs * 4;
  const nearestBars = Math.max(1, Math.round(baseMs / barMs)) * barMs;
  if (Math.abs(nearestBars - baseMs) <= 350) {
    return Math.round(nearestBars);
  }
  return baseMs;
}

/**
 * Legacy helper returning BPM-aligned crossfade duration centered around default 8s.
 */
export function getBpmCrossfadeMs(bpm?: number): number {
  return getAutoCrossfadeMs(DEFAULT_CROSSFADE_SETTINGS, bpm);
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

function hashSeedUnit(seed: string, salt = 0): number {
  let hash = 2166136261 ^ salt;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 10000) / 10000;
}

/**
 * Computes a heat-peak hook window from a bajao-style 12-bucket heat array.
 */
function getHeatPeakHookWindow(heat: number[], safeDur: number): HookRange {
  const n = heat.length;
  const targetSpan = Math.min(58, Math.max(36, Math.round(safeDur * 0.24)));
  const bucketDur = safeDur / Math.max(1, n);
  const windowBuckets = Math.max(1, Math.min(n - 1, Math.round(targetSpan / bucketDur)));

  // Avoid starting in the final trailing bucket when song has room
  const maxStartIdx = Math.max(0, n - windowBuckets - (safeDur > 140 ? 1 : 0));
  let bestIdx = 0;
  let bestScore = -1;

  for (let i = 0; i <= maxStartIdx; i += 1) {
    let sum = 0;
    for (let k = 0; k < windowBuckets; k += 1) {
      sum += heat[i + k] ?? 0;
    }
    // Slight preference for first half/chorus climax over outro repeat if tied
    const positionBias = i <= Math.floor(n * 0.55) ? 1.03 : 1;
    const score = (sum / windowBuckets) * positionBias;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  const startSec = roundTenth(Math.max(4, Math.min(safeDur - MIN_HOOK_SPAN_SEC - 4, bestIdx * bucketDur)));
  const endSec = roundTenth(Math.min(safeDur - 2, startSec + targetSpan));
  return clampHookWindow(startSec, endSec, safeDur);
}

/**
 * Bajao.party-style entry start offset (~25s or curated entry_sec) for helper callers.
 */
export function getEntryStartSec(
  track?: Track | null,
  durationSec?: number
): number {
  if (!track) return 0;
  const knownDur =
    Number.isFinite(durationSec) && (durationSec ?? 0) > 0
      ? Number(durationSec)
      : track.durationSec > 0
        ? track.durationSec
        : 0;

  if (
    track.hookStartSec !== undefined &&
    Number.isFinite(track.hookStartSec) &&
    track.hookStartSec >= 0 &&
    (knownDur === 0 || track.hookStartSec < knownDur - MIN_HOOK_SPAN_SEC)
  ) {
    return roundTenth(track.hookStartSec);
  }

  return getDefaultHookWindow(knownDur || 218, track).startSec;
}

/**
 * Computes per-song Hook Mode [startSec, endSec] matching bajao.party:
 * 1) Songs with curated hookStartSec/hookEndSec honor their exact Bajao entry_sec & exit_sec
 *    (whether 5s, 14.5s, 32.8s, 86s, or 107.7s — never forcibly overwritten to 25s).
 * 2) Songs with a heat curve pick their highest-intensity drop window.
 * 3) All other tracks derive a distinct, BPM/genre/duration-tailored hook window so
 *    different songs never share an identical generic hook cutout.
 */
export function getDefaultHookWindow(
  durationSec: number,
  track?: Track | null
): HookRange {
  const safeDur = Math.max(20, Math.round(durationSec || track?.durationSec || 218));

  // 1. Honor curated per-song Bajao entry_sec / exit_sec directly
  if (
    track?.hookStartSec !== undefined &&
    track?.hookEndSec !== undefined &&
    Number.isFinite(track.hookStartSec) &&
    Number.isFinite(track.hookEndSec) &&
    track.hookEndSec - track.hookStartSec >= MIN_HOOK_SPAN_SEC
  ) {
    return clampHookWindow(track.hookStartSec, track.hookEndSec, safeDur);
  }

  // 2. Heat-peak fallback if heat curve exists without explicit bounds
  if (track?.heat && track.heat.length >= 4 && safeDur >= 60) {
    return getHeatPeakHookWindow(track.heat, safeDur);
  }

  const seed = track?.id || track?.embedId || track?.title || 'gullygroove-track';
  const r1 = hashSeedUnit(seed, 11);
  const r2 = hashSeedUnit(seed, 37);

  // 3a. Short previews / clips (< 75s)
  if (safeDur < 75) {
    const startRatio = 0.12 + r1 * 0.14;
    const startSec = roundTenth(
      Math.min(Math.max(4, safeDur * startRatio), Math.max(2, safeDur - MIN_HOOK_SPAN_SEC - 4))
    );
    const endSec = roundTenth(
      Math.min(safeDur - 1.5, Math.max(startSec + MIN_HOOK_SPAN_SEC, safeDur * (0.78 + r2 * 0.12)))
    );
    return clampHookWindow(startSec, endSec, safeDur);
  }

  const descriptor = `${track?.genre ?? ''} ${track?.title ?? ''} ${track?.album ?? ''}`;
  const bpm = track?.bpm && Number.isFinite(track.bpm) ? track.bpm : 112;
  const isMashupOrJukebox =
    safeDur >= 420 || /mashup|jukebox|non[- ]?stop|medley|mega\s*mix/i.test(descriptor);
  const isHighEnergy =
    bpm >= 122 ||
    (track?.energy !== undefined && track.energy >= 8) ||
    /bhangra|club|dj|party|remix|edm|electronic|house|gym|workout|rap|hip[- ]?hop|daru|haryanvi/i.test(
      descriptor
    );
  const isMelodicSlow =
    bpm <= 104 ||
    /romantic|2\s*am|sufi|ghazal|lofi|lo-fi|retro|classic|evergreen|bhakti|bhajan|aarti|folk|unplugged|acoustic/i.test(
      descriptor
    );

  let startSec: number;
  let spanSec: number;

  if (isMashupOrJukebox) {
    // Nonstop mashups & jukeboxes: land cleanly across varied drop points (26s..96s)
    const maxMashupStart = Math.min(98, Math.round(safeDur * 0.25));
    startSec = roundTenth(26 + r1 * Math.max(20, maxMashupStart - 26));
    spanSec = Math.round(52 + r2 * 16);
  } else if (isHighEnergy) {
    // Fast-drop dance/club/bhangra/gym tracks: early-to-mid drop (11%..25% of song, 14s..54s)
    const minS = Math.min(28, Math.max(12, safeDur * 0.11));
    const maxS = Math.min(54, Math.max(minS + 10, safeDur * 0.25));
    startSec = roundTenth(minS + r1 * (maxS - minS));
    spanSec = Math.round(39 + r2 * 15);
  } else if (isMelodicSlow) {
    // Melodic, 2AM, Retro, Sufi & Devotional tracks: main mukhda/chorus lift (17%..33%, 22s..74s)
    const minS = Math.min(34, Math.max(20, safeDur * 0.17));
    const maxS = Math.min(74, Math.max(minS + 14, safeDur * 0.33));
    startSec = roundTenth(minS + r1 * (maxS - minS));
    spanSec = Math.round(44 + r2 * 16);
  } else {
    // Standard mid-tempo Bollywood / Indipop / Regional tracks (14%..29%, 18s..62s)
    const minS = Math.min(30, Math.max(18, safeDur * 0.14));
    const maxS = Math.min(62, Math.max(minS + 12, safeDur * 0.29));
    startSec = roundTenth(minS + r1 * (maxS - minS));
    spanSec = Math.round(42 + r2 * 15);
  }

  const maxAllowedStart = Math.max(8, safeDur - MIN_HOOK_SPAN_SEC - 12);
  startSec = roundTenth(Math.min(startSec, maxAllowedStart));
  const endSec = roundTenth(Math.min(safeDur - 3, startSec + spanSec));

  return clampHookWindow(startSec, endSec, safeDur);
}

/**
 * Matches bajao.party Ra(entry, exit, duration):
 * - 0.1s precision rounding
 * - Minimum 8s hook span
 * - Clamped within [0, duration]
 */
export function clampHookWindow(
  startSec: number,
  endSec: number,
  durationSec: number
): HookRange {
  const safeDur = Math.max(20, Math.round(durationSec || 218));
  const safeStartRaw = Number.isFinite(startSec) ? startSec : 0;
  let clampedStart = Math.max(
    0,
    Math.min(safeStartRaw, Math.max(0, safeDur - MIN_HOOK_SPAN_SEC))
  );
  let clampedEnd = Number.isFinite(endSec) ? endSec : clampedStart + 50;
  clampedEnd = Math.min(Math.max(clampedEnd, clampedStart + MIN_HOOK_SPAN_SEC), safeDur);
  if (clampedEnd - clampedStart < MIN_HOOK_SPAN_SEC) {
    clampedStart = Math.max(0, clampedEnd - MIN_HOOK_SPAN_SEC);
  }
  return {
    startSec: roundTenth(clampedStart),
    endSec: roundTenth(clampedEnd),
  };
}

/**
 * Matches bajao.party setHookWindow(which, targetSec):
 * - 'start': clamps [0, currentEnd - MIN_HOOK_SPAN_SEC]
 * - 'end': prevents dragging end behind (currentTime + 1.5s) while playing
 */
export function adjustHookBoundary(
  which: 'start' | 'end',
  targetSec: number,
  currentHook: HookRange,
  durationSec: number,
  currentTimeSec = 0,
  isPlaying = false
): HookRange {
  const safeDur = Math.max(20, Math.round(durationSec || 218));
  if (!Number.isFinite(targetSec)) {
    return clampHookWindow(currentHook.startSec, currentHook.endSec, safeDur);
  }

  if (which === 'start') {
    const maxStart = Math.max(0, currentHook.endSec - MIN_HOOK_SPAN_SEC);
    const nextStart = roundTenth(Math.min(Math.max(0, targetSec), maxStart));
    return clampHookWindow(nextStart, currentHook.endSec, safeDur);
  }

  const playingFloor = isPlaying && Number.isFinite(currentTimeSec) ? currentTimeSec + 1.5 : 0;
  const minEnd = Math.max(currentHook.startSec + MIN_HOOK_SPAN_SEC, playingFloor);
  const maxEnd = Math.max(minEnd, safeDur);
  const nextEnd = roundTenth(Math.min(Math.max(minEnd, targetSec), maxEnd));
  return clampHookWindow(currentHook.startSec, nextEnd, safeDur);
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
 * Generates deterministic studio waveform bar heights (0.2..1.0) per track ID.
 * When Bajao's 12-bucket `heat` curve is available, bars follow the real song energy contour.
 */
export function generateWaveformBars(
  seedId: string,
  count = 56,
  heat?: number[]
): number[] {
  let hash = 2166136261;
  for (let i = 0; i < seedId.length; i += 1) {
    hash ^= seedId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  const hasHeat = Array.isArray(heat) && heat.length >= 2;
  const bars: number[] = [];

  for (let i = 0; i < count; i += 1) {
    hash ^= (i + 1) * 0x9e3779b1;
    hash = Math.imul(hash, 0x85ebca6b);
    const norm = ((hash >>> 0) % 1000) / 1000;
    const pos = i / Math.max(1, count - 1);

    let height: number;
    if (hasHeat) {
      const heatPos = pos * (heat.length - 1);
      const lo = Math.floor(heatPos);
      const hi = Math.min(heat.length - 1, lo + 1);
      const frac = heatPos - lo;
      const interp = ((heat[lo] ?? 65) * (1 - frac) + (heat[hi] ?? 65) * frac) / 100;
      const heatContour = 0.22 + interp * 0.78;
      // Blend real song heat curve (78%) with subtle bar micro-dynamics (22%)
      height = Math.max(0.2, Math.min(1, heatContour * 0.78 + (0.28 + norm * 0.72) * 0.22));
    } else {
      const energy = 0.72 + 0.28 * Math.sin(pos * Math.PI);
      height = Math.max(0.2, Math.min(1, (0.26 + norm * 0.74) * energy));
    }

    bars.push(Number(height.toFixed(3)));
  }
  return bars;
}
