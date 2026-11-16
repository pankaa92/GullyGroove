import {
  ChevronDown,
  ExternalLink,
  Heart,
  ListMusic,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Track } from '../types/music';
import { formatDuration } from '../utils/format';
import { ArtworkImage } from './ArtworkImage';

export type RepeatMode = 'off' | 'all' | 'one';

const CROSSFADE_TARGET_SEC = 8;

interface YTPlayerInstance {
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead?: boolean) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
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
    ENDED: number;
    PLAYING: number;
    PAUSED: number;
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
  timerId: number | null;
}

interface CrossfadeStatus {
  nextTitle: string;
  remainingSec: number;
}

interface PlayerBarProps {
  currentTrack: Track | null;
  queue: Track[];
  isPlaying: boolean;
  shuffle: boolean;
  repeatMode: RepeatMode;
  isFavorite: boolean;
  embedTrack: Track | null;
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
  onPlaybackEnded: () => void;
  onSetPlayingState: (playing: boolean) => void;
}

export function PlayerBar({
  currentTrack,
  queue,
  isPlaying,
  shuffle,
  repeatMode,
  isFavorite,
  embedTrack,
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
  onPlaybackEnded,
  onSetPlayingState,
}: PlayerBarProps) {
  // Dual HTML5 Audio Decks
  const deck0Ref = useRef<HTMLAudioElement | null>(null);
  const deck1Ref = useRef<HTMLAudioElement | null>(null);
  const activeDeckIdxRef = useRef<0 | 1>(0);
  const deckTrackIdRef = useRef<[string, string]>(['', '']);
  const deckUrlRef = useRef<[string, string]>(['', '']);

  // Dual YouTube IFrame Decks (enables full 8s crossfade for YouTube->YouTube as well)
  const ytHost0Ref = useRef<HTMLDivElement | null>(null);
  const ytHost1Ref = useRef<HTMLDivElement | null>(null);
  const ytPlayersRef = useRef<[YTPlayerInstance | null, YTPlayerInstance | null]>([null, null]);
  const ytReadyRef = useRef<[boolean, boolean]>([false, false]);
  const ytDeckTrackIdRef = useRef<[string, string]>(['', '']);
  const activeYtDeckIdxRef = useRef<0 | 1>(0);
  const ytStartZeroRef = useRef<[boolean, boolean]>([false, false]);

  const transitionRef = useRef<TransitionSession | null>(null);
  const transitionLockFromIdRef = useRef<string>('');
  const consecutiveYtErrorsRef = useRef(0);

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.82);
  const [muted, setMuted] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [mobileExpanded, setMobileExpanded] = useState(false);
  const [mobileQueueOpen, setMobileQueueOpen] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [ytDockMinimized, setYtDockMinimized] = useState(false);
  const [ytSlotTracks, setYtSlotTracks] = useState<[Track | null, Track | null]>([null, null]);
  const [activeYtDeckIdx, setActiveYtDeckIdx] = useState<0 | 1>(0);
  const [visualCrossfadeYtIdx, setVisualCrossfadeYtIdx] = useState<0 | 1 | null>(null);
  const [crossfadeStatus, setCrossfadeStatus] = useState<CrossfadeStatus | null>(null);

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
  const getNextTrackRef = useRef(getNextTrack);
  getNextTrackRef.current = getNextTrack;
  const onCrossfadeCompleteRef = useRef(onCrossfadeComplete);
  onCrossfadeCompleteRef.current = onCrossfadeComplete;
  const onPlaybackEndedRef = useRef(onPlaybackEnded);
  onPlaybackEndedRef.current = onPlaybackEnded;
  const onSetPlayingStateRef = useRef(onSetPlayingState);
  onSetPlayingStateRef.current = onSetPlayingState;

  const isCurrentYouTube =
    currentTrack?.playbackRights === 'embed-only' && Boolean(currentTrack.embedId);
  const hasAnyYtDeck = Boolean(ytSlotTracks[0] || ytSlotTracks[1]);
  const displayedYtTrack =
    (visualCrossfadeYtIdx !== null ? ytSlotTracks[visualCrossfadeYtIdx] : null) ??
    ytSlotTracks[activeYtDeckIdx] ??
    ytSlotTracks[0] ??
    ytSlotTracks[1];

  // Warm YouTube IFrame API once on mount so YouTube crossfades start instantaneously
  useEffect(() => {
    loadYouTubeIframeApi().catch(() => {});
  }, []);

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

      if (session.timerId !== null) {
        window.clearInterval(session.timerId);
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
            const next: [Track | null, Track | null] = [...prev] as [Track | null, Track | null];
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

    if (session.timerId !== null) {
      window.clearInterval(session.timerId);
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
      // Clear all YouTube slots when transitioning into an Audio track
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

      // Remove outgoing YouTube slot if we came from YouTube->YouTube
      if (session.outgoingKind === 'youtube') {
        const outYt = session.outgoingYtDeckIdx;
        ytStartZeroRef.current[outYt] = false;
        setYtSlotTracks((prev) => {
          const next: [Track | null, Track | null] = [...prev] as [Track | null, Track | null];
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
      // Equal-power crossfade curve prevents any volume dip or spike during the 8s overlap
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
      if (session.timerId !== null) {
        window.clearInterval(session.timerId);
      }
      session.lastTickMs = performance.now();

      session.timerId = window.setInterval(() => {
        const activeSession = transitionRef.current;
        if (!activeSession || activeSession !== session) return;
        if (!isPlayingRef.current) {
          activeSession.lastTickMs = performance.now();
          return;
        }

        const now = performance.now();
        activeSession.elapsedMs += Math.max(0, now - activeSession.lastTickMs);
        activeSession.lastTickMs = now;

        const progress = Math.min(1, activeSession.elapsedMs / activeSession.durationMs);
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
      if (repeatModeRef.current === 'one') return;
      if (!Number.isFinite(durSec) || durSec <= 4) return;
      if (transitionLockFromIdRef.current === track.id) return;

      const triggerWindow = Math.min(
        CROSSFADE_TARGET_SEC,
        Math.max(2, durSec * 0.45)
      );
      const remaining = durSec - curSec;
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

        inDeck.currentTime = 0;
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
            sourceKind === 'youtube' ? [...prev] as [Track | null, Track | null] : [null, null];
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
        timerId: null,
      };

      transitionRef.current = session;
      setCrossfadeStatus({
        nextTitle: next.title,
        remainingSec: Math.ceil(durationMs / 1000),
      });
      startTransitionInterval(session);
    },
    [cancelTransition, getDeck, startTransitionInterval]
  );

  // Reset YouTube dock visibility whenever a new YouTube track starts
  useEffect(() => {
    if (hasAnyYtDeck && isPlaying) {
      setYtDockMinimized(false);
    }
  }, [currentTrack?.id, hasAnyYtDeck, isPlaying]);

  // Unified dual-deck HTML5 <audio> & YouTube handoff synchronization
  useEffect(() => {
    if (!currentTrack) {
      cancelTransition(true);
      clearDeck(0);
      clearDeck(1);
      ytStartZeroRef.current = [false, false];
      setYtSlotTracks([null, null]);
      setCurrentTime(0);
      setDuration(0);
      return;
    }

    if (isCurrentYouTube) {
      const activeYt = activeYtDeckIdxRef.current;
      const alreadyActiveYt = ytDeckTrackIdRef.current[activeYt] === currentTrack.id;

      if (!alreadyActiveYt) {
        // User manually switched to a YouTube track
        cancelTransition(true);
        clearDeck(0);
        clearDeck(1);
        transitionLockFromIdRef.current = '';
        setAudioError(null);
        setCurrentTime(0);
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
      setCurrentTime(0);
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
  ]);

  // Mount & manage YouTube Slot 0 and Slot 1 independently for seamless YouTube->YouTube crossfade
  const mountYtSlot = useCallback(
    (slotIdx: 0 | 1, track: Track | null) => {
      const hostEl = slotIdx === 0 ? ytHost0Ref.current : ytHost1Ref.current;
      if (!track || !track.embedId) {
        ytReadyRef.current[slotIdx] = false;
        ytDeckTrackIdRef.current[slotIdx] = '';
        if (ytPlayersRef.current[slotIdx]) {
          try {
            ytPlayersRef.current[slotIdx]?.destroy();
          } catch {
            // ignore
          }
          ytPlayersRef.current[slotIdx] = null;
        }
        hostEl?.replaceChildren();
        return () => {};
      }

      let cancelled = false;
      const videoId = track.embedId;
      const startZero = ytStartZeroRef.current[slotIdx];
      ytReadyRef.current[slotIdx] = false;
      ytDeckTrackIdRef.current[slotIdx] = track.id;

      loadYouTubeIframeApi().then(() => {
        const currentHost = slotIdx === 0 ? ytHost0Ref.current : ytHost1Ref.current;
        if (cancelled || !currentHost || !window.YT?.Player) return;

        const mountEl = document.createElement('div');
        currentHost.replaceChildren(mountEl);

        const player = new window.YT.Player(mountEl, {
          videoId,
          width: '100%',
          height: '100%',
          playerVars: {
            autoplay: isPlayingRef.current || startZero ? 1 : 0,
            playsinline: 1,
            rel: 0,
            modestbranding: 1,
            enablejsapi: 1,
            origin: window.location.origin,
          },
          events: {
            onReady: (event) => {
              if (cancelled) return;
              ytReadyRef.current[slotIdx] = true;
              ytPlayersRef.current[slotIdx] = event.target;
              consecutiveYtErrorsRef.current = 0;

              if (startZero) {
                event.target.unMute();
                event.target.setVolume(0);
              } else {
                setYtDeckVolume(slotIdx, volumeRef.current);
              }

              if (!startZero && slotIdx === activeYtDeckIdxRef.current) {
                const ytDur = event.target.getDuration();
                if (Number.isFinite(ytDur) && ytDur > 0) {
                  setDuration(ytDur);
                }
              }

              if (isPlayingRef.current || startZero) {
                event.target.playVideo();
              }
            },
            onStateChange: (event) => {
              if (cancelled) return;
              const ENDED = window.YT?.PlayerState?.ENDED ?? 0;
              const PLAYING = window.YT?.PlayerState?.PLAYING ?? 1;
              const PAUSED = window.YT?.PlayerState?.PAUSED ?? 2;

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

              if (event.data === PLAYING) {
                consecutiveYtErrorsRef.current = 0;
                if (!transitionRef.current && slotIdx === activeYtDeckIdxRef.current) {
                  const ytDur = event.target.getDuration();
                  if (Number.isFinite(ytDur) && ytDur > 0) {
                    setDuration(ytDur);
                  }
                  onSetPlayingStateRef.current(true);
                }
              } else if (event.data === PAUSED) {
                if (
                  !transitionRef.current &&
                  !isIncomingDuringFade &&
                  slotIdx === activeYtDeckIdxRef.current
                ) {
                  onSetPlayingStateRef.current(false);
                }
              } else if (event.data === ENDED) {
                if (isOutgoingDuringFade) {
                  finishTransition();
                } else if (
                  !transitionRef.current &&
                  slotIdx === activeYtDeckIdxRef.current
                ) {
                  if (repeatModeRef.current === 'one') {
                    event.target.seekTo(0, true);
                    event.target.playVideo();
                  } else {
                    onPlaybackEndedRef.current();
                  }
                }
              }
            },
            onError: () => {
              if (cancelled) return;
              if (slotIdx !== activeYtDeckIdxRef.current && transitionRef.current) {
                cancelTransition(true);
                return;
              }
              consecutiveYtErrorsRef.current += 1;
              if (consecutiveYtErrorsRef.current <= 2) {
                setAudioError('YouTube track unavailable here; skipping to next track...');
                onPlaybackEndedRef.current();
              } else {
                setAudioError('YouTube embed could not start. Please try another track.');
                onSetPlayingStateRef.current(false);
              }
            },
          },
        });

        ytPlayersRef.current[slotIdx] = player;
      });

      return () => {
        cancelled = true;
        ytReadyRef.current[slotIdx] = false;
        ytDeckTrackIdRef.current[slotIdx] = '';
        if (ytPlayersRef.current[slotIdx]) {
          try {
            ytPlayersRef.current[slotIdx]?.destroy();
          } catch {
            // ignore
          }
          ytPlayersRef.current[slotIdx] = null;
        }
        (slotIdx === 0 ? ytHost0Ref.current : ytHost1Ref.current)?.replaceChildren();
      };
    },
    [cancelTransition, finishTransition, setYtDeckVolume]
  );

  useEffect(() => {
    return mountYtSlot(0, ytSlotTracks[0]);
  }, [ytSlotTracks[0]?.id, ytSlotTracks[0]?.embedId, mountYtSlot]);

  useEffect(() => {
    return mountYtSlot(1, ytSlotTracks[1]);
  }, [ytSlotTracks[1]?.id, ytSlotTracks[1]?.embedId, mountYtSlot]);

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

  // Preload the next direct-audio track onto the idle audio deck ahead of the 8-second window
  useEffect(() => {
    if (!currentTrack || !isPlaying) return;
    const timer = window.setTimeout(() => {
      preloadIdleDeckForTrack(currentTrack);
    }, 600);
    return () => window.clearTimeout(timer);
  }, [currentTrack?.id, isPlaying, queue, shuffle, repeatMode, preloadIdleDeckForTrack]);

  // High-resolution playback monitor for HTML5 audio (catches 8s remaining smoothly)
  useEffect(() => {
    if (!isPlaying || !currentTrack || isCurrentYouTube) return;
    const monitor = window.setInterval(() => {
      const activeDeck = getDeck(activeDeckIdxRef.current);
      if (!activeDeck) return;
      const cur = activeDeck.currentTime;
      const dur =
        Number.isFinite(activeDeck.duration) && activeDeck.duration > 0
          ? activeDeck.duration
          : currentTrack.durationSec || 0;
      if (Number.isFinite(cur)) setCurrentTime(cur);
      if (dur > 0) {
        setDuration(dur);
        maybeStartCrossfade(cur, dur, 'audio');
      }
    }, 200);

    return () => window.clearInterval(monitor);
  }, [isPlaying, currentTrack?.id, isCurrentYouTube, getDeck, maybeStartCrossfade]);

  // High-resolution playback monitor for YouTube (catches 8s remaining for both YouTube->Audio and YouTube->YouTube)
  useEffect(() => {
    if (!isCurrentYouTube || !isPlaying) return;
    const interval = window.setInterval(() => {
      const activeSlot = activeYtDeckIdxRef.current;
      const player = ytPlayersRef.current[activeSlot];
      if (!player || !ytReadyRef.current[activeSlot]) return;
      try {
        const cur = player.getCurrentTime();
        const dur = player.getDuration();
        if (Number.isFinite(cur)) setCurrentTime(cur);
        if (Number.isFinite(dur) && dur > 0) {
          setDuration(dur);
          maybeStartCrossfade(cur, dur, 'youtube');
        }
      } catch {
        // ignore transient calls
      }
    }, 250);

    return () => window.clearInterval(interval);
  }, [isCurrentYouTube, isPlaying, maybeStartCrossfade]);

  // Sync volume & mute to active deck (or active crossfade) across Audio & YouTube
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

  // Cleanup crossfade interval on unmount
  useEffect(() => {
    return () => {
      if (transitionRef.current?.timerId != null) {
        window.clearInterval(transitionRef.current.timerId);
      }
    };
  }, []);

  const handleSeek = (nextSec: number) => {
    const dur = duration || currentTrack?.durationSec || 218;
    const remainingAfterSeek = dur - nextSec;
    if (remainingAfterSeek > CROSSFADE_TARGET_SEC + 0.5) {
      cancelTransition(true);
      transitionLockFromIdRef.current = '';
    }

    if (isCurrentYouTube) {
      const activeSlot = activeYtDeckIdxRef.current;
      const player = ytPlayersRef.current[activeSlot];
      if (player && ytReadyRef.current[activeSlot]) {
        player.seekTo(nextSec, true);
        setCurrentTime(nextSec);
      }
      return;
    }

    const activeDeck = getDeck(activeDeckIdxRef.current);
    if (!activeDeck) return;
    activeDeck.currentTime = nextSec;
    setCurrentTime(nextSec);
  };

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
    if (Number.isFinite(deckEl.duration) && deckEl.duration > 0) {
      setDuration(deckEl.duration);
    }
  };

  const handleDeckEnded = (deckIdx: 0 | 1) => {
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
      activeDeck.currentTime = 0;
      activeDeck.play().catch(() => {});
      return;
    }

    onPlaybackEndedRef.current();
  };

  const handleDeckError = (deckIdx: 0 | 1) => {
    if (deckIdx !== activeDeckIdxRef.current) return;
    if (currentTrackRef.current?.streamUrl && !isCurrentYouTube) {
      setAudioError('Stream unavailable; skipping to next track...');
      onPlaybackEndedRef.current();
    }
  };

  const effectiveDuration = duration || currentTrack?.durationSec || 218;
  const progressPct =
    effectiveDuration > 0 ? Math.min(100, (currentTime / effectiveDuration) * 100) : 0;

  return (
    <>
      {/* Dual Audio Decks for True 8-Second Preloaded Overlap & Gapless Crossfade */}
      <audio
        ref={deck0Ref}
        preload="auto"
        onTimeUpdate={(e) => handleDeckTimeUpdate(0, e.currentTarget)}
        onLoadedMetadata={(e) => handleDeckLoadedMetadata(0, e.currentTarget)}
        onEnded={() => handleDeckEnded(0)}
        onError={() => handleDeckError(0)}
      />
      <audio
        ref={deck1Ref}
        preload="auto"
        onTimeUpdate={(e) => handleDeckTimeUpdate(1, e.currentTarget)}
        onLoadedMetadata={(e) => handleDeckLoadedMetadata(1, e.currentTarget)}
        onEnded={() => handleDeckEnded(1)}
        onError={() => handleDeckError(1)}
      />

      {/* Non-blocking Dual-Deck YouTube Mini-Player Dock (supports 8s crossfade across all combinations) */}
      {hasAnyYtDeck && displayedYtTrack ? (
        <aside
          aria-label="YouTube Mini Player"
          className={`fixed left-3 right-3 sm:left-auto sm:right-6 z-40 bottom-28 lg:bottom-24 sm:w-[320px] max-w-[340px] ml-auto rounded-2xl bg-[#12121A]/95 backdrop-blur-xl border border-white/10 shadow-2xl overflow-hidden transition-transform duration-200 ${
            ytDockMinimized ? 'translate-y-2 opacity-90' : 'translate-y-0 opacity-100'
          }`}
        >
          <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-white/[0.08]">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-white truncate">
                {displayedYtTrack.title}
              </p>
              <p className="text-[11px] text-blue-300 truncate">
                {crossfadeStatus
                  ? `Crossfading to ${crossfadeStatus.nextTitle} · ${crossfadeStatus.remainingSec}s`
                  : 'YouTube Mix · 8s Gapless Crossfade'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setYtDockMinimized((prev) => !prev)}
              aria-label={ytDockMinimized ? 'Expand YouTube player' : 'Minimize YouTube player'}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06]"
            >
              <ChevronDown
                className={`w-4 h-4 transition-transform ${ytDockMinimized ? 'rotate-180' : ''}`}
              />
            </button>
            <button
              type="button"
              onClick={() => {
                cancelTransition(true);
                onSetPlayingState(false);
                setYtDockMinimized(true);
              }}
              aria-label="Pause and minimize YouTube player"
              className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div
            className={`relative w-full bg-black transition-all duration-200 ${
              ytDockMinimized ? 'h-0 overflow-hidden' : 'h-[200px]'
            }`}
          >
            <div
              ref={ytHost0Ref}
              className={`absolute inset-0 w-full h-full transition-opacity duration-700 ${
                (visualCrossfadeYtIdx ?? activeYtDeckIdx) === 0
                  ? 'opacity-100 z-10'
                  : 'opacity-0 z-0 pointer-events-none'
              }`}
            />
            <div
              ref={ytHost1Ref}
              className={`absolute inset-0 w-full h-full transition-opacity duration-700 ${
                (visualCrossfadeYtIdx ?? activeYtDeckIdx) === 1
                  ? 'opacity-100 z-10'
                  : 'opacity-0 z-0 pointer-events-none'
              }`}
            />
          </div>
        </aside>
      ) : null}

      {/* Desktop Queue Popover */}
      {queueOpen ? (
        <aside
          aria-label="Up Next Queue"
          className="hidden lg:flex fixed bottom-24 right-6 z-40 w-88 max-h-[60vh] flex-col rounded-2xl bg-[#12121A]/95 backdrop-blur-xl border border-white/10 shadow-2xl overflow-hidden"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.08]">
            <div>
              <h3 className="font-display text-sm font-semibold text-white">Up Next Queue</h3>
              <p className="text-[11px] text-slate-400 font-mono-tabular">
                {queue.length} tracks · 8s gapless crossfade
              </p>
            </div>
            <button
              type="button"
              onClick={() => setQueueOpen(false)}
              aria-label="Close queue"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {queue.map((item) => {
              const active = item.id === currentTrack?.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectTrack(item)}
                  className={`w-full flex items-center gap-3 p-2 rounded-lg text-left transition-colors ${
                    active
                      ? 'bg-violet-500/15 text-white'
                      : 'hover:bg-white/[0.05] text-slate-300'
                  }`}
                >
                  <div className="h-9 w-9 shrink-0 overflow-hidden rounded">
                    <ArtworkImage src={item.coverUrl} alt={item.title} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium truncate">{item.title}</p>
                    <p className="text-[11px] text-slate-400 truncate">{item.artist}</p>
                  </div>
                  <span className="text-[11px] font-mono-tabular text-slate-500">
                    {item.durationSec > 0 ? formatDuration(item.durationSec) : 'YouTube'}
                  </span>
                </button>
              );
            })}
          </div>
        </aside>
      ) : null}

      {/* Desktop Fixed Bottom Player Bar */}
      <footer className="hidden lg:flex fixed bottom-0 left-0 right-0 z-40 h-20 items-center justify-between gap-6 px-6 bg-[#0B0B10]/95 backdrop-blur-xl border-t border-white/[0.08]">
        {/* Left: Current Track Info */}
        <div className="flex items-center gap-3.5 w-80 min-w-0">
          {currentTrack ? (
            <>
              <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-[#181822]">
                <ArtworkImage src={currentTrack.coverUrl} alt={currentTrack.title} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-white truncate">
                  {currentTrack.title}
                </p>
                <p className="text-xs text-slate-400 truncate mt-0.5">
                  {currentTrack.artist}
                  <span className="mx-1.5 text-slate-600" aria-hidden="true">
                    ·
                  </span>
                  <span className="text-blue-400">{currentTrack.licenseType}</span>
                </p>
                {crossfadeStatus ? (
                  <p className="text-[11px] text-violet-300 truncate font-mono-tabular">
                    Crossfading to {crossfadeStatus.nextTitle} · {crossfadeStatus.remainingSec}s
                  </p>
                ) : audioError ? (
                  <p className="text-[11px] text-amber-400 truncate">{audioError}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => onToggleFavorite(currentTrack.id)}
                aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-colors ${
                  isFavorite ? 'text-violet-400' : 'text-slate-400 hover:text-white'
                }`}
              >
                <Heart className={`w-4 h-4 ${isFavorite ? 'fill-current' : ''}`} />
              </button>
            </>
          ) : (
            <div className="text-xs text-slate-500">
              Select any track to start streaming
            </div>
          )}
        </div>

        {/* Center: Controls & Seek Scrubber */}
        <div className="flex flex-1 max-w-xl flex-col items-center gap-1.5">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onToggleShuffle}
              aria-label="Toggle shuffle"
              className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
                shuffle ? 'text-violet-400' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Shuffle className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={onPrev}
              disabled={!currentTrack}
              aria-label="Previous track"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-300 hover:text-white disabled:opacity-35 transition-colors"
            >
              <SkipBack className="w-4 h-4 fill-current" />
            </button>

            <button
              type="button"
              onClick={onPlayPause}
              disabled={!currentTrack}
              aria-label={isPlaying ? 'Pause' : 'Play'}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-r from-violet-600 to-blue-500 text-white shadow-md shadow-violet-950/50 transition-transform duration-150 hover:scale-105 active:scale-95 disabled:opacity-40"
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
              disabled={!currentTrack}
              aria-label="Next track"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-300 hover:text-white disabled:opacity-35 transition-colors"
            >
              <SkipForward className="w-4 h-4 fill-current" />
            </button>

            <button
              type="button"
              onClick={onCycleRepeat}
              aria-label={`Repeat mode: ${repeatMode}`}
              className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
                repeatMode !== 'off' ? 'text-blue-400' : 'text-slate-400 hover:text-white'
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
              disabled={!currentTrack}
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

        {/* Right: Queue & Volume */}
        <div className="flex items-center justify-end gap-3 w-72">
          <button
            type="button"
            onClick={() => setQueueOpen((prev) => !prev)}
            aria-label="Toggle playback queue"
            className={`flex h-10 w-10 items-center justify-center rounded-lg transition-colors ${
              queueOpen
                ? 'bg-violet-500/20 text-violet-300'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <ListMusic className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => setMuted((prev) => !prev)}
            aria-label={muted ? 'Unmute audio' : 'Mute audio'}
            className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-400 hover:text-white transition-colors"
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
            className="gg-range w-24"
            style={{
              background: `linear-gradient(to right, #8B5CF6 0%, #3B82F6 ${
                (muted ? 0 : volume) * 100
              }%, rgba(255,255,255,0.12) ${(muted ? 0 : volume) * 100}%, rgba(255,255,255,0.12) 100%)`,
              borderRadius: '9999px',
              height: '4px',
            }}
          />
        </div>
      </footer>

      {/* Mobile Compact Mini-Player Strip (sits directly above 56px bottom nav) */}
      {currentTrack ? (
        <div className="lg:hidden fixed bottom-14 left-0 right-0 z-40 px-2 pb-1">
          <div className="flex h-12 items-center gap-1.5 rounded-xl bg-[#151520]/95 backdrop-blur-xl border border-white/10 px-2.5 shadow-xl relative overflow-hidden">
            {/* Subtle top hairline progress */}
            <div
              className="absolute top-0 left-0 h-[2px] bg-gradient-to-r from-violet-500 to-blue-500 transition-[width] duration-150"
              style={{ width: `${progressPct}%` }}
            />
            <button
              type="button"
              onClick={() => setMobileExpanded(true)}
              className="flex flex-1 min-w-0 items-center gap-2.5 text-left"
              aria-label="Open Now Playing view"
            >
              <div className="h-8 w-8 shrink-0 overflow-hidden rounded">
                <ArtworkImage src={currentTrack.coverUrl} alt={currentTrack.title} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-white truncate">
                  {currentTrack.title}
                </p>
                <p className="text-[11px] text-slate-400 truncate">
                  {crossfadeStatus
                    ? `Crossfading · ${crossfadeStatus.remainingSec}s`
                    : currentTrack.artist}
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => onToggleFavorite(currentTrack.id)}
              aria-label="Favorite track"
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
                isFavorite ? 'text-violet-400' : 'text-slate-400'
              }`}
            >
              <Heart className={`w-4 h-4 ${isFavorite ? 'fill-current' : ''}`} />
            </button>

            <button
              type="button"
              onClick={onPlayPause}
              aria-label={isPlaying ? 'Pause' : 'Play'}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-white"
            >
              {isPlaying ? (
                <Pause className="w-5 h-5 fill-current" />
              ) : (
                <Play className="w-5 h-5 fill-current" />
              )}
            </button>

            <button
              type="button"
              onClick={onNext}
              aria-label="Next track"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-300 hover:text-white"
            >
              <SkipForward className="w-4 h-4 fill-current" />
            </button>
          </div>
        </div>
      ) : null}

      {/* Mobile Full-Screen Now Playing Sheet */}
      {mobileExpanded && currentTrack ? (
        <div className="lg:hidden fixed inset-0 z-50 flex flex-col bg-[#09090D] px-5 pt-5 pb-[max(2rem,env(safe-area-inset-bottom))] overflow-y-auto">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                setMobileExpanded(false);
                setMobileQueueOpen(false);
              }}
              aria-label="Collapse player"
              className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-300 hover:bg-white/5"
            >
              <ChevronDown className="w-6 h-6" />
            </button>
            <div className="text-center">
              <p className="text-[11px] text-slate-400">
                {crossfadeStatus ? '8s Gapless Crossfade' : 'Now Streaming'}
              </p>
              <p className="text-xs font-medium text-blue-300">{currentTrack.licenseType}</p>
            </div>
            <button
              type="button"
              onClick={() => setMobileQueueOpen((prev) => !prev)}
              aria-label={mobileQueueOpen ? 'Show artwork' : 'Show up next queue'}
              className={`flex h-11 w-11 items-center justify-center rounded-xl transition-colors ${
                mobileQueueOpen ? 'bg-violet-500/20 text-violet-300' : 'text-slate-400 hover:bg-white/5'
              }`}
            >
              <ListMusic className="w-5 h-5" />
            </button>
          </div>

          {mobileQueueOpen ? (
            <div className="my-5 flex-1 min-h-[240px] max-h-[340px] flex flex-col rounded-2xl bg-[#12121A] border border-white/10 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.08]">
                <span className="font-display text-sm font-semibold text-white">
                  Up Next Queue ({queue.length})
                </span>
                <button
                  type="button"
                  onClick={() => setMobileQueueOpen(false)}
                  className="text-xs text-violet-300 font-medium"
                >
                  Done
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {queue.map((item) => {
                  const active = item.id === currentTrack.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onSelectTrack(item)}
                      className={`w-full flex items-center gap-3 p-2 rounded-lg text-left transition-colors ${
                        active
                          ? 'bg-violet-500/15 text-white'
                          : 'hover:bg-white/[0.05] text-slate-300'
                      }`}
                    >
                      <div className="h-9 w-9 shrink-0 overflow-hidden rounded">
                        <ArtworkImage src={item.coverUrl} alt={item.title} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium truncate">{item.title}</p>
                        <p className="text-[11px] text-slate-400 truncate">{item.artist}</p>
                      </div>
                      <span className="text-[11px] font-mono-tabular text-slate-500">
                        {item.durationSec > 0 ? formatDuration(item.durationSec) : 'YouTube'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="my-6 mx-auto w-full max-w-[280px] aspect-square overflow-hidden rounded-2xl border border-white/10 shadow-2xl">
              <ArtworkImage src={currentTrack.coverUrl} alt={currentTrack.title} />
            </div>
          )}

          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-display text-xl font-bold text-white truncate">
                {currentTrack.title}
              </h2>
              <p className="text-sm text-slate-400 truncate mt-0.5">
                {currentTrack.artist} · {currentTrack.album}
              </p>
              {crossfadeStatus ? (
                <p className="text-xs text-violet-300 mt-1 font-mono-tabular">
                  Crossfading to {crossfadeStatus.nextTitle} · {crossfadeStatus.remainingSec}s
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => onToggleFavorite(currentTrack.id)}
              aria-label="Toggle favorite"
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
                isFavorite ? 'text-violet-400' : 'text-slate-400'
              }`}
            >
              <Heart className={`w-5 h-5 ${isFavorite ? 'fill-current' : ''}`} />
            </button>
          </div>

          <div className="mt-6">
            <input
              type="range"
              aria-label="Seek"
              min={0}
              max={effectiveDuration}
              step={0.2}
              value={Math.min(currentTime, effectiveDuration)}
              onChange={(e) => handleSeek(Number(e.target.value))}
              className="gg-range w-full"
              style={{
                background: `linear-gradient(to right, #8B5CF6 0%, #3B82F6 ${progressPct}%, rgba(255,255,255,0.14) ${progressPct}%, rgba(255,255,255,0.14) 100%)`,
                borderRadius: '9999px',
                height: '5px',
              }}
            />
            <div className="mt-2 flex justify-between text-xs font-mono-tabular text-slate-400">
              <span>{formatDuration(currentTime)}</span>
              <span>{formatDuration(effectiveDuration)}</span>
            </div>
          </div>

          <div className="mt-6 flex items-center justify-between">
            <button
              type="button"
              onClick={onToggleShuffle}
              aria-label="Shuffle"
              className={`flex h-11 w-11 items-center justify-center rounded-xl ${
                shuffle ? 'text-violet-400' : 'text-slate-400'
              }`}
            >
              <Shuffle className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={onPrev}
              aria-label="Previous"
              className="flex h-12 w-12 items-center justify-center rounded-xl text-white"
            >
              <SkipBack className="w-6 h-6 fill-current" />
            </button>
            <button
              type="button"
              onClick={onPlayPause}
              aria-label={isPlaying ? 'Pause' : 'Play'}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-r from-violet-600 to-blue-500 text-white shadow-xl"
            >
              {isPlaying ? (
                <Pause className="w-7 h-7 fill-current" />
              ) : (
                <Play className="w-7 h-7 fill-current ml-0.5" />
              )}
            </button>
            <button
              type="button"
              onClick={onNext}
              aria-label="Next"
              className="flex h-12 w-12 items-center justify-center rounded-xl text-white"
            >
              <SkipForward className="w-6 h-6 fill-current" />
            </button>
            <button
              type="button"
              onClick={onCycleRepeat}
              aria-label="Repeat"
              className={`flex h-11 w-11 items-center justify-center rounded-xl ${
                repeatMode !== 'off' ? 'text-blue-400' : 'text-slate-400'
              }`}
            >
              {repeatMode === 'one' ? (
                <Repeat1 className="w-5 h-5" />
              ) : (
                <Repeat className="w-5 h-5" />
              )}
            </button>
          </div>

          <p className="mt-6 text-center text-xs text-slate-500">
            {currentTrack.licenseSummary}
          </p>
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
                <h3 id="embed-dialog-title" className="font-display text-base font-semibold text-white truncate">
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
