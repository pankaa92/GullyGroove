import type { Track } from '../types/music';

/**
 * Generates an inaudible 1-second 8kHz mono 8-bit PCM silent WAV Blob URL.
 * Playing this silently on a top-level <audio loop> element while embedded YouTube
 * streams are active lets mobile and desktop browsers maintain OS Audio Focus,
 * lock-screen Media Session controls, and background playback when minimized or
 * when the display is turned off.
 */
let cachedSilentWavUrl: string | null = null;

export function getSilentKeepAliveWavUrl(): string {
  if (cachedSilentWavUrl) return cachedSilentWavUrl;

  const sampleRate = 8000;
  const numSamples = sampleRate; // 1 second
  const dataSize = numSamples;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeAscii = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i += 1) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true); // Byte rate
  view.setUint16(32, 1, true); // Block align
  view.setUint16(34, 8, true); // Bits per sample
  writeAscii(36, 'data');
  view.setUint32(40, dataSize, true);

  // 8-bit unsigned PCM silence midpoint is 128 (0x80)
  for (let i = 0; i < numSamples; i += 1) {
    view.setUint8(44 + i, 128);
  }

  const blob = new Blob([buffer], { type: 'audio/wav' });
  cachedSilentWavUrl = URL.createObjectURL(blob);
  return cachedSilentWavUrl;
}

/**
 * Creates an unthrottled background interval using an inline Web Worker when supported,
 * falling back to window.setInterval. Keeps 8s gapless crossfade and track monitors
 * accurate even when the browser tab is in the background or screen is locked.
 */
export function startBackgroundTicker(
  onTick: () => void,
  intervalMs: number
): () => void {
  if (typeof window === 'undefined') return () => {};

  if (typeof Worker !== 'undefined' && typeof Blob !== 'undefined') {
    try {
      const workerCode = `
        let id = null;
        self.onmessage = function(e) {
          if (e.data && e.data.cmd === 'start') {
            if (id !== null) clearInterval(id);
            id = setInterval(function() { self.postMessage('tick'); }, e.data.ms);
          } else if (e.data && e.data.cmd === 'stop') {
            if (id !== null) clearInterval(id);
            id = null;
          }
        };
      `;
      const blob = new Blob([workerCode], { type: 'application/javascript' });
      const workerUrl = URL.createObjectURL(blob);
      const worker = new Worker(workerUrl);
      worker.onmessage = () => onTick();
      worker.postMessage({ cmd: 'start', ms: intervalMs });

      return () => {
        try {
          worker.postMessage({ cmd: 'stop' });
          worker.terminate();
        } catch {
          // ignore
        }
        URL.revokeObjectURL(workerUrl);
      };
    } catch {
      // Fallback to standard setInterval below
    }
  }

  const timerId = window.setInterval(onTick, intervalMs);
  return () => window.clearInterval(timerId);
}

export interface MediaSessionHandlers {
  onPlay: () => void;
  onPause: () => void;
  onNext: () => void;
  onPrev: () => void;
  onSeekTo: (timeSec: number) => void;
  onSeekBy: (deltaSec: number) => void;
}

export function registerMediaSession(
  track: Track | null,
  isPlaying: boolean,
  handlers: MediaSessionHandlers
): void {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;

  const ms = navigator.mediaSession;
  if (!track) {
    ms.metadata = null;
    ms.playbackState = 'none';
    return;
  }

  let resolvedCover = track.coverUrl;
  try {
    resolvedCover = new URL(track.coverUrl, window.location.href).href;
  } catch {
    // keep raw coverUrl
  }

  if (typeof MediaMetadata !== 'undefined') {
    ms.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album || 'GullyGroove',
      artwork: resolvedCover
        ? [
            { src: resolvedCover, sizes: '256x256', type: 'image/jpeg' },
            { src: resolvedCover, sizes: '512x512', type: 'image/jpeg' },
          ]
        : [],
    });
  }

  ms.playbackState = isPlaying ? 'playing' : 'paused';

  const safeSet = (
    action: MediaSessionAction,
    handler: MediaSessionActionHandler | null
  ) => {
    try {
      ms.setActionHandler(action, handler);
    } catch {
      // Action unsupported on this browser
    }
  };

  safeSet('play', () => handlers.onPlay());
  safeSet('pause', () => handlers.onPause());
  safeSet('nexttrack', () => handlers.onNext());
  safeSet('previoustrack', () => handlers.onPrev());
  safeSet('seekbackward', (details) => {
    handlers.onSeekBy(-(details.seekOffset ?? 10));
  });
  safeSet('seekforward', (details) => {
    handlers.onSeekBy(details.seekOffset ?? 10);
  });
  safeSet('seekto', (details) => {
    if (typeof details.seekTime === 'number' && Number.isFinite(details.seekTime)) {
      handlers.onSeekTo(details.seekTime);
    }
  });
}

export function updateMediaSessionPosition(
  currentTimeSec: number,
  durationSec: number
): void {
  if (
    typeof navigator === 'undefined' ||
    !('mediaSession' in navigator) ||
    typeof navigator.mediaSession.setPositionState !== 'function'
  ) {
    return;
  }
  if (!Number.isFinite(durationSec) || durationSec <= 0) return;

  const safePos = Math.max(
    0,
    Math.min(durationSec, Number.isFinite(currentTimeSec) ? currentTimeSec : 0)
  );
  try {
    navigator.mediaSession.setPositionState({
      duration: durationSec,
      playbackRate: 1,
      position: safePos,
    });
  } catch {
    // Ignore transient MediaSession state errors
  }
}
