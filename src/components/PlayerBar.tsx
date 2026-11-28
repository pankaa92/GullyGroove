import {
  AudioLines,
  ChevronDown,
  ChevronUp,
  Clock,
  ExternalLink,
  Heart,
  History,
  ListMusic,
  Maximize2,
  Music2,
  Pause,
  Play,
  Plus,
  Repeat,
  Repeat1,
  Scissors,
  Shuffle,
  SkipBack,
  SkipForward,
  Tv,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Track } from '../types/music';
import {
  getSilentKeepAliveWavUrl,
  registerMediaSession,
  startBackgroundTicker,
  updateMediaSessionPosition,
} from '../utils/backgroundAudio';
import { formatDuration } from '../utils/format';
import {
  CROSSFADE_TICK_MS,
  DEFAULT_CROSSFADE_SETTINGS,
  getAutoCrossfadeMs,
  getDefaultHookWindow,
  getPrerollLeadSec,
  isLiteConnection,
  loadCustomHooks,
  MANUAL_SWITCH_FADE_MS,
  MIN_HOOK_SPAN_SEC,
  saveCustomHooksMap,
  type CrossfadeSettings,
  type HookRange,
} from '../utils/hookTiming';
import { ArtworkImage } from './ArtworkImage';
import { BrandLogo } from './BrandLogo';
import { StudioWaveformScrubber } from './StudioWaveformScrubber';

export type RepeatMode = 'off' | 'all' | 'one';
type ConsoleDrawerTab = 'queue' | 'recent' | null;

const PREROLL_MIN_REMAINING_SEC = 0.4;
const PREROLL_DRIFT_SNAP_SEC = 0.2;
const CROSSFADE_ATTEMPT_DEBOUNCE_MS = 3500;
const YT_BUFFER_WATCHDOG_MS = 9000;
const YT_UNSKIPPABLE_AD_BYPASS_MS = 4500;
const MAX_CONSECUTIVE_AD_SKIPS = 3;
type YtSlotMode = 'idle' | 'active' | 'precue' | 'preroll' | 'crossfade' | 'fadeout';

function isLikelyYtAdDuration(
  reportedDur: number,
  track: Track | null | undefined
): boolean {
  if (!track || !Number.isFinite(reportedDur) || reportedDur <= 0) return false;
  if (track.durationSec >= 90) {
    return reportedDur < Math.min(65, track.durationSec * 0.45);
  }
  if (track.durationSec >= 45) {
    return reportedDur < Math.min(35, track.durationSec * 0.45);
  }
  // Tracks without pre-known duration (durationSec === 0): YouTube pre-roll ads are <= 45s
  return reportedDur <= 45;
}

interface YTPlayerInstance {
  playVideo: () => void;
  pauseVideo: () => void;
  stopVideo?: () => void;
  loadVideoById?: (options: { videoId: string; startSeconds?: number }) => void;
  cueVideoById?: (options: { videoId: string; startSeconds?: number }) => void;
  seekTo: (seconds: number, allowSeekAhead?: boolean) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  getPlayerState?: () => number;
  setPlaybackQuality?: (suggestedQuality: string) => void;
  setVolume: (volume: number) => void;
  mute: () => void;
  unMute: () => void;
  destroy: () => void;
}

interface YTNamespace {
  Player: new (
    element: HTMLElement | string,
    options: {
      videoId: string;
      width?: string | number;
      height?: string | number;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: (event: { target: YTPlayerInstance }) => void;
        onStateChange?: (event: { data: number; target: YTPlayerInstance }) => void;
        onError?: () => void;
      };
    }
  ) => YTPlayerInstance;
  PlayerState?: {
    UNSTARTED?: number;
    ENDED: number;
    PLAYING: number;
    PAUSED: number;
    BUFFERING?: number;
    CUED?: number;
  };
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytApiPromise: Promise<void> | null = null;

function loadYouTubeIframeApi(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.YT?.Player) return Promise.resolve();
  if (ytApiPromise) return ytApiPromise;

  ytApiPromise = new Promise<void>((resolve) => {
    const prevReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prevReady?.();
      resolve();
    };

    const existing = document.querySelector(
      'script[src="https://www.youtube.com/iframe_api"]'
    );
    if (!existing) {
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      document.head.appendChild(script);
    }
  });

  return ytApiPromise;
}

interface TransitionSession {
  fromTrackId: string;
  toTrack: Track;
  outgoingKind: 'audio' | 'youtube';
  incomingKind: 'audio' | 'youtube';
  outgoingAudioDeckIdx: 0 | 1;
  incomingAudioDeckIdx: 0 | 1;
  outgoingYtDeckIdx: 0 | 1;
  incomingYtDeckIdx: 0 | 1;
  durationMs: number;
  elapsedMs: number;
  lastTickMs: number;
  stopTicker: (() => void) | null;
}

interface CrossfadeStatus {
  nextTitle: string;
  remainingSec: number;
}

interface StageRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface PlayerBarProps {
  currentTrack: Track | null;
  queue: Track[];
  recentlyPlayed: Track[];
  isPlaying: boolean;
  shuffle: boolean;
  repeatMode: RepeatMode;
  isFavorite: boolean;
  embedTrack: Track | null;
  studioConsoleOpen: boolean;
  onSetStudioConsoleOpen: (open: boolean) => void;
  getNextTrack: (fromTrackId?: string) => Track | null;
  onCrossfadeComplete: (nextTrack: Track) => void;
  onCloseEmbed: () => void;
  onPlayPause: () => void;
  onNext: () => void;
  onPrev: () => void;
  onToggleShuffle: () => void;
  onCycleRepeat: () => void;
  onToggleFavorite: (trackId: string) => void;
  onSelectTrack: (track: Track) => void;
  onClearRecentlyPlayed?: () => void;
  onPlaybackEnded: () => void;
  onSetPlayingState: (playing: boolean) => void;
  onClosePlayer?: () => void;
  onOpenTuneRequest?: () => void;
  volume?: number;
  muted?: boolean;
  hookMode?: boolean;
  crossfadeSettings?: CrossfadeSettings;
  audioDucking?: boolean;
  onVolumeChange?: (volume01: number) => void;
  onMutedChange?: (muted: boolean) => void;
  onHookModeChange?: (hookMode: boolean) => void;
  onChangeCrossfadeSettings?: (next: CrossfadeSettings) => void;
}

export function PlayerBar({
  currentTrack,
  queue,
  recentlyPlayed,
  isPlaying,
  shuffle,
  repeatMode,
  isFavorite,
  embedTrack,
  studioConsoleOpen,
  onSetStudioConsoleOpen,
  getNextTrack,
  onCrossfadeComplete,
  onCloseEmbed,
  onPlayPause,
  onNext,
  onPrev,
  onToggleShuffle,
  onCycleRepeat,
  onToggleFavorite,
  onSelectTrack,
  onClearRecentlyPlayed,
  onPlaybackEnded,
  onSetPlayingState,
  onClosePlayer,
  onOpenTuneRequest,
  volume: controlledVolume,
  muted: controlledMuted,
  hookMode: controlledHookMode,
  crossfadeSettings = DEFAULT_CROSSFADE_SETTINGS,
  audioDucking = false,
  onVolumeChange,
  onMutedChange,
  onHookModeChange,
}: PlayerBarProps) {
  // Dual HTML5 Audio Decks + Background Audio-Focus Keep-Alive Deck
  const deck0Ref = useRef<HTMLAudioElement | null>(null);
  const deck1Ref = useRef<HTMLAudioElement | null>(null);
  const keepAliveAudioRef = useRef<HTMLAudioElement | null>(null);
  const activeDeckIdxRef = useRef<0 | 1>(0);
  const deckTrackIdRef = useRef<[string, string]>(['', '']);
  const deckUrlRef = useRef<[string, string]>(['', '']);
  const pendingAudioHookSeekTrackIdRef = useRef<string>('');

  // Dual Persistent YouTube IFrame Decks (initialized once, switched via loadVideoById)
  const ytHost0Ref = useRef<HTMLDivElement | null>(null);
  const ytHost1Ref = useRef<HTMLDivElement | null>(null);
  const ytPlayersRef = useRef<[YTPlayerInstance | null, YTPlayerInstance | null]>([
    null,
    null,
  ]);
  const ytInitializingRef = useRef<[boolean, boolean]>([false, false]);
  const ytReadyRef = useRef<[boolean, boolean]>([false, false]);
  const ytDeckTrackIdRef = useRef<[string, string]>(['', '']);
  const ytDesiredTrackRef = useRef<[Track | null, Track | null]>([null, null]);
  const ytEmbedRetryIdxRef = useRef<[number, number]>([0, 0]);
  const activeYtDeckIdxRef = useRef<0 | 1>(0);
  const ytStartZeroRef = useRef<[boolean, boolean]>([false, false]);
  const ytDeckModeRef = useRef<[YtSlotMode, YtSlotMode]>(['idle', 'idle']);
  const ytPreRolledRef = useRef<[boolean, boolean]>([false, false]);
  const ytPrerollStartSecRef = useRef<[number, number]>([0, 0]);
  const ytPrerollLatencyRef = useRef<number>(0.5);
  const audioPreRolledRef = useRef<[boolean, boolean]>([false, false]);
  const exitTimerRef = useRef<number | null>(null);
  const exitTimerTrackIdRef = useRef<string>('');
  const lastCrossfadeAttemptMsRef = useRef<number>(0);
  const ytWaitCancelRef = useRef<(() => void) | null>(null);
  const ytBufferingSinceRef = useRef<number | null>(null);
  const ytAdActiveRef = useRef<[boolean, boolean]>([false, false]);
  const ytAdStartedAtRef = useRef<[number, number]>([0, 0]);
  const ytAdRetriedRef = useRef<[boolean, boolean]>([false, false]);
  const ytAdReloadedRef = useRef<[boolean, boolean]>([false, false]);
  const ytExpectedStartSecRef = useRef<[number, number]>([0, 0]);
  const ytOffsetVerifiedRef = useRef<[boolean, boolean]>([false, false]);
  const ytOffsetSeekTriedAtRef = useRef<[number, number]>([0, 0]);
  const ytBlockedRetryDoneRef = useRef<[boolean, boolean]>([false, false]);
  const consecutiveAdSkipsRef = useRef(0);
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);

  // Center Studio Console Stage Slot measurement (keeps YT iframe locked inside Center Screen with 0 teardown)
  const stageSlotRef = useRef<HTMLDivElement | null>(null);
  const consoleScrollRef = useRef<HTMLDivElement | null>(null);
  const [stageRect, setStageRect] = useState<StageRect | null>(null);
  const [isDesktopViewport, setIsDesktopViewport] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1024 : true
  );

  const transitionRef = useRef<TransitionSession | null>(null);
  const transitionLockFromIdRef = useRef<string>('');
  const manualSwitchGenRef = useRef(0);
  const manualFadeStopRef = useRef<(() => void) | null>(null);
  const manualFadeOutAudioIdxRef = useRef<0 | 1 | null>(null);
  const manualFadeOutYtSlotRef = useRef<0 | 1 | null>(null);
  const autoCompletedTrackIdRef = useRef<string>('');
  const prevRenderedTrackRef = useRef<Track | null>(null);
  const consecutiveYtErrorsRef = useRef(0);
  const userPausedRef = useRef(false);
  const prevIsPlayingRef = useRef(isPlaying);
  const ytAwaitingPlayRef = useRef<[boolean, boolean]>([false, false]);
  const ytAwaitingPlaySinceRef = useRef<[number, number]>([0, 0]);
  const audioSwitchingDeckRef = useRef<[boolean, boolean]>([false, false]);
  const lastVisibilityChangeMsRef = useRef(0);
  const lastMsPosSyncRef = useRef(0);
  const lastYtMsAssertRef = useRef(0);
  const keepAliveUnlockedRef = useRef(false);
  const deckUnlockedRef = useRef<[boolean, boolean]>([false, false]);

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [internalVolume, setInternalVolume] = useState(1);
  const [internalMuted, setInternalMuted] = useState(false);
  const volume = controlledVolume ?? internalVolume;
  const muted = controlledMuted ?? internalMuted;
  const effectiveMasterGain = !isDesktopViewport
    ? audioDucking
      ? 0.18
      : 1
    : muted
      ? 0
      : volume * (audioDucking ? 0.18 : 1);

  const setVolume = useCallback(
    (nextVol: number) => {
      const clamped = Math.max(0, Math.min(1, nextVol));
      setInternalVolume(clamped);
      onVolumeChange?.(clamped);
    },
    [onVolumeChange]
  );

  const setMuted = useCallback(
    (updater: boolean | ((prev: boolean) => boolean)) => {
      const next =
        typeof updater === 'function' ? updater(muted) : updater;
      setInternalMuted(next);
      onMutedChange?.(next);
    },
    [muted, onMutedChange]
  );

  const [minimizedDrawerTab, setMinimizedDrawerTab] =
    useState<ConsoleDrawerTab>(null);
  const [consoleDrawerTab, setConsoleDrawerTab] = useState<ConsoleDrawerTab>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [ytDockMinimized, setYtDockMinimized] = useState(true);
  const [ytBuffering, setYtBuffering] = useState(false);
  const [ytAdActiveState, setYtAdActiveState] = useState(false);
  const [ytSlotTracks, setYtSlotTracks] = useState<[Track | null, Track | null]>([
    null,
    null,
  ]);
  const [activeYtDeckIdx, setActiveYtDeckIdx] = useState<0 | 1>(0);
  const [visualCrossfadeYtIdx, setVisualCrossfadeYtIdx] = useState<0 | 1 | null>(null);
  const [crossfadeStatus, setCrossfadeStatus] = useState<CrossfadeStatus | null>(null);

  // Hook-based playback state (Auto-Cut Chorus Drop vs Full Song; defaults to Full Song)
  const [internalHookMode, setInternalHookMode] = useState(false);
  const hookMode = controlledHookMode ?? internalHookMode;
  const [customHooks, setCustomHooks] = useState<Record<string, HookRange>>(() =>
    loadCustomHooks()
  );

  // Latest state/callback refs to avoid stale closures inside timers and player events
  const currentTrackRef = useRef(currentTrack);
  currentTrackRef.current = currentTrack;
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  const repeatModeRef = useRef(repeatMode);
  repeatModeRef.current = repeatMode;
  const volumeRef = useRef(volume);
  volumeRef.current = volume;
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const effectiveGainRef = useRef(effectiveMasterGain);
  effectiveGainRef.current = effectiveMasterGain;
  const hookModeRef = useRef(hookMode);
  hookModeRef.current = hookMode;
  const crossfadeSettingsRef = useRef(crossfadeSettings);
  crossfadeSettingsRef.current = crossfadeSettings;
  const customHooksRef = useRef(customHooks);
  customHooksRef.current = customHooks;
  const getNextTrackRef = useRef(getNextTrack);
  getNextTrackRef.current = getNextTrack;
  const onCrossfadeCompleteRef = useRef(onCrossfadeComplete);
  onCrossfadeCompleteRef.current = onCrossfadeComplete;
  const onPlaybackEndedRef = useRef(onPlaybackEnded);
  onPlaybackEndedRef.current = onPlaybackEnded;
  const onSetPlayingStateRef = useRef(onSetPlayingState);
  onSetPlayingStateRef.current = onSetPlayingState;
  const onNextRef = useRef(onNext);
  onNextRef.current = onNext;
  const onPrevRef = useRef(onPrev);
  onPrevRef.current = onPrev;
  const currentTimeRef = useRef(currentTime);
  currentTimeRef.current = currentTime;
  const durationRef = useRef(duration);
  durationRef.current = duration;

  const isCurrentYouTube =
    currentTrack?.playbackRights === 'embed-only' && Boolean(currentTrack.embedId);
  const isCrossfadingToYouTube = Boolean(
    crossfadeStatus !== null && transitionRef.current?.incomingKind === 'youtube'
  );
  const ytStageVisible = Boolean(
    currentTrack && (isCurrentYouTube || isCrossfadingToYouTube)
  );
  const displayedYtTrack =
    (visualCrossfadeYtIdx !== null ? ytSlotTracks[visualCrossfadeYtIdx] : null) ??
    (isCurrentYouTube
      ? ytSlotTracks[activeYtDeckIdx] ?? currentTrack
      : isCrossfadingToYouTube && transitionRef.current
        ? ytSlotTracks[transitionRef.current.incomingYtDeckIdx]
        : null);
  const nextTrackPreview = currentTrack ? getNextTrack(currentTrack.id) : null;

  const effectiveDuration = duration || currentTrack?.durationSec || 218;
  const progressPct =
    effectiveDuration > 0 ? Math.min(100, (currentTime / effectiveDuration) * 100) : 0;

  const getHookForTrack = useCallback(
    (track: Track | null, durSec?: number): HookRange & { isCustom: boolean } => {
      if (!track) return { startSec: 20, endSec: 80, isCustom: false };
      const resolvedDur = durSec || track.durationSec || 218;
      const custom = customHooksRef.current[track.id];
      if (
        custom &&
        custom.endSec - custom.startSec >= MIN_HOOK_SPAN_SEC &&
        custom.endSec <= resolvedDur + 1
      ) {
        return {
          startSec: Math.max(0, custom.startSec),
          endSec: Math.min(resolvedDur, custom.endSec),
          isCustom: true,
        };
      }
      const def = getDefaultHookWindow(resolvedDur, track);
      return { ...def, isCustom: false };
    },
    []
  );

  // Hook Mode starts at each song's curated/derived entry_sec; Full Song Mode starts from 0:00 while keeping crossfade
  const getStartSecForTrack = useCallback(
    (track: Track | null, durSec?: number): number => {
      if (!track) return 0;
      if (hookModeRef.current) {
        return getHookForTrack(track, durSec).startSec;
      }
      return 0;
    },
    [getHookForTrack]
  );

  // Early Crossfade trigger: starts `fadeSec` BEFORE current hook finishes (or `fadeSec` before end in Full Song Mode)
  const getAutoExitTargetSec = useCallback(
    (track: Track, durSec: number): number => {
      const safeDur = Math.max(8, durSec || track.durationSec || 218);
      const next = getNextTrackRef.current(track.id);
      const fadeSec =
        getAutoCrossfadeMs(crossfadeSettingsRef.current, next?.bpm ?? track.bpm) / 1000;
      if (hookModeRef.current) {
        const hookWin = getHookForTrack(track, safeDur);
        const hookSpan = Math.max(MIN_HOOK_SPAN_SEC, hookWin.endSec - hookWin.startSec);
        // Start next song's hook BEFORE current hook finishes (default 8s early; 10-16s early in DJ Mode)
        const minSoloSec = Math.min(3, Math.max(1.5, hookSpan * 0.25));
        const minHookEntryFloor = hookWin.startSec + minSoloSec;
        const earlyTriggerSec = hookWin.endSec - fadeSec;
        const maxSafePhysicalCap = safeDur - Math.min(safeDur * 0.45, fadeSec + 0.8);
        return Math.min(maxSafePhysicalCap, Math.max(minHookEntryFloor, earlyTriggerSec));
      }
      const leadSec = Math.min(Math.max(4, safeDur * 0.45), fadeSec + 1.0);
      return Math.max(4, safeDur - leadSec);
    },
    [getHookForTrack]
  );

  const activeHookWindow = useMemo(() => {
    if (!currentTrack) return { startSec: 20, endSec: 80, isCustom: false };
    const custom = customHooks[currentTrack.id];
    if (
      custom &&
      custom.endSec - custom.startSec >= MIN_HOOK_SPAN_SEC &&
      custom.endSec <= effectiveDuration + 1
    ) {
      return {
        startSec: Math.max(0, custom.startSec),
        endSec: Math.min(effectiveDuration, custom.endSec),
        isCustom: true,
      };
    }
    return {
      ...getDefaultHookWindow(effectiveDuration, currentTrack),
      isCustom: false,
    };
  }, [currentTrack, customHooks, effectiveDuration]);

  // Responsive viewport listener for Center Console + Stage Slot measurement
  useEffect(() => {
    const syncViewport = () => {
      setIsDesktopViewport(window.innerWidth >= 1024);
    };
    syncViewport();
    window.addEventListener('resize', syncViewport);
    return () => window.removeEventListener('resize', syncViewport);
  }, []);

  // Lock volume to 100% and unmuted in mobile view (< 1024px) where volume controls are hidden
  useEffect(() => {
    if (!isDesktopViewport) {
      if (volume !== 1) setVolume(1);
      if (muted) setMuted(false);
    }
  }, [isDesktopViewport, volume, muted, setVolume, setMuted]);

  const measureStageSlot = useCallback(() => {
    const el = stageSlotRef.current;
    if (!el || !studioConsoleOpen) {
      setStageRect(null);
      return;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 40) {
      setStageRect(null);
      return;
    }
    setStageRect((prev) => {
      if (
        prev &&
        Math.abs(prev.top - rect.top) < 1 &&
        Math.abs(prev.left - rect.left) < 1 &&
        Math.abs(prev.width - rect.width) < 1 &&
        Math.abs(prev.height - rect.height) < 1
      ) {
        return prev;
      }
      return {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      };
    });
  }, [studioConsoleOpen]);

  useLayoutEffect(() => {
    if (!studioConsoleOpen || !currentTrack) {
      setStageRect(null);
      return;
    }

    let rafId = 0;
    let settleRafId = 0;
    const startMs = performance.now();

    const scheduleMeasure = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(measureStageSlot);
    };

    const trackTransitionFrames = () => {
      measureStageSlot();
      if (performance.now() - startMs < 280) {
        settleRafId = requestAnimationFrame(trackTransitionFrames);
      }
    };

    scheduleMeasure();
    settleRafId = requestAnimationFrame(trackTransitionFrames);

    const observer =
      typeof ResizeObserver !== 'undefined' && stageSlotRef.current
        ? new ResizeObserver(scheduleMeasure)
        : null;
    if (observer && stageSlotRef.current) {
      observer.observe(stageSlotRef.current);
    }

    const scrollEl = consoleScrollRef.current;
    scrollEl?.addEventListener('scroll', scheduleMeasure, { passive: true });
    window.addEventListener('resize', scheduleMeasure);

    return () => {
      cancelAnimationFrame(rafId);
      cancelAnimationFrame(settleRafId);
      observer?.disconnect();
      scrollEl?.removeEventListener('scroll', scheduleMeasure);
      window.removeEventListener('resize', scheduleMeasure);
    };
  }, [
    studioConsoleOpen,
    currentTrack?.id,
    isCurrentYouTube,
    ytStageVisible,
    consoleDrawerTab,
    isDesktopViewport,
    hookMode,
    nextTrackPreview?.id,
    measureStageSlot,
  ]);

  // Warm YouTube IFrame API and silent keep-alive audio stream once on mount
  useEffect(() => {
    loadYouTubeIframeApi().catch(() => {});
    const ka = keepAliveAudioRef.current;
    if (ka) {
      ka.src = getSilentKeepAliveWavUrl();
      ka.volume = 0.3;
    }
  }, []);

  // Screen WakeLock while playing so mobile/tablet screen stays awake cleanly during playback
  useEffect(() => {
    const navWithWakeLock = navigator as Navigator & {
      wakeLock?: {
        request: (type: 'screen') => Promise<{ release: () => Promise<void> }>;
      };
    };
    if (!navWithWakeLock.wakeLock) return;

    const acquireWakeLock = async () => {
      if (!isPlayingRef.current || !currentTrackRef.current || document.hidden) return;
      try {
        if (!wakeLockRef.current) {
          wakeLockRef.current = await navWithWakeLock.wakeLock!.request('screen');
        }
      } catch {
        // Ignore browser battery-saver / permission blocks
      }
    };

    const releaseWakeLock = async () => {
      try {
        await wakeLockRef.current?.release();
      } catch {
        // ignore
      }
      wakeLockRef.current = null;
    };

    if (isPlaying && currentTrack) {
      void acquireWakeLock();
    } else {
      void releaseWakeLock();
    }

    const onVisibility = () => {
      if (!document.hidden && isPlayingRef.current && currentTrackRef.current) {
        void acquireWakeLock();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      void releaseWakeLock();
    };
  }, [isPlaying, currentTrack?.id]);

  // Unlock top-level <audio> elements synchronously on valid HTML user-activation events
  useEffect(() => {
    const silentUrl = getSilentKeepAliveWavUrl();
    const primeAudioOnGesture = () => {
      const ka = keepAliveAudioRef.current;
      if (ka && !keepAliveUnlockedRef.current) {
        keepAliveUnlockedRef.current = true;
        if (!ka.src) ka.src = silentUrl;
        ka.volume = 0.3;
        ka.play()
          .then(() => {
            window.setTimeout(() => {
              if (!isPlayingRef.current) {
                ka.pause();
              }
            }, 80);
          })
          .catch(() => {
            keepAliveUnlockedRef.current = false;
          });
      }

      ([0, 1] as const).forEach((idx) => {
        const deck = idx === 0 ? deck0Ref.current : deck1Ref.current;
        if (
          !deck ||
          deckUnlockedRef.current[idx] ||
          deckTrackIdRef.current[idx] ||
          isPlayingRef.current
        ) {
          return;
        }
        deckUnlockedRef.current[idx] = true;
        deck.volume = 0;
        deck.src = silentUrl;
        deck.play()
          .then(() => {
            if (!deckTrackIdRef.current[idx]) {
              deck.pause();
              deck.removeAttribute('src');
              deck.load();
              deck.volume = mutedRef.current ? 0 : volumeRef.current;
            }
          })
          .catch(() => {
            deckUnlockedRef.current[idx] = false;
          });
      });

      if (
        keepAliveUnlockedRef.current &&
        (deckUnlockedRef.current[0] || deckTrackIdRef.current[0]) &&
        (deckUnlockedRef.current[1] || deckTrackIdRef.current[1])
      ) {
        document.removeEventListener('click', primeAudioOnGesture, true);
        document.removeEventListener('touchend', primeAudioOnGesture, true);
        document.removeEventListener('keydown', primeAudioOnGesture, true);
      }
    };

    document.addEventListener('click', primeAudioOnGesture, true);
    document.addEventListener('touchend', primeAudioOnGesture, true);
    document.addEventListener('keydown', primeAudioOnGesture, true);
    return () => {
      document.removeEventListener('click', primeAudioOnGesture, true);
      document.removeEventListener('touchend', primeAudioOnGesture, true);
      document.removeEventListener('keydown', primeAudioOnGesture, true);
    };
  }, []);

  // Track intentional user play/pause state
  useEffect(() => {
    if (isPlaying) {
      userPausedRef.current = false;
    } else if (prevIsPlayingRef.current) {
      userPausedRef.current = true;
    }
    prevIsPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    if (isPlaying) {
      userPausedRef.current = false;
    }
  }, [currentTrack?.id, isPlaying]);

  const getDeck = useCallback((idx: 0 | 1): HTMLAudioElement | null => {
    return idx === 0 ? deck0Ref.current : deck1Ref.current;
  }, []);

  const clearDeck = useCallback(
    (idx: 0 | 1) => {
      deckTrackIdRef.current[idx] = '';
      deckUrlRef.current[idx] = '';
      audioSwitchingDeckRef.current[idx] = false;
      const deck = getDeck(idx);
      if (deck) {
        deck.pause();
        deck.currentTime = 0;
        deck.removeAttribute('src');
        deck.load();
      }
    },
    [getDeck]
  );

  const stopManualFade = useCallback(() => {
    if (manualFadeStopRef.current) {
      manualFadeStopRef.current();
      manualFadeStopRef.current = null;
    }
  }, []);

  const hardSilenceYtSlot = useCallback((slotIdx: 0 | 1) => {
    ytDeckModeRef.current[slotIdx] = 'idle';
    ytStartZeroRef.current[slotIdx] = false;
    ytPreRolledRef.current[slotIdx] = false;
    ytPrerollStartSecRef.current[slotIdx] = 0;
    ytAwaitingPlayRef.current[slotIdx] = false;
    ytAwaitingPlaySinceRef.current[slotIdx] = 0;
    ytAdActiveRef.current[slotIdx] = false;
    ytAdStartedAtRef.current[slotIdx] = 0;
    ytAdRetriedRef.current[slotIdx] = false;
    ytAdReloadedRef.current[slotIdx] = false;
    ytExpectedStartSecRef.current[slotIdx] = 0;
    ytOffsetVerifiedRef.current[slotIdx] = false;
    ytOffsetSeekTriedAtRef.current[slotIdx] = 0;
    ytBlockedRetryDoneRef.current[slotIdx] = false;
    ytDesiredTrackRef.current[slotIdx] = null;
    ytDeckTrackIdRef.current[slotIdx] = '';

    const p = ytPlayersRef.current[slotIdx];
    if (p && ytReadyRef.current[slotIdx]) {
      try {
        p.mute();
        p.setVolume(0);
        p.pauseVideo();
        p.stopVideo?.();
      } catch {
        // ignore transient errors
      }
    }
  }, []);

  const setYtDeckVolume = useCallback((idx: 0 | 1, gain01: number) => {
    const player = ytPlayersRef.current[idx];
    if (!player || !ytReadyRef.current[idx]) return;
    try {
      if (
        ytAdActiveRef.current[idx] ||
        mutedRef.current ||
        volumeRef.current === 0 ||
        gain01 <= 0
      ) {
        player.mute();
        if (ytAdActiveRef.current[idx]) {
          player.setVolume(0);
        }
      } else {
        player.unMute();
        player.setVolume(Math.max(0, Math.min(100, Math.round(gain01 * 100))));
      }
    } catch {
      // ignore transient calls
    }
  }, []);

  const tryYtFallbackEmbed = useCallback(
    (slotIdx: 0 | 1, isStandbySlot: boolean): boolean => {
      const desiredTrack = ytDesiredTrackRef.current[slotIdx];
      if (!desiredTrack) return false;
      const fallbacks = desiredTrack.fallbackEmbedIds || [];
      const nextRetryIdx = ytEmbedRetryIdxRef.current[slotIdx];
      if (nextRetryIdx >= fallbacks.length) return false;

      const backupVideoId = fallbacks[nextRetryIdx];
      ytEmbedRetryIdxRef.current[slotIdx] = nextRetryIdx + 1;
      const player = ytPlayersRef.current[slotIdx];
      if (!player || !ytReadyRef.current[slotIdx] || !backupVideoId) return false;

      const entryStart = getStartSecForTrack(
        desiredTrack,
        desiredTrack.durationSec || 218
      );
      try {
        ytAdActiveRef.current[slotIdx] = false;
        ytAdStartedAtRef.current[slotIdx] = 0;
        ytExpectedStartSecRef.current[slotIdx] = entryStart;
        ytOffsetVerifiedRef.current[slotIdx] = false;
        ytOffsetSeekTriedAtRef.current[slotIdx] = 0;
        ytBlockedRetryDoneRef.current[slotIdx] = false;
        if (!isStandbySlot) {
          setYtAdActiveState(false);
          setYtBuffering(true);
          ytBufferingSinceRef.current = Date.now();
        }
        if (ytDeckModeRef.current[slotIdx] === 'precue') {
          player.cueVideoById?.({
            videoId: backupVideoId,
            startSeconds: entryStart,
          });
        } else {
          player.loadVideoById?.({
            videoId: backupVideoId,
            startSeconds: entryStart,
          });
          if (isPlayingRef.current || ytStartZeroRef.current[slotIdx]) {
            player.playVideo();
          }
        }
        return true;
      } catch {
        return false;
      }
    },
    [getStartSecForTrack]
  );

  const cancelTransition = useCallback(
    (stopIncoming = true) => {
      if (ytWaitCancelRef.current) {
        ytWaitCancelRef.current();
        ytWaitCancelRef.current = null;
      }
      if (exitTimerRef.current !== null) {
        window.clearTimeout(exitTimerRef.current);
        exitTimerRef.current = null;
        exitTimerTrackIdRef.current = '';
      }
      const session = transitionRef.current;
      if (!session) return;

      if (session.stopTicker) {
        session.stopTicker();
      }
      transitionRef.current = null;
      setCrossfadeStatus(null);
      setVisualCrossfadeYtIdx(null);

      if (stopIncoming) {
        if (session.incomingKind === 'audio') {
          clearDeck(session.incomingAudioDeckIdx);
        } else {
          const inYt = session.incomingYtDeckIdx;
          ytStartZeroRef.current[inYt] = false;
          ytPreRolledRef.current[inYt] = false;
          ytPrerollStartSecRef.current[inYt] = 0;
          ytDeckModeRef.current[inYt] = 'idle';
          ytAdActiveRef.current[inYt] = false;
          ytAdRetriedRef.current[inYt] = false;
          ytBlockedRetryDoneRef.current[inYt] = false;
          setYtSlotTracks((prev) => {
            const next: [Track | null, Track | null] = [...prev] as [
              Track | null,
              Track | null,
            ];
            next[inYt] = null;
            return next;
          });
        }
      }

      if (session.outgoingKind === 'audio') {
        const outDeck = getDeck(session.outgoingAudioDeckIdx);
        if (outDeck) {
          outDeck.volume = effectiveGainRef.current;
        }
      } else {
        ytDeckModeRef.current[session.outgoingYtDeckIdx] = 'active';
        setYtDeckVolume(session.outgoingYtDeckIdx, effectiveGainRef.current);
      }
    },
    [clearDeck, getDeck, setYtDeckVolume]
  );

  const finishTransition = useCallback(() => {
    const session = transitionRef.current;
    if (!session) return;

    if (session.stopTicker) {
      session.stopTicker();
    }
    transitionRef.current = null;
    setCrossfadeStatus(null);
    setVisualCrossfadeYtIdx(null);

    if (session.outgoingKind === 'audio') {
      clearDeck(session.outgoingAudioDeckIdx);
    }

    if (session.incomingKind === 'audio') {
      activeDeckIdxRef.current = session.incomingAudioDeckIdx;
      const inDeck = getDeck(session.incomingAudioDeckIdx);
      if (inDeck) {
        inDeck.volume = effectiveGainRef.current;
        setCurrentTime(inDeck.currentTime || 0);
        if (Number.isFinite(inDeck.duration) && inDeck.duration > 0) {
          setDuration(inDeck.duration);
        } else {
          setDuration(session.toTrack.durationSec || 0);
        }
      }
      ytStartZeroRef.current = [false, false];
      ytPreRolledRef.current = [false, false];
      ytPrerollStartSecRef.current = [0, 0];
      ytDeckModeRef.current = ['idle', 'idle'];
      ytAdActiveRef.current = [false, false];
      ytAdStartedAtRef.current = [0, 0];
      ytAdRetriedRef.current = [false, false];
      ytAdReloadedRef.current = [false, false];
      ytExpectedStartSecRef.current = [0, 0];
      ytOffsetVerifiedRef.current = [false, false];
      ytOffsetSeekTriedAtRef.current = [0, 0];
      ytBlockedRetryDoneRef.current = [false, false];
      setYtAdActiveState(false);
      setYtSlotTracks([null, null]);
    } else {
      const inYt = session.incomingYtDeckIdx;
      activeYtDeckIdxRef.current = inYt;
      setActiveYtDeckIdx(inYt);
      ytStartZeroRef.current[inYt] = false;
      ytPreRolledRef.current[inYt] = false;
      ytPrerollStartSecRef.current[inYt] = 0;
      ytDeckModeRef.current[inYt] = 'active';
      setYtDeckVolume(inYt, effectiveGainRef.current);

      const inPlayer = ytPlayersRef.current[inYt];
      if (inPlayer && ytReadyRef.current[inYt]) {
        try {
          const cur = inPlayer.getCurrentTime();
          const dur = inPlayer.getDuration();
          const incomingHasAd =
            ytAdActiveRef.current[inYt] || isLikelyYtAdDuration(dur, session.toTrack);
          ytAdActiveRef.current[inYt] = incomingHasAd;
          setYtAdActiveState(incomingHasAd);
          if (incomingHasAd) {
            if (!ytAdStartedAtRef.current[inYt]) {
              ytAdStartedAtRef.current[inYt] = Date.now();
            }
            inPlayer.mute();
            inPlayer.setVolume(0);
          } else {
            ytAdStartedAtRef.current[inYt] = 0;
            const resolvedDur =
              Number.isFinite(dur) && dur > 0 ? dur : session.toTrack.durationSec || 218;
            const entryStart = getStartSecForTrack(session.toTrack, resolvedDur);
            ytExpectedStartSecRef.current[inYt] = entryStart;
            if (entryStart > 0 && Number.isFinite(cur) && cur < entryStart - 1.5) {
              inPlayer.seekTo(entryStart, true);
              setCurrentTime(entryStart);
            } else if (Number.isFinite(cur)) {
              setCurrentTime(cur);
            }
          }
          if (Number.isFinite(dur) && dur > 0 && !incomingHasAd) {
            setDuration(dur);
          } else {
            setDuration(session.toTrack.durationSec || 0);
          }
        } catch {
          // ignore
        }
      }

      if (session.outgoingKind === 'youtube') {
        const outYt = session.outgoingYtDeckIdx;
        ytStartZeroRef.current[outYt] = false;
        ytPreRolledRef.current[outYt] = false;
        ytPrerollStartSecRef.current[outYt] = 0;
        ytDeckModeRef.current[outYt] = 'idle';
        ytAdActiveRef.current[outYt] = false;
        ytAdStartedAtRef.current[outYt] = 0;
        ytAdRetriedRef.current[outYt] = false;
        ytAdReloadedRef.current[outYt] = false;
        ytExpectedStartSecRef.current[outYt] = 0;
        ytOffsetVerifiedRef.current[outYt] = false;
        ytOffsetSeekTriedAtRef.current[outYt] = 0;
        ytBlockedRetryDoneRef.current[outYt] = false;
        setYtSlotTracks((prev) => {
          const next: [Track | null, Track | null] = [...prev] as [
            Track | null,
            Track | null,
          ];
          next[outYt] = null;
          return next;
        });
      }
    }

    if (exitTimerRef.current !== null) {
      window.clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
      exitTimerTrackIdRef.current = '';
    }
    audioPreRolledRef.current = [false, false];
    transitionLockFromIdRef.current = '';
    lastCrossfadeAttemptMsRef.current = 0;
    autoCompletedTrackIdRef.current = session.toTrack.id;
    onCrossfadeCompleteRef.current(session.toTrack);
  }, [clearDeck, getDeck, getStartSecForTrack, setYtDeckVolume]);

  const applyFadeVolumes = useCallback(
    (session: TransitionSession, progress: number) => {
      const master = effectiveGainRef.current;
      const outGain = Math.cos(progress * Math.PI * 0.5);
      const inGain = Math.sin(progress * Math.PI * 0.5);

      if (session.outgoingKind === 'audio') {
        const outDeck = getDeck(session.outgoingAudioDeckIdx);
        if (outDeck) outDeck.volume = Math.max(0, Math.min(1, master * outGain));
      } else {
        setYtDeckVolume(session.outgoingYtDeckIdx, master * outGain);
      }

      if (session.incomingKind === 'audio') {
        const inDeck = getDeck(session.incomingAudioDeckIdx);
        if (inDeck) inDeck.volume = Math.max(0, Math.min(1, master * inGain));
      } else {
        setYtDeckVolume(session.incomingYtDeckIdx, master * inGain);
        if (session.outgoingKind === 'youtube' && progress >= 0.45) {
          setVisualCrossfadeYtIdx(session.incomingYtDeckIdx);
        }
      }
    },
    [getDeck, setYtDeckVolume]
  );

  const startTransitionInterval = useCallback(
    (session: TransitionSession) => {
      if (session.stopTicker) {
        session.stopTicker();
      }
      session.lastTickMs = performance.now();

      session.stopTicker = startBackgroundTicker(() => {
        const activeSession = transitionRef.current;
        if (!activeSession || activeSession !== session) return;
        if (!isPlayingRef.current) {
          activeSession.lastTickMs = performance.now();
          return;
        }

        const now = performance.now();
        activeSession.elapsedMs += Math.max(0, now - activeSession.lastTickMs);
        activeSession.lastTickMs = now;

        const progress = Math.min(
          1,
          activeSession.elapsedMs / activeSession.durationMs
        );
        applyFadeVolumes(activeSession, progress);

        const secsLeft = Math.max(
          1,
          Math.ceil((activeSession.durationMs - activeSession.elapsedMs) / 1000)
        );
        setCrossfadeStatus({
          nextTitle: activeSession.toTrack.title,
          remainingSec: secsLeft,
        });

        if (progress >= 1) {
          finishTransition();
        }
      }, CROSSFADE_TICK_MS);
    },
    [applyFadeVolumes, finishTransition]
  );

  const clearExitTimer = useCallback(() => {
    if (exitTimerRef.current !== null) {
      window.clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }
    exitTimerTrackIdRef.current = '';
  }, []);

  const clearYtStandbySlot = useCallback((slotIdx: 0 | 1) => {
    ytDeckModeRef.current[slotIdx] = 'idle';
    ytPreRolledRef.current[slotIdx] = false;
    ytStartZeroRef.current[slotIdx] = false;
    ytPrerollStartSecRef.current[slotIdx] = 0;
    ytAdActiveRef.current[slotIdx] = false;
    ytAdRetriedRef.current[slotIdx] = false;
    ytBlockedRetryDoneRef.current[slotIdx] = false;
    setYtSlotTracks((prev) => {
      if (!prev[slotIdx]) return prev;
      const next: [Track | null, Track | null] = [...prev] as [
        Track | null,
        Track | null,
      ];
      next[slotIdx] = null;
      return next;
    });
  }, []);

  const preloadIdleDeckForTrack = useCallback(
    (track: Track | null) => {
      if (!track || transitionRef.current || repeatModeRef.current === 'one') return;
      const next = getNextTrackRef.current(track.id);
      if (!next || !next.streamUrl || next.id === track.id) return;

      const idleIdx: 0 | 1 = activeDeckIdxRef.current === 0 ? 1 : 0;
      const idleDeck = getDeck(idleIdx);
      if (!idleDeck) return;

      const resolvedUrl = new URL(next.streamUrl, window.location.origin).href;
      if (
        deckUrlRef.current[idleIdx] === resolvedUrl &&
        deckTrackIdRef.current[idleIdx] === next.id
      ) {
        return;
      }

      idleDeck.pause();
      idleDeck.preload = 'auto';
      idleDeck.volume = 0;
      idleDeck.src = resolvedUrl;
      idleDeck.load();
      deckUrlRef.current[idleIdx] = resolvedUrl;
      deckTrackIdRef.current[idleIdx] = next.id;
    },
    [getDeck]
  );

  const precueStandbyYtForTrack = useCallback(
    (track: Track | null) => {
      if (!track || transitionRef.current) return;
      const curIsYt =
        track.playbackRights === 'embed-only' && Boolean(track.embedId);
      const standbySlot: 0 | 1 = curIsYt
        ? activeYtDeckIdxRef.current === 0
          ? 1
          : 0
        : 0;

      if (repeatModeRef.current === 'one') {
        if (
          ytDeckModeRef.current[standbySlot] === 'precue' ||
          ytDeckModeRef.current[standbySlot] === 'preroll'
        ) {
          clearYtStandbySlot(standbySlot);
        }
        return;
      }

      const next = getNextTrackRef.current(track.id);
      if (
        !next ||
        next.id === track.id ||
        next.playbackRights !== 'embed-only' ||
        !next.embedId
      ) {
        if (
          ytDeckModeRef.current[standbySlot] === 'precue' ||
          ytDeckModeRef.current[standbySlot] === 'preroll'
        ) {
          clearYtStandbySlot(standbySlot);
        }
        return;
      }

      if (
        ytDeckModeRef.current[standbySlot] === 'preroll' &&
        ytDeckTrackIdRef.current[standbySlot] === next.id
      ) {
        return;
      }

      const entryStart = getStartSecForTrack(next, next.durationSec || 218);

      ytDeckModeRef.current[standbySlot] = 'precue';
      ytPreRolledRef.current[standbySlot] = false;
      ytStartZeroRef.current[standbySlot] = true;
      ytPrerollStartSecRef.current[standbySlot] = entryStart;
      ytExpectedStartSecRef.current[standbySlot] = entryStart;
      ytOffsetVerifiedRef.current[standbySlot] = false;
      ytOffsetSeekTriedAtRef.current[standbySlot] = 0;

      const standbyPlayer = ytPlayersRef.current[standbySlot];
      if (
        ytDeckTrackIdRef.current[standbySlot] === next.id &&
        standbyPlayer &&
        ytReadyRef.current[standbySlot]
      ) {
        try {
          standbyPlayer.mute();
          standbyPlayer.setVolume(0);
          standbyPlayer.cueVideoById?.({
            videoId: next.embedId,
            startSeconds: entryStart,
          });
        } catch {
          // ignore
        }
        return;
      }

      setYtSlotTracks((prev) => {
        if (prev[standbySlot]?.id === next.id) return prev;
        const updated: [Track | null, Track | null] = [...prev] as [
          Track | null,
          Track | null,
        ];
        updated[standbySlot] = next;
        return updated;
      });
    },
    [clearYtStandbySlot, getStartSecForTrack]
  );

  const abortStandbyPreroll = useCallback(() => {
    clearExitTimer();
    ([0, 1] as const).forEach((slotIdx) => {
      if (ytDeckModeRef.current[slotIdx] === 'preroll') {
        ytDeckModeRef.current[slotIdx] = 'precue';
        ytPreRolledRef.current[slotIdx] = false;
        const standbyTrack = ytDesiredTrackRef.current[slotIdx];
        const standbyPlayer = ytPlayersRef.current[slotIdx];
        if (standbyTrack?.embedId && standbyPlayer && ytReadyRef.current[slotIdx]) {
          const entryStart = getStartSecForTrack(
            standbyTrack,
            standbyTrack.durationSec || 218
          );
          ytExpectedStartSecRef.current[slotIdx] = entryStart;
          try {
            standbyPlayer.pauseVideo();
            standbyPlayer.mute();
            standbyPlayer.setVolume(0);
            standbyPlayer.cueVideoById?.({
              videoId: standbyTrack.embedId,
              startSeconds: entryStart,
            });
          } catch {
            // ignore
          }
        }
      }
      if (audioPreRolledRef.current[slotIdx]) {
        audioPreRolledRef.current[slotIdx] = false;
        if (slotIdx !== activeDeckIdxRef.current) {
          const deck = getDeck(slotIdx);
          try {
            deck?.pause();
          } catch {
            // ignore
          }
        }
      }
    });
  }, [clearExitTimer, getDeck, getStartSecForTrack]);

  const syncYtPrerolledDrift = useCallback(
    (slotIdx: 0 | 1, targetEntrySec: number) => {
      const player = ytPlayersRef.current[slotIdx];
      if (!player || !ytReadyRef.current[slotIdx]) return;
      try {
        const dur = player.getDuration();
        if (isLikelyYtAdDuration(dur, ytDesiredTrackRef.current[slotIdx])) {
          return;
        }
        const cur = player.getCurrentTime();
        if (!Number.isFinite(cur)) return;
        const drift = targetEntrySec - cur;
        if (targetEntrySec > 3) {
          ytPrerollLatencyRef.current = Math.min(
            1.5,
            Math.max(0, ytPrerollLatencyRef.current + 0.6 * drift)
          );
        }
        if (Math.abs(drift) > PREROLL_DRIFT_SNAP_SEC) {
          player.seekTo(targetEntrySec, true);
        }
      } catch {
        // ignore
      }
    },
    []
  );

  const waitForYtDeckPlaying = useCallback(
    (slotIdx: 0 | 1, maxMs = 1500): Promise<boolean> => {
      if (ytWaitCancelRef.current) {
        ytWaitCancelRef.current();
        ytWaitCancelRef.current = null;
      }
      return new Promise((resolve) => {
        const player = ytPlayersRef.current[slotIdx];
        if (!player) {
          resolve(false);
          return;
        }
        let settled = false;
        let pollId: number | null = null;
        let timeoutId: number | null = null;
        const finish = (ok: boolean) => {
          if (settled) return;
          settled = true;
          if (pollId !== null) window.clearInterval(pollId);
          if (timeoutId !== null) window.clearTimeout(timeoutId);
          if (ytWaitCancelRef.current === cancel) {
            ytWaitCancelRef.current = null;
          }
          resolve(ok);
        };
        const cancel = () => finish(false);
        ytWaitCancelRef.current = cancel;

        pollId = window.setInterval(() => {
          if (!isPlayingRef.current || ytDeckModeRef.current[slotIdx] !== 'crossfade') {
            finish(false);
            return;
          }
          try {
            const p = ytPlayersRef.current[slotIdx];
            if (p && ytReadyRef.current[slotIdx] && p.getPlayerState?.() === 1) {
              finish(true);
            }
          } catch {
            finish(false);
          }
        }, 50);

        timeoutId = window.setTimeout(() => finish(false), maxMs);
      });
    },
    []
  );

  const triggerBajaoCrossfade = useCallback(
    (sourceKind: 'audio' | 'youtube', forceInstant = false): boolean => {
      const track = currentTrackRef.current;
      if (!track || !isPlayingRef.current) return false;
      if (transitionRef.current) return false;
      if (!forceInstant && transitionLockFromIdRef.current === track.id) return false;

      const nowMs = Date.now();
      if (
        !forceInstant &&
        nowMs - lastCrossfadeAttemptMsRef.current < CROSSFADE_ATTEMPT_DEBOUNCE_MS
      ) {
        return false;
      }

      const next = getNextTrackRef.current(track.id);
      if (!next || next.id === track.id) return false;

      const nextIsYt =
        next.playbackRights === 'embed-only' && Boolean(next.embedId);
      const incomingKind: 'audio' | 'youtube' = nextIsYt ? 'youtube' : 'audio';
      if (incomingKind === 'audio' && !next.streamUrl) return false;

      lastCrossfadeAttemptMsRef.current = nowMs;
      clearExitTimer();

      const outgoingAudioDeckIdx = activeDeckIdxRef.current;
      const incomingAudioDeckIdx: 0 | 1 = outgoingAudioDeckIdx === 0 ? 1 : 0;
      const outgoingYtDeckIdx = activeYtDeckIdxRef.current;
      const incomingYtDeckIdx: 0 | 1 =
        sourceKind === 'youtube' ? (outgoingYtDeckIdx === 0 ? 1 : 0) : 0;

      // Configured Early Crossfade (8s default; 10-16s in DJ Mode) with BPM phrase alignment
      let durationMs = getAutoCrossfadeMs(crossfadeSettingsRef.current, next.bpm);
      let outgoingEndedAlready = false;
      try {
        if (sourceKind === 'audio') {
          const outDeck = getDeck(outgoingAudioDeckIdx);
          if (outDeck) {
            if (outDeck.ended) {
              outgoingEndedAlready = true;
            } else if (Number.isFinite(outDeck.duration) && outDeck.duration > 4) {
              const curSec = outDeck.currentTime || 0;
              const runwayMs = (outDeck.duration - curSec - 0.3) * 1000;
              if (runwayMs > 500) {
                durationMs = Math.min(durationMs, Math.max(MANUAL_SWITCH_FADE_MS, Math.round(runwayMs)));
              }
              if (hookModeRef.current) {
                const hookEnd = getHookForTrack(track, outDeck.duration).endSec;
                const hookRemainingMs = (hookEnd - curSec) * 1000;
                if (hookRemainingMs >= 1500 && hookRemainingMs < durationMs) {
                  durationMs = Math.max(MANUAL_SWITCH_FADE_MS, Math.round(hookRemainingMs));
                }
              }
            }
          }
        } else {
          const outYt = ytPlayersRef.current[outgoingYtDeckIdx];
          if (outYt && ytReadyRef.current[outgoingYtDeckIdx]) {
            if (outYt.getPlayerState?.() === 0) {
              outgoingEndedAlready = true;
            } else {
              const ytDur = outYt.getDuration?.() || track.durationSec || 218;
              const ytCur = outYt.getCurrentTime?.() || 0;
              if (Number.isFinite(ytDur) && ytDur > 4) {
                const runwayMs = (ytDur - ytCur - 0.3) * 1000;
                if (runwayMs > 500) {
                  durationMs = Math.min(durationMs, Math.max(MANUAL_SWITCH_FADE_MS, Math.round(runwayMs)));
                }
                if (hookModeRef.current) {
                  const hookEnd = getHookForTrack(track, ytDur).endSec;
                  const hookRemainingMs = (hookEnd - ytCur) * 1000;
                  if (hookRemainingMs >= 1500 && hookRemainingMs < durationMs) {
                    durationMs = Math.max(MANUAL_SWITCH_FADE_MS, Math.round(hookRemainingMs));
                  }
                }
              }
            }
          }
        }
      } catch {
        // ignore transient reads
      }
      if (outgoingEndedAlready) {
        durationMs = MANUAL_SWITCH_FADE_MS;
      }
      transitionLockFromIdRef.current = track.id;

      const nextStartSec = getStartSecForTrack(next, next.durationSec || 218);

      const beginFadeInterval = () => {
        if (
          !isPlayingRef.current ||
          currentTrackRef.current?.id !== track.id ||
          transitionRef.current
        ) {
          return;
        }
        const session: TransitionSession = {
          fromTrackId: track.id,
          toTrack: next,
          outgoingKind: sourceKind,
          incomingKind,
          outgoingAudioDeckIdx,
          incomingAudioDeckIdx,
          outgoingYtDeckIdx,
          incomingYtDeckIdx,
          durationMs,
          elapsedMs: 0,
          lastTickMs: performance.now(),
          stopTicker: null,
        };

        transitionRef.current = session;
        setCrossfadeStatus({
          nextTitle: next.title,
          remainingSec: Math.max(1, Math.ceil(durationMs / 1000)),
        });
        startTransitionInterval(session);
      };

      if (incomingKind === 'audio') {
        const inDeck = getDeck(incomingAudioDeckIdx);
        if (!inDeck || !next.streamUrl) {
          transitionLockFromIdRef.current = '';
          return false;
        }

        const resolvedNextUrl = new URL(next.streamUrl, window.location.origin).href;
        if (
          deckUrlRef.current[incomingAudioDeckIdx] !== resolvedNextUrl ||
          deckTrackIdRef.current[incomingAudioDeckIdx] !== next.id
        ) {
          inDeck.pause();
          inDeck.preload = 'auto';
          inDeck.src = resolvedNextUrl;
          deckUrlRef.current[incomingAudioDeckIdx] = resolvedNextUrl;
          deckTrackIdRef.current[incomingAudioDeckIdx] = next.id;
        }

        const wasAudioPrerolled =
          audioPreRolledRef.current[incomingAudioDeckIdx] && !inDeck.paused;
        audioPreRolledRef.current[incomingAudioDeckIdx] = false;

        if (wasAudioPrerolled) {
          const drift = nextStartSec - (inDeck.currentTime || 0);
          if (Math.abs(drift) > PREROLL_DRIFT_SNAP_SEC) {
            try {
              inDeck.currentTime = nextStartSec;
            } catch {
              // ignore
            }
          }
        } else {
          try {
            inDeck.currentTime = nextStartSec;
          } catch {
            // ignore if metadata not yet loaded
          }
        }

        inDeck.volume = 0;
        inDeck.play().catch((err: unknown) => {
          const name = (err as { name?: string })?.name;
          if (name !== 'AbortError') {
            cancelTransition(true);
          }
        });
        beginFadeInterval();
        return true;
      }

      // Incoming YouTube deck
      const standbyPlayer = ytPlayersRef.current[incomingYtDeckIdx];
      const alreadyPrerolledAndPlaying = Boolean(
        ytPreRolledRef.current[incomingYtDeckIdx] &&
          ytDeckTrackIdRef.current[incomingYtDeckIdx] === next.id &&
          standbyPlayer &&
          ytReadyRef.current[incomingYtDeckIdx] &&
          standbyPlayer.getPlayerState?.() === 1
      );

      ytDeckModeRef.current[incomingYtDeckIdx] = 'crossfade';
      ytStartZeroRef.current[incomingYtDeckIdx] = true;
      ytExpectedStartSecRef.current[incomingYtDeckIdx] = nextStartSec;
      ytOffsetVerifiedRef.current[incomingYtDeckIdx] = false;
      ytOffsetSeekTriedAtRef.current[incomingYtDeckIdx] = 0;
      if (sourceKind === 'audio') {
        activeYtDeckIdxRef.current = incomingYtDeckIdx;
        setActiveYtDeckIdx(incomingYtDeckIdx);
      }

      if (alreadyPrerolledAndPlaying && standbyPlayer) {
        ytPreRolledRef.current[incomingYtDeckIdx] = false;
        syncYtPrerolledDrift(incomingYtDeckIdx, nextStartSec);
        try {
          if (
            ytAdActiveRef.current[incomingYtDeckIdx] ||
            mutedRef.current ||
            volumeRef.current === 0
          ) {
            standbyPlayer.mute();
            if (ytAdActiveRef.current[incomingYtDeckIdx]) {
              standbyPlayer.setVolume(0);
            }
          } else {
            standbyPlayer.unMute();
            standbyPlayer.setVolume(0);
          }
        } catch {
          // ignore
        }
        setYtSlotTracks((prev) => {
          const updated: [Track | null, Track | null] =
            sourceKind === 'youtube'
              ? ([...prev] as [Track | null, Track | null])
              : [null, null];
          updated[incomingYtDeckIdx] = next;
          return updated;
        });
        beginFadeInterval();
        return true;
      }

      // Cold-start or cue-only standby deck: prime at volume 0 and wait up to 1.5s for PLAYING before fading
      ytPreRolledRef.current[incomingYtDeckIdx] = false;
      ytPrerollStartSecRef.current[incomingYtDeckIdx] = nextStartSec;
      if (
        standbyPlayer &&
        ytReadyRef.current[incomingYtDeckIdx] &&
        next.embedId
      ) {
        try {
          if (mutedRef.current || volumeRef.current === 0) {
            standbyPlayer.mute();
          } else {
            standbyPlayer.unMute();
            standbyPlayer.setVolume(0);
          }
          if (ytDeckTrackIdRef.current[incomingYtDeckIdx] === next.id) {
            standbyPlayer.seekTo(nextStartSec, true);
          } else {
            ytDeckTrackIdRef.current[incomingYtDeckIdx] = next.id;
            standbyPlayer.loadVideoById?.({
              videoId: next.embedId,
              startSeconds: nextStartSec,
            });
          }
          ytAwaitingPlayRef.current[incomingYtDeckIdx] = true;
          ytAwaitingPlaySinceRef.current[incomingYtDeckIdx] = Date.now();
          standbyPlayer.playVideo();
        } catch {
          // ignore
        }
      }
      setYtSlotTracks((prev) => {
        const updated: [Track | null, Track | null] =
          sourceKind === 'youtube'
            ? ([...prev] as [Track | null, Track | null])
            : [null, null];
        updated[incomingYtDeckIdx] = next;
        return updated;
      });

      void waitForYtDeckPlaying(incomingYtDeckIdx, 1500).then((isReady) => {
        if (
          !isPlayingRef.current ||
          currentTrackRef.current?.id !== track.id ||
          ytDeckModeRef.current[incomingYtDeckIdx] !== 'crossfade'
        ) {
          return;
        }
        if (!isReady) {
          if (ytPlayersRef.current[incomingYtDeckIdx]?.getPlayerState?.() !== 1) {
            try {
              ytPlayersRef.current[incomingYtDeckIdx]?.playVideo();
            } catch {
              // ignore
            }
          }
        }
        beginFadeInterval();
      });
      return true;
    },
    [
      cancelTransition,
      clearExitTimer,
      getDeck,
      getHookForTrack,
      getStartSecForTrack,
      startTransitionInterval,
      syncYtPrerolledDrift,
      waitForYtDeckPlaying,
    ]
  );

  const maybeStartCrossfade = useCallback(
    (curSec: number, durSec: number, sourceKind: 'audio' | 'youtube') => {
      const track = currentTrackRef.current;
      if (!track || !isPlayingRef.current) return;
      if (transitionRef.current) return;
      if (!Number.isFinite(durSec) || durSec <= 4) return;

      if (repeatModeRef.current === 'one') {
        const loopEndTarget = hookModeRef.current
          ? Math.min(durSec, getHookForTrack(track, durSec).endSec)
          : Math.max(4, durSec - 0.5);
        if (loopEndTarget - curSec <= 0.25) {
          const loopStart = getStartSecForTrack(track, durSec);
          ytExpectedStartSecRef.current[activeYtDeckIdxRef.current] = loopStart;
          if (sourceKind === 'youtube') {
            ytPlayersRef.current[activeYtDeckIdxRef.current]?.seekTo(
              loopStart,
              true
            );
          } else {
            const deck = getDeck(activeDeckIdxRef.current);
            if (deck) deck.currentTime = loopStart;
          }
          setCurrentTime(loopStart);
        }
        return;
      }

      // Hook Mode starts Early Crossfade `fadeSec` before hook.endSec; Full Song Mode blends `fadeSec` before end
      const exitTarget = getAutoExitTargetSec(track, durSec);
      const remaining = exitTarget - curSec;

      if (transitionLockFromIdRef.current === track.id) return;

      const prerollLeadSec = getPrerollLeadSec();

      // If playhead is safely ahead of preroll window (e.g. user sought back), abort any stale preroll
      if (remaining > prerollLeadSec + 0.5) {
        if (
          exitTimerRef.current !== null ||
          ytDeckModeRef.current[0] === 'preroll' ||
          ytDeckModeRef.current[1] === 'preroll' ||
          audioPreRolledRef.current[0] ||
          audioPreRolledRef.current[1]
        ) {
          abortStandbyPreroll();
        }
        return;
      }

      const next = getNextTrackRef.current(track.id);
      if (!next || next.id === track.id) return;

      const nextIsYt =
        next.playbackRights === 'embed-only' && Boolean(next.embedId);
      const incomingKind: 'audio' | 'youtube' = nextIsYt ? 'youtube' : 'audio';
      const nextStartSec = getStartSecForTrack(next, next.durationSec || 218);

      // Within bajao.party preroll window (3s normal / 6s slow): silently pre-roll standby deck + schedule exact exit cut
      if (remaining > 0.05 && remaining <= prerollLeadSec) {
        if (
          exitTimerRef.current === null ||
          exitTimerTrackIdRef.current !== track.id
        ) {
          clearExitTimer();
          exitTimerTrackIdRef.current = track.id;
          exitTimerRef.current = window.setTimeout(() => {
            exitTimerRef.current = null;
            exitTimerTrackIdRef.current = '';
            if (
              !isPlayingRef.current ||
              transitionRef.current ||
              currentTrackRef.current?.id !== track.id
            ) {
              return;
            }
            let liveCur = currentTimeRef.current;
            try {
              if (sourceKind === 'youtube') {
                const p = ytPlayersRef.current[activeYtDeckIdxRef.current];
                const t = p?.getCurrentTime();
                if (typeof t === 'number' && Number.isFinite(t)) liveCur = t;
              } else {
                const d = getDeck(activeDeckIdxRef.current);
                if (d && Number.isFinite(d.currentTime)) liveCur = d.currentTime;
              }
            } catch {
              // ignore
            }
            if (liveCur < exitTarget - 0.2) return;
            triggerBajaoCrossfade(sourceKind);
          }, Math.max(0, remaining * 1000));
        }

        // Pre-roll standby deck silently in BOTH Hook Mode and Full Song Mode so next song starts immediately with zero wait
        if (remaining >= PREROLL_MIN_REMAINING_SEC) {
          const prerollStartSec =
            nextStartSec >= remaining + 0.2
              ? Math.max(
                  0,
                  Math.min(
                    nextStartSec - 0.1,
                    nextStartSec - remaining + ytPrerollLatencyRef.current
                  )
                )
              : Math.max(0, nextStartSec);

          if (incomingKind === 'youtube') {
            const outgoingYtDeckIdx = activeYtDeckIdxRef.current;
            const incomingYtDeckIdx: 0 | 1 =
              sourceKind === 'youtube' ? (outgoingYtDeckIdx === 0 ? 1 : 0) : 0;

            if (
              !ytPreRolledRef.current[incomingYtDeckIdx] ||
              ytDeckTrackIdRef.current[incomingYtDeckIdx] !== next.id
            ) {
              ytDeckModeRef.current[incomingYtDeckIdx] = 'preroll';
              ytPreRolledRef.current[incomingYtDeckIdx] = true;
              ytStartZeroRef.current[incomingYtDeckIdx] = true;
              ytPrerollStartSecRef.current[incomingYtDeckIdx] = prerollStartSec;
              ytExpectedStartSecRef.current[incomingYtDeckIdx] = nextStartSec;

              const standbyPlayer = ytPlayersRef.current[incomingYtDeckIdx];
              if (
                ytDeckTrackIdRef.current[incomingYtDeckIdx] === next.id &&
                standbyPlayer &&
                ytReadyRef.current[incomingYtDeckIdx]
              ) {
                try {
                  if (mutedRef.current || volumeRef.current === 0) {
                    standbyPlayer.mute();
                  } else {
                    standbyPlayer.unMute();
                    standbyPlayer.setVolume(0);
                  }
                  standbyPlayer.seekTo(prerollStartSec, true);
                  ytAwaitingPlayRef.current[incomingYtDeckIdx] = true;
                  ytAwaitingPlaySinceRef.current[incomingYtDeckIdx] = Date.now();
                  standbyPlayer.playVideo();
                } catch {
                  // ignore
                }
              } else {
                setYtSlotTracks((prev) => {
                  const updated: [Track | null, Track | null] =
                    sourceKind === 'youtube'
                      ? ([...prev] as [Track | null, Track | null])
                      : [null, null];
                  updated[incomingYtDeckIdx] = next;
                  return updated;
                });
              }
            }
          } else if (next.streamUrl) {
            const incomingAudioDeckIdx: 0 | 1 =
              activeDeckIdxRef.current === 0 ? 1 : 0;
            const inDeck = getDeck(incomingAudioDeckIdx);
            if (inDeck && !audioPreRolledRef.current[incomingAudioDeckIdx]) {
              const resolvedNextUrl = new URL(next.streamUrl, window.location.origin).href;
              if (
                deckUrlRef.current[incomingAudioDeckIdx] !== resolvedNextUrl ||
                deckTrackIdRef.current[incomingAudioDeckIdx] !== next.id
              ) {
                inDeck.pause();
                inDeck.preload = 'auto';
                inDeck.src = resolvedNextUrl;
                deckUrlRef.current[incomingAudioDeckIdx] = resolvedNextUrl;
                deckTrackIdRef.current[incomingAudioDeckIdx] = next.id;
              }
              try {
                inDeck.currentTime = prerollStartSec;
              } catch {
                // ignore
              }
              inDeck.volume = 0;
              audioPreRolledRef.current[incomingAudioDeckIdx] = true;
              inDeck.play().catch(() => {
                audioPreRolledRef.current[incomingAudioDeckIdx] = false;
              });
            }
          }
        }
        return;
      }

      // Reached Early Crossfade point (before hook.endSec or song end): start next song's hook & blend
      if (remaining <= 0.05) {
        triggerBajaoCrossfade(sourceKind);
      }
    },
    [
      abortStandbyPreroll,
      clearExitTimer,
      getAutoExitTargetSec,
      getDeck,
      getHookForTrack,
      getStartSecForTrack,
      triggerBajaoCrossfade,
    ]
  );

  // Unified dual-deck HTML5 <audio> & YouTube handoff synchronization
  useEffect(() => {
    if (!currentTrack) {
      manualSwitchGenRef.current += 1;
      stopManualFade();
      manualFadeOutAudioIdxRef.current = null;
      manualFadeOutYtSlotRef.current = null;
      autoCompletedTrackIdRef.current = '';
      prevRenderedTrackRef.current = null;
      cancelTransition(true);
      clearDeck(0);
      clearDeck(1);
      hardSilenceYtSlot(0);
      hardSilenceYtSlot(1);
      consecutiveAdSkipsRef.current = 0;
      setYtAdActiveState(false);
      setYtSlotTracks([null, null]);
      setMinimizedDrawerTab(null);
      setConsoleDrawerTab(null);
      setCurrentTime(0);
      setDuration(0);
      return;
    }

    const prevTrack = prevRenderedTrackRef.current;
    const trackChanged = prevTrack?.id !== currentTrack.id;
    const isAutoCrossfadeHandoff =
      trackChanged && autoCompletedTrackIdRef.current === currentTrack.id;
    if (trackChanged) {
      autoCompletedTrackIdRef.current = '';
      prevRenderedTrackRef.current = currentTrack;
    }
    const isManualSwitch = trackChanged && prevTrack !== null && !isAutoCrossfadeHandoff;

    if (isManualSwitch) {
      const switchGen = ++manualSwitchGenRef.current;
      stopManualFade();
      cancelTransition(true);
      clearExitTimer();
      abortStandbyPreroll();
      transitionLockFromIdRef.current = '';
      lastCrossfadeAttemptMsRef.current = 0;

      // Rapid-click protection: hard-silence any prior still-fading deck/slot before reusing it
      if (manualFadeOutAudioIdxRef.current !== null) {
        clearDeck(manualFadeOutAudioIdxRef.current);
        manualFadeOutAudioIdxRef.current = null;
      }
      if (manualFadeOutYtSlotRef.current !== null) {
        hardSilenceYtSlot(manualFadeOutYtSlotRef.current);
        manualFadeOutYtSlotRef.current = null;
      }

      const prevWasYt = Boolean(
        prevTrack.playbackRights === 'embed-only' && prevTrack.embedId
      );
      const prevAudioIdx = activeDeckIdxRef.current;
      const prevAudioDeck = getDeck(prevAudioIdx);
      const prevYtSlot = activeYtDeckIdxRef.current;

      let outAudioIdx: 0 | 1 | null = null;
      let outAudioStartVol = 0;
      let outYtSlot: 0 | 1 | null = null;
      let outYtStartVol = 0;

      if (
        !prevWasYt &&
        prevAudioDeck &&
        deckTrackIdRef.current[prevAudioIdx] === prevTrack.id &&
        !prevAudioDeck.paused &&
        prevAudioDeck.volume > 0.005
      ) {
        outAudioIdx = prevAudioIdx;
        outAudioStartVol = prevAudioDeck.volume;
      } else if (
        prevWasYt &&
        ytDeckTrackIdRef.current[prevYtSlot] === prevTrack.id &&
        ytPlayersRef.current[prevYtSlot] &&
        ytReadyRef.current[prevYtSlot] &&
        !ytAdActiveRef.current[prevYtSlot] &&
        effectiveGainRef.current > 0.005
      ) {
        try {
          const st = ytPlayersRef.current[prevYtSlot]?.getPlayerState?.();
          if (st === 1 || st === 3) {
            outYtSlot = prevYtSlot;
            outYtStartVol = effectiveGainRef.current;
          }
        } catch {
          // ignore
        }
      }

      const startSec = getStartSecForTrack(
        currentTrack,
        currentTrack.durationSec || 218
      );
      setAudioError(null);
      setCurrentTime(startSec);
      setDuration(currentTrack.durationSec || 0);

      let inAudioIdx: 0 | 1 | null = null;
      let inYtSlot: 0 | 1 | null = null;

      if (isCurrentYouTube) {
        if (outAudioIdx !== null && isPlaying) {
          const otherAudio: 0 | 1 = outAudioIdx === 0 ? 1 : 0;
          clearDeck(otherAudio);
          manualFadeOutAudioIdxRef.current = outAudioIdx;
        } else {
          clearDeck(0);
          clearDeck(1);
          outAudioIdx = null;
        }
        audioPreRolledRef.current = [false, false];

        const altYtSlot: 0 | 1 = prevYtSlot === 0 ? 1 : 0;
        const canReuseAltWarmed =
          ytDeckTrackIdRef.current[altYtSlot] === currentTrack.id &&
          ytReadyRef.current[altYtSlot] &&
          ytPlayersRef.current[altYtSlot] &&
          outYtSlot !== altYtSlot;

        const targetYtSlot: 0 | 1 = canReuseAltWarmed
          ? altYtSlot
          : outYtSlot !== null
            ? (outYtSlot === 0 ? 1 : 0)
            : 0;
        const otherYtSlot: 0 | 1 = targetYtSlot === 0 ? 1 : 0;
        inYtSlot = targetYtSlot;

        if (outYtSlot === otherYtSlot && isPlaying) {
          ytDeckModeRef.current[otherYtSlot] = 'fadeout';
          ytAwaitingPlayRef.current[otherYtSlot] = false;
          ytAwaitingPlaySinceRef.current[otherYtSlot] = 0;
          manualFadeOutYtSlotRef.current = otherYtSlot;
        } else {
          hardSilenceYtSlot(otherYtSlot);
          outYtSlot = null;
        }

        const shouldFade = isPlaying && (outAudioIdx !== null || outYtSlot !== null);
        const wasAlreadyCuedOnTarget =
          ytDeckTrackIdRef.current[targetYtSlot] === currentTrack.id &&
          ytReadyRef.current[targetYtSlot] &&
          ytPlayersRef.current[targetYtSlot];

        activeYtDeckIdxRef.current = targetYtSlot;
        setActiveYtDeckIdx(targetYtSlot);
        ytDeckModeRef.current[targetYtSlot] = 'active';
        ytStartZeroRef.current[targetYtSlot] = shouldFade;
        ytPreRolledRef.current[targetYtSlot] = false;
        ytPrerollStartSecRef.current[targetYtSlot] = 0;
        ytExpectedStartSecRef.current[targetYtSlot] = startSec;
        ytOffsetVerifiedRef.current[targetYtSlot] = false;
        ytOffsetSeekTriedAtRef.current[targetYtSlot] = 0;
        ytBlockedRetryDoneRef.current[targetYtSlot] = false;
        ytAdActiveRef.current[targetYtSlot] = false;
        ytAdStartedAtRef.current[targetYtSlot] = 0;
        ytAdRetriedRef.current[targetYtSlot] = false;
        ytAdReloadedRef.current[targetYtSlot] = false;
        setYtAdActiveState(false);

        const nextSlots: [Track | null, Track | null] = [null, null];
        nextSlots[targetYtSlot] = currentTrack;
        if (manualFadeOutYtSlotRef.current === otherYtSlot) {
          nextSlots[otherYtSlot] = ytDesiredTrackRef.current[otherYtSlot];
        }
        setYtSlotTracks(nextSlots);

        if (wasAlreadyCuedOnTarget) {
          const p = ytPlayersRef.current[targetYtSlot]!;
          ytDesiredTrackRef.current[targetYtSlot] = currentTrack;
          setYtDeckVolume(targetYtSlot, shouldFade ? 0 : effectiveGainRef.current);
          if (startSec > 0) {
            try {
              p.seekTo(startSec, true);
            } catch {
              // ignore
            }
          }
          if (isPlaying) {
            ytAwaitingPlayRef.current[targetYtSlot] = true;
            ytAwaitingPlaySinceRef.current[targetYtSlot] = Date.now();
            try {
              p.playVideo();
            } catch {
              // ignore
            }
          }
        } else if (ytPlayersRef.current[targetYtSlot] && ytReadyRef.current[targetYtSlot]) {
          // Trigger loadVideoById synchronously for zero click-to-load lag
          ensureYtSlotSynced(targetYtSlot, currentTrack);
        }
      } else {
        // Incoming track is direct Audio
        if (!currentTrack.streamUrl) return;
        const targetAudioIdx: 0 | 1 =
          outAudioIdx !== null ? (outAudioIdx === 0 ? 1 : 0) : activeDeckIdxRef.current;
        const targetDeck = getDeck(targetAudioIdx);
        if (!targetDeck) return;

        const otherAudioIdx: 0 | 1 = targetAudioIdx === 0 ? 1 : 0;
        if (outAudioIdx === otherAudioIdx && isPlaying) {
          manualFadeOutAudioIdxRef.current = otherAudioIdx;
        } else {
          clearDeck(otherAudioIdx);
          outAudioIdx = null;
        }
        audioPreRolledRef.current = [false, false];

        if (outYtSlot !== null && isPlaying) {
          const nonFadeYt: 0 | 1 = outYtSlot === 0 ? 1 : 0;
          hardSilenceYtSlot(nonFadeYt);
          ytDeckModeRef.current[outYtSlot] = 'fadeout';
          ytAwaitingPlayRef.current[outYtSlot] = false;
          ytAwaitingPlaySinceRef.current[outYtSlot] = 0;
          manualFadeOutYtSlotRef.current = outYtSlot;
          const nextSlots: [Track | null, Track | null] = [null, null];
          nextSlots[outYtSlot] = ytDesiredTrackRef.current[outYtSlot];
          setYtSlotTracks(nextSlots);
        } else {
          hardSilenceYtSlot(0);
          hardSilenceYtSlot(1);
          setYtSlotTracks([null, null]);
          outYtSlot = null;
        }
        setYtAdActiveState(false);

        const resolvedUrl = new URL(currentTrack.streamUrl, window.location.origin).href;
        const shouldFade = isPlaying && (outAudioIdx !== null || outYtSlot !== null);
        activeDeckIdxRef.current = targetAudioIdx;
        deckTrackIdRef.current[targetAudioIdx] = currentTrack.id;
        deckUrlRef.current[targetAudioIdx] = resolvedUrl;
        pendingAudioHookSeekTrackIdRef.current = startSec > 0 ? currentTrack.id : '';
        audioSwitchingDeckRef.current[targetAudioIdx] = true;
        targetDeck.volume = shouldFade ? 0 : effectiveGainRef.current;
        targetDeck.src = resolvedUrl;
        targetDeck.load();
        inAudioIdx = targetAudioIdx;

        if (isPlaying) {
          const playPromise = targetDeck.play();
          if (playPromise !== undefined) {
            playPromise.catch((err: unknown) => {
              const name = (err as { name?: string })?.name;
              if (name === 'AbortError') return;
              if (name === 'NotAllowedError') {
                setAudioError('Tap Play again to enable browser audio playback.');
              } else {
                setAudioError('Could not start audio stream for this track.');
              }
              onSetPlayingStateRef.current(false);
            });
          }
        } else {
          targetDeck.pause();
        }
      }

      // Ultra-short 240ms anti-click fade transition for manual switches
      if (isPlaying && (outAudioIdx !== null || outYtSlot !== null)) {
        const capturedOutAudio = outAudioIdx;
        const capturedOutYt = outYtSlot;
        const capturedInAudio = inAudioIdx;
        const capturedInYt = inYtSlot;
        const startPerf = performance.now();

        manualFadeStopRef.current = startBackgroundTicker(() => {
          if (manualSwitchGenRef.current !== switchGen) return;
          const p = Math.min(1, (performance.now() - startPerf) / MANUAL_SWITCH_FADE_MS);
          const master = effectiveGainRef.current;

          if (capturedOutAudio !== null) {
            const od = getDeck(capturedOutAudio);
            if (od) od.volume = Math.max(0, Math.min(1, outAudioStartVol * (1 - p)));
          }
          if (capturedOutYt !== null) {
            setYtDeckVolume(capturedOutYt, Math.max(0, outYtStartVol * (1 - p)));
          }

          if (capturedInAudio !== null) {
            const idDeck = getDeck(capturedInAudio);
            if (idDeck) idDeck.volume = Math.max(0, Math.min(1, master * p));
          }
          if (capturedInYt !== null) {
            if (p > 0.05) {
              ytStartZeroRef.current[capturedInYt] = false;
            }
            setYtDeckVolume(capturedInYt, master * p);
          }

          if (p >= 1) {
            stopManualFade();
            if (manualFadeOutAudioIdxRef.current !== null) {
              clearDeck(manualFadeOutAudioIdxRef.current);
              manualFadeOutAudioIdxRef.current = null;
            }
            if (manualFadeOutYtSlotRef.current !== null) {
              const finishedFadeYt = manualFadeOutYtSlotRef.current;
              hardSilenceYtSlot(finishedFadeYt);
              manualFadeOutYtSlotRef.current = null;
              setYtSlotTracks((prev) => {
                if (!prev[finishedFadeYt] || ytDeckModeRef.current[finishedFadeYt] === 'active') {
                  return prev;
                }
                const next: [Track | null, Track | null] = [...prev] as [
                  Track | null,
                  Track | null,
                ];
                next[finishedFadeYt] = null;
                return next;
              });
            }
            if (capturedInAudio !== null) {
              const idDeck = getDeck(capturedInAudio);
              if (idDeck) idDeck.volume = master;
            }
            if (capturedInYt !== null) {
              ytStartZeroRef.current[capturedInYt] = false;
              setYtDeckVolume(capturedInYt, master);
            }
          }
        }, 20);
      }
      return;
    }

    if (isCurrentYouTube) {
      const activeYt = activeYtDeckIdxRef.current;
      const standbyYt: 0 | 1 = activeYt === 0 ? 1 : 0;
      const alreadyActiveYt =
        ytDeckTrackIdRef.current[activeYt] === currentTrack.id &&
        ytDeckModeRef.current[activeYt] === 'active';

      if (!alreadyActiveYt) {
        const warmedSlot: 0 | 1 | null =
          ytDeckTrackIdRef.current[activeYt] === currentTrack.id &&
          ytReadyRef.current[activeYt] &&
          ytPlayersRef.current[activeYt]
            ? activeYt
            : ytDeckTrackIdRef.current[standbyYt] === currentTrack.id &&
                ytReadyRef.current[standbyYt] &&
                ytPlayersRef.current[standbyYt]
              ? standbyYt
              : null;

        cancelTransition(false);
        clearExitTimer();
        clearDeck(0);
        clearDeck(1);
        audioPreRolledRef.current = [false, false];
        transitionLockFromIdRef.current = '';
        lastCrossfadeAttemptMsRef.current = 0;
        setAudioError(null);
        const startSec = getStartSecForTrack(
          currentTrack,
          currentTrack.durationSec || 218
        );
        setCurrentTime(startSec);
        setDuration(currentTrack.durationSec || 0);

        if (warmedSlot !== null) {
          const prevSlot: 0 | 1 = warmedSlot === 0 ? 1 : 0;
          const wasPrecueOnly = ytDeckModeRef.current[warmedSlot] === 'precue';
          activeYtDeckIdxRef.current = warmedSlot;
          setActiveYtDeckIdx(warmedSlot);
          ytDeckModeRef.current[warmedSlot] = 'active';
          ytStartZeroRef.current[warmedSlot] = false;
          ytPreRolledRef.current[warmedSlot] = false;
          ytPrerollStartSecRef.current[warmedSlot] = 0;
          ytExpectedStartSecRef.current[warmedSlot] = startSec;
          ytOffsetVerifiedRef.current[warmedSlot] = false;
          ytOffsetSeekTriedAtRef.current[warmedSlot] = 0;

          ytDeckModeRef.current[prevSlot] = 'idle';
          ytStartZeroRef.current[prevSlot] = false;
          ytPreRolledRef.current[prevSlot] = false;
          ytPrerollStartSecRef.current[prevSlot] = 0;
          ytAdActiveRef.current[prevSlot] = false;
          ytAdStartedAtRef.current[prevSlot] = 0;
          ytAdRetriedRef.current[prevSlot] = false;
          ytAdReloadedRef.current[prevSlot] = false;
          ytExpectedStartSecRef.current[prevSlot] = 0;
          ytOffsetVerifiedRef.current[prevSlot] = false;
          ytOffsetSeekTriedAtRef.current[prevSlot] = 0;
          setYtAdActiveState(ytAdActiveRef.current[warmedSlot]);

          setYtSlotTracks(() => {
            const nextSlots: [Track | null, Track | null] = [null, null];
            nextSlots[warmedSlot] = currentTrack;
            return nextSlots;
          });

          const promotedPlayer = ytPlayersRef.current[warmedSlot];
          if (promotedPlayer) {
            setYtDeckVolume(warmedSlot, effectiveGainRef.current);
            if (wasPrecueOnly && startSec > 0) {
              try {
                promotedPlayer.seekTo(startSec, true);
              } catch {
                // ignore
              }
            }
            if (isPlayingRef.current) {
              ytAwaitingPlayRef.current[warmedSlot] = true;
              ytAwaitingPlaySinceRef.current[warmedSlot] = Date.now();
              try {
                promotedPlayer.playVideo();
              } catch {
                // ignore
              }
            }
          }
        } else {
          activeYtDeckIdxRef.current = 0;
          setActiveYtDeckIdx(0);
          ytStartZeroRef.current = [false, false];
          ytPreRolledRef.current = [false, false];
          ytPrerollStartSecRef.current = [0, 0];
          ytDeckModeRef.current = ['active', 'idle'];
          ytAdActiveRef.current = [false, false];
          ytAdStartedAtRef.current = [0, 0];
          ytAdRetriedRef.current = [false, false];
          ytAdReloadedRef.current = [false, false];
          ytExpectedStartSecRef.current = [startSec, 0];
          ytOffsetVerifiedRef.current = [false, false];
          ytOffsetSeekTriedAtRef.current = [0, 0];
          ytBlockedRetryDoneRef.current = [false, false];
          setYtAdActiveState(false);
          setYtSlotTracks([currentTrack, null]);
        }
      }
      return;
    }

    // Current track is direct Audio
    if (!currentTrack.streamUrl) return;

    const activeIdx = activeDeckIdxRef.current;
    const activeDeck = getDeck(activeIdx);
    const idleIdx: 0 | 1 = activeIdx === 0 ? 1 : 0;
    if (!activeDeck) return;

    const resolvedUrl = new URL(currentTrack.streamUrl, window.location.origin).href;
    const alreadyActiveHere =
      deckTrackIdRef.current[activeIdx] === currentTrack.id &&
      deckUrlRef.current[activeIdx] === resolvedUrl;

    if (!alreadyActiveHere) {
      cancelTransition(true);
      clearExitTimer();
      clearDeck(idleIdx);
      audioPreRolledRef.current = [false, false];
      hardSilenceYtSlot(0);
      hardSilenceYtSlot(1);
      setYtAdActiveState(false);
      setYtSlotTracks([null, null]);
      transitionLockFromIdRef.current = '';
      lastCrossfadeAttemptMsRef.current = 0;

      deckTrackIdRef.current[activeIdx] = currentTrack.id;
      deckUrlRef.current[activeIdx] = resolvedUrl;
      setAudioError(null);
      const startSec = getStartSecForTrack(
        currentTrack,
        currentTrack.durationSec || 218
      );
      pendingAudioHookSeekTrackIdRef.current = startSec > 0 ? currentTrack.id : '';
      setCurrentTime(startSec);
      setDuration(currentTrack.durationSec || 0);
      audioSwitchingDeckRef.current[activeIdx] = true;
      activeDeck.volume = effectiveGainRef.current;
      activeDeck.src = resolvedUrl;
      activeDeck.load();
    }

    if (isPlaying) {
      const playPromise = activeDeck.play();
      if (playPromise !== undefined) {
        playPromise.catch((err: unknown) => {
          const name = (err as { name?: string })?.name;
          if (name === 'AbortError') return;
          if (name === 'NotAllowedError') {
            setAudioError('Tap Play again to enable browser audio playback.');
          } else {
            setAudioError('Could not start audio stream for this track.');
          }
          onSetPlayingStateRef.current(false);
        });
      }

      const session = transitionRef.current;
      if (session && session.incomingKind === 'audio') {
        getDeck(session.incomingAudioDeckIdx)?.play().catch(() => {});
      }
    } else {
      activeDeck.pause();
      const session = transitionRef.current;
      if (session && session.incomingKind === 'audio') {
        getDeck(session.incomingAudioDeckIdx)?.pause();
      }
    }
  }, [
    currentTrack?.id,
    currentTrack?.streamUrl,
    isPlaying,
    isCurrentYouTube,
    abortStandbyPreroll,
    cancelTransition,
    clearDeck,
    clearExitTimer,
    getDeck,
    getStartSecForTrack,
    hardSilenceYtSlot,
    setYtDeckVolume,
    stopManualFade,
  ]);

  // Sync YouTube Slot 0 and Slot 1 using persistent YT.Player instances + loadVideoById
  const ensureYtSlotSynced = useCallback(
    (slotIdx: 0 | 1, track: Track | null) => {
      if (ytDeckModeRef.current[slotIdx] === 'fadeout') {
        return;
      }
      ytDesiredTrackRef.current[slotIdx] = track;
      const existingPlayer = ytPlayersRef.current[slotIdx];

      if (!track || !track.embedId) {
        ytDeckTrackIdRef.current[slotIdx] = '';
        ytAwaitingPlayRef.current[slotIdx] = false;
        ytAwaitingPlaySinceRef.current[slotIdx] = 0;
        if (existingPlayer && ytReadyRef.current[slotIdx]) {
          try {
            existingPlayer.pauseVideo();
            existingPlayer.stopVideo?.();
          } catch {
            // ignore
          }
        }
        return;
      }

      const slotMode = ytDeckModeRef.current[slotIdx];
      const isPrecueOnly = slotMode === 'precue';
      const startZero =
        ytStartZeroRef.current[slotIdx] ||
        slotMode === 'precue' ||
        slotMode === 'preroll';
      const shouldAutoPlay =
        !isPrecueOnly &&
        (isPlayingRef.current ||
          slotMode === 'crossfade' ||
          slotMode === 'preroll');
      const entryStartSec = getStartSecForTrack(track, track.durationSec || 218);
      const targetStartSec =
        (slotMode === 'preroll' || slotMode === 'crossfade') &&
        ytPreRolledRef.current[slotIdx]
          ? ytPrerollStartSecRef.current[slotIdx]
          : entryStartSec;
      ytExpectedStartSecRef.current[slotIdx] = targetStartSec;

      // Fast path: persistent player already created & ready -> reuse via loadVideoById (no iframe rebuild!)
      if (existingPlayer && ytReadyRef.current[slotIdx]) {
        const sameTrack = ytDeckTrackIdRef.current[slotIdx] === track.id;
        ytDeckTrackIdRef.current[slotIdx] = track.id;
        if (slotIdx === activeYtDeckIdxRef.current && slotMode === 'active') {
          ytBufferingSinceRef.current = null;
        }
        if (!sameTrack) {
          ytEmbedRetryIdxRef.current[slotIdx] = 0;
          ytAdActiveRef.current[slotIdx] = false;
          ytAdStartedAtRef.current[slotIdx] = 0;
          ytAdRetriedRef.current[slotIdx] = false;
          ytAdReloadedRef.current[slotIdx] = false;
          ytOffsetVerifiedRef.current[slotIdx] = false;
          ytOffsetSeekTriedAtRef.current[slotIdx] = 0;
          ytBlockedRetryDoneRef.current[slotIdx] = false;
          if (slotIdx === activeYtDeckIdxRef.current && slotMode === 'active') {
            setYtAdActiveState(false);
          }
        }

        if (isPrecueOnly) {
          try {
            existingPlayer.mute();
            existingPlayer.setVolume(0);
          } catch {
            // ignore
          }
        } else if (startZero || (manualFadeStopRef.current !== null && slotIdx === activeYtDeckIdxRef.current)) {
          try {
            if (mutedRef.current || volumeRef.current === 0) {
              existingPlayer.mute();
            } else {
              existingPlayer.unMute();
              if (startZero) {
                existingPlayer.setVolume(0);
              }
            }
          } catch {
            // ignore
          }
        } else {
          setYtDeckVolume(slotIdx, effectiveGainRef.current);
        }

        if (!sameTrack) {
          ytAwaitingPlayRef.current[slotIdx] = shouldAutoPlay;
          ytAwaitingPlaySinceRef.current[slotIdx] = shouldAutoPlay ? Date.now() : 0;
          if (slotIdx === activeYtDeckIdxRef.current && slotMode === 'active') {
            setYtBuffering(true);
          }
          try {
            if (shouldAutoPlay && existingPlayer.loadVideoById) {
              existingPlayer.loadVideoById({
                videoId: track.embedId,
                startSeconds: targetStartSec,
              });
            } else if (!shouldAutoPlay && existingPlayer.cueVideoById) {
              existingPlayer.cueVideoById({
                videoId: track.embedId,
                startSeconds: targetStartSec,
              });
            } else {
              existingPlayer.loadVideoById?.({
                videoId: track.embedId,
                startSeconds: targetStartSec,
              });
            }
            if (shouldAutoPlay) {
              existingPlayer.playVideo();
              keepAliveAudioRef.current?.play().catch(() => {});
              syncMediaSessionRef.current();
            }
          } catch {
            // ignore
          }
        } else if (shouldAutoPlay) {
          const curState = existingPlayer.getPlayerState?.();
          if (curState !== 1 && curState !== 3) {
            ytAwaitingPlayRef.current[slotIdx] = true;
            ytAwaitingPlaySinceRef.current[slotIdx] = Date.now();
            try {
              existingPlayer.playVideo();
            } catch {
              // ignore
            }
          }
        }
        return;
      }

      // Initialize persistent YT.Player once for this slot
      if (ytInitializingRef.current[slotIdx]) {
        return;
      }
      ytInitializingRef.current[slotIdx] = true;
      ytDeckTrackIdRef.current[slotIdx] = track.id;
      ytEmbedRetryIdxRef.current[slotIdx] = 0;
      ytAdActiveRef.current[slotIdx] = false;
      ytAdStartedAtRef.current[slotIdx] = 0;
      ytAdRetriedRef.current[slotIdx] = false;
      ytAdReloadedRef.current[slotIdx] = false;
      ytOffsetVerifiedRef.current[slotIdx] = false;
      ytOffsetSeekTriedAtRef.current[slotIdx] = 0;
      ytBlockedRetryDoneRef.current[slotIdx] = false;
      if (slotIdx === activeYtDeckIdxRef.current && slotMode === 'active') {
        setYtAdActiveState(false);
        setYtBuffering(true);
      }

      loadYouTubeIframeApi().then(() => {
        const currentHost = slotIdx === 0 ? ytHost0Ref.current : ytHost1Ref.current;
        if (!currentHost || !window.YT?.Player) {
          ytInitializingRef.current[slotIdx] = false;
          return;
        }

        const latestDesired = ytDesiredTrackRef.current[slotIdx];
        const initialVideoId = latestDesired?.embedId || track.embedId!;
        const mountEl = document.createElement('div');
        currentHost.replaceChildren(mountEl);

        const player = new window.YT.Player(mountEl, {
          videoId: initialVideoId,
          width: '100%',
          height: '100%',
          playerVars: {
            autoplay: 0,
            controls: 0,
            disablekb: 1,
            fs: 0,
            playsinline: 1,
            rel: 0,
            iv_load_policy: 3,
            modestbranding: 1,
            enablejsapi: 1,
            origin: window.location.origin,
            widget_referrer: window.location.href,
          },
          events: {
            onReady: (event) => {
              ytInitializingRef.current[slotIdx] = false;
              ytReadyRef.current[slotIdx] = true;
              ytPlayersRef.current[slotIdx] = event.target;
              consecutiveYtErrorsRef.current = 0;

              const readyIframe = (
                slotIdx === 0 ? ytHost0Ref.current : ytHost1Ref.current
              )?.querySelector('iframe');
              if (readyIframe) {
                readyIframe.setAttribute(
                  'allow',
                  'autoplay; encrypted-media; picture-in-picture; fullscreen'
                );
              }

              const latestTrack = ytDesiredTrackRef.current[slotIdx];
              if (!latestTrack || !latestTrack.embedId || ytDeckModeRef.current[slotIdx] === 'fadeout') {
                try {
                  if (ytDeckModeRef.current[slotIdx] === 'fadeout') {
                    event.target.mute();
                    event.target.setVolume(0);
                  }
                  event.target.pauseVideo();
                } catch {
                  // ignore
                }
                if (slotIdx === activeYtDeckIdxRef.current) {
                  setYtBuffering(false);
                }
                return;
              }

              const latestMode = ytDeckModeRef.current[slotIdx];
              const latestIsPrecue = latestMode === 'precue';
              const latestStartZero =
                ytStartZeroRef.current[slotIdx] ||
                latestIsPrecue ||
                latestMode === 'preroll';
              const latestShouldPlay =
                !latestIsPrecue &&
                (isPlayingRef.current ||
                  latestMode === 'crossfade' ||
                  latestMode === 'preroll');
              const latestEntryStart = getStartSecForTrack(
                latestTrack,
                latestTrack.durationSec || 218
              );
              const latestTargetStart =
                (latestMode === 'preroll' || latestMode === 'crossfade') &&
                ytPreRolledRef.current[slotIdx]
                  ? ytPrerollStartSecRef.current[slotIdx]
                  : latestEntryStart;
              ytExpectedStartSecRef.current[slotIdx] = latestTargetStart;

              if (latestIsPrecue) {
                try {
                  event.target.mute();
                  event.target.setVolume(0);
                } catch {
                  // ignore
                }
              } else if (latestStartZero) {
                try {
                  if (mutedRef.current || volumeRef.current === 0) {
                    event.target.mute();
                  } else {
                    event.target.unMute();
                    event.target.setVolume(0);
                  }
                } catch {
                  // ignore
                }
              } else {
                setYtDeckVolume(slotIdx, effectiveGainRef.current);
              }

              if (latestIsPrecue) {
                ytDeckTrackIdRef.current[slotIdx] = latestTrack.id;
                if (
                  (latestTrack.embedId !== initialVideoId || latestTargetStart > 0) &&
                  event.target.cueVideoById
                ) {
                  try {
                    event.target.cueVideoById({
                      videoId: latestTrack.embedId,
                      startSeconds: latestTargetStart,
                    });
                  } catch {
                    // ignore
                  }
                }
                ytAwaitingPlayRef.current[slotIdx] = false;
                return;
              }

              if (
                latestTrack.embedId !== initialVideoId &&
                event.target.loadVideoById
              ) {
                ytDeckTrackIdRef.current[slotIdx] = latestTrack.id;
                event.target.loadVideoById({
                  videoId: latestTrack.embedId,
                  startSeconds: latestTargetStart,
                });
              } else if (latestTargetStart > 0) {
                try {
                  event.target.seekTo(latestTargetStart, true);
                } catch {
                  // ignore
                }
              }

              if (
                !latestStartZero &&
                slotIdx === activeYtDeckIdxRef.current &&
                latestMode === 'active'
              ) {
                const ytDur = event.target.getDuration();
                if (
                  Number.isFinite(ytDur) &&
                  ytDur > 0 &&
                  !isLikelyYtAdDuration(ytDur, latestTrack)
                ) {
                  setDuration(ytDur);
                }
              }

              if (latestShouldPlay) {
                ytAwaitingPlayRef.current[slotIdx] = true;
                ytAwaitingPlaySinceRef.current[slotIdx] = Date.now();
                event.target.playVideo();
                keepAliveAudioRef.current?.play().catch(() => {});
                syncMediaSessionRef.current();
              } else {
                ytAwaitingPlayRef.current[slotIdx] = false;
                if (slotIdx === activeYtDeckIdxRef.current) {
                  setYtBuffering(false);
                }
              }
            },
            onStateChange: (event) => {
              if (!ytDesiredTrackRef.current[slotIdx]) return;
              if (ytDeckModeRef.current[slotIdx] === 'fadeout') return;
              const UNSTARTED = window.YT?.PlayerState?.UNSTARTED ?? -1;
              const ENDED = window.YT?.PlayerState?.ENDED ?? 0;
              const PLAYING = window.YT?.PlayerState?.PLAYING ?? 1;
              const PAUSED = window.YT?.PlayerState?.PAUSED ?? 2;
              const BUFFERING = window.YT?.PlayerState?.BUFFERING ?? 3;
              const CUED = window.YT?.PlayerState?.CUED ?? 5;

              const isOutgoingDuringFade = Boolean(
                transitionRef.current &&
                  transitionRef.current.outgoingKind === 'youtube' &&
                  transitionRef.current.outgoingYtDeckIdx === slotIdx
              );
              const isIncomingDuringFade = Boolean(
                transitionRef.current &&
                  transitionRef.current.incomingKind === 'youtube' &&
                  transitionRef.current.incomingYtDeckIdx === slotIdx
              );

              const isActiveSlot =
                slotIdx === activeYtDeckIdxRef.current &&
                ytDeckModeRef.current[slotIdx] === 'active';
              const isStandbyWarmup =
                ytDeckModeRef.current[slotIdx] === 'precue' ||
                ytDeckModeRef.current[slotIdx] === 'preroll';

              if (
                (event.data === PLAYING || event.data === BUFFERING) &&
                isLiteConnection()
              ) {
                try {
                  event.target.setPlaybackQuality?.('tiny');
                } catch {
                  // ignore
                }
              }

              if (event.data === BUFFERING || event.data === UNSTARTED) {
                if (isActiveSlot && isPlayingRef.current) {
                  setYtBuffering(true);
                  if (ytBufferingSinceRef.current === null) {
                    ytBufferingSinceRef.current = Date.now();
                  }
                }
                return;
              }

              if (event.data === PLAYING) {
                consecutiveYtErrorsRef.current = 0;
                ytAwaitingPlayRef.current[slotIdx] = false;
                ytAwaitingPlaySinceRef.current[slotIdx] = 0;
                if (isActiveSlot) {
                  ytBufferingSinceRef.current = null;
                  setYtBuffering(false);
                }
                keepAliveAudioRef.current?.play().catch(() => {});
                if (!transitionRef.current && isActiveSlot) {
                  const ytDur = event.target.getDuration();
                  if (
                    Number.isFinite(ytDur) &&
                    ytDur > 0 &&
                    !isLikelyYtAdDuration(ytDur, currentTrackRef.current)
                  ) {
                    setDuration(ytDur);
                  }
                  onSetPlayingStateRef.current(true);
                  syncMediaSessionRef.current();
                  window.setTimeout(() => syncMediaSessionRef.current(), 350);
                  window.setTimeout(() => syncMediaSessionRef.current(), 1200);
                }
              } else if (event.data === PAUSED || event.data === CUED) {
                if (ytDeckModeRef.current[slotIdx] === 'precue') {
                  return;
                }

                const isAwaitingPlay =
                  ytAwaitingPlayRef.current[slotIdx] &&
                  Date.now() - ytAwaitingPlaySinceRef.current[slotIdx] < 8000;

                if (isAwaitingPlay && !userPausedRef.current && isPlayingRef.current) {
                  try {
                    event.target.playVideo();
                  } catch {
                    // ignore
                  }
                  return;
                }

                if (event.data === CUED) {
                  return;
                }

                if (isActiveSlot) {
                  ytBufferingSinceRef.current = null;
                  setYtBuffering(false);
                }
                const isBackgroundOrFocusLoss =
                  document.hidden ||
                  !document.hasFocus() ||
                  Date.now() - lastVisibilityChangeMsRef.current < 8000;
                if (
                  isBackgroundOrFocusLoss &&
                  !userPausedRef.current &&
                  isPlayingRef.current &&
                  !isStandbyWarmup
                ) {
                  keepAliveAudioRef.current?.play().catch(() => {});
                  try {
                    event.target.playVideo();
                  } catch {
                    // ignore
                  }
                  window.setTimeout(() => {
                    if (!userPausedRef.current && isPlayingRef.current) {
                      try {
                        event.target.playVideo();
                      } catch {
                        // ignore
                      }
                    }
                  }, 200);
                  window.setTimeout(() => {
                    if (!userPausedRef.current && isPlayingRef.current) {
                      try {
                        event.target.playVideo();
                      } catch {
                        // ignore
                      }
                    }
                  }, 600);
                  return;
                }

                if (
                  !transitionRef.current &&
                  !isIncomingDuringFade &&
                  !isStandbyWarmup &&
                  isActiveSlot
                ) {
                  userPausedRef.current = true;
                  onSetPlayingStateRef.current(false);
                }
              } else if (event.data === ENDED) {
                if (isActiveSlot) {
                  ytBufferingSinceRef.current = null;
                  setYtBuffering(false);
                }
                ytAwaitingPlayRef.current[slotIdx] = false;
                if (isOutgoingDuringFade) {
                  finishTransition();
                } else if (!transitionRef.current && isActiveSlot) {
                  if (repeatModeRef.current === 'one') {
                    const desired = ytDesiredTrackRef.current[slotIdx];
                    const restartAt = desired
                      ? getStartSecForTrack(desired, desired.durationSec || 218)
                      : 0;
                    ytExpectedStartSecRef.current[slotIdx] = restartAt;
                    ytOffsetVerifiedRef.current[slotIdx] = false;
                    ytOffsetSeekTriedAtRef.current[slotIdx] = 0;
                    event.target.seekTo(restartAt, true);
                    event.target.playVideo();
                  } else if (!triggerBajaoCrossfade('youtube', true)) {
                    onPlaybackEndedRef.current();
                  }
                }
              }
            },
            onError: () => {
              if (ytDeckModeRef.current[slotIdx] === 'fadeout') {
                hardSilenceYtSlot(slotIdx);
                return;
              }
              const isStandbySlot =
                ytDeckModeRef.current[slotIdx] === 'precue' ||
                ytDeckModeRef.current[slotIdx] === 'preroll' ||
                slotIdx !== activeYtDeckIdxRef.current;
              if (!isStandbySlot) {
                ytBufferingSinceRef.current = null;
                setYtBuffering(false);
              }
              ytAwaitingPlayRef.current[slotIdx] = false;
              if (tryYtFallbackEmbed(slotIdx, isStandbySlot)) {
                return;
              }

              if (isStandbySlot) {
                if (transitionRef.current) {
                  cancelTransition(true);
                } else {
                  clearYtStandbySlot(slotIdx);
                }
                return;
              }
              consecutiveYtErrorsRef.current += 1;
              if (consecutiveYtErrorsRef.current <= 3) {
                setAudioError('YouTube mirror unavailable; skipping to next track...');
                onPlaybackEndedRef.current();
              } else {
                setAudioError(
                  'YouTube embed could not start. Please try another track.'
                );
                onSetPlayingStateRef.current(false);
              }
            },
          },
        });

        const iframeEl = currentHost.querySelector('iframe');
        if (iframeEl) {
          iframeEl.setAttribute(
            'allow',
            'autoplay; encrypted-media; picture-in-picture; fullscreen'
          );
        }
        ytPlayersRef.current[slotIdx] = player;
      });
    },
    [
      cancelTransition,
      finishTransition,
      getStartSecForTrack,
      setYtDeckVolume,
      triggerBajaoCrossfade,
      tryYtFallbackEmbed,
    ]
  );

  // Destroy persistent YT players only on unmount
  useEffect(() => {
    return () => {
      ([0, 1] as const).forEach((slotIdx) => {
        try {
          ytPlayersRef.current[slotIdx]?.destroy();
        } catch {
          // ignore
        }
        ytPlayersRef.current[slotIdx] = null;
        ytReadyRef.current[slotIdx] = false;
      });
    };
  }, []);

  useEffect(() => {
    ensureYtSlotSynced(0, ytSlotTracks[0]);
  }, [ytSlotTracks[0]?.id, ytSlotTracks[0]?.embedId, ensureYtSlotSynced]);

  useEffect(() => {
    ensureYtSlotSynced(1, ytSlotTracks[1]);
  }, [ytSlotTracks[1]?.id, ytSlotTracks[1]?.embedId, ensureYtSlotSynced]);

  // Unlock idle YouTube deck silently on active playback gesture
  useEffect(() => {
    if (!isPlaying || !isCurrentYouTube) return;
    const standbySlot: 0 | 1 = activeYtDeckIdxRef.current === 0 ? 1 : 0;
    const standbyPlayer = ytPlayersRef.current[standbySlot];
    if (
      standbyPlayer &&
      ytReadyRef.current[standbySlot] &&
      !ytSlotTracks[standbySlot]
    ) {
      try {
        standbyPlayer.mute();
        standbyPlayer.playVideo();
        window.setTimeout(() => {
          if (!ytDesiredTrackRef.current[standbySlot]) {
            try {
              standbyPlayer.pauseVideo();
            } catch {
              // ignore
            }
          }
        }, 60);
      } catch {
        // ignore
      }
    }
  }, [isPlaying, isCurrentYouTube, currentTrack?.id, ytSlotTracks]);

  // Sync Play/Pause across active and actively pre-rolling/crossfading YouTube decks (never auto-play precue-only or fadeout deck)
  useEffect(() => {
    ([0, 1] as const).forEach((slotIdx) => {
      if (!ytSlotTracks[slotIdx]) return;
      const slotMode = ytDeckModeRef.current[slotIdx];
      if (slotMode === 'precue' || slotMode === 'fadeout') return;
      const player = ytPlayersRef.current[slotIdx];
      if (!player || !ytReadyRef.current[slotIdx]) return;
      try {
        if (isPlaying) {
          ytAwaitingPlayRef.current[slotIdx] = true;
          ytAwaitingPlaySinceRef.current[slotIdx] = Date.now();
          player.playVideo();
        } else {
          ytAwaitingPlayRef.current[slotIdx] = false;
          player.pauseVideo();
        }
      } catch {
        // ignore
      }
    });
  }, [isPlaying, ytSlotTracks]);

  // Preload next direct-audio track and pre-cue next YouTube track onto standby deck
  useEffect(() => {
    if (!currentTrack || !isPlaying) return;
    const timer = window.setTimeout(() => {
      preloadIdleDeckForTrack(currentTrack);
      precueStandbyYtForTrack(currentTrack);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [
    currentTrack?.id,
    isPlaying,
    queue,
    shuffle,
    repeatMode,
    hookMode,
    preloadIdleDeckForTrack,
    precueStandbyYtForTrack,
  ]);

  // Maintain top-level Audio Focus loop
  useEffect(() => {
    const ka = keepAliveAudioRef.current;
    if (!ka) return;
    if (!ka.src) {
      ka.src = getSilentKeepAliveWavUrl();
    }
    ka.volume = 0.3;

    if (isPlaying) {
      ka.play().catch(() => {});
    } else {
      ka.pause();
    }
  }, [isPlaying, currentTrack?.id, isCurrentYouTube, ytStageVisible]);

  // High-resolution unthrottled playback monitor for HTML5 audio
  useEffect(() => {
    if (!isPlaying || !currentTrack || isCurrentYouTube) return;
    return startBackgroundTicker(() => {
      const activeDeck = getDeck(activeDeckIdxRef.current);
      if (!activeDeck) return;
      if (
        activeDeck.paused &&
        activeDeck.src &&
        !userPausedRef.current &&
        isPlayingRef.current
      ) {
        activeDeck.play().catch(() => {});
      }
      const cur = activeDeck.currentTime;
      const dur =
        Number.isFinite(activeDeck.duration) && activeDeck.duration > 0
          ? activeDeck.duration
          : currentTrack.durationSec || 0;
      if (Number.isFinite(cur)) setCurrentTime(cur);
      if (dur > 0) {
        setDuration(dur);
        maybeStartCrossfade(cur, dur, 'audio');
        const now = Date.now();
        if (now - lastMsPosSyncRef.current >= 900) {
          lastMsPosSyncRef.current = now;
          updateMediaSessionPosition(cur, dur);
        }
      }
    }, 80);
  }, [isPlaying, currentTrack?.id, isCurrentYouTube, getDeck, maybeStartCrossfade]);

  // High-resolution unthrottled playback monitor for YouTube
  useEffect(() => {
    if (!isCurrentYouTube || !isPlaying) {
      ytBufferingSinceRef.current = null;
      setYtBuffering(false);
      return;
    }
    return startBackgroundTicker(() => {
      const ka = keepAliveAudioRef.current;
      if (ka && ka.paused && !userPausedRef.current && isPlayingRef.current) {
        ka.play().catch(() => {});
      }

      const activeSlot = activeYtDeckIdxRef.current;
      const player = ytPlayersRef.current[activeSlot];
      if (!player || !ytReadyRef.current[activeSlot]) return;
      try {
        const ytState = player.getPlayerState?.();
        if (
          ytAwaitingPlayRef.current[activeSlot] &&
          Date.now() - ytAwaitingPlaySinceRef.current[activeSlot] < 8000 &&
          !userPausedRef.current &&
          isPlayingRef.current &&
          (ytState === 2 || ytState === 5)
        ) {
          player.playVideo();
        } else if (
          !userPausedRef.current &&
          isPlayingRef.current &&
          (document.hidden || !document.hasFocus()) &&
          Date.now() - lastVisibilityChangeMsRef.current < 5000 &&
          ytState === 2
        ) {
          player.playVideo();
        }

        const lite = isLiteConnection();
        const blockedLimitMs = lite ? 6000 : 3500;
        const hardBufferLimitMs = lite ? 18000 : YT_BUFFER_WATCHDOG_MS;

        if (
          (ytState === -1 || ytState === 3 || ytState === 5) &&
          !transitionRef.current &&
          !userPausedRef.current
        ) {
          setYtBuffering(true);
          if (ytBufferingSinceRef.current === null) {
            ytBufferingSinceRef.current = Date.now();
            ytBlockedRetryDoneRef.current[activeSlot] = false;
          } else {
            const elapsedMs = Date.now() - ytBufferingSinceRef.current;
            if ((ytState === -1 || ytState === 5) && elapsedMs >= 1800 && !ytBlockedRetryDoneRef.current[activeSlot]) {
              ytBlockedRetryDoneRef.current[activeSlot] = true;
              try {
                player.playVideo();
              } catch {
                // ignore
              }
            }
            const limitMs = ytState === 3 ? hardBufferLimitMs : blockedLimitMs;
            if (elapsedMs > limitMs) {
              ytBufferingSinceRef.current = null;
              setYtBuffering(false);
              if (tryYtFallbackEmbed(activeSlot, false)) {
                return;
              }
              setAudioError('YouTube stream stalled; skipping to next track...');
              onPlaybackEndedRef.current();
              return;
            }
          }
        } else if (ytState === 1) {
          ytBufferingSinceRef.current = null;
          ytBlockedRetryDoneRef.current[activeSlot] = false;
          setYtBuffering(false);
        }

        const cur = player.getCurrentTime();
        const dur = player.getDuration();
        const activeTrack = currentTrackRef.current;
        const nowMs = Date.now();
        const expectedStart = ytExpectedStartSecRef.current[activeSlot];
        const durLooksLikeAd = isLikelyYtAdDuration(dur, activeTrack);

        // Detect YouTube pre-roll ads by startSeconds mismatch (YouTube plays from 0..10s and blocks seekTo)
        let offsetBlockedAsAd = false;
        if (
          activeTrack &&
          ytState === 1 &&
          !transitionRef.current &&
          expectedStart >= 12 &&
          Number.isFinite(cur)
        ) {
          if (!ytOffsetVerifiedRef.current[activeSlot]) {
            if (cur >= expectedStart - 3) {
              ytOffsetVerifiedRef.current[activeSlot] = true;
              ytOffsetSeekTriedAtRef.current[activeSlot] = 0;
            } else if (cur < expectedStart - 4) {
              if (!ytOffsetSeekTriedAtRef.current[activeSlot]) {
                ytOffsetSeekTriedAtRef.current[activeSlot] = nowMs;
                try {
                  player.seekTo(expectedStart, true);
                } catch {
                  // ignore
                }
              } else if (nowMs - ytOffsetSeekTriedAtRef.current[activeSlot] > 750) {
                offsetBlockedAsAd = true;
              }
            }
          }
        }

        const isAdPlaying =
          ytState === 1 ? durLooksLikeAd || offsetBlockedAsAd : durLooksLikeAd;

        if (isAdPlaying) {
          // Bajao-style YouTube ad avoidance: hide behind artwork, mute immediately, try fallback / clean reload, or crossfade past unskippable ad
          if (!ytAdActiveRef.current[activeSlot]) {
            ytAdActiveRef.current[activeSlot] = true;
            ytAdStartedAtRef.current[activeSlot] = nowMs;
            setYtAdActiveState(true);
          }
          ytBufferingSinceRef.current = null;
          setYtBuffering(false);
          try {
            player.mute();
            player.setVolume(0);
          } catch {
            // ignore
          }
          if (!ytAdRetriedRef.current[activeSlot]) {
            ytAdRetriedRef.current[activeSlot] = true;
            if (tryYtFallbackEmbed(activeSlot, false)) {
              return;
            }
          }
          if (
            !ytAdReloadedRef.current[activeSlot] &&
            nowMs - ytAdStartedAtRef.current[activeSlot] >= 900 &&
            activeTrack?.embedId &&
            player.loadVideoById
          ) {
            ytAdReloadedRef.current[activeSlot] = true;
            const restartAt = getStartSecForTrack(
              activeTrack,
              activeTrack.durationSec || 218
            );
            ytExpectedStartSecRef.current[activeSlot] = restartAt;
            ytOffsetVerifiedRef.current[activeSlot] = false;
            ytOffsetSeekTriedAtRef.current[activeSlot] = 0;
            try {
              player.loadVideoById({
                videoId: activeTrack.embedId,
                startSeconds: restartAt,
              });
              player.playVideo();
            } catch {
              // ignore
            }
            return;
          }
          if (
            nowMs - ytAdStartedAtRef.current[activeSlot] >= YT_UNSKIPPABLE_AD_BYPASS_MS &&
            consecutiveAdSkipsRef.current < MAX_CONSECUTIVE_AD_SKIPS
          ) {
            const next = activeTrack ? getNextTrackRef.current(activeTrack.id) : null;
            if (next && next.id !== activeTrack?.id) {
              consecutiveAdSkipsRef.current += 1;
              ytAdActiveRef.current[activeSlot] = false;
              ytAdStartedAtRef.current[activeSlot] = 0;
              setYtAdActiveState(false);
              if (!triggerBajaoCrossfade('youtube', true)) {
                onPlaybackEndedRef.current();
              }
              return;
            }
          }
          if (activeTrack?.durationSec) {
            setDuration(activeTrack.durationSec);
          }
        } else {
          if (ytState === 1) {
            consecutiveAdSkipsRef.current = 0;
          }
          if (ytAdActiveRef.current[activeSlot]) {
            ytAdActiveRef.current[activeSlot] = false;
            ytAdStartedAtRef.current[activeSlot] = 0;
            setYtAdActiveState(false);
            setYtDeckVolume(activeSlot, effectiveGainRef.current);
            // If ad reset playhead to 0, snap right back to curated entry_sec / hook drop
            if (activeTrack) {
              const resolvedDur =
                Number.isFinite(dur) && dur > 0 ? dur : activeTrack.durationSec || 218;
              const entryStart = getStartSecForTrack(activeTrack, resolvedDur);
              ytExpectedStartSecRef.current[activeSlot] = entryStart;
              if (entryStart > 0 && Number.isFinite(cur) && cur < entryStart - 1.5) {
                player.seekTo(entryStart, true);
                setCurrentTime(entryStart);
                return;
              }
            }
          }

          if (Number.isFinite(cur)) setCurrentTime(cur);
          if (Number.isFinite(dur) && dur > 0) {
            setDuration(dur);
            maybeStartCrossfade(cur, dur, 'youtube');
            const now = Date.now();
            if (now - lastMsPosSyncRef.current >= 900) {
              lastMsPosSyncRef.current = now;
              updateMediaSessionPosition(cur, dur);
            }
          }
        }

        // Also keep standby preroll/crossfade deck muted & ad-safe
        const standbySlot: 0 | 1 = activeSlot === 0 ? 1 : 0;
        const standbyMode = ytDeckModeRef.current[standbySlot];
        if (standbyMode === 'preroll' || standbyMode === 'crossfade') {
          const standbyPlayer = ytPlayersRef.current[standbySlot];
          const standbyTrack = ytDesiredTrackRef.current[standbySlot];
          if (standbyPlayer && ytReadyRef.current[standbySlot] && standbyTrack) {
            try {
              const sDur = standbyPlayer.getDuration();
              const standbyHasAd = isLikelyYtAdDuration(sDur, standbyTrack);
              if (standbyHasAd) {
                ytAdActiveRef.current[standbySlot] = true;
                standbyPlayer.mute();
                standbyPlayer.setVolume(0);
                if (!ytAdRetriedRef.current[standbySlot]) {
                  ytAdRetriedRef.current[standbySlot] = true;
                  tryYtFallbackEmbed(standbySlot, standbyMode === 'preroll');
                }
              } else if (ytAdActiveRef.current[standbySlot]) {
                ytAdActiveRef.current[standbySlot] = false;
                const sCur = standbyPlayer.getCurrentTime();
                const resolvedSDur =
                  Number.isFinite(sDur) && sDur > 0 ? sDur : standbyTrack.durationSec || 218;
                const sEntryStart = getStartSecForTrack(standbyTrack, resolvedSDur);
                ytExpectedStartSecRef.current[standbySlot] = sEntryStart;
                if (sEntryStart > 0 && Number.isFinite(sCur) && sCur < sEntryStart - 1.5) {
                  standbyPlayer.seekTo(sEntryStart, true);
                }
              }
            } catch {
              // ignore
            }
          }
        }

        const nowAssert = Date.now();
        if (nowAssert - lastYtMsAssertRef.current >= 4000) {
          lastYtMsAssertRef.current = nowAssert;
          syncMediaSessionRef.current();
        }
      } catch {
        // ignore transient calls
      }
    }, 120);
  }, [
    getStartSecForTrack,
    isCurrentYouTube,
    isPlaying,
    maybeStartCrossfade,
    setYtDeckVolume,
    triggerBajaoCrossfade,
    tryYtFallbackEmbed,
  ]);

  // 60–120fps requestAnimationFrame playhead & waveform smoothness while visible
  useEffect(() => {
    if (!isPlaying || !currentTrack) return;
    let rafId = 0;
    let lastRenderedTime = -1;
    let lastYtAnchorSec = -1;
    let lastYtAnchorPerf = performance.now();

    const step = (now: number) => {
      if (document.visibilityState === 'visible' && !transitionRef.current) {
        if (!isCurrentYouTube) {
          const activeDeck = getDeck(activeDeckIdxRef.current);
          if (activeDeck && !activeDeck.paused) {
            const cur = activeDeck.currentTime;
            if (Number.isFinite(cur) && Math.abs(cur - lastRenderedTime) >= 0.015) {
              lastRenderedTime = cur;
              setCurrentTime(cur);
            }
          }
        } else {
          const activeSlot = activeYtDeckIdxRef.current;
          const player = ytPlayersRef.current[activeSlot];
          if (player && ytReadyRef.current[activeSlot]) {
            try {
              const ytState = player.getPlayerState?.();
              const dur = player.getDuration?.() || 0;
              const isAd =
                ytAdActiveRef.current[activeSlot] ||
                isLikelyYtAdDuration(dur, currentTrackRef.current);
              if (ytState === 1 && !isAd) {
                const rawCur = player.getCurrentTime();
                if (Number.isFinite(rawCur)) {
                  if (
                    lastYtAnchorSec < 0 ||
                    Math.abs(rawCur - lastYtAnchorSec) > 0.04
                  ) {
                    lastYtAnchorSec = rawCur;
                    lastYtAnchorPerf = now;
                  }
                  const interpolated = Math.min(
                    dur > 0 ? dur : rawCur + 0.5,
                    lastYtAnchorSec + Math.min(0.45, Math.max(0, (now - lastYtAnchorPerf) / 1000))
                  );
                  if (Math.abs(interpolated - lastRenderedTime) >= 0.015) {
                    lastRenderedTime = interpolated;
                    setCurrentTime(interpolated);
                  }
                }
              } else {
                lastYtAnchorSec = -1;
              }
            } catch {
              // ignore transient API read
            }
          }
        }
      }
      rafId = requestAnimationFrame(step);
    };

    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, currentTrack, isCurrentYouTube, getDeck]);

  // Background visibility & focus guard
  useEffect(() => {
    const resumeActivePlayback = () => {
      if (!isPlayingRef.current || userPausedRef.current) return;

      keepAliveAudioRef.current?.play().catch(() => {});

      if (currentTrackRef.current?.playbackRights === 'embed-only') {
        ([0, 1] as const).forEach((slotIdx) => {
          const slotMode = ytDeckModeRef.current[slotIdx];
          if (slotMode !== 'active' && slotMode !== 'preroll' && slotMode !== 'crossfade') {
            return;
          }
          const player = ytPlayersRef.current[slotIdx];
          if (
            player &&
            ytReadyRef.current[slotIdx] &&
            ytDeckTrackIdRef.current[slotIdx]
          ) {
            try {
              player.playVideo();
            } catch {
              // ignore
            }
          }
        });
      } else {
        const activeDeck = getDeck(activeDeckIdxRef.current);
        if (activeDeck && activeDeck.paused && activeDeck.src) {
          activeDeck.play().catch(() => {});
        }
      }
      syncMediaSessionRef.current();
    };

    const handleBackgroundSignal = () => {
      lastVisibilityChangeMsRef.current = Date.now();
      if (!isPlayingRef.current || userPausedRef.current) return;

      if (document.hidden) {
        resumeActivePlayback();
        window.setTimeout(resumeActivePlayback, 150);
        window.setTimeout(resumeActivePlayback, 500);
        window.setTimeout(resumeActivePlayback, 1200);
      } else {
        const s = transitionRef.current;
        if (s && s.elapsedMs >= s.durationMs) {
          finishTransition();
        } else {
          resumeActivePlayback();
        }
      }
    };

    document.addEventListener('visibilitychange', handleBackgroundSignal);
    window.addEventListener('blur', handleBackgroundSignal);
    window.addEventListener('focus', handleBackgroundSignal);
    window.addEventListener('pagehide', handleBackgroundSignal);
    return () => {
      document.removeEventListener('visibilitychange', handleBackgroundSignal);
      window.removeEventListener('blur', handleBackgroundSignal);
      window.removeEventListener('focus', handleBackgroundSignal);
      window.removeEventListener('pagehide', handleBackgroundSignal);
    };
  }, [finishTransition, getDeck]);

  // Sync volume, mute & voice ducking to active deck
  useEffect(() => {
    if (manualFadeStopRef.current !== null) {
      return;
    }
    if (transitionRef.current) {
      const s = transitionRef.current;
      const p = Math.min(1, s.elapsedMs / s.durationMs);
      applyFadeVolumes(s, p);
      return;
    }

    const activeDeck = getDeck(activeDeckIdxRef.current);
    if (activeDeck) {
      activeDeck.volume = effectiveMasterGain;
    }

    setYtDeckVolume(activeYtDeckIdxRef.current, effectiveMasterGain);
    const standbySlot: 0 | 1 = activeYtDeckIdxRef.current === 0 ? 1 : 0;
    if (
      ytDeckModeRef.current[standbySlot] === 'preroll' &&
      ytPlayersRef.current[standbySlot] &&
      ytReadyRef.current[standbySlot]
    ) {
      try {
        if (muted || volume === 0) {
          ytPlayersRef.current[standbySlot]!.mute();
        } else {
          ytPlayersRef.current[standbySlot]!.unMute();
          ytPlayersRef.current[standbySlot]!.setVolume(0);
        }
      } catch {
        // ignore
      }
    }
  }, [volume, muted, audioDucking, effectiveMasterGain, ytStageVisible, applyFadeVolumes, getDeck, setYtDeckVolume]);

  // Cleanup crossfade ticker, manual fade ticker & exit timer on unmount
  useEffect(() => {
    return () => {
      stopManualFade();
      if (transitionRef.current?.stopTicker) {
        transitionRef.current.stopTicker();
      }
      if (exitTimerRef.current !== null) {
        window.clearTimeout(exitTimerRef.current);
      }
      if (ytWaitCancelRef.current) {
        ytWaitCancelRef.current();
      }
    };
  }, [stopManualFade]);

  const handleSeek = useCallback(
    (nextSec: number) => {
      const track = currentTrackRef.current;
      const dur = durationRef.current || track?.durationSec || 218;
      const clampedSec = Math.max(0, Math.min(dur, nextSec));
      const exitTarget = track
        ? getAutoExitTargetSec(track, dur)
        : Math.max(4, dur - 8);
      const remainingAfterSeek = exitTarget - clampedSec;
      const prerollLeadSec = getPrerollLeadSec();

      if (remainingAfterSeek > prerollLeadSec + 0.5) {
        cancelTransition(true);
        abortStandbyPreroll();
        transitionLockFromIdRef.current = '';
        lastCrossfadeAttemptMsRef.current = 0;
      }

      if (track?.playbackRights === 'embed-only' && track.embedId) {
        const activeSlot = activeYtDeckIdxRef.current;
        const player = ytPlayersRef.current[activeSlot];
        ytExpectedStartSecRef.current[activeSlot] = clampedSec;
        ytOffsetVerifiedRef.current[activeSlot] = true;
        ytOffsetSeekTriedAtRef.current[activeSlot] = 0;
        if (player && ytReadyRef.current[activeSlot]) {
          player.seekTo(clampedSec, true);
          setCurrentTime(clampedSec);
          updateMediaSessionPosition(clampedSec, dur);
        }
        return;
      }

      const activeDeck = getDeck(activeDeckIdxRef.current);
      if (!activeDeck) return;
      activeDeck.currentTime = clampedSec;
      setCurrentTime(clampedSec);
      updateMediaSessionPosition(clampedSec, dur);
    },
    [abortStandbyPreroll, cancelTransition, getAutoExitTargetSec, getDeck]
  );

  const handleSeekRef = useRef(handleSeek);
  handleSeekRef.current = handleSeek;

  const handleManualNext = useCallback(() => {
    userPausedRef.current = false;
    autoCompletedTrackIdRef.current = '';
    cancelTransition(true);
    abortStandbyPreroll();
    transitionLockFromIdRef.current = '';
    lastCrossfadeAttemptMsRef.current = 0;
    onNextRef.current();
  }, [abortStandbyPreroll, cancelTransition]);

  const handleManualPrev = useCallback(() => {
    userPausedRef.current = false;
    autoCompletedTrackIdRef.current = '';
    cancelTransition(true);
    abortStandbyPreroll();
    transitionLockFromIdRef.current = '';
    lastCrossfadeAttemptMsRef.current = 0;
    onPrevRef.current();
  }, [abortStandbyPreroll, cancelTransition]);

  const handleManualNextRef = useRef(handleManualNext);
  handleManualNextRef.current = handleManualNext;
  const handleManualPrevRef = useRef(handleManualPrev);
  handleManualPrevRef.current = handleManualPrev;

  const handleTogglePlayPause = useCallback(() => {
    const nextPlaying = !isPlayingRef.current;
    if (nextPlaying) {
      userPausedRef.current = false;
      keepAliveAudioRef.current?.play().catch(() => {});
      if (currentTrackRef.current?.playbackRights === 'embed-only') {
        const player = ytPlayersRef.current[activeYtDeckIdxRef.current];
        if (player && ytReadyRef.current[activeYtDeckIdxRef.current]) {
          try {
            player.playVideo();
          } catch {
            // ignore
          }
        }
      } else {
        const activeDeck = getDeck(activeDeckIdxRef.current);
        if (activeDeck && activeDeck.src) {
          activeDeck.play().catch(() => {});
        }
      }
    } else {
      userPausedRef.current = true;
      ytAwaitingPlayRef.current = [false, false];
    }
    onPlayPause();
  }, [getDeck, onPlayPause]);

  const prevHookModeRef = useRef(hookMode);
  useEffect(() => {
    if (hookMode !== prevHookModeRef.current) {
      cancelTransition(true);
      abortStandbyPreroll();
      transitionLockFromIdRef.current = '';
      lastCrossfadeAttemptMsRef.current = 0;

      const track = currentTrackRef.current;
      if (track) {
        if (hookMode) {
          const dur = durationRef.current || track.durationSec || 218;
          const hook = getHookForTrack(track, dur);
          if (
            currentTimeRef.current < hook.startSec - 1 ||
            currentTimeRef.current >= hook.endSec - 2
          ) {
            handleSeekRef.current(hook.startSec);
          }
        }
        if (isPlayingRef.current) {
          precueStandbyYtForTrack(track);
        }
      }
    }
    prevHookModeRef.current = hookMode;
  }, [
    hookMode,
    abortStandbyPreroll,
    cancelTransition,
    getHookForTrack,
    precueStandbyYtForTrack,
  ]);

  const handleToggleHookMode = useCallback(() => {
    const next = !hookMode;
    setInternalHookMode(next);
    onHookModeChange?.(next);
  }, [hookMode, onHookModeChange]);

  const handleUpdateHook = useCallback(
    (startSec: number, endSec: number) => {
      const track = currentTrackRef.current;
      if (!track) return;
      abortStandbyPreroll();
      setCustomHooks((prev) => {
        const next = { ...prev, [track.id]: { startSec, endSec } };
        saveCustomHooksMap(next);
        return next;
      });
    },
    [abortStandbyPreroll]
  );

  const handleResetHook = useCallback(() => {
    const track = currentTrackRef.current;
    if (!track) return;
    setCustomHooks((prev) => {
      const next = { ...prev };
      delete next[track.id];
      saveCustomHooksMap(next);
      return next;
    });
  }, []);

  const syncMediaSession = useCallback(() => {
    registerMediaSession(currentTrackRef.current, isPlayingRef.current, {
      onPlay: () => {
        userPausedRef.current = false;
        keepAliveAudioRef.current?.play().catch(() => {});
        if (currentTrackRef.current?.playbackRights === 'embed-only') {
          const player = ytPlayersRef.current[activeYtDeckIdxRef.current];
          if (player && ytReadyRef.current[activeYtDeckIdxRef.current]) {
            try {
              player.playVideo();
            } catch {
              // ignore
            }
          }
        } else {
          const activeDeck = getDeck(activeDeckIdxRef.current);
          if (activeDeck && activeDeck.src) {
            activeDeck.play().catch(() => {});
          }
        }
        onSetPlayingStateRef.current(true);
      },
      onPause: () => {
        userPausedRef.current = true;
        ytAwaitingPlayRef.current = [false, false];
        keepAliveAudioRef.current?.pause();
        if (currentTrackRef.current?.playbackRights === 'embed-only') {
          ([0, 1] as const).forEach((slotIdx) => {
            const player = ytPlayersRef.current[slotIdx];
            if (player && ytReadyRef.current[slotIdx]) {
              try {
                player.pauseVideo();
              } catch {
                // ignore
              }
            }
          });
        } else {
          getDeck(0)?.pause();
          getDeck(1)?.pause();
        }
        onSetPlayingStateRef.current(false);
      },
      onNext: () => {
        handleManualNextRef.current();
      },
      onPrev: () => {
        handleManualPrevRef.current();
      },
      onSeekTo: (timeSec) => handleSeekRef.current(timeSec),
      onSeekBy: (deltaSec) =>
        handleSeekRef.current(currentTimeRef.current + deltaSec),
    });
  }, [getDeck]);

  const syncMediaSessionRef = useRef(syncMediaSession);
  syncMediaSessionRef.current = syncMediaSession;

  useEffect(() => {
    syncMediaSession();
  }, [currentTrack, isPlaying, syncMediaSession]);

  const handleDeckTimeUpdate = (deckIdx: 0 | 1, deckEl: HTMLAudioElement) => {
    if (deckIdx !== activeDeckIdxRef.current) return;
    const cur = deckEl.currentTime;
    const dur =
      Number.isFinite(deckEl.duration) && deckEl.duration > 0
        ? deckEl.duration
        : currentTrackRef.current?.durationSec || 0;
    setCurrentTime(cur);
    if (dur > 0) {
      setDuration(dur);
      maybeStartCrossfade(cur, dur, 'audio');
    }
  };

  const handleDeckLoadedMetadata = (deckIdx: 0 | 1, deckEl: HTMLAudioElement) => {
    if (deckIdx !== activeDeckIdxRef.current) return;
    const loadedDur =
      Number.isFinite(deckEl.duration) && deckEl.duration > 0
        ? deckEl.duration
        : currentTrackRef.current?.durationSec || 0;
    if (loadedDur > 0) {
      setDuration(loadedDur);
    }
    const track = currentTrackRef.current;
    if (track && pendingAudioHookSeekTrackIdRef.current === track.id) {
      pendingAudioHookSeekTrackIdRef.current = '';
      const entryStart = getStartSecForTrack(track, loadedDur || 218);
      try {
        deckEl.currentTime = entryStart;
        setCurrentTime(entryStart);
      } catch {
        // ignore seek before ready
      }
    }
  };

  const handleDeckEnded = (deckIdx: 0 | 1) => {
    if (!deckTrackIdRef.current[deckIdx]) return;
    const session = transitionRef.current;
    if (
      session &&
      session.outgoingKind === 'audio' &&
      session.outgoingAudioDeckIdx === deckIdx
    ) {
      finishTransition();
      return;
    }

    if (deckIdx !== activeDeckIdxRef.current) return;

    const activeDeck = getDeck(deckIdx);
    if (repeatModeRef.current === 'one' && activeDeck) {
      const track = currentTrackRef.current;
      const restartSec = track
        ? getStartSecForTrack(track, activeDeck.duration || track.durationSec || 218)
        : 0;
      activeDeck.currentTime = restartSec;
      activeDeck.play().catch(() => {});
      return;
    }

    if (!triggerBajaoCrossfade('audio', true)) {
      onPlaybackEndedRef.current();
    }
  };

  const handleDeckError = (deckIdx: 0 | 1) => {
    audioSwitchingDeckRef.current[deckIdx] = false;
    if (!deckTrackIdRef.current[deckIdx]) return;
    if (deckIdx !== activeDeckIdxRef.current) return;
    if (currentTrackRef.current?.streamUrl && !isCurrentYouTube) {
      setAudioError('Stream unavailable; skipping to next track...');
      onPlaybackEndedRef.current();
    }
  };

  const handleDeckPause = (deckIdx: 0 | 1, deckEl: HTMLAudioElement) => {
    if (audioSwitchingDeckRef.current[deckIdx]) return;
    if (deckIdx !== activeDeckIdxRef.current) return;
    if (!deckTrackIdRef.current[deckIdx] || deckEl.ended) return;

    const isBackgroundOrFocusLoss =
      document.hidden ||
      !document.hasFocus() ||
      Date.now() - lastVisibilityChangeMsRef.current < 5000;

    if (isBackgroundOrFocusLoss && !userPausedRef.current && isPlayingRef.current) {
      deckEl.play().catch(() => {});
      return;
    }

    if (!transitionRef.current && isPlayingRef.current && !userPausedRef.current) {
      userPausedRef.current = true;
      onSetPlayingStateRef.current(false);
    }
  };

  const centeredQueueWindow = useMemo(() => {
    const curIdx = currentTrack
      ? queue.findIndex((t) => t.id === currentTrack.id)
      : 0;
    const start = Math.max(0, curIdx - 10);
    return queue.slice(start, start + 100);
  }, [queue, currentTrack?.id]);

  // Persistent YouTube Stage positioning mode:
  // 1. Inside Center Studio Console screen slot (when expanded)
  // 2. Compact floating stage (when minimized to bottom bar & not hidden; shifts cleanly alongside Queue/Recent drawer)
  // 3. Offscreen 1px hidden (only when player closed or stage minimized via ChevronDown/Tv toggle)
  const ytDockedInsideConsole = Boolean(
    ytStageVisible && studioConsoleOpen && stageRect
  );
  const ytFloatingCorner = Boolean(
    ytStageVisible && !studioConsoleOpen && !ytDockMinimized
  );

  return (
    <>
      {/* Dual Audio Decks for BPM-Matched Equal-Power Overlap & Gapless Crossfade */}
      <audio
        ref={deck0Ref}
        preload="auto"
        playsInline
        onTimeUpdate={(e) => handleDeckTimeUpdate(0, e.currentTarget)}
        onLoadedMetadata={(e) => handleDeckLoadedMetadata(0, e.currentTarget)}
        onPlaying={() => {
          audioSwitchingDeckRef.current[0] = false;
        }}
        onPause={(e) => handleDeckPause(0, e.currentTarget)}
        onEnded={() => handleDeckEnded(0)}
        onError={() => handleDeckError(0)}
      />
      <audio
        ref={deck1Ref}
        preload="auto"
        playsInline
        onTimeUpdate={(e) => handleDeckTimeUpdate(1, e.currentTarget)}
        onLoadedMetadata={(e) => handleDeckLoadedMetadata(1, e.currentTarget)}
        onPlaying={() => {
          audioSwitchingDeckRef.current[1] = false;
        }}
        onPause={(e) => handleDeckPause(1, e.currentTarget)}
        onEnded={() => handleDeckEnded(1)}
        onError={() => handleDeckError(1)}
      />
      {/* Silent Top-Level Keep-Alive Audio for OS MediaSession & YouTube Background Persistence */}
      <audio ref={keepAliveAudioRef} loop playsInline preload="auto" aria-hidden="true" />

      {/* Persistent Bajao-Style 16:9 YouTube Stage Player (NEVER unmounts between Console & Docked views!) */}
      <aside
        aria-label="YouTube Stage Player"
        aria-hidden={!ytDockedInsideConsole && !ytFloatingCorner}
        style={
          ytDockedInsideConsole && stageRect
            ? {
                top: `${stageRect.top}px`,
                left: `${stageRect.left}px`,
                width: `${stageRect.width}px`,
                height: `${stageRect.height}px`,
              }
            : undefined
        }
        className={
          ytDockedInsideConsole
            ? 'fixed z-[60] rounded-xl overflow-hidden bg-[#07070B]'
            : ytFloatingCorner
              ? minimizedDrawerTab !== null
                ? 'fixed z-40 right-2 left-auto w-[212px] bottom-[calc(184px+min(26dvh,200px)+8px)] md:bottom-[184px] md:right-[384px] md:w-[340px] lg:bottom-[94px] lg:right-[410px] lg:w-[372px] ml-auto rounded-2xl bg-[#11111A]/95 backdrop-blur-2xl border border-violet-500/30 shadow-[0_24px_70px_-15px_rgba(15,10,40,0.92)] overflow-hidden transition-all duration-200'
                : 'fixed left-2 right-2 sm:left-auto sm:right-6 z-40 bottom-[184px] lg:bottom-[94px] sm:w-[372px] xl:w-[404px] ml-auto rounded-2xl bg-[#11111A]/95 backdrop-blur-2xl border border-violet-500/30 shadow-[0_24px_70px_-15px_rgba(15,10,40,0.92)] overflow-hidden transition-all duration-200'
              : 'pointer-events-none opacity-0 fixed -left-[9999px] top-0 w-[320px] h-[180px] overflow-hidden'
        }
      >
        {/* Mini Header shown only in floating corner mode (when Center Console is minimized) */}
        {ytFloatingCorner && displayedYtTrack && currentTrack ? (
          <div className="flex items-center justify-between gap-2 px-3.5 py-2 border-b border-white/[0.08] bg-gradient-to-r from-violet-950/35 to-blue-950/20">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[11px] font-medium">
                <span className="text-blue-300 truncate">
                  {crossfadeStatus
                    ? `Crossfading · ${crossfadeStatus.remainingSec}s`
                    : isPlaying
                      ? 'Now Playing'
                      : 'Paused'}
                </span>
                {nextTrackPreview ? (
                  <>
                    <span aria-hidden="true" className="text-slate-600">
                      ·
                    </span>
                    <span className="text-slate-400 truncate">
                      Next: {nextTrackPreview.title}
                    </span>
                  </>
                ) : null}
              </div>
              <p className="text-xs font-semibold text-white truncate mt-0.5">
                {displayedYtTrack.title}
              </p>
            </div>

            <button
              type="button"
              onClick={() => onSetStudioConsoleOpen(true)}
              aria-label="Open Studio Console"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-300 hover:text-white hover:bg-white/[0.08]"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={() => setYtDockMinimized(true)}
              aria-label="Hide video stage"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.08]"
            >
              <ChevronDown className="w-4 h-4" />
            </button>
          </div>
        ) : null}

        <div
          className={`gg-keep-dark group relative w-full bg-[#07070B] overflow-hidden ${
            ytDockedInsideConsole ? 'h-full' : 'aspect-video'
          }`}
        >
          {displayedYtTrack ? (
            <div className="absolute inset-0 z-0">
              <ArtworkImage
                src={displayedYtTrack.coverUrl}
                alt={displayedYtTrack.title}
                className="w-full h-full object-cover opacity-45 brightness-90 saturate-95 transition-opacity duration-200 group-hover:opacity-60"
              />
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#07070E]/80 via-[#07070E]/30 to-[#0B0C1D]/45"
              />
            </div>
          ) : null}

          <div
            ref={ytHost0Ref}
            className={`absolute inset-0 w-full h-full transition-opacity duration-500 ${
              (visualCrossfadeYtIdx ?? activeYtDeckIdx) === 0 &&
              !(isCurrentYouTube && isPlaying && (ytBuffering || ytAdActiveState) && !crossfadeStatus)
                ? `${ytDockedInsideConsole ? 'opacity-[0.88] group-hover:opacity-100' : 'opacity-100'} z-[2]`
                : 'opacity-0 z-[1] pointer-events-none'
            }`}
          />
          <div
            ref={ytHost1Ref}
            className={`absolute inset-0 w-full h-full transition-opacity duration-500 ${
              (visualCrossfadeYtIdx ?? activeYtDeckIdx) === 1 &&
              !(isCurrentYouTube && isPlaying && (ytBuffering || ytAdActiveState) && !crossfadeStatus)
                ? `${ytDockedInsideConsole ? 'opacity-[0.88] group-hover:opacity-100' : 'opacity-100'} z-[2]`
                : 'opacity-0 z-[1] pointer-events-none'
            }`}
          />

          {/* Subtle dark vignette gradient over YouTube stage in console for a softer luxury aesthetic */}
          {ytDockedInsideConsole ? (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 z-[4] bg-gradient-to-t from-[#080915]/60 via-[#080915]/15 to-[#080915]/30 transition-opacity duration-200 group-hover:opacity-45"
            />
          ) : null}

          {/* Transparent Click Shield (tap to Play/Pause) with Bottom-Right Skip-Ad Passthrough Cutout */}
          {ytStageVisible ? (
            <>
              <button
                type="button"
                onClick={handleTogglePlayPause}
                aria-label={isPlaying ? 'Pause video playback' : 'Play video playback'}
                className="absolute top-0 left-0 right-0 bottom-[58px] z-20 cursor-pointer bg-transparent focus-visible:outline-none"
              />
              <button
                type="button"
                onClick={handleTogglePlayPause}
                aria-label={isPlaying ? 'Pause video playback' : 'Play video playback'}
                className="absolute bottom-0 left-0 right-[138px] h-[58px] z-20 cursor-pointer bg-transparent focus-visible:outline-none"
              />
            </>
          ) : null}
        </div>
      </aside>

      {/* REDESIGNED MIDNIGHT VIOLET-CYAN STUDIO MUSIC PLAYER CONSOLE */}
      {currentTrack && studioConsoleOpen ? (
        <div
          ref={consoleScrollRef}
          role="dialog"
          aria-modal="true"
          aria-label="GullyGroove Studio Player"
          className="fixed inset-0 z-50 flex items-start justify-center bg-[#04040B]/90 backdrop-blur-2xl p-2 sm:p-4 overflow-y-auto scroll-smooth"
        >
          <div
            className={`w-full flex flex-col lg:flex-row items-stretch justify-center gap-3.5 my-auto transition-all duration-200 ${
              consoleDrawerTab !== null
                ? 'max-w-[920px]'
                : 'max-w-[430px] sm:max-w-[540px] lg:max-w-[580px]'
            }`}
          >
            {/* Main Midnight Glass Studio Player Card */}
            <section className="relative flex-1 min-w-0 rounded-3xl bg-gradient-to-b from-[#131129] via-[#0B0C1D] to-[#080915] border border-violet-400/25 shadow-[0_32px_100px_-20px_rgba(109,40,217,0.58)] overflow-hidden">
              {/* Ambient Violet-Cyan Luminous Glows */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -top-20 -left-16 h-56 w-56 rounded-full bg-violet-600/20 blur-3xl"
              />
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -bottom-20 -right-16 h-56 w-56 rounded-full bg-cyan-500/18 blur-3xl"
              />

              {/* Top Console Navigation Header */}
              <div className="relative z-10 flex items-center justify-between gap-2 px-3 sm:px-4 py-2.5 border-b border-white/[0.08] bg-white/[0.02]">
                <div className="flex items-center gap-2 min-w-0">
                  <BrandLogo size="sm" />
                  <span className="font-display text-base sm:text-[17px] font-bold tracking-tight text-white truncate">
                    Gully
                    <span className="bg-gradient-to-r from-violet-400 to-cyan-400 bg-clip-text text-transparent">
                      Groove
                    </span>
                  </span>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() =>
                      setConsoleDrawerTab((prev) =>
                        prev === 'queue' ? null : 'queue'
                      )
                    }
                    aria-label="Toggle playback queue"
                    title="Queue"
                    className={`flex h-9 w-9 items-center justify-center rounded-xl transition-colors ${
                      consoleDrawerTab === 'queue'
                        ? 'bg-gradient-to-r from-violet-600/40 to-blue-500/35 text-white border border-violet-400/40'
                        : 'text-slate-300 hover:text-white hover:bg-white/[0.07]'
                    }`}
                  >
                    <ListMusic className="w-4 h-4" />
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setConsoleDrawerTab((prev) =>
                        prev === 'recent' ? null : 'recent'
                      )
                    }
                    aria-label="Toggle recently played"
                    title="Recently played"
                    className={`flex h-9 w-9 items-center justify-center rounded-xl transition-colors ${
                      consoleDrawerTab === 'recent'
                        ? 'bg-gradient-to-r from-violet-600/40 to-blue-500/35 text-white border border-violet-400/40'
                        : 'text-slate-300 hover:text-white hover:bg-white/[0.07]'
                    }`}
                  >
                    <History className="w-4 h-4" />
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setYtDockMinimized(true);
                      onSetStudioConsoleOpen(false);
                    }}
                    aria-label="Minimize to bottom player"
                    title="Minimize to bottom player"
                    className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-300 hover:text-white hover:bg-white/[0.07] transition-colors shrink-0"
                  >
                    <ChevronDown className="w-5 h-5" />
                  </button>

                  {onClosePlayer ? (
                    <button
                      type="button"
                      onClick={() => {
                        userPausedRef.current = true;
                        ytAwaitingPlayRef.current = [false, false];
                        cancelTransition(true);
                        onClosePlayer();
                      }}
                      aria-label="Close music player"
                      title="Close player"
                      className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 hover:text-white hover:bg-white/[0.07] transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  ) : null}
                </div>
              </div>

              {/* Player Main Content Stack */}
              <div className="relative z-10 p-3 sm:p-4 space-y-3">
                {/* 1. Hero Media Artwork / YouTube Stage + Track Metadata Card */}
                <div
                  className={`flex gap-3 sm:gap-4 ${
                    isCurrentYouTube
                      ? 'flex-col sm:flex-row sm:items-center'
                      : 'flex-row items-center'
                  }`}
                >
                  {/* Glowing Stage Frame (16:9 for YouTube so Skip-Ad cutout has plenty of room, Square for Audio) */}
                  <div
                    ref={stageSlotRef}
                    className={`gg-keep-dark relative shrink-0 overflow-hidden rounded-2xl bg-[#07070B] border-2 border-violet-400/50 shadow-[0_0_28px_-6px_rgba(96,165,250,0.58)] ${
                      isCurrentYouTube
                        ? 'w-full sm:w-[242px] md:w-[260px] aspect-video max-h-[172px] sm:max-h-none'
                        : 'h-24 w-24 sm:h-28 sm:w-28'
                    }`}
                  >
                    {!isCurrentYouTube ? (
                      <button
                        type="button"
                        onClick={handleTogglePlayPause}
                        aria-label={isPlaying ? 'Pause audio' : 'Play audio'}
                        className="relative w-full h-full flex items-center justify-center group focus-visible:outline-none"
                      >
                        <ArtworkImage
                          src={currentTrack.coverUrl}
                          alt={currentTrack.title}
                          className="w-full h-full object-cover opacity-90 brightness-95 transition-all duration-300 group-hover:opacity-100 group-hover:brightness-100 group-hover:scale-105"
                        />
                        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#07070E]/60 via-black/15 to-[#0B0C1D]/25 transition-opacity duration-200 group-hover:opacity-80 flex items-center justify-center">
                          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity">
                            {isPlaying ? (
                              <Pause className="w-4 h-4 fill-current" />
                            ) : (
                              <Play className="w-4 h-4 fill-current ml-0.5" />
                            )}
                          </span>
                        </div>
                      </button>
                    ) : null}
                  </div>

                  {/* Right Track Title, Playback Status, Channel & Clean Metadata */}
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-violet-200 opacity-85 truncate">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-blue-500 text-white">
                          {crossfadeStatus || hookMode ? (
                            <AudioLines className="w-3 h-3" />
                          ) : isPlaying ? (
                            <Play className="w-2.5 h-2.5 fill-current ml-0.5" />
                          ) : (
                            <Pause className="w-2.5 h-2.5 fill-current" />
                          )}
                        </span>
                        <span className="truncate">
                          {crossfadeStatus
                            ? `${crossfadeSettings.djMode ? 'DJ Blend' : 'Crossfading'} · ${crossfadeStatus.remainingSec}s`
                            : hookMode
                              ? (() => {
                                  const blendTrigger = getAutoExitTargetSec(
                                    currentTrack,
                                    effectiveDuration
                                  );
                                  const secsToBlend = blendTrigger - currentTime;
                                  if (isPlaying && secsToBlend > 0 && secsToBlend <= 60) {
                                    return `${
                                      crossfadeSettings.djMode ? 'DJ Blend' : 'Early Blend'
                                    } in ${Math.ceil(secsToBlend)}s`;
                                  }
                                  return 'Hook Mode';
                                })()
                              : isPlaying
                                ? 'Now Playing'
                                : 'Paused'}
                        </span>
                      </span>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => onToggleFavorite(currentTrack.id)}
                          aria-label={
                            isFavorite
                              ? 'Remove from favorites'
                              : 'Add to favorites'
                          }
                          className={`flex h-9 w-9 items-center justify-center rounded-full border transition-colors ${
                            isFavorite
                              ? 'bg-violet-500/25 border-violet-400/50 text-violet-200'
                              : 'bg-white/[0.05] border-white/[0.09] text-slate-300 hover:text-white'
                          }`}
                        >
                          <Heart
                            className={`w-4 h-4 ${isFavorite ? 'fill-current' : ''}`}
                          />
                        </button>

                        {currentTrack.externalUrl ? (
                          <a
                            href={currentTrack.externalUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label="Open original source"
                            title="Open on YouTube / Source"
                            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.05] border border-white/[0.09] text-slate-300 hover:text-white transition-colors"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </a>
                        ) : null}
                      </div>
                    </div>

                    {/* Track Title with Soft Gradient Last-Word Accent */}
                    <h2 className="font-display text-lg sm:text-xl font-bold text-slate-100 opacity-90 leading-snug line-clamp-2">
                      {(() => {
                        const words = currentTrack.title.trim().split(/\s+/);
                        if (words.length <= 1) return currentTrack.title;
                        const lead = words.slice(0, -1).join(' ');
                        const tail = words[words.length - 1];
                        return (
                          <>
                            {lead}{' '}
                            <span className="bg-gradient-to-r from-fuchsia-300/90 via-violet-300/90 to-cyan-300/90 bg-clip-text text-transparent">
                              {tail}
                            </span>
                          </>
                        );
                      })()}
                    </h2>

                    {/* Artist / YouTube Channel Line */}
                    <div className="flex items-center gap-1.5 min-w-0 text-xs sm:text-[13px] text-slate-300 opacity-85">
                      {isCurrentYouTube ? (
                        <span
                          aria-hidden="true"
                          className="inline-flex h-4 w-5 shrink-0 items-center justify-center rounded bg-red-600/85 text-white/95"
                        >
                          <Play className="w-2.5 h-2.5 fill-current ml-0.5" />
                        </span>
                      ) : (
                        <Music2
                          aria-hidden="true"
                          className="w-3.5 h-3.5 text-violet-300 shrink-0"
                        />
                      )}
                      <span className="truncate font-medium">
                        {currentTrack.artist}
                      </span>
                    </div>

                    {/* Clean Unboxed Metadata */}
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] font-mono-tabular text-slate-400 opacity-90">
                      <span>{currentTrack.language}</span>
                      <span aria-hidden="true" className="text-slate-600">
                        ·
                      </span>
                      <span>{currentTrack.bpm} BPM</span>
                      <span aria-hidden="true" className="text-slate-600">
                        ·
                      </span>
                      <span className="font-sans text-blue-300 opacity-85 truncate">
                        {currentTrack.licenseType}
                      </span>
                    </div>

                    {audioError ? (
                      <p className="text-[11px] text-amber-400 truncate">
                        {audioError}
                      </p>
                    ) : null}
                  </div>
                </div>

                {/* 2. Primary Progress Bar (05:22 ———o——— 24:23) */}
                <div className="flex items-center gap-2.5 pt-0.5">
                  <span className="w-10 text-right text-[11px] font-mono-tabular text-slate-300 shrink-0">
                    {formatDuration(currentTime)}
                  </span>
                  <input
                    type="range"
                    aria-label="Seek track position"
                    min={0}
                    max={effectiveDuration}
                    step={0.2}
                    value={Math.min(currentTime, effectiveDuration)}
                    onChange={(e) => handleSeek(Number(e.target.value))}
                    className="gg-range w-full"
                    style={{
                      background: `linear-gradient(to right, #A855F7 0%, #38BDF8 ${progressPct}%, var(--gg-range-track-rest, rgba(255,255,255,0.14)) ${progressPct}%, var(--gg-range-track-rest, rgba(255,255,255,0.14)) 100%)`,
                      borderRadius: '9999px',
                      height: '4px',
                    }}
                  />
                  <span className="w-10 text-[11px] font-mono-tabular text-slate-300 shrink-0">
                    {formatDuration(effectiveDuration)}
                  </span>
                </div>

                {/* 3. Hook Mode Waveform Scrubber Card (ACTIVE ONLY when Hook Mode is selected; hidden in Full Song) */}
                {hookMode ? (
                  <StudioWaveformScrubber
                    trackId={currentTrack.id}
                    currentTime={currentTime}
                    duration={effectiveDuration}
                    isPlaying={isPlaying}
                    bpm={currentTrack.bpm}
                    heat={currentTrack.heat}
                    hookMode={hookMode}
                    hookStartSec={activeHookWindow.startSec}
                    hookEndSec={activeHookWindow.endSec}
                    hasCustomHook={activeHookWindow.isCustom}
                    onSeek={handleSeek}
                    onUpdateHook={handleUpdateHook}
                    onResetHook={handleResetHook}
                  />
                ) : null}

                {/* 4. Circular Transport Row + Full/Hook Segmented Toggle */}
                <div className="flex flex-col items-center gap-2.5 pt-0.5">
                  <div className="flex items-center justify-center gap-2.5 sm:gap-3.5">
                    <button
                      type="button"
                      onClick={onToggleShuffle}
                      aria-label="Toggle shuffle"
                      aria-pressed={shuffle}
                      className={`flex h-10 w-10 items-center justify-center rounded-full border transition-colors ${
                        shuffle
                          ? 'bg-violet-500/25 border-violet-400/45 text-violet-200'
                          : 'bg-white/[0.04] border-white/[0.08] text-slate-300 hover:text-white hover:bg-white/[0.08]'
                      }`}
                    >
                      <Shuffle className="w-4 h-4" />
                    </button>

                    <button
                      type="button"
                      onClick={handleManualPrev}
                      aria-label="Previous track"
                      className="flex h-11 w-11 items-center justify-center rounded-full bg-white/[0.06] border border-white/[0.09] text-slate-100 hover:text-white hover:bg-white/[0.12] transition-colors"
                    >
                      <SkipBack className="w-4 h-4 fill-current" />
                    </button>

                    <button
                      type="button"
                      onClick={handleTogglePlayPause}
                      aria-label={isPlaying ? 'Pause' : 'Play'}
                      className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 via-purple-600 to-blue-500 text-white shadow-[0_0_28px_-2px_rgba(139,92,246,0.75)] hover:scale-[1.03] active:scale-[0.97] transition-transform"
                    >
                      {isPlaying ? (
                        <Pause className="w-6 h-6 fill-current" />
                      ) : (
                        <Play className="w-6 h-6 fill-current ml-0.5" />
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={handleManualNext}
                      aria-label="Next track"
                      className="flex h-11 w-11 items-center justify-center rounded-full bg-white/[0.06] border border-white/[0.09] text-slate-100 hover:text-white hover:bg-white/[0.12] transition-colors"
                    >
                      <SkipForward className="w-4 h-4 fill-current" />
                    </button>

                    <button
                      type="button"
                      onClick={onCycleRepeat}
                      aria-label={`Repeat mode: ${repeatMode}`}
                      className={`flex h-10 w-10 items-center justify-center rounded-full border transition-colors ${
                        repeatMode !== 'off'
                          ? 'bg-blue-500/25 border-blue-400/45 text-blue-200'
                          : 'bg-white/[0.04] border-white/[0.08] text-slate-300 hover:text-white hover:bg-white/[0.08]'
                      }`}
                    >
                      {repeatMode === 'one' ? (
                        <Repeat1 className="w-4 h-4" />
                      ) : (
                        <Repeat className="w-4 h-4" />
                      )}
                    </button>
                  </div>

                  {/* Full | Hook Segmented Switch (DJ crossfade timing configured in Settings) */}
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={hookMode}
                      aria-label={
                        hookMode
                          ? 'Hook Mode active. Switch to Full Song'
                          : 'Full Song active. Switch to Hook Mode'
                      }
                      onClick={handleToggleHookMode}
                      className={`gg-hook-switch group relative inline-flex h-8 items-center rounded-full p-[3px] bg-[#070815] border transition-all duration-200 shadow-[inset_0_2px_6px_rgba(0,0,0,0.85)] shrink-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet-400 ${
                        hookMode
                          ? 'is-hook border-violet-400/50 shadow-[inset_0_2px_6px_rgba(0,0,0,0.85),0_0_18px_-4px_rgba(139,92,246,0.55)]'
                          : 'border-white/[0.12] hover:border-violet-400/35'
                      }`}
                    >
                      <span className="relative grid grid-cols-2 items-center">
                        <span
                          aria-hidden="true"
                          className={`pointer-events-none absolute inset-y-0 left-0 w-1/2 rounded-full transition-all duration-200 ease-out ${
                            hookMode
                              ? 'translate-x-full bg-gradient-to-r from-violet-600 to-blue-500 border border-violet-300/40 shadow-[0_0_12px_rgba(139,92,246,0.55)]'
                              : 'translate-x-0 bg-white/[0.13] border border-white/[0.18] shadow-sm'
                          }`}
                        />
                        <span
                          className={`relative z-10 inline-flex items-center justify-center gap-1.5 px-3.5 py-0.5 text-xs font-semibold tracking-tight whitespace-nowrap transition-colors duration-200 ${
                            !hookMode
                              ? 'text-white'
                              : 'text-slate-400 group-hover:text-slate-200'
                          }`}
                        >
                          <span
                            aria-hidden="true"
                            className={`h-1.5 w-1.5 rounded-full transition-colors ${
                              !hookMode
                                ? 'bg-blue-400 shadow-[0_0_6px_rgba(96,165,250,0.9)]'
                                : 'bg-slate-600'
                            }`}
                          />
                          <span>Full</span>
                        </span>
                        <span
                          className={`relative z-10 inline-flex items-center justify-center gap-1.5 px-3.5 py-0.5 text-xs font-semibold tracking-tight whitespace-nowrap transition-colors duration-200 ${
                            hookMode
                              ? 'text-white'
                              : 'text-slate-400 group-hover:text-slate-200'
                          }`}
                        >
                          <Scissors
                            className={`w-3 h-3 transition-colors ${
                              hookMode ? 'text-white' : 'text-violet-300/75'
                            }`}
                          />
                          <span>Hook</span>
                        </span>
                      </span>
                    </button>
                  </div>
                </div>

                {/* 5. Glass Volume Bar (Visible on Desktop only; hidden on mobile where volume is locked at 100%) */}
                <div className="hidden lg:flex items-center gap-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] px-3 py-1.5">
                  <button
                    type="button"
                    onClick={() => setMuted((prev) => !prev)}
                    aria-label={muted ? 'Unmute audio' : 'Mute audio'}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-300 hover:text-white hover:bg-white/[0.06] transition-colors"
                  >
                    {muted || volume === 0 ? (
                      <VolumeX className="w-4 h-4" />
                    ) : (
                      <Volume2 className="w-4 h-4" />
                    )}
                  </button>
                  <input
                    type="range"
                    aria-label="Volume"
                    min={0}
                    max={1}
                    step={0.02}
                    value={muted ? 0 : volume}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setVolume(val);
                      if (val > 0 && muted) setMuted(false);
                    }}
                    className="gg-range w-full"
                    style={{
                      background: `linear-gradient(to right, #8B5CF6 0%, #38BDF8 ${
                        (muted ? 0 : volume) * 100
                      }%, var(--gg-range-track-rest, rgba(255,255,255,0.14)) ${
                        (muted ? 0 : volume) * 100
                      }%, var(--gg-range-track-rest, rgba(255,255,255,0.14)) 100%)`,
                      borderRadius: '9999px',
                      height: '4px',
                    }}
                  />
                  <span className="w-10 text-right text-[11px] font-mono-tabular text-slate-300 shrink-0">
                    {Math.round((muted ? 0 : volume) * 100)}%
                  </span>
                </div>

                {/* 6. Up Next Queue Card + Recent / Tune Request Strip */}
                <div className="rounded-2xl bg-white/[0.04] border border-white/[0.08] overflow-hidden">
                  <button
                    type="button"
                    onClick={() =>
                      setConsoleDrawerTab((prev) =>
                        prev === 'queue' ? null : 'queue'
                      )
                    }
                    className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-white/[0.04] transition-colors"
                    aria-expanded={consoleDrawerTab === 'queue'}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <ListMusic className="w-4 h-4 text-violet-300 shrink-0" />
                      <span className="text-xs font-semibold text-white">
                        Up Next
                      </span>
                      <span className="text-xs font-mono-tabular text-slate-400">
                        · {queue.length} tracks
                      </span>
                    </div>
                    {consoleDrawerTab === 'queue' ? (
                      <ChevronUp className="w-4 h-4 text-slate-400 shrink-0" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                    )}
                  </button>

                  {nextTrackPreview ? (
                    <div className="flex items-center justify-between gap-2.5 px-3 py-2 border-t border-white/[0.06] bg-white/[0.015]">
                      <button
                        type="button"
                        onClick={() => onSelectTrack(nextTrackPreview)}
                        className="flex items-center gap-2.5 min-w-0 flex-1 text-left group focus-visible:outline-none"
                      >
                        <div className="h-9 w-9 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-[#141422]">
                          <ArtworkImage
                            src={nextTrackPreview.coverUrl}
                            alt={nextTrackPreview.title}
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-white truncate group-hover:text-violet-300 transition-colors">
                            {nextTrackPreview.title}
                          </p>
                          <p className="text-[11px] text-slate-400 truncate">
                            {nextTrackPreview.artist}
                            {hookMode
                              ? ` · IN ${Math.round(
                                  getHookForTrack(
                                    nextTrackPreview,
                                    nextTrackPreview.durationSec || 218
                                  ).startSec
                                )}s`
                              : ''}
                          </p>
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={handleManualNext}
                        aria-label={`Play next track: ${nextTrackPreview.title}`}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-slate-200 hover:text-white hover:bg-violet-500/30 transition-colors"
                      >
                        <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                      </button>
                    </div>
                  ) : null}
                </div>

                {/* Bottom Quick Actions: Recent History + Song Missing Request */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5 text-[11px]">
                  <button
                    type="button"
                    onClick={() =>
                      setConsoleDrawerTab((prev) =>
                        prev === 'recent' ? null : 'recent'
                      )
                    }
                    className="inline-flex items-center gap-1.5 text-slate-400 hover:text-white transition-colors font-mono-tabular"
                  >
                    <History className="w-3.5 h-3.5" />
                    <span>Recent: {recentlyPlayed.length}</span>
                  </button>

                  {onOpenTuneRequest ? (
                    <button
                      type="button"
                      onClick={onOpenTuneRequest}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-300 hover:text-white transition-colors whitespace-nowrap shrink-0"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Song missing? Request song</span>
                    </button>
                  ) : null}
                </div>
              </div>

              {/* Mobile & Narrow Inline Queue / Recently Played Drawer (rendered BELOW stage & controls so player never disappears!) */}
              {consoleDrawerTab !== null && !isDesktopViewport ? (
                <div className="relative z-10 border-t border-violet-500/20 bg-[#0A0A14]/95 p-3 sm:p-4 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1 p-1 rounded-xl bg-[#11111C] border border-white/[0.07]">
                      <button
                        type="button"
                        onClick={() => setConsoleDrawerTab('queue')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                          consoleDrawerTab === 'queue'
                            ? 'bg-gradient-to-r from-violet-600 to-blue-500 text-white'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        Queue ({queue.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setConsoleDrawerTab('recent')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                          consoleDrawerTab === 'recent'
                            ? 'bg-gradient-to-r from-violet-600 to-blue-500 text-white'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        Recent ({recentlyPlayed.length})
                      </button>
                    </div>

                    <div className="flex items-center gap-2">
                      {consoleDrawerTab === 'recent' &&
                      recentlyPlayed.length > 0 &&
                      onClearRecentlyPlayed ? (
                        <button
                          type="button"
                          onClick={onClearRecentlyPlayed}
                          className="text-xs font-medium text-blue-400 hover:text-blue-300"
                        >
                          Clear
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => setConsoleDrawerTab(null)}
                        aria-label="Close drawer"
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.07]"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div className="max-h-[220px] overflow-y-auto space-y-1 pr-1">
                    {consoleDrawerTab === 'queue' ? (
                      centeredQueueWindow.map((item) => {
                        const active = item.id === currentTrack.id;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => onSelectTrack(item)}
                            className={`w-full flex items-center gap-3 p-2 rounded-xl text-left transition-colors ${
                              active
                                ? 'bg-violet-500/20 text-white border border-violet-500/30'
                                : 'hover:bg-white/[0.05] text-slate-300 border border-transparent'
                            }`}
                          >
                            <div className="h-9 w-9 shrink-0 overflow-hidden rounded-lg">
                              <ArtworkImage src={item.coverUrl} alt={item.title} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-semibold truncate">
                                {item.title}
                              </p>
                              <p className="text-[11px] text-slate-400 truncate">
                                {item.artist}
                              </p>
                            </div>
                            <span className="text-[11px] font-mono-tabular text-slate-500 shrink-0">
                              {hookMode
                                ? `IN ${Math.round(
                                    getHookForTrack(item, item.durationSec || 218).startSec
                                  )}s`
                                : item.durationSec > 0
                                  ? formatDuration(item.durationSec)
                                  : 'YT'}
                            </span>
                          </button>
                        );
                      })
                    ) : recentlyPlayed.length === 0 ? (
                      <div className="py-8 text-center text-xs text-slate-400">
                        Songs you play will appear here for instant replay.
                      </div>
                    ) : (
                      recentlyPlayed.map((item) => {
                        const active = item.id === currentTrack.id;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => onSelectTrack(item)}
                            className={`w-full flex items-center gap-3 p-2 rounded-xl text-left transition-colors ${
                              active
                                ? 'bg-violet-500/20 text-white border border-violet-500/30'
                                : 'hover:bg-white/[0.05] text-slate-300 border border-transparent'
                            }`}
                          >
                            <div className="h-9 w-9 shrink-0 overflow-hidden rounded-lg">
                              <ArtworkImage src={item.coverUrl} alt={item.title} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-semibold truncate">
                                {item.title}
                              </p>
                              <p className="text-[11px] text-slate-400 truncate">
                                {item.artist}
                              </p>
                            </div>
                            <Clock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              ) : null}
            </section>

            {/* Desktop Side Drawer for Playlist Queue & Recently Played */}
            {consoleDrawerTab !== null && isDesktopViewport ? (
              <aside
                aria-label="Queue and Recently Played"
                className="w-72 xl:w-80 shrink-0 rounded-2xl sm:rounded-3xl bg-[#10101A]/95 border border-violet-500/20 shadow-2xl flex flex-col max-h-[540px] overflow-hidden"
              >
                <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-white/[0.08]">
                  <div className="flex items-center gap-1 p-1 rounded-xl bg-[#09090F] border border-white/[0.06]">
                    <button
                      type="button"
                      onClick={() => setConsoleDrawerTab('queue')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                        consoleDrawerTab === 'queue'
                          ? 'bg-gradient-to-r from-violet-600 to-blue-500 text-white'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Queue ({queue.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setConsoleDrawerTab('recent')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                        consoleDrawerTab === 'recent'
                          ? 'bg-gradient-to-r from-violet-600 to-blue-500 text-white'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Recent ({recentlyPlayed.length})
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => setConsoleDrawerTab(null)}
                    aria-label="Close drawer"
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06]"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {consoleDrawerTab === 'recent' &&
                recentlyPlayed.length > 0 &&
                onClearRecentlyPlayed ? (
                  <div className="flex items-center justify-between px-4 py-2 border-b border-white/[0.05] text-[11px] text-slate-400">
                    <span>Recently Played History</span>
                    <button
                      type="button"
                      onClick={onClearRecentlyPlayed}
                      className="text-blue-400 hover:text-blue-300"
                    >
                      Clear
                    </button>
                  </div>
                ) : null}

                <div className="flex-1 overflow-y-auto p-2.5 space-y-1">
                  {consoleDrawerTab === 'queue' ? (
                    centeredQueueWindow.map((item) => {
                      const active = item.id === currentTrack.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => onSelectTrack(item)}
                          className={`w-full flex items-center gap-3 p-2 rounded-xl text-left transition-colors ${
                            active
                              ? 'bg-violet-500/20 text-white border border-violet-500/30'
                              : 'hover:bg-white/[0.05] text-slate-300 border border-transparent'
                          }`}
                        >
                          <div className="h-9 w-9 shrink-0 overflow-hidden rounded-lg">
                            <ArtworkImage src={item.coverUrl} alt={item.title} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium truncate">
                              {item.title}
                            </p>
                            <p className="text-[11px] text-slate-400 truncate">
                              {item.artist}
                            </p>
                          </div>
                          <span className="text-[11px] font-mono-tabular text-slate-500 shrink-0">
                            {hookMode
                              ? `IN ${Math.round(
                                  getHookForTrack(item, item.durationSec || 218).startSec
                                )}s`
                              : item.durationSec > 0
                                ? formatDuration(item.durationSec)
                                : 'YT'}
                          </span>
                        </button>
                      );
                    })
                  ) : recentlyPlayed.length === 0 ? (
                    <div className="py-12 px-4 text-center text-xs text-slate-400">
                      Tracks you play appear here for quick replay.
                    </div>
                  ) : (
                    recentlyPlayed.map((item) => {
                      const active = item.id === currentTrack.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => onSelectTrack(item)}
                          className={`w-full flex items-center gap-3 p-2 rounded-xl text-left transition-colors ${
                            active
                              ? 'bg-violet-500/20 text-white border border-violet-500/30'
                              : 'hover:bg-white/[0.05] text-slate-300 border border-transparent'
                          }`}
                        >
                          <div className="h-9 w-9 shrink-0 overflow-hidden rounded-lg">
                            <ArtworkImage src={item.coverUrl} alt={item.title} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium truncate">
                              {item.title}
                            </p>
                            <p className="text-[11px] text-slate-400 truncate">
                              {item.artist}
                            </p>
                          </div>
                          <Clock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                        </button>
                      );
                    })
                  )}
                </div>
              </aside>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Unified Queue & Recently Played Floating Drawer (Minimized View — ALL Screen Sizes, Never Hides Player!) */}
      {currentTrack && minimizedDrawerTab !== null && !studioConsoleOpen ? (
        <aside
          aria-label="Queue and Recently Played"
          className="fixed z-40 left-2 right-2 bottom-[184px] h-[min(26dvh,200px)] md:h-auto md:left-auto md:right-6 md:w-[348px] lg:w-[372px] lg:bottom-[94px] md:max-h-[46vh] lg:max-h-[58vh] flex flex-col rounded-2xl bg-gradient-to-b from-[#131320]/96 to-[#0A0A12]/96 backdrop-blur-2xl border border-violet-500/30 shadow-[0_24px_70px_-15px_rgba(124,58,237,0.48)] overflow-hidden"
        >
          <div className="flex items-center justify-between gap-2 px-3.5 py-2.5 border-b border-white/[0.08]">
            <div className="flex items-center gap-1 p-1 rounded-xl bg-[#090910] border border-white/[0.06]">
              <button
                type="button"
                onClick={() => setMinimizedDrawerTab('queue')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                  minimizedDrawerTab === 'queue'
                    ? 'bg-gradient-to-r from-violet-600 to-blue-500 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Queue ({queue.length})
              </button>
              <button
                type="button"
                onClick={() => setMinimizedDrawerTab('recent')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                  minimizedDrawerTab === 'recent'
                    ? 'bg-gradient-to-r from-violet-600 to-blue-500 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Recent ({recentlyPlayed.length})
              </button>
            </div>

            <div className="flex items-center gap-1.5">
              {minimizedDrawerTab === 'recent' &&
              recentlyPlayed.length > 0 &&
              onClearRecentlyPlayed ? (
                <button
                  type="button"
                  onClick={onClearRecentlyPlayed}
                  className="text-[11px] font-medium text-blue-400 hover:text-blue-300 px-1.5"
                >
                  Clear
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setMinimizedDrawerTab(null)}
                aria-label="Close drawer"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {minimizedDrawerTab === 'queue' ? (
              centeredQueueWindow.map((item) => {
                const active = item.id === currentTrack.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onSelectTrack(item)}
                    className={`w-full flex items-center gap-3 p-2 rounded-xl text-left transition-colors ${
                      active
                        ? 'bg-violet-500/20 text-white border border-violet-500/30'
                        : 'hover:bg-white/[0.05] text-slate-300 border border-transparent'
                    }`}
                  >
                    <div className="h-9 w-9 shrink-0 overflow-hidden rounded-lg">
                      <ArtworkImage src={item.coverUrl} alt={item.title} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium truncate">{item.title}</p>
                      <p className="text-[11px] text-slate-400 truncate">
                        {item.artist}
                      </p>
                    </div>
                    <span className="text-[11px] font-mono-tabular text-slate-500">
                      {item.durationSec > 0 ? formatDuration(item.durationSec) : 'YT'}
                    </span>
                  </button>
                );
              })
            ) : recentlyPlayed.length === 0 ? (
              <div className="py-10 px-4 text-center text-xs text-slate-400">
                Tracks you play appear here for instant replay.
              </div>
            ) : (
              recentlyPlayed.map((item) => {
                const active = item.id === currentTrack.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onSelectTrack(item)}
                    className={`w-full flex items-center gap-3 p-2 rounded-xl text-left transition-colors ${
                      active
                        ? 'bg-violet-500/20 text-white border border-violet-500/30'
                        : 'hover:bg-white/[0.05] text-slate-300 border border-transparent'
                    }`}
                  >
                    <div className="h-9 w-9 shrink-0 overflow-hidden rounded-lg">
                      <ArtworkImage src={item.coverUrl} alt={item.title} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium truncate">{item.title}</p>
                      <p className="text-[11px] text-slate-400 truncate">
                        {item.artist}
                      </p>
                    </div>
                    <Clock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  </button>
                );
              })
            )}
          </div>
        </aside>
      ) : null}

      {/* Desktop Fixed Bottom Studio Docked Player Bar (Midnight Violet-Blue unified look) */}
      {currentTrack && !studioConsoleOpen ? (
        <footer className="hidden lg:flex fixed bottom-0 left-0 right-0 z-40 h-[84px] items-center justify-between gap-5 px-6 bg-gradient-to-r from-[#131320]/96 via-[#0D0D17]/96 to-[#11111E]/96 backdrop-blur-2xl border-t border-violet-500/25 shadow-[0_-12px_40px_-12px_rgba(124,58,237,0.35)]">
          {/* Left: Current Track Info (clickable to reopen Center Studio Console) */}
          <div className="flex items-center gap-3 w-72 xl:w-80 min-w-0">
            <button
              type="button"
              onClick={() => {
                setMinimizedDrawerTab(null);
                onSetStudioConsoleOpen(true);
              }}
              className="flex items-center gap-3 min-w-0 flex-1 text-left group focus-visible:outline-none"
              title="Open Center Studio Player"
            >
              <div className="gg-keep-dark relative h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-[#181822] border border-violet-500/30 shadow-md shadow-violet-950/50">
                <ArtworkImage
                  src={currentTrack.coverUrl}
                  alt={currentTrack.title}
                  className="w-full h-full object-cover opacity-90 brightness-95 transition-all duration-200 group-hover:opacity-100 group-hover:brightness-100"
                />
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/50 via-black/15 to-transparent transition-opacity duration-200 group-hover:opacity-65"
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-display text-sm font-semibold text-slate-100 opacity-90 truncate group-hover:text-violet-300 group-hover:opacity-100 transition-colors">
                  {currentTrack.title}
                </p>
                <p className="text-xs text-slate-400 opacity-90 truncate mt-0.5">
                  {currentTrack.artist}
                  <span className="mx-1.5 text-slate-600" aria-hidden="true">
                    ·
                  </span>
                  <span className="text-blue-400 opacity-85">
                    {hookMode ? 'Hook Mode' : currentTrack.licenseType}
                  </span>
                </p>
                {crossfadeStatus ? (
                  <p className="text-[11px] text-violet-300 truncate font-mono-tabular">
                    Crossfading to {crossfadeStatus.nextTitle} · {crossfadeStatus.remainingSec}s
                  </p>
                ) : audioError ? (
                  <p className="text-[11px] text-amber-400 truncate">{audioError}</p>
                ) : null}
              </div>
            </button>
            <button
              type="button"
              onClick={() => onToggleFavorite(currentTrack.id)}
              aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition-colors ${
                isFavorite
                  ? 'bg-violet-500/20 border-violet-400/40 text-violet-300'
                  : 'bg-white/[0.04] border-white/[0.08] text-slate-400 hover:text-white'
              }`}
            >
              <Heart className={`w-4 h-4 ${isFavorite ? 'fill-current' : ''}`} />
            </button>
          </div>

          {/* Center: Unified Studio Controls & Seek Scrubber */}
          <div className="flex flex-1 max-w-xl flex-col items-center gap-1.5">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                role="switch"
                aria-checked={hookMode}
                onClick={handleToggleHookMode}
                aria-label={
                  hookMode
                    ? 'Hook Mode active. Switch to Full Song'
                    : 'Full Song active. Switch to Hook Mode'
                }
                title={hookMode ? 'Hook Mode: On (switch to Full)' : 'Full Song (switch to Hook)'}
                className={`gg-hook-switch group relative inline-flex h-8 items-center rounded-xl p-[2.5px] bg-[#06060C] border transition-all duration-200 shadow-[inset_0_1px_5px_rgba(0,0,0,0.85)] shrink-0 ${
                  hookMode
                    ? 'is-hook border-violet-400/50 shadow-[inset_0_1px_5px_rgba(0,0,0,0.85),0_0_12px_-3px_rgba(139,92,246,0.5)]'
                    : 'border-white/[0.1] hover:border-violet-400/35'
                }`}
              >
                <span className="relative grid grid-cols-2 items-center">
                  <span
                    aria-hidden="true"
                    className={`pointer-events-none absolute inset-y-0 left-0 w-1/2 rounded-lg transition-all duration-200 ease-out ${
                      hookMode
                        ? 'translate-x-full bg-gradient-to-r from-violet-600 to-blue-500 border border-violet-300/35 shadow-[0_0_10px_rgba(139,92,246,0.5)]'
                        : 'translate-x-0 bg-white/[0.12] border border-white/[0.16]'
                    }`}
                  />
                  <span
                    className={`relative z-10 px-2 py-0.5 text-[10px] font-semibold tracking-tight whitespace-nowrap transition-colors ${
                      !hookMode ? 'text-white' : 'text-slate-400 group-hover:text-slate-200'
                    }`}
                  >
                    Full
                  </span>
                  <span
                    className={`relative z-10 inline-flex items-center gap-0.5 px-2 py-0.5 text-[10px] font-semibold tracking-tight whitespace-nowrap transition-colors ${
                      hookMode ? 'text-white' : 'text-slate-400 group-hover:text-slate-200'
                    }`}
                  >
                    <Scissors className="w-2.5 h-2.5" />
                    <span>Hook</span>
                  </span>
                </span>
              </button>

              <button
                type="button"
                onClick={onToggleShuffle}
                aria-label="Toggle shuffle"
                aria-pressed={shuffle}
                className={`flex h-9 w-9 items-center justify-center rounded-xl transition-colors ${
                  shuffle
                    ? 'bg-violet-500/20 text-violet-300'
                    : 'text-slate-400 hover:text-white hover:bg-white/[0.05]'
                }`}
              >
                <Shuffle className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={handleManualPrev}
                aria-label="Previous track"
                className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.05] text-slate-200 hover:text-white hover:bg-white/[0.1] transition-colors"
              >
                <SkipBack className="w-4 h-4 fill-current" />
              </button>

              <button
                type="button"
                onClick={handleTogglePlayPause}
                aria-label={isPlaying ? 'Pause' : 'Play'}
                className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-r from-violet-600 to-blue-500 text-white shadow-md shadow-violet-950/60 transition-transform duration-150 hover:scale-105 active:scale-95"
              >
                {isPlaying ? (
                  <Pause className="w-4 h-4 fill-current" />
                ) : (
                  <Play className="w-4 h-4 fill-current ml-0.5" />
                )}
              </button>

              <button
                type="button"
                onClick={handleManualNext}
                aria-label="Next track"
                className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.05] text-slate-200 hover:text-white hover:bg-white/[0.1] transition-colors"
              >
                <SkipForward className="w-4 h-4 fill-current" />
              </button>

              <button
                type="button"
                onClick={onCycleRepeat}
                aria-label={`Repeat mode: ${repeatMode}`}
                className={`flex h-9 w-9 items-center justify-center rounded-xl transition-colors ${
                  repeatMode !== 'off'
                    ? 'bg-blue-500/20 text-blue-300'
                    : 'text-slate-400 hover:text-white hover:bg-white/[0.05]'
                }`}
              >
                {repeatMode === 'one' ? (
                  <Repeat1 className="w-4 h-4" />
                ) : (
                  <Repeat className="w-4 h-4" />
                )}
              </button>
            </div>

            <div className="flex w-full items-center gap-2.5">
              <span className="w-10 text-right text-[11px] font-mono-tabular text-slate-400">
                {formatDuration(currentTime)}
              </span>
              <input
                type="range"
                aria-label="Seek audio position"
                min={0}
                max={effectiveDuration}
                step={0.2}
                value={Math.min(currentTime, effectiveDuration)}
                onChange={(e) => handleSeek(Number(e.target.value))}
                className="gg-range w-full"
                style={{
                  background: `linear-gradient(to right, #8B5CF6 0%, #3B82F6 ${progressPct}%, var(--gg-range-track-rest, rgba(255,255,255,0.12)) ${progressPct}%, var(--gg-range-track-rest, rgba(255,255,255,0.12)) 100%)`,
                  borderRadius: '9999px',
                  height: '4px',
                }}
              />
              <span className="w-10 text-[11px] font-mono-tabular text-slate-400">
                {formatDuration(effectiveDuration)}
              </span>
            </div>
          </div>

          {/* Right: Expand Console, Stage Toggle, Queue, Recent & Volume */}
          <div className="flex items-center justify-end gap-1.5 xl:w-96 shrink-0">
            <button
              type="button"
              onClick={() => {
                setMinimizedDrawerTab(null);
                onSetStudioConsoleOpen(true);
              }}
              aria-label="Open Studio Console"
              className="inline-flex h-9 items-center gap-1.5 px-3 rounded-xl bg-gradient-to-r from-violet-600/25 to-blue-500/20 border border-violet-500/35 text-xs font-medium text-white hover:opacity-90 transition-opacity whitespace-nowrap shrink-0"
            >
              <Maximize2 className="w-3.5 h-3.5 text-violet-300" />
              <span>Studio</span>
            </button>

            {ytStageVisible ? (
              <button
                type="button"
                onClick={() => setYtDockMinimized((prev) => !prev)}
                aria-label={ytDockMinimized ? 'Show video stage' : 'Hide video stage'}
                title={ytDockMinimized ? 'Show video stage' : 'Hide video stage'}
                className={`flex h-9 w-9 items-center justify-center rounded-xl transition-colors ${
                  !ytDockMinimized
                    ? 'bg-violet-500/20 text-violet-300'
                    : 'text-slate-400 hover:text-white hover:bg-white/[0.06]'
                }`}
              >
                <Tv className="w-4 h-4" />
              </button>
            ) : null}

            <button
              type="button"
              onClick={() =>
                setMinimizedDrawerTab((prev) => (prev === 'queue' ? null : 'queue'))
              }
              aria-label="Toggle playback queue"
              title="Queue"
              className={`flex h-9 w-9 items-center justify-center rounded-xl transition-colors ${
                minimizedDrawerTab === 'queue'
                  ? 'bg-gradient-to-r from-violet-600/35 to-blue-500/30 text-white border border-violet-400/40'
                  : 'text-slate-400 hover:text-white hover:bg-white/[0.06]'
              }`}
            >
              <ListMusic className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() =>
                setMinimizedDrawerTab((prev) => (prev === 'recent' ? null : 'recent'))
              }
              aria-label="Toggle recently played"
              title="Recently Played"
              className={`flex h-9 w-9 items-center justify-center rounded-xl transition-colors ${
                minimizedDrawerTab === 'recent'
                  ? 'bg-gradient-to-r from-violet-600/35 to-blue-500/30 text-white border border-violet-400/40'
                  : 'text-slate-400 hover:text-white hover:bg-white/[0.06]'
              }`}
            >
              <History className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => setMuted((prev) => !prev)}
              aria-label={muted ? 'Unmute audio' : 'Mute audio'}
              className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 hover:text-white transition-colors"
            >
              {muted || volume === 0 ? (
                <VolumeX className="w-4 h-4" />
              ) : (
                <Volume2 className="w-4 h-4" />
              )}
            </button>

            <input
              type="range"
              aria-label="Volume"
              min={0}
              max={1}
              step={0.02}
              value={muted ? 0 : volume}
              onChange={(e) => {
                const val = Number(e.target.value);
                setVolume(val);
                if (val > 0 && muted) setMuted(false);
              }}
              className="gg-range w-20"
              style={{
                background: `linear-gradient(to right, #8B5CF6 0%, #3B82F6 ${
                  (muted ? 0 : volume) * 100
                }%, var(--gg-range-track-rest, rgba(255,255,255,0.12)) ${(muted ? 0 : volume) * 100}%, var(--gg-range-track-rest, rgba(255,255,255,0.12)) 100%)`,
                borderRadius: '9999px',
                height: '4px',
              }}
            />

            {onClosePlayer ? (
              <button
                type="button"
                onClick={() => {
                  userPausedRef.current = true;
                  onClosePlayer();
                }}
                aria-label="Close music player"
                className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            ) : null}
          </div>
        </footer>
      ) : null}

      {/* Mobile & Tablet Studio Mini-Console Deck (mirrors Desktop & Expanded Studio Console look) */}
      {currentTrack && !studioConsoleOpen ? (
        <div className="lg:hidden fixed bottom-[58px] left-2 right-2 z-40">
          <div className="rounded-2xl bg-gradient-to-b from-[#131320]/96 via-[#0E0E17]/96 to-[#090910]/96 backdrop-blur-2xl border border-violet-500/30 shadow-[0_18px_50px_-12px_rgba(124,58,237,0.48)] px-2.5 py-2 space-y-1.5">
            {/* Row 1: Artwork + Track Info + Studio Stage / Queue / Recent / Expand / Close */}
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  setMinimizedDrawerTab(null);
                  onSetStudioConsoleOpen(true);
                }}
                className="group flex flex-1 min-w-0 items-center gap-2.5 text-left focus-visible:outline-none"
                aria-label="Open Studio Player"
              >
                <div className="gg-keep-dark relative h-9 w-9 shrink-0 overflow-hidden rounded-xl border border-violet-500/30 bg-[#181822]">
                  <ArtworkImage
                    src={currentTrack.coverUrl}
                    alt={currentTrack.title}
                    className="w-full h-full object-cover opacity-90 brightness-95 transition-all duration-200 group-hover:opacity-100 group-hover:brightness-100"
                  />
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/50 via-black/15 to-transparent transition-opacity duration-200 group-hover:opacity-65"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-display text-xs font-semibold text-slate-100 opacity-90 truncate group-hover:text-violet-300 group-hover:opacity-100 transition-colors">
                    {currentTrack.title}
                  </p>
                  <p className="text-[11px] text-slate-400 opacity-90 truncate">
                    {crossfadeStatus
                      ? `Crossfading · ${crossfadeStatus.remainingSec}s`
                      : hookMode
                        ? `${currentTrack.artist} · Hook`
                        : currentTrack.artist}
                  </p>
                </div>
              </button>

              <div className="flex items-center gap-1 shrink-0">
                {ytStageVisible ? (
                  <button
                    type="button"
                    onClick={() => setYtDockMinimized((prev) => !prev)}
                    aria-label={ytDockMinimized ? 'Show video stage' : 'Hide video stage'}
                    className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
                      !ytDockMinimized
                        ? 'bg-violet-500/20 text-violet-300'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <Tv className="w-3.5 h-3.5" />
                  </button>
                ) : null}

                <button
                  type="button"
                  onClick={() =>
                    setMinimizedDrawerTab((prev) =>
                      prev === 'queue' ? null : 'queue'
                    )
                  }
                  aria-label="Toggle playback queue"
                  className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
                    minimizedDrawerTab === 'queue'
                      ? 'bg-gradient-to-r from-violet-600/35 to-blue-500/30 text-white border border-violet-400/40'
                      : 'text-slate-300 hover:text-white hover:bg-white/[0.06]'
                  }`}
                >
                  <ListMusic className="w-3.5 h-3.5" />
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setMinimizedDrawerTab((prev) =>
                      prev === 'recent' ? null : 'recent'
                    )
                  }
                  aria-label="Toggle recently played"
                  className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
                    minimizedDrawerTab === 'recent'
                      ? 'bg-gradient-to-r from-violet-600/35 to-blue-500/30 text-white border border-violet-400/40'
                      : 'text-slate-300 hover:text-white hover:bg-white/[0.06]'
                  }`}
                >
                  <History className="w-3.5 h-3.5" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setMinimizedDrawerTab(null);
                    onSetStudioConsoleOpen(true);
                  }}
                  aria-label="Open Studio Console"
                  className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-r from-violet-600/25 to-blue-500/20 border border-violet-500/35 text-violet-200 hover:text-white"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                </button>

                {onClosePlayer ? (
                  <button
                    type="button"
                    onClick={() => {
                      userPausedRef.current = true;
                      onClosePlayer();
                    }}
                    aria-label="Close music player"
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:text-white"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                ) : null}
              </div>
            </div>

            {/* Row 2: Seek Progress Bar with Tabular Time */}
            <div className="flex items-center gap-2">
              <span className="w-8 text-right text-[10px] font-mono-tabular text-slate-400 shrink-0">
                {formatDuration(currentTime)}
              </span>
              <input
                type="range"
                aria-label="Seek audio position"
                min={0}
                max={effectiveDuration}
                step={0.2}
                value={Math.min(currentTime, effectiveDuration)}
                onChange={(e) => handleSeek(Number(e.target.value))}
                className="gg-range w-full"
                style={{
                  background: `linear-gradient(to right, #8B5CF6 0%, #3B82F6 ${progressPct}%, var(--gg-range-track-rest, rgba(255,255,255,0.14)) ${progressPct}%, var(--gg-range-track-rest, rgba(255,255,255,0.14)) 100%)`,
                  borderRadius: '9999px',
                  height: '4px',
                }}
              />
              <span className="w-8 text-[10px] font-mono-tabular text-slate-400 shrink-0">
                {formatDuration(effectiveDuration)}
              </span>
            </div>

            {/* Row 3: Unified Studio Transport Bar */}
            <div className="flex items-center justify-between gap-1 pt-0.5">
              <button
                type="button"
                role="switch"
                aria-checked={hookMode}
                onClick={handleToggleHookMode}
                aria-label={
                  hookMode
                    ? 'Hook Mode active. Switch to Full Song'
                    : 'Full Song active. Switch to Hook Mode'
                }
                className={`gg-hook-switch inline-flex h-8 items-center gap-1 px-1.5 rounded-xl bg-[#06060C] border transition-all duration-200 shadow-[inset_0_1px_4px_rgba(0,0,0,0.85)] shrink-0 ${
                  hookMode
                    ? 'is-hook border-violet-400/50 text-violet-200 shadow-[inset_0_1px_4px_rgba(0,0,0,0.85),0_0_10px_-2px_rgba(139,92,246,0.5)]'
                    : 'border-white/[0.1] text-slate-400 hover:text-white'
                }`}
              >
                <Scissors
                  className={`w-3 h-3 transition-colors ${
                    hookMode ? 'text-violet-300' : 'text-slate-400'
                  }`}
                />
                <span
                  aria-hidden="true"
                  className={`relative inline-flex h-3.5 w-6 items-center rounded-full p-0.5 transition-colors duration-200 ${
                    hookMode
                      ? 'bg-gradient-to-r from-violet-600 to-blue-500'
                      : 'bg-white/[0.12]'
                  }`}
                >
                  <span
                    className={`h-2.5 w-2.5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                      hookMode ? 'translate-x-2.5' : 'translate-x-0'
                    }`}
                  />
                </span>
              </button>

              <button
                type="button"
                onClick={onToggleShuffle}
                aria-label="Toggle shuffle"
                aria-pressed={shuffle}
                className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
                  shuffle
                    ? 'bg-violet-500/20 text-violet-300'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Shuffle className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={handleManualPrev}
                aria-label="Previous track"
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.05] text-slate-200 hover:text-white"
              >
                <SkipBack className="w-3.5 h-3.5 fill-current" />
              </button>

              <button
                type="button"
                onClick={handleTogglePlayPause}
                aria-label={isPlaying ? 'Pause' : 'Play'}
                className="inline-flex h-9 min-w-[78px] items-center justify-center gap-1.5 px-3 rounded-xl bg-gradient-to-r from-violet-600 to-blue-500 text-xs font-bold text-white shadow-md shadow-violet-950/60 active:scale-95 transition-transform"
              >
                {isPlaying ? (
                  <>
                    <Pause className="w-3.5 h-3.5 fill-current" />
                    <span>Pause</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>Play</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleManualNext}
                aria-label="Next track"
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.05] text-slate-200 hover:text-white"
              >
                <SkipForward className="w-3.5 h-3.5 fill-current" />
              </button>

              <button
                type="button"
                onClick={onCycleRepeat}
                aria-label={`Repeat mode: ${repeatMode}`}
                className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
                  repeatMode !== 'off'
                    ? 'bg-blue-500/20 text-blue-300'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {repeatMode === 'one' ? (
                  <Repeat1 className="w-3.5 h-3.5" />
                ) : (
                  <Repeat className="w-3.5 h-3.5" />
                )}
              </button>

              <button
                type="button"
                onClick={() => onToggleFavorite(currentTrack.id)}
                aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
                  isFavorite
                    ? 'bg-violet-500/20 text-violet-300'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Heart className={`w-3.5 h-3.5 ${isFavorite ? 'fill-current' : ''}`} />
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Metadata-Only Rights Modal */}
      {embedTrack ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="embed-dialog-title"
        >
          <div className="w-full max-w-xl rounded-2xl bg-[#12121A] border border-white/10 overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.08]">
              <div className="min-w-0">
                <h3
                  id="embed-dialog-title"
                  className="font-display text-base font-semibold text-white truncate"
                >
                  {embedTrack.title}
                </h3>
                <p className="text-xs text-slate-400 truncate">
                  {embedTrack.artist} · {embedTrack.providerName}
                </p>
              </div>
              <button
                type="button"
                onClick={onCloseEmbed}
                aria-label="Close modal"
                className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-white/5"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="flex items-center gap-4 p-4 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg">
                  <ArtworkImage src={embedTrack.coverUrl} alt={embedTrack.title} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-white">{embedTrack.title}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{embedTrack.artist}</p>
                  <p className="text-xs text-blue-300 mt-1">{embedTrack.licenseType}</p>
                </div>
              </div>

              <p className="text-xs text-slate-400 leading-relaxed">
                {embedTrack.licenseSummary} GullyGroove respects all provider licensing boundaries and never downloads or bypasses DRM.
              </p>

              <div className="flex items-center justify-end gap-3 pt-1">
                <button
                  type="button"
                  onClick={onCloseEmbed}
                  className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-white rounded-lg border border-white/10 hover:bg-white/5"
                >
                  Close
                </button>
                {embedTrack.externalUrl ? (
                  <a
                    href={embedTrack.externalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white rounded-lg bg-gradient-to-r from-violet-600 to-blue-500 hover:opacity-95"
                  >
                    Open Official Source
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
