import {
  ChevronDown,
  Clock,
  ExternalLink,
  Heart,
  History,
  ListMusic,
  Loader2,
  Maximize2,
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
  getDefaultHookWindow,
  loadCustomHooks,
  saveCustomHooksMap,
  type HookRange,
} from '../utils/hookTiming';
import { ArtworkImage } from './ArtworkImage';
import { BoomboxEqRack } from './BoomboxEqRack';
import { StudioWaveformScrubber } from './StudioWaveformScrubber';

export type RepeatMode = 'off' | 'all' | 'one';
type ConsoleDrawerTab = 'queue' | 'recent' | null;

const CROSSFADE_TARGET_SEC = 8;
const YT_BUFFER_WATCHDOG_MS = 12000;

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
  const ytBufferingSinceRef = useRef<number | null>(null);
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
  const consecutiveYtErrorsRef = useRef(0);
  const userPausedRef = useRef(false);
  const prevIsPlayingRef = useRef(isPlaying);
  const lastVisibilityChangeMsRef = useRef(0);
  const lastMsPosSyncRef = useRef(0);
  const lastYtMsAssertRef = useRef(0);
  const keepAliveUnlockedRef = useRef(false);
  const deckUnlockedRef = useRef<[boolean, boolean]>([false, false]);

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [minimizedDrawerTab, setMinimizedDrawerTab] =
    useState<ConsoleDrawerTab>(null);
  const [consoleDrawerTab, setConsoleDrawerTab] = useState<ConsoleDrawerTab>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [ytDockMinimized, setYtDockMinimized] = useState(true);
  const [ytBuffering, setYtBuffering] = useState(false);
  const [ytSlotTracks, setYtSlotTracks] = useState<[Track | null, Track | null]>([
    null,
    null,
  ]);
  const [activeYtDeckIdx, setActiveYtDeckIdx] = useState<0 | 1>(0);
  const [visualCrossfadeYtIdx, setVisualCrossfadeYtIdx] = useState<0 | 1 | null>(null);
  const [crossfadeStatus, setCrossfadeStatus] = useState<CrossfadeStatus | null>(null);

  // Hook-based playback state (Auto-Cut Chorus Drop vs Full Song)
  const [hookMode, setHookMode] = useState(false);
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
  const hookModeRef = useRef(hookMode);
  hookModeRef.current = hookMode;
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
  const hasAnyYtDeck = Boolean(ytSlotTracks[0] || ytSlotTracks[1]);
  const displayedYtTrack =
    (visualCrossfadeYtIdx !== null ? ytSlotTracks[visualCrossfadeYtIdx] : null) ??
    ytSlotTracks[activeYtDeckIdx] ??
    ytSlotTracks[0] ??
    ytSlotTracks[1];
  const nextTrackPreview = currentTrack ? getNextTrack(currentTrack.id) : null;

  const effectiveDuration = duration || currentTrack?.durationSec || 218;
  const progressPct =
    effectiveDuration > 0 ? Math.min(100, (currentTime / effectiveDuration) * 100) : 0;

  const getHookForTrack = useCallback(
    (track: Track | null, durSec?: number): HookRange & { isCustom: boolean } => {
      if (!track) return { startSec: 20, endSec: 80, isCustom: false };
      const resolvedDur = durSec || track.durationSec || 218;
      const custom = customHooksRef.current[track.id];
      if (custom && custom.endSec > custom.startSec + 5 && custom.endSec <= resolvedDur + 1) {
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

  const activeHookWindow = useMemo(() => {
    if (!currentTrack) return { startSec: 20, endSec: 80, isCustom: false };
    const custom = customHooks[currentTrack.id];
    if (
      custom &&
      custom.endSec > custom.startSec + 5 &&
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
    hasAnyYtDeck,
    consoleDrawerTab,
    isDesktopViewport,
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
      const deck = getDeck(idx);
      if (deck) {
        deck.pause();
        deck.currentTime = 0;
        deck.removeAttribute('src');
        deck.load();
      }
      deckTrackIdRef.current[idx] = '';
      deckUrlRef.current[idx] = '';
    },
    [getDeck]
  );

  const setYtDeckVolume = useCallback((idx: 0 | 1, gain01: number) => {
    const player = ytPlayersRef.current[idx];
    if (!player || !ytReadyRef.current[idx]) return;
    try {
      if (mutedRef.current || volumeRef.current === 0) {
        player.mute();
      } else {
        player.unMute();
        player.setVolume(Math.max(0, Math.min(100, Math.round(gain01 * 100))));
      }
    } catch {
      // ignore transient calls
    }
  }, []);

  const cancelTransition = useCallback(
    (stopIncoming = true) => {
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
          outDeck.volume = mutedRef.current ? 0 : volumeRef.current;
        }
      } else {
        setYtDeckVolume(session.outgoingYtDeckIdx, volumeRef.current);
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
        inDeck.volume = mutedRef.current ? 0 : volumeRef.current;
        setCurrentTime(inDeck.currentTime || 0);
        if (Number.isFinite(inDeck.duration) && inDeck.duration > 0) {
          setDuration(inDeck.duration);
        } else {
          setDuration(session.toTrack.durationSec || 0);
        }
      }
      ytStartZeroRef.current = [false, false];
      setYtSlotTracks([null, null]);
    } else {
      const inYt = session.incomingYtDeckIdx;
      activeYtDeckIdxRef.current = inYt;
      setActiveYtDeckIdx(inYt);
      ytStartZeroRef.current[inYt] = false;
      setYtDeckVolume(inYt, volumeRef.current);

      const inPlayer = ytPlayersRef.current[inYt];
      if (inPlayer && ytReadyRef.current[inYt]) {
        try {
          const cur = inPlayer.getCurrentTime();
          const dur = inPlayer.getDuration();
          if (Number.isFinite(cur)) setCurrentTime(cur);
          if (Number.isFinite(dur) && dur > 0) setDuration(dur);
        } catch {
          // ignore
        }
      }

      if (session.outgoingKind === 'youtube') {
        const outYt = session.outgoingYtDeckIdx;
        ytStartZeroRef.current[outYt] = false;
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

    transitionLockFromIdRef.current = '';
    onCrossfadeCompleteRef.current(session.toTrack);
  }, [clearDeck, getDeck, setYtDeckVolume]);

  const applyFadeVolumes = useCallback(
    (session: TransitionSession, progress: number) => {
      const master = mutedRef.current ? 0 : volumeRef.current;
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
      }, 50);
    },
    [applyFadeVolumes, finishTransition]
  );

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

  const maybeStartCrossfade = useCallback(
    (curSec: number, durSec: number, sourceKind: 'audio' | 'youtube') => {
      const track = currentTrackRef.current;
      if (!track || !isPlayingRef.current) return;
      if (transitionRef.current) return;
      if (!Number.isFinite(durSec) || durSec <= 4) return;

      const hookWin = getHookForTrack(track, durSec);
      const effectiveEnd = hookModeRef.current
        ? Math.min(durSec, hookWin.endSec)
        : durSec;
      const remaining = effectiveEnd - curSec;

      if (repeatModeRef.current === 'one') {
        if (hookModeRef.current && remaining <= 0.25) {
          if (sourceKind === 'youtube') {
            ytPlayersRef.current[activeYtDeckIdxRef.current]?.seekTo(
              hookWin.startSec,
              true
            );
          } else {
            const deck = getDeck(activeDeckIdxRef.current);
            if (deck) deck.currentTime = hookWin.startSec;
          }
          setCurrentTime(hookWin.startSec);
        }
        return;
      }

      if (transitionLockFromIdRef.current === track.id) return;

      // If user sought past hook end in Hook Mode, advance cleanly
      if (hookModeRef.current && remaining <= 0.15) {
        transitionLockFromIdRef.current = track.id;
        onPlaybackEndedRef.current();
        return;
      }

      const triggerWindow = Math.min(
        CROSSFADE_TARGET_SEC,
        Math.max(2, effectiveEnd * 0.45)
      );
      if (remaining > triggerWindow || remaining <= 0.25) return;

      const next = getNextTrackRef.current(track.id);
      if (!next || next.id === track.id) return;

      const nextIsYt =
        next.playbackRights === 'embed-only' && Boolean(next.embedId);
      const incomingKind: 'audio' | 'youtube' = nextIsYt ? 'youtube' : 'audio';

      if (incomingKind === 'audio' && !next.streamUrl) return;

      const outgoingAudioDeckIdx = activeDeckIdxRef.current;
      const incomingAudioDeckIdx: 0 | 1 = outgoingAudioDeckIdx === 0 ? 1 : 0;

      const outgoingYtDeckIdx = activeYtDeckIdxRef.current;
      const incomingYtDeckIdx: 0 | 1 =
        sourceKind === 'youtube' ? (outgoingYtDeckIdx === 0 ? 1 : 0) : 0;

      const durationMs = Math.max(1500, Math.round(remaining * 1000));
      transitionLockFromIdRef.current = track.id;

      const nextStartSec = hookModeRef.current
        ? getHookForTrack(next, next.durationSec || 218).startSec
        : 0;

      if (incomingKind === 'audio') {
        const inDeck = getDeck(incomingAudioDeckIdx);
        if (!inDeck || !next.streamUrl) return;

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
          inDeck.currentTime = nextStartSec;
        } catch {
          // ignore if metadata not yet loaded
        }
        inDeck.volume = 0;
        inDeck.play().catch((err: unknown) => {
          const name = (err as { name?: string })?.name;
          if (name !== 'AbortError') {
            cancelTransition(true);
          }
        });
      } else {
        ytStartZeroRef.current[incomingYtDeckIdx] = true;
        if (sourceKind === 'audio') {
          activeYtDeckIdxRef.current = incomingYtDeckIdx;
          setActiveYtDeckIdx(incomingYtDeckIdx);
        }
        setYtSlotTracks((prev) => {
          const updated: [Track | null, Track | null] =
            sourceKind === 'youtube'
              ? ([...prev] as [Track | null, Track | null])
              : [null, null];
          updated[incomingYtDeckIdx] = next;
          return updated;
        });
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
        remainingSec: Math.ceil(durationMs / 1000),
      });
      startTransitionInterval(session);
    },
    [cancelTransition, getDeck, getHookForTrack, startTransitionInterval]
  );

  // Unified dual-deck HTML5 <audio> & YouTube handoff synchronization
  useEffect(() => {
    if (!currentTrack) {
      cancelTransition(true);
      clearDeck(0);
      clearDeck(1);
      ytStartZeroRef.current = [false, false];
      setYtSlotTracks([null, null]);
      setMinimizedDrawerTab(null);
      setConsoleDrawerTab(null);
      setCurrentTime(0);
      setDuration(0);
      return;
    }

    if (isCurrentYouTube) {
      const activeYt = activeYtDeckIdxRef.current;
      const alreadyActiveYt = ytDeckTrackIdRef.current[activeYt] === currentTrack.id;

      if (!alreadyActiveYt) {
        cancelTransition(true);
        clearDeck(0);
        clearDeck(1);
        transitionLockFromIdRef.current = '';
        setAudioError(null);
        const startSec = hookModeRef.current
          ? getHookForTrack(currentTrack, currentTrack.durationSec || 218).startSec
          : 0;
        setCurrentTime(startSec);
        setDuration(currentTrack.durationSec || 0);

        activeYtDeckIdxRef.current = 0;
        setActiveYtDeckIdx(0);
        ytStartZeroRef.current = [false, false];
        setYtSlotTracks([currentTrack, null]);
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
      clearDeck(idleIdx);
      ytStartZeroRef.current = [false, false];
      setYtSlotTracks([null, null]);
      transitionLockFromIdRef.current = '';

      deckTrackIdRef.current[activeIdx] = currentTrack.id;
      deckUrlRef.current[activeIdx] = resolvedUrl;
      setAudioError(null);
      const startSec = hookModeRef.current
        ? getHookForTrack(currentTrack, currentTrack.durationSec || 218).startSec
        : 0;
      pendingAudioHookSeekTrackIdRef.current = startSec > 0 ? currentTrack.id : '';
      setCurrentTime(startSec);
      setDuration(currentTrack.durationSec || 0);
      activeDeck.volume = mutedRef.current ? 0 : volumeRef.current;
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
    cancelTransition,
    clearDeck,
    getDeck,
    getHookForTrack,
  ]);

  // Sync YouTube Slot 0 and Slot 1 using persistent YT.Player instances + loadVideoById
  const ensureYtSlotSynced = useCallback(
    (slotIdx: 0 | 1, track: Track | null) => {
      ytDesiredTrackRef.current[slotIdx] = track;
      const existingPlayer = ytPlayersRef.current[slotIdx];

      if (!track || !track.embedId) {
        ytDeckTrackIdRef.current[slotIdx] = '';
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

      const startZero = ytStartZeroRef.current[slotIdx];
      const shouldAutoPlay = isPlayingRef.current || startZero;
      const hookStartSec = hookModeRef.current
        ? getHookForTrack(track, track.durationSec || 218).startSec
        : 0;

      // Fast path: persistent player already created & ready -> reuse via loadVideoById (no iframe rebuild!)
      if (existingPlayer && ytReadyRef.current[slotIdx]) {
        const sameTrack = ytDeckTrackIdRef.current[slotIdx] === track.id;
        ytDeckTrackIdRef.current[slotIdx] = track.id;
        ytBufferingSinceRef.current = null;
        if (!sameTrack) {
          ytEmbedRetryIdxRef.current[slotIdx] = 0;
        }

        if (startZero) {
          try {
            existingPlayer.unMute();
            existingPlayer.setVolume(0);
          } catch {
            // ignore
          }
        } else {
          setYtDeckVolume(slotIdx, volumeRef.current);
        }

        if (!sameTrack) {
          setYtBuffering(true);
          try {
            if (shouldAutoPlay && existingPlayer.loadVideoById) {
              existingPlayer.loadVideoById({
                videoId: track.embedId,
                startSeconds: hookStartSec,
              });
            } else if (!shouldAutoPlay && existingPlayer.cueVideoById) {
              existingPlayer.cueVideoById({
                videoId: track.embedId,
                startSeconds: hookStartSec,
              });
            } else {
              existingPlayer.loadVideoById?.({
                videoId: track.embedId,
                startSeconds: hookStartSec,
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
          try {
            existingPlayer.playVideo();
          } catch {
            // ignore
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
      setYtBuffering(true);

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
              if (!latestTrack || !latestTrack.embedId) {
                try {
                  event.target.pauseVideo();
                } catch {
                  // ignore
                }
                setYtBuffering(false);
                return;
              }

              const latestStartZero = ytStartZeroRef.current[slotIdx];
              const latestShouldPlay = isPlayingRef.current || latestStartZero;
              const latestHookStart = hookModeRef.current
                ? getHookForTrack(latestTrack, latestTrack.durationSec || 218).startSec
                : 0;

              if (latestStartZero) {
                event.target.unMute();
                event.target.setVolume(0);
              } else {
                setYtDeckVolume(slotIdx, volumeRef.current);
              }

              if (
                latestTrack.embedId !== initialVideoId &&
                event.target.loadVideoById
              ) {
                ytDeckTrackIdRef.current[slotIdx] = latestTrack.id;
                event.target.loadVideoById({
                  videoId: latestTrack.embedId,
                  startSeconds: latestHookStart,
                });
              } else if (latestHookStart > 0) {
                try {
                  event.target.seekTo(latestHookStart, true);
                } catch {
                  // ignore
                }
              }

              if (!latestStartZero && slotIdx === activeYtDeckIdxRef.current) {
                const ytDur = event.target.getDuration();
                if (Number.isFinite(ytDur) && ytDur > 0) {
                  setDuration(ytDur);
                }
              }

              if (latestShouldPlay) {
                event.target.playVideo();
                keepAliveAudioRef.current?.play().catch(() => {});
                syncMediaSessionRef.current();
              } else {
                setYtBuffering(false);
              }
            },
            onStateChange: (event) => {
              if (!ytDesiredTrackRef.current[slotIdx]) return;
              const UNSTARTED = window.YT?.PlayerState?.UNSTARTED ?? -1;
              const ENDED = window.YT?.PlayerState?.ENDED ?? 0;
              const PLAYING = window.YT?.PlayerState?.PLAYING ?? 1;
              const PAUSED = window.YT?.PlayerState?.PAUSED ?? 2;
              const BUFFERING = window.YT?.PlayerState?.BUFFERING ?? 3;

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

              if (event.data === BUFFERING || event.data === UNSTARTED) {
                if (slotIdx === activeYtDeckIdxRef.current && isPlayingRef.current) {
                  setYtBuffering(true);
                  if (ytBufferingSinceRef.current === null) {
                    ytBufferingSinceRef.current = Date.now();
                  }
                }
                return;
              }

              if (event.data === PLAYING) {
                consecutiveYtErrorsRef.current = 0;
                ytBufferingSinceRef.current = null;
                setYtBuffering(false);
                keepAliveAudioRef.current?.play().catch(() => {});
                if (!transitionRef.current && slotIdx === activeYtDeckIdxRef.current) {
                  const ytDur = event.target.getDuration();
                  if (Number.isFinite(ytDur) && ytDur > 0) {
                    setDuration(ytDur);
                  }
                  onSetPlayingStateRef.current(true);
                  syncMediaSessionRef.current();
                  window.setTimeout(() => syncMediaSessionRef.current(), 350);
                  window.setTimeout(() => syncMediaSessionRef.current(), 1200);
                }
              } else if (event.data === PAUSED) {
                ytBufferingSinceRef.current = null;
                setYtBuffering(false);
                const isBackgroundOrFocusLoss =
                  document.hidden ||
                  !document.hasFocus() ||
                  Date.now() - lastVisibilityChangeMsRef.current < 8000;
                if (
                  isBackgroundOrFocusLoss &&
                  !userPausedRef.current &&
                  isPlayingRef.current
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
                  slotIdx === activeYtDeckIdxRef.current
                ) {
                  userPausedRef.current = true;
                  onSetPlayingStateRef.current(false);
                }
              } else if (event.data === ENDED) {
                ytBufferingSinceRef.current = null;
                setYtBuffering(false);
                if (isOutgoingDuringFade) {
                  finishTransition();
                } else if (
                  !transitionRef.current &&
                  slotIdx === activeYtDeckIdxRef.current
                ) {
                  if (repeatModeRef.current === 'one') {
                    const desired = ytDesiredTrackRef.current[slotIdx];
                    const restartAt =
                      hookModeRef.current && desired
                        ? getHookForTrack(desired, desired.durationSec || 218).startSec
                        : 0;
                    event.target.seekTo(restartAt, true);
                    event.target.playVideo();
                  } else {
                    onPlaybackEndedRef.current();
                  }
                }
              }
            },
            onError: () => {
              ytBufferingSinceRef.current = null;
              setYtBuffering(false);
              const desiredTrack = ytDesiredTrackRef.current[slotIdx];
              if (!desiredTrack) return;

              const fallbacks = desiredTrack.fallbackEmbedIds || [];
              const nextRetryIdx = ytEmbedRetryIdxRef.current[slotIdx];
              if (nextRetryIdx < fallbacks.length) {
                const backupVideoId = fallbacks[nextRetryIdx];
                ytEmbedRetryIdxRef.current[slotIdx] = nextRetryIdx + 1;
                const player = ytPlayersRef.current[slotIdx];
                if (player && ytReadyRef.current[slotIdx] && backupVideoId) {
                  const hookStart = hookModeRef.current
                    ? getHookForTrack(desiredTrack, desiredTrack.durationSec || 218)
                        .startSec
                    : 0;
                  try {
                    setYtBuffering(true);
                    ytBufferingSinceRef.current = Date.now();
                    player.loadVideoById?.({
                      videoId: backupVideoId,
                      startSeconds: hookStart,
                    });
                    if (isPlayingRef.current || ytStartZeroRef.current[slotIdx]) {
                      player.playVideo();
                    }
                    return;
                  } catch {
                    // fall through to skip logic below
                  }
                }
              }

              if (slotIdx !== activeYtDeckIdxRef.current && transitionRef.current) {
                cancelTransition(true);
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
    [cancelTransition, finishTransition, getHookForTrack, setYtDeckVolume]
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

  // Sync Play/Pause across active and transitioning YouTube decks
  useEffect(() => {
    ([0, 1] as const).forEach((slotIdx) => {
      if (!ytSlotTracks[slotIdx]) return;
      const player = ytPlayersRef.current[slotIdx];
      if (!player || !ytReadyRef.current[slotIdx]) return;
      try {
        if (isPlaying) player.playVideo();
        else player.pauseVideo();
      } catch {
        // ignore
      }
    });
  }, [isPlaying, ytSlotTracks]);

  // Preload next direct-audio track onto idle deck
  useEffect(() => {
    if (!currentTrack || !isPlaying) return;
    const timer = window.setTimeout(() => {
      preloadIdleDeckForTrack(currentTrack);
    }, 600);
    return () => window.clearTimeout(timer);
  }, [currentTrack?.id, isPlaying, queue, preloadIdleDeckForTrack]);

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
  }, [isPlaying, currentTrack?.id, isCurrentYouTube, hasAnyYtDeck]);

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
    }, 100);
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
          !userPausedRef.current &&
          isPlayingRef.current &&
          (document.hidden || !document.hasFocus()) &&
          Date.now() - lastVisibilityChangeMsRef.current < 5000 &&
          ytState === 2
        ) {
          player.playVideo();
        }

        if (
          (ytState === -1 || ytState === 3) &&
          !transitionRef.current &&
          !userPausedRef.current
        ) {
          setYtBuffering(true);
          if (ytBufferingSinceRef.current === null) {
            ytBufferingSinceRef.current = Date.now();
          } else if (Date.now() - ytBufferingSinceRef.current > YT_BUFFER_WATCHDOG_MS) {
            ytBufferingSinceRef.current = null;
            setYtBuffering(false);
            setAudioError('YouTube stream stalled; skipping to next track...');
            onPlaybackEndedRef.current();
            return;
          }
        } else if (ytState === 1) {
          ytBufferingSinceRef.current = null;
          setYtBuffering(false);
        }

        const cur = player.getCurrentTime();
        const dur = player.getDuration();
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

        const nowAssert = Date.now();
        if (nowAssert - lastYtMsAssertRef.current >= 4000) {
          lastYtMsAssertRef.current = nowAssert;
          syncMediaSessionRef.current();
        }
      } catch {
        // ignore transient calls
      }
    }, 180);
  }, [isCurrentYouTube, isPlaying, maybeStartCrossfade]);

  // Background visibility & focus guard
  useEffect(() => {
    const resumeActivePlayback = () => {
      if (!isPlayingRef.current || userPausedRef.current) return;

      keepAliveAudioRef.current?.play().catch(() => {});

      if (currentTrackRef.current?.playbackRights === 'embed-only') {
        ([0, 1] as const).forEach((slotIdx) => {
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

  // Sync volume & mute to active deck
  useEffect(() => {
    if (transitionRef.current) {
      const s = transitionRef.current;
      const p = Math.min(1, s.elapsedMs / s.durationMs);
      applyFadeVolumes(s, p);
      return;
    }

    const activeDeck = getDeck(activeDeckIdxRef.current);
    if (activeDeck) {
      activeDeck.volume = muted ? 0 : volume;
    }

    setYtDeckVolume(activeYtDeckIdxRef.current, volume);
  }, [volume, muted, hasAnyYtDeck, applyFadeVolumes, getDeck, setYtDeckVolume]);

  // Cleanup crossfade ticker on unmount
  useEffect(() => {
    return () => {
      if (transitionRef.current?.stopTicker) {
        transitionRef.current.stopTicker();
      }
    };
  }, []);

  const handleSeek = useCallback(
    (nextSec: number) => {
      const dur = durationRef.current || currentTrackRef.current?.durationSec || 218;
      const clampedSec = Math.max(0, Math.min(dur, nextSec));
      const remainingAfterSeek = dur - clampedSec;
      if (remainingAfterSeek > CROSSFADE_TARGET_SEC + 0.5) {
        cancelTransition(true);
        transitionLockFromIdRef.current = '';
      }

      if (
        currentTrackRef.current?.playbackRights === 'embed-only' &&
        currentTrackRef.current.embedId
      ) {
        const activeSlot = activeYtDeckIdxRef.current;
        const player = ytPlayersRef.current[activeSlot];
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
    [cancelTransition, getDeck]
  );

  const handleSeekRef = useRef(handleSeek);
  handleSeekRef.current = handleSeek;

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
    }
    onPlayPause();
  }, [getDeck, onPlayPause]);

  const handleToggleHookMode = useCallback(() => {
    setHookMode((prev) => {
      const next = !prev;
      const track = currentTrackRef.current;
      if (next && track) {
        const dur = durationRef.current || track.durationSec || 218;
        const hook = getHookForTrack(track, dur);
        if (
          currentTimeRef.current < hook.startSec - 1 ||
          currentTimeRef.current >= hook.endSec - 2
        ) {
          handleSeekRef.current(hook.startSec);
        }
      }
      return next;
    });
  }, [getHookForTrack]);

  const handleUpdateHook = useCallback(
    (startSec: number, endSec: number) => {
      const track = currentTrackRef.current;
      if (!track) return;
      setCustomHooks((prev) => {
        const next = { ...prev, [track.id]: { startSec, endSec } };
        saveCustomHooksMap(next);
        return next;
      });
    },
    []
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
        userPausedRef.current = false;
        onNextRef.current();
      },
      onPrev: () => {
        userPausedRef.current = false;
        onPrevRef.current();
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
    if (
      hookModeRef.current &&
      track &&
      pendingAudioHookSeekTrackIdRef.current === track.id
    ) {
      pendingAudioHookSeekTrackIdRef.current = '';
      const hookStart = getHookForTrack(track, loadedDur || 218).startSec;
      try {
        deckEl.currentTime = hookStart;
        setCurrentTime(hookStart);
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
      const restartSec =
        hookModeRef.current && track
          ? getHookForTrack(track, activeDeck.duration || track.durationSec || 218)
              .startSec
          : 0;
      activeDeck.currentTime = restartSec;
      activeDeck.play().catch(() => {});
      return;
    }

    onPlaybackEndedRef.current();
  };

  const handleDeckError = (deckIdx: 0 | 1) => {
    if (!deckTrackIdRef.current[deckIdx]) return;
    if (deckIdx !== activeDeckIdxRef.current) return;
    if (currentTrackRef.current?.streamUrl && !isCurrentYouTube) {
      setAudioError('Stream unavailable; skipping to next track...');
      onPlaybackEndedRef.current();
    }
  };

  const handleDeckPause = (deckIdx: 0 | 1, deckEl: HTMLAudioElement) => {
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
    currentTrack && hasAnyYtDeck && studioConsoleOpen && stageRect
  );
  const ytFloatingCorner = Boolean(
    currentTrack && hasAnyYtDeck && !studioConsoleOpen && !ytDockMinimized
  );

  return (
    <>
      {/* Dual Audio Decks for True 8-Second Preloaded Overlap & Gapless Crossfade */}
      <audio
        ref={deck0Ref}
        preload="auto"
        playsInline
        onTimeUpdate={(e) => handleDeckTimeUpdate(0, e.currentTarget)}
        onLoadedMetadata={(e) => handleDeckLoadedMetadata(0, e.currentTarget)}
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
                    : ytBuffering
                      ? 'Loading Stream'
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
          className={`relative w-full bg-[#07070B] overflow-hidden ${
            ytDockedInsideConsole ? 'h-full' : 'aspect-video'
          }`}
        >
          {displayedYtTrack ? (
            <div className="absolute inset-0 z-0">
              <ArtworkImage
                src={displayedYtTrack.coverUrl}
                alt={displayedYtTrack.title}
                className="w-full h-full object-cover opacity-55"
              />
            </div>
          ) : null}

          <div
            ref={ytHost0Ref}
            className={`absolute inset-0 w-full h-full transition-opacity duration-700 ${
              (visualCrossfadeYtIdx ?? activeYtDeckIdx) === 0
                ? 'opacity-100 z-[2]'
                : 'opacity-0 z-[1] pointer-events-none'
            }`}
          />
          <div
            ref={ytHost1Ref}
            className={`absolute inset-0 w-full h-full transition-opacity duration-700 ${
              (visualCrossfadeYtIdx ?? activeYtDeckIdx) === 1
                ? 'opacity-100 z-[2]'
                : 'opacity-0 z-[1] pointer-events-none'
            }`}
          />

          {isCurrentYouTube && isPlaying && ytBuffering ? (
            <div className="absolute inset-0 z-[15] flex flex-col items-center justify-center gap-2 bg-black/55 backdrop-blur-[2px] pointer-events-none">
              <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
              <span className="text-[11px] font-medium text-slate-200">
                Loading stream...
              </span>
            </div>
          ) : null}

          {/* Transparent Click Shield (tap to Play/Pause) with Bottom-Right Skip-Ad Passthrough Cutout */}
          {currentTrack && hasAnyYtDeck ? (
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

      {/* BAJAO-INSPIRED CENTER STUDIO MUSIC PLAYER CONSOLE (Midnight Violet-Blue Theme) */}
      {currentTrack && studioConsoleOpen ? (
        <div
          ref={consoleScrollRef}
          role="dialog"
          aria-modal="true"
          aria-label="GullyGroove Studio Player"
          className="fixed inset-0 z-50 flex items-start justify-center bg-[#06060B]/88 backdrop-blur-2xl p-2 sm:p-5 overflow-y-auto"
        >
          <div
            className={`w-full flex flex-col lg:flex-row items-stretch justify-center gap-4 my-auto transition-all duration-200 ${
              consoleDrawerTab !== null ? 'max-w-5xl' : 'max-w-2xl xl:max-w-3xl'
            }`}
          >
            {/* Main Boombox Center Stage Console */}
            <section className="flex-1 min-w-0 rounded-3xl bg-gradient-to-b from-[#131320] via-[#0E0E17] to-[#090910] border border-violet-500/25 shadow-[0_32px_100px_-20px_rgba(124,58,237,0.48)] overflow-hidden">
              {/* Top Console Status & Window Controls */}
              <div className="flex items-center justify-between gap-2 px-4 sm:px-5 py-3 border-b border-white/[0.08] bg-gradient-to-r from-violet-950/35 via-[#12121D] to-blue-950/25">
                <div className="min-w-0 flex items-center gap-2 text-xs">
                  <span className="font-semibold text-blue-300 truncate">
                    {crossfadeStatus
                      ? `Crossfading · ${crossfadeStatus.remainingSec}s`
                      : hookMode
                        ? 'Auto-Cut Hook Mode'
                        : isPlaying
                          ? 'Now Playing'
                          : 'Paused'}
                  </span>
                  <span aria-hidden="true" className="text-slate-600">
                    ·
                  </span>
                  <span className="text-slate-400 truncate">
                    {currentTrack.album}
                  </span>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() =>
                      setConsoleDrawerTab((prev) => (prev === 'queue' ? null : 'queue'))
                    }
                    aria-label="Toggle playlist queue"
                    className={`inline-flex h-9 items-center gap-1.5 px-3 rounded-xl text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                      consoleDrawerTab === 'queue'
                        ? 'bg-gradient-to-r from-violet-600/35 to-blue-500/30 text-white border border-violet-400/40'
                        : 'text-slate-300 hover:text-white hover:bg-white/[0.06]'
                    }`}
                  >
                    <ListMusic className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Queue</span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setConsoleDrawerTab((prev) =>
                        prev === 'recent' ? null : 'recent'
                      )
                    }
                    aria-label="Toggle recently played"
                    className={`inline-flex h-9 items-center gap-1.5 px-3 rounded-xl text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                      consoleDrawerTab === 'recent'
                        ? 'bg-gradient-to-r from-violet-600/35 to-blue-500/30 text-white border border-violet-400/40'
                        : 'text-slate-300 hover:text-white hover:bg-white/[0.06]'
                    }`}
                  >
                    <History className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Recent</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setYtDockMinimized(true);
                      onSetStudioConsoleOpen(false);
                    }}
                    aria-label="Minimize to bottom player"
                    title="Minimize to bottom player"
                    className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-300 hover:text-white hover:bg-white/[0.07] transition-colors"
                  >
                    <ChevronDown className="w-4 h-4" />
                  </button>

                  {onClosePlayer ? (
                    <button
                      type="button"
                      onClick={() => {
                        userPausedRef.current = true;
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

              {/* Center Boombox Stage + Track Info + Waveform + Transport (ALWAYS visible even when Queue/Recent is open) */}
              <div className="p-3 sm:p-5 space-y-4">
                  {/* Boombox Frame: Left EQ + Center Video/Artwork Stage + Right EQ */}
                  <div className="flex items-stretch gap-1.5 sm:gap-3.5 rounded-2xl bg-[#0B0B13] border border-white/[0.07] p-1.5 sm:p-3">
                    <BoomboxEqRack side="left" isPlaying={isPlaying} />

                    {/* Center Stage Slot (YouTube IFrame docks directly over this box!) */}
                    <div className="flex-1 min-w-0 flex flex-col gap-2">
                      <div
                        ref={stageSlotRef}
                        className="relative aspect-video w-full rounded-xl overflow-hidden bg-[#07070B] border border-violet-500/25 shadow-[0_0_40px_-14px_rgba(124,58,237,0.5)]"
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
                              className="absolute inset-0 w-full h-full object-cover opacity-35 blur-md scale-110"
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-[#09090D] via-[#09090D]/55 to-transparent" />
                            <div className="relative z-10 flex items-center gap-4 px-4">
                              <div className="h-24 w-24 sm:h-32 sm:w-32 shrink-0 overflow-hidden rounded-2xl border border-white/15 shadow-2xl">
                                <ArtworkImage
                                  src={currentTrack.coverUrl}
                                  alt={currentTrack.title}
                                />
                              </div>
                            </div>
                          </button>
                        ) : null}
                      </div>

                      {/* Next-Up Preview Strip Inside Boombox */}
                      {nextTrackPreview ? (
                        <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.05] text-[11px]">
                          <div className="min-w-0 flex items-center gap-2">
                            <span className="font-mono-tabular font-semibold text-violet-300 shrink-0">
                              NEXT
                            </span>
                            <span className="text-slate-200 font-medium truncate">
                              {nextTrackPreview.title}
                            </span>
                            <span aria-hidden="true" className="text-slate-600">
                              ·
                            </span>
                            <span className="text-slate-400 truncate hidden sm:inline">
                              {nextTrackPreview.artist}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={onNext}
                            className="text-blue-400 hover:text-blue-300 font-medium whitespace-nowrap shrink-0"
                          >
                            Skip
                          </button>
                        </div>
                      ) : null}
                    </div>

                    <BoomboxEqRack side="right" isPlaying={isPlaying} />
                  </div>

                  {/* Song Thumbnail, Title, Artist Information & Actions */}
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-[#141422]">
                        <ArtworkImage
                          src={currentTrack.coverUrl}
                          alt={currentTrack.title}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h2 className="font-display text-base sm:text-lg font-bold text-white truncate">
                          {currentTrack.title}
                        </h2>
                        <p className="text-xs text-slate-300 truncate mt-0.5">
                          {currentTrack.artist}
                        </p>
                        <p className="text-[11px] text-slate-400 truncate mt-0.5 font-mono-tabular">
                          {currentTrack.language}
                          <span className="mx-1.5 text-slate-600" aria-hidden="true">
                            ·
                          </span>
                          {currentTrack.bpm} BPM
                          <span className="mx-1.5 text-slate-600" aria-hidden="true">
                            ·
                          </span>
                          <span className="text-blue-400 font-sans">
                            {currentTrack.licenseType}
                          </span>
                        </p>
                        {audioError ? (
                          <p className="text-[11px] text-amber-400 truncate mt-0.5">
                            {audioError}
                          </p>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => onToggleFavorite(currentTrack.id)}
                        aria-label={
                          isFavorite ? 'Remove from favorites' : 'Add to favorites'
                        }
                        className={`flex h-10 w-10 items-center justify-center rounded-xl border transition-colors ${
                          isFavorite
                            ? 'bg-violet-500/20 border-violet-400/40 text-violet-300'
                            : 'bg-white/[0.04] border-white/[0.08] text-slate-400 hover:text-white'
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
                          aria-label="Open on YouTube"
                          title="Open original source"
                          className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.04] border border-white/[0.08] text-slate-400 hover:text-white transition-colors"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      ) : null}
                    </div>
                  </div>

                  {/* Interactive Bajao-Inspired Beat-Reactive Waveform & Hook Scrubber */}
                  <StudioWaveformScrubber
                    trackId={currentTrack.id}
                    currentTime={currentTime}
                    duration={effectiveDuration}
                    isPlaying={isPlaying}
                    bpm={currentTrack.bpm}
                    hookMode={hookMode}
                    hookStartSec={activeHookWindow.startSec}
                    hookEndSec={activeHookWindow.endSec}
                    hasCustomHook={activeHookWindow.isCustom}
                    onSeek={handleSeek}
                    onUpdateHook={handleUpdateHook}
                    onResetHook={handleResetHook}
                  />

                  {/* Main Transport Deck: Hook Mode, Shuffle, Prev, Play/Pause, Next, Repeat */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    {/* Left: Compact Dual-State Sliding Toggle (Full <-> Hook) */}
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
                      className={`group relative mx-auto sm:mx-0 inline-flex h-8 items-center rounded-xl p-[3px] bg-[#06060C] border transition-all duration-200 shadow-[inset_0_2px_6px_rgba(0,0,0,0.85)] shrink-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet-400 ${
                        hookMode
                          ? 'border-violet-400/50 shadow-[inset_0_2px_6px_rgba(0,0,0,0.85),0_0_16px_-4px_rgba(139,92,246,0.55)]'
                          : 'border-white/[0.11] hover:border-violet-400/35'
                      }`}
                    >
                      <span className="relative grid grid-cols-2 items-center">
                        <span
                          aria-hidden="true"
                          className={`pointer-events-none absolute inset-y-0 left-0 w-1/2 rounded-lg transition-all duration-200 ease-out ${
                            hookMode
                              ? 'translate-x-full bg-gradient-to-r from-violet-600 to-blue-500 border border-violet-300/40 shadow-[0_0_12px_rgba(139,92,246,0.55)]'
                              : 'translate-x-0 bg-white/[0.13] border border-white/[0.18] shadow-sm'
                          }`}
                        />
                        <span
                          className={`relative z-10 inline-flex items-center justify-center gap-1 px-2.5 py-1 text-[11px] font-semibold tracking-tight whitespace-nowrap transition-colors duration-200 ${
                            !hookMode ? 'text-white' : 'text-slate-400 group-hover:text-slate-200'
                          }`}
                        >
                          <span
                            aria-hidden="true"
                            className={`h-1.5 w-1.5 rounded-full transition-colors ${
                              !hookMode ? 'bg-blue-400 shadow-[0_0_6px_rgba(96,165,250,0.9)]' : 'bg-slate-600'
                            }`}
                          />
                          <span>Full</span>
                        </span>
                        <span
                          className={`relative z-10 inline-flex items-center justify-center gap-1 px-2.5 py-1 text-[11px] font-semibold tracking-tight whitespace-nowrap transition-colors duration-200 ${
                            hookMode ? 'text-white' : 'text-slate-400 group-hover:text-slate-200'
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

                    {/* Center: Transport Controls */}
                    <div className="flex items-center gap-1.5 sm:gap-2.5 mx-auto">
                      <button
                        type="button"
                        onClick={onToggleShuffle}
                        aria-label="Toggle shuffle"
                        aria-pressed={shuffle}
                        className={`flex h-11 w-11 items-center justify-center rounded-xl transition-colors ${
                          shuffle
                            ? 'bg-violet-500/20 text-violet-300'
                            : 'text-slate-400 hover:text-white hover:bg-white/[0.05]'
                        }`}
                      >
                        <Shuffle className="w-4 h-4" />
                      </button>

                      <button
                        type="button"
                        onClick={onPrev}
                        aria-label="Previous track"
                        className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/[0.05] text-slate-200 hover:text-white hover:bg-white/[0.1] transition-colors"
                      >
                        <SkipBack className="w-4 h-4 fill-current" />
                      </button>

                      <button
                        type="button"
                        onClick={handleTogglePlayPause}
                        aria-label={isPlaying ? 'Pause' : 'Play'}
                        className="inline-flex h-12 min-w-[116px] sm:min-w-[136px] items-center justify-center gap-2 px-5 rounded-2xl bg-gradient-to-r from-violet-600 to-blue-500 text-sm font-bold text-white shadow-lg shadow-violet-950/60 hover:opacity-95 active:scale-[0.98] transition-all whitespace-nowrap shrink-0"
                      >
                        {isPlaying ? (
                          <>
                            <Pause className="w-4 h-4 fill-current" />
                            <span>Pause</span>
                          </>
                        ) : (
                          <>
                            <Play className="w-4 h-4 fill-current" />
                            <span>Play</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={onNext}
                        aria-label="Next track"
                        className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/[0.05] text-slate-200 hover:text-white hover:bg-white/[0.1] transition-colors"
                      >
                        <SkipForward className="w-4 h-4 fill-current" />
                      </button>

                      <button
                        type="button"
                        onClick={onCycleRepeat}
                        aria-label={`Repeat mode: ${repeatMode}`}
                        className={`flex h-11 w-11 items-center justify-center rounded-xl transition-colors ${
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

                    {/* Right: Volume Control (Desktop only) */}
                    <div className="hidden lg:flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setMuted((prev) => !prev)}
                        aria-label={muted ? 'Unmute audio' : 'Mute audio'}
                        className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.04] border border-white/[0.08] text-slate-300 hover:text-white transition-colors"
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
                        className="gg-range w-20 sm:w-24"
                        style={{
                          background: `linear-gradient(to right, #8B5CF6 0%, #3B82F6 ${
                            (muted ? 0 : volume) * 100
                          }%, rgba(255,255,255,0.14) ${
                            (muted ? 0 : volume) * 100
                          }%, rgba(255,255,255,0.14) 100%)`,
                          borderRadius: '9999px',
                          height: '4px',
                        }}
                      />
                    </div>
                  </div>

                  {/* Bottom Studio Strip: Missing Song Request + Quick Queue / Recent Counts */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-white/[0.07] text-xs">
                    <div className="flex items-center gap-2 text-slate-400 font-mono-tabular">
                      <button
                        type="button"
                        onClick={() =>
                          setConsoleDrawerTab((prev) =>
                            prev === 'queue' ? null : 'queue'
                          )
                        }
                        className="hover:text-white transition-colors"
                      >
                        Queue: {queue.length}
                      </button>
                      <span aria-hidden="true" className="text-slate-600">
                        ·
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setConsoleDrawerTab((prev) =>
                            prev === 'recent' ? null : 'recent'
                          )
                        }
                        className="hover:text-white transition-colors"
                      >
                        Recent: {recentlyPlayed.length}
                      </button>
                    </div>

                  {onOpenTuneRequest ? (
                      <button
                        type="button"
                        onClick={onOpenTuneRequest}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-300 hover:text-white transition-colors whitespace-nowrap shrink-0"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Song missing? Tune Request</span>
                      </button>
                    ) : null}
                  </div>
                </div>

              {/* Mobile & Narrow Inline Queue / Recently Played Drawer (rendered BELOW stage & controls so player never disappears!) */}
              {consoleDrawerTab !== null && !isDesktopViewport ? (
                <div className="border-t border-violet-500/20 bg-[#0A0A12]/95 p-3 sm:p-4 space-y-2.5">
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
                            <span className="text-[11px] font-mono-tabular text-slate-500">
                              {item.durationSec > 0
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
                className="w-80 xl:w-88 shrink-0 rounded-3xl bg-[#10101A]/95 border border-violet-500/20 shadow-2xl flex flex-col max-h-[640px] overflow-hidden"
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
                          <span className="text-[11px] font-mono-tabular text-slate-500">
                            {item.durationSec > 0
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
              <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-[#181822] border border-violet-500/30 shadow-md shadow-violet-950/50">
                <ArtworkImage src={currentTrack.coverUrl} alt={currentTrack.title} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-display text-sm font-semibold text-white truncate group-hover:text-violet-300 transition-colors">
                  {currentTrack.title}
                </p>
                <p className="text-xs text-slate-400 truncate mt-0.5">
                  {currentTrack.artist}
                  <span className="mx-1.5 text-slate-600" aria-hidden="true">
                    ·
                  </span>
                  <span className="text-blue-400">
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
                className={`group relative inline-flex h-8 items-center rounded-xl p-[2.5px] bg-[#06060C] border transition-all duration-200 shadow-[inset_0_1px_5px_rgba(0,0,0,0.85)] shrink-0 ${
                  hookMode
                    ? 'border-violet-400/50 shadow-[inset_0_1px_5px_rgba(0,0,0,0.85),0_0_12px_-3px_rgba(139,92,246,0.5)]'
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
                onClick={onPrev}
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
                onClick={onNext}
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
                  background: `linear-gradient(to right, #8B5CF6 0%, #3B82F6 ${progressPct}%, rgba(255,255,255,0.12) ${progressPct}%, rgba(255,255,255,0.12) 100%)`,
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

            {hasAnyYtDeck ? (
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
                }%, rgba(255,255,255,0.12) ${(muted ? 0 : volume) * 100}%, rgba(255,255,255,0.12) 100%)`,
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
                className="flex flex-1 min-w-0 items-center gap-2.5 text-left focus-visible:outline-none"
                aria-label="Open Studio Player"
              >
                <div className="h-9 w-9 shrink-0 overflow-hidden rounded-xl border border-violet-500/30 bg-[#181822]">
                  <ArtworkImage src={currentTrack.coverUrl} alt={currentTrack.title} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-display text-xs font-semibold text-white truncate">
                    {currentTrack.title}
                  </p>
                  <p className="text-[11px] text-slate-400 truncate">
                    {crossfadeStatus
                      ? `Crossfading · ${crossfadeStatus.remainingSec}s`
                      : hookMode
                        ? `${currentTrack.artist} · Hook`
                        : currentTrack.artist}
                  </p>
                </div>
              </button>

              <div className="flex items-center gap-1 shrink-0">
                {hasAnyYtDeck ? (
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
                  background: `linear-gradient(to right, #8B5CF6 0%, #3B82F6 ${progressPct}%, rgba(255,255,255,0.14) ${progressPct}%, rgba(255,255,255,0.14) 100%)`,
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
                className={`inline-flex h-8 items-center gap-1 px-1.5 rounded-xl bg-[#06060C] border transition-all duration-200 shadow-[inset_0_1px_4px_rgba(0,0,0,0.85)] shrink-0 ${
                  hookMode
                    ? 'border-violet-400/50 text-violet-200 shadow-[inset_0_1px_4px_rgba(0,0,0,0.85),0_0_10px_-2px_rgba(139,92,246,0.5)]'
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
                onClick={onPrev}
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
                onClick={onNext}
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
