import {
  Mic,
  MicOff,
  Radio,
  Send,
  Volume2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import groovyAvatarUrl from '../assets/images/groovy_girl_avatar_1795443866890.jpg';
import { searchCatalog } from '../services/clientCatalog';
import type { PlaylistWithStats, Track } from '../types/music';
import {
  doesSearchResultMatchQuery,
  extractGroovyWakeCommand,
  interpretGroovyCommandWithAI,
  parseGroovyIntent,
  playGroovyWakeChime,
  speakGroovyReply,
  stopGroovySpeech,
} from '../utils/groovyVoice';
import type { RepeatMode } from './PlayerBar';

interface BrowserSpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface BrowserSpeechRecognitionResult {
  isFinal: boolean;
  length: number;
  [index: number]: BrowserSpeechRecognitionAlternative;
}

interface BrowserSpeechRecognitionResultList {
  length: number;
  [index: number]: BrowserSpeechRecognitionResult;
}

interface BrowserSpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: BrowserSpeechRecognitionResultList;
}

interface BrowserSpeechRecognitionErrorEvent extends Event {
  error: string;
}

interface BrowserSpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  onerror: ((event: BrowserSpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionCtor = new () => BrowserSpeechRecognition;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const win = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return win.SpeechRecognition || win.webkitSpeechRecognition || null;
}

function pickBestTranscript(res: BrowserSpeechRecognitionResult): string {
  const fallback = res[0]?.transcript || '';
  for (let altIdx = 0; altIdx < res.length; altIdx++) {
    const altText = res[altIdx]?.transcript || '';
    if (altText && extractGroovyWakeCommand(altText).hasWakeWord) {
      return altText;
    }
  }
  return fallback;
}

const HANDS_FREE_WAKE_STORAGE_KEY = 'gg_groovy_handsfree_wake_v1';

type VoicePhase = 'idle' | 'standby' | 'listening' | 'speaking';

interface GroovyAssistantProps {
  playlists: PlaylistWithStats[];
  tracks: Track[];
  currentTrack: Track | null;
  isPlaying: boolean;
  shuffle: boolean;
  hookMode: boolean;
  volume: number;
  muted: boolean;
  studioConsoleOpen: boolean;
  favorites: Set<string>;
  onPlayTrack: (track: Track, list: Track[]) => void;
  onPlayPlaylist: (playlistId: string) => void;
  onSetPlaying: (playing: boolean) => void;
  onNext: () => void;
  onPrev: () => void;
  onToggleShuffle: (value?: boolean) => void;
  onSetRepeatMode: (mode: RepeatMode) => void;
  onSetHookMode: (enabled: boolean) => void;
  onSetVolume: (volume01: number) => void;
  onSetMuted: (muted: boolean) => void;
  onToggleFavorite: (trackId: string, track?: Track) => void;
  onNavigateTab: (tab: 'discover' | 'playlists' | 'search') => void;
  onSetStudioConsoleOpen: (open: boolean) => void;
  onDuckAudioChange: (ducking: boolean) => void;
}

const QUICK_COMMANDS = [
  'Play 2 AM playlist',
  'Play Top Hindi Songs',
  'Next song',
  'Hook mode on',
];

function readSavedHandsFreeWake(): boolean {
  try {
    return localStorage.getItem(HANDS_FREE_WAKE_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function GroovyAssistant({
  playlists,
  tracks,
  currentTrack,
  isPlaying,
  shuffle,
  volume,
  studioConsoleOpen,
  favorites,
  onPlayTrack,
  onPlayPlaylist,
  onSetPlaying,
  onNext,
  onPrev,
  onToggleShuffle,
  onSetRepeatMode,
  onSetHookMode,
  onSetVolume,
  onSetMuted,
  onToggleFavorite,
  onNavigateTab,
  onSetStudioConsoleOpen,
  onDuckAudioChange,
}: GroovyAssistantProps) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [handsFreeWake, setHandsFreeWake] = useState<boolean>(readSavedHandsFreeWake);
  const [voiceRepliesEnabled, setVoiceRepliesEnabled] = useState(true);
  const [phase, setPhase] = useState<VoicePhase>('idle');
  const [liveTranscript, setLiveTranscript] = useState('');
  const [lastUserQuery, setLastUserQuery] = useState('');
  const [groovyReply, setGroovyReply] = useState(
    'Tap mic or press Alt+G to speak — music auto-pauses and resumes.'
  );
  const [textCommand, setTextCommand] = useState('');
  const [micError, setMicError] = useState<string | null>(null);

  const speechSupported = Boolean(getSpeechRecognitionCtor());

  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const recognitionModeRef = useRef<'one-shot' | 'wake-standby' | null>(null);
  const recognitionActiveRef = useRef(false);
  const handsFreeWakeRef = useRef(handsFreeWake);
  handsFreeWakeRef.current = handsFreeWake;
  const activeListeningRef = useRef(false);
  const handledOneShotResultRef = useRef(false);
  const resumeMusicAfterVoiceRef = useRef(false);
  const armedUntilRef = useRef(0);
  const lastChimeAtRef = useRef(0);
  const isSpeakingRef = useRef(false);
  const restartTimerRef = useRef<number | null>(null);
  const startDelayTimerRef = useRef<number | null>(null);
  const armedTimerRef = useRef<number | null>(null);
  const standbyStartedAtRef = useRef(0);
  const lastStandbyActivityAtRef = useRef(0);
  const consecutiveWakeErrorsRef = useRef(0);
  const lastCommandSigRef = useRef<{ sig: string; at: number }>({ sig: '', at: 0 });
  const permissionDeniedRef = useRef(false);
  const hasGreetedSessionRef = useRef(false);
  const greetingActiveRef = useRef(false);
  const panelOpenRef = useRef(panelOpen);
  panelOpenRef.current = panelOpen;

  // Keep latest callbacks/data in refs for speech recognition handlers
  const latestRef = useRef({
    playlists,
    tracks,
    currentTrack,
    isPlaying,
    shuffle,
    volume,
    favorites,
    voiceRepliesEnabled,
    onPlayTrack,
    onPlayPlaylist,
    onSetPlaying,
    onNext,
    onPrev,
    onToggleShuffle,
    onSetRepeatMode,
    onSetHookMode,
    onSetVolume,
    onSetMuted,
    onToggleFavorite,
    onNavigateTab,
    onSetStudioConsoleOpen,
  });
  latestRef.current = {
    playlists,
    tracks,
    currentTrack,
    isPlaying,
    shuffle,
    volume,
    favorites,
    voiceRepliesEnabled,
    onPlayTrack,
    onPlayPlaylist,
    onSetPlaying,
    onNext,
    onPrev,
    onToggleShuffle,
    onSetRepeatMode,
    onSetHookMode,
    onSetVolume,
    onSetMuted,
    onToggleFavorite,
    onNavigateTab,
    onSetStudioConsoleOpen,
  };

  useEffect(() => {
    const shouldDuck = phase === 'listening' || phase === 'speaking';
    onDuckAudioChange(shouldDuck);
    return () => {
      onDuckAudioChange(false);
    };
  }, [phase, onDuckAudioChange]);

  const triggerWakeChime = useCallback(() => {
    const now = Date.now();
    if (now - lastChimeAtRef.current < 900) return;
    lastChimeAtRef.current = now;
    playGroovyWakeChime();
  }, []);

  const pauseMusicTemporarily = useCallback(() => {
    if (latestRef.current.isPlaying) {
      resumeMusicAfterVoiceRef.current = true;
      latestRef.current.onSetPlaying(false);
      return true;
    }
    return false;
  }, []);

  const resumeMusicIfNeeded = useCallback(() => {
    if (resumeMusicAfterVoiceRef.current) {
      resumeMusicAfterVoiceRef.current = false;
      latestRef.current.onSetPlaying(true);
    }
  }, []);

  const replyWithVoice = useCallback(
    (
      message: string,
      options?: {
        resumePhaseAfter?: VoicePhase;
        resumePausedMusic?: boolean;
        autoClosePanel?: boolean;
      }
    ) => {
      setGroovyReply(message);
      if (options?.autoClosePanel) {
        panelOpenRef.current = false;
        setPanelOpen(false);
      }

      const finalize = () => {
        if (options?.resumePausedMusic) {
          resumeMusicIfNeeded();
        }
        setPhase(
          options?.resumePhaseAfter ??
            (handsFreeWakeRef.current ? 'standby' : 'idle')
        );
      };

      if (!latestRef.current.voiceRepliesEnabled) {
        finalize();
        return;
      }

      isSpeakingRef.current = true;
      setPhase('speaking');
      speakGroovyReply(message, {
        onEnd: () => {
          window.setTimeout(() => {
            isSpeakingRef.current = false;
            finalize();
          }, 260);
        },
      });
    },
    [resumeMusicIfNeeded]
  );

  const armListeningWindow = useCallback(
    (durationMs = 8500) => {
      pauseMusicTemporarily();
      triggerWakeChime();
      armedUntilRef.current = Date.now() + durationMs;
      setPanelOpen(true);
      setPhase('listening');
      if (armedTimerRef.current) window.clearTimeout(armedTimerRef.current);
      armedTimerRef.current = window.setTimeout(() => {
        if (Date.now() >= armedUntilRef.current && !activeListeningRef.current) {
          resumeMusicIfNeeded();
          setPhase(handsFreeWakeRef.current ? 'standby' : 'idle');
        }
      }, durationMs + 120);
    },
    [pauseMusicTemporarily, resumeMusicIfNeeded, triggerWakeChime]
  );

  const executeSearchAndPlay = useCallback(
    async (query: string, customReply?: string): Promise<boolean> => {
      const state = latestRef.current;
      try {
        const results = await searchCatalog({ query }, true);
        const combined = [...(results.localTracks || []), ...(results.externalTracks || [])].filter(
          (t) => Boolean(t.streamUrl) || (t.playbackRights === 'embed-only' && Boolean(t.embedId))
        );
        const matched = combined.filter((t) => doesSearchResultMatchQuery(query, t));
        if (matched.length > 0) {
          resumeMusicAfterVoiceRef.current = false;
          state.onPlayTrack(matched[0], matched);
          replyWithVoice(
            customReply || `Playing ${matched[0].title} by ${matched[0].artist}.`,
            { autoClosePanel: true }
          );
          return true;
        }
      } catch {
        // handled below
      }
      return false;
    },
    [replyWithVoice]
  );

  const executeGroovyCommand = useCallback(
    async (rawText: string) => {
      greetingActiveRef.current = false;
      const cleaned = rawText.trim();
      if (!cleaned) return;

      const sig = cleaned.toLowerCase();
      const now = Date.now();
      if (
        lastCommandSigRef.current.sig === sig &&
        now - lastCommandSigRef.current.at < 1100
      ) {
        return;
      }
      lastCommandSigRef.current = { sig, at: now };

      setLastUserQuery(cleaned);
      setLiveTranscript('');

      const state = latestRef.current;
      const intent = parseGroovyIntent(cleaned, state.playlists, state.tracks);

      switch (intent.type) {
        case 'wake-only': {
          armListeningWindow(8000);
          setGroovyReply('Yes, listening... Try "Play Top Hindi Songs" or "Next song".');
          return;
        }
        case 'dismiss':
          replyWithVoice(intent.reply || 'Okay, continuing.', {
            resumePausedMusic: true,
          });
          return;
        case 'smalltalk':
          replyWithVoice(intent.reply, { resumePausedMusic: true });
          return;
        case 'help':
          replyWithVoice(
            'You can say Play Top Hindi Songs, Play BTS, Next song, Hook mode on, Volume 70, or What is playing?',
            { resumePausedMusic: true }
          );
          return;
        case 'play-resume':
          resumeMusicAfterVoiceRef.current = false;
          if (state.currentTrack) {
            state.onSetPlaying(true);
            replyWithVoice(`Resuming ${state.currentTrack.title}.`, {
              autoClosePanel: true,
            });
          } else {
            state.onPlayPlaylist('top-50-hindi');
            replyWithVoice('Playing Top Hindi Songs.', { autoClosePanel: true });
          }
          return;
        case 'pause':
          resumeMusicAfterVoiceRef.current = false;
          state.onSetPlaying(false);
          replyWithVoice('Music paused.');
          return;
        case 'next':
          resumeMusicAfterVoiceRef.current = false;
          state.onNext();
          replyWithVoice('Playing next song.', { autoClosePanel: true });
          return;
        case 'previous':
          resumeMusicAfterVoiceRef.current = false;
          state.onPrev();
          replyWithVoice('Playing previous song.', { autoClosePanel: true });
          return;
        case 'shuffle': {
          const nextShuffle =
            intent.enabled === 'toggle' ? !state.shuffle : intent.enabled;
          state.onToggleShuffle(nextShuffle);
          replyWithVoice(
            nextShuffle ? 'Shuffle is now on.' : 'Shuffle is now off.',
            { resumePausedMusic: true }
          );
          return;
        }
        case 'repeat':
          state.onSetRepeatMode(intent.mode);
          replyWithVoice(
            intent.mode === 'one'
              ? 'Repeating current song.'
              : intent.mode === 'all'
                ? 'Repeat all is on.'
                : 'Repeat is off.',
            { resumePausedMusic: true }
          );
          return;
        case 'hook-mode':
          state.onSetHookMode(intent.enabled);
          replyWithVoice(
            intent.enabled ? 'Hook mode activated.' : 'Switched to full song mode.',
            { resumePausedMusic: true }
          );
          return;
        case 'mute':
          state.onSetMuted(intent.muted);
          replyWithVoice(
            intent.muted ? 'Audio muted.' : 'Audio unmuted.',
            { resumePausedMusic: true }
          );
          return;
        case 'volume-set': {
          const pct = Math.round(intent.volume01 * 100);
          state.onSetMuted(false);
          state.onSetVolume(intent.volume01);
          replyWithVoice(`Volume set to ${pct} percent.`, {
            resumePausedMusic: true,
          });
          return;
        }
        case 'volume-delta': {
          const nextVol = Math.max(0.05, Math.min(1, state.volume + intent.delta01));
          state.onSetMuted(false);
          state.onSetVolume(nextVol);
          replyWithVoice(`Volume set to ${Math.round(nextVol * 100)} percent.`, {
            resumePausedMusic: true,
          });
          return;
        }
        case 'whats-playing':
          if (state.currentTrack) {
            replyWithVoice(
              `Now playing ${state.currentTrack.title} by ${state.currentTrack.artist}.`,
              { resumePausedMusic: true }
            );
          } else {
            replyWithVoice(
              'Nothing is playing right now. Say Play followed by a song or playlist.',
              { resumePausedMusic: true }
            );
          }
          return;
        case 'favorite':
          if (!state.currentTrack) {
            replyWithVoice('Start a song first so I can save it to My Playlist.', {
              resumePausedMusic: true,
            });
            return;
          }
          if (intent.like && !state.favorites.has(state.currentTrack.id)) {
            state.onToggleFavorite(state.currentTrack.id, state.currentTrack);
            replyWithVoice(`Saved ${state.currentTrack.title} to My Playlist.`, {
              resumePausedMusic: true,
            });
          } else if (!intent.like && state.favorites.has(state.currentTrack.id)) {
            state.onToggleFavorite(state.currentTrack.id, state.currentTrack);
            replyWithVoice(`Removed ${state.currentTrack.title} from favorites.`, {
              resumePausedMusic: true,
            });
          } else {
            replyWithVoice(
              intent.like
                ? `${state.currentTrack.title} is already in your favorites.`
                : `${state.currentTrack.title} is not in favorites.`,
              { resumePausedMusic: true }
            );
          }
          return;
        case 'navigate':
          if (intent.target === 'studio') {
            if (state.currentTrack) {
              state.onSetStudioConsoleOpen(true);
              replyWithVoice('Opening Studio Console.', {
                resumePausedMusic: true,
              });
            } else {
              replyWithVoice('Play a song first to open the Studio Console.', {
                resumePausedMusic: true,
              });
            }
          } else if (intent.target === 'minimize') {
            state.onSetStudioConsoleOpen(false);
            replyWithVoice('Minimized player.', {
              resumePausedMusic: true,
            });
          } else {
            state.onSetStudioConsoleOpen(false);
            state.onNavigateTab(intent.target);
            replyWithVoice(`Opening ${intent.target}.`, {
              resumePausedMusic: true,
            });
          }
          return;
        case 'play-playlist':
          if (
            intent.playlist.id === 'my-playlist' &&
            state.favorites.size === 0 &&
            !state.tracks.some((t) => t.playlistIds.includes('my-playlist'))
          ) {
            replyWithVoice(
              'Your My Playlist is empty. Heart a song first, or pick another playlist.',
              { resumePausedMusic: true }
            );
            return;
          }
          resumeMusicAfterVoiceRef.current = false;
          state.onPlayPlaylist(intent.playlist.id);
          replyWithVoice(`Playing ${intent.playlist.title}.`, {
            autoClosePanel: true,
          });
          return;
        case 'play-track':
          resumeMusicAfterVoiceRef.current = false;
          state.onPlayTrack(intent.track, intent.queue);
          replyWithVoice(`Playing ${intent.track.title}.`, {
            autoClosePanel: true,
          });
          return;
        case 'search-and-play': {
          setGroovyReply(`Searching for "${intent.query}"...`);
          const found = await executeSearchAndPlay(intent.query);
          if (found) return;
          // Ask Gemini AI before giving up in case the phrasing meant a playlist or mood
          break;
        }
        case 'unknown':
          break;
      }

      // Smart Gemini AI Fallback for natural language / ambiguous commands
      setGroovyReply('Thinking...');
      const aiAction = await interpretGroovyCommandWithAI({
        transcript: cleaned,
        playlists: state.playlists,
        currentTrack: state.currentTrack,
      });

      if (aiAction) {
        switch (aiAction.action) {
          case 'play_playlist': {
            const targetPlaylist = state.playlists.find((p) => p.id === aiAction.playlistId);
            if (targetPlaylist) {
              resumeMusicAfterVoiceRef.current = false;
              state.onPlayPlaylist(targetPlaylist.id);
              replyWithVoice(aiAction.reply || `Playing ${targetPlaylist.title}.`, {
                autoClosePanel: true,
              });
              return;
            }
            break;
          }
          case 'play_query': {
            const q = (aiAction.query || '').trim();
            if (q) {
              const found = await executeSearchAndPlay(q, aiAction.reply);
              if (found) return;
              replyWithVoice(`I couldn't find "${q}" in the catalog.`, {
                resumePausedMusic: true,
              });
              return;
            }
            break;
          }
          case 'pause':
            resumeMusicAfterVoiceRef.current = false;
            state.onSetPlaying(false);
            replyWithVoice(aiAction.reply || 'Music paused.');
            return;
          case 'resume':
            resumeMusicAfterVoiceRef.current = false;
            if (state.currentTrack) {
              state.onSetPlaying(true);
              replyWithVoice(aiAction.reply || `Resuming ${state.currentTrack.title}.`, {
                autoClosePanel: true,
              });
            } else {
              state.onPlayPlaylist('top-50-hindi');
              replyWithVoice(aiAction.reply || 'Playing Top Hindi Songs.', {
                autoClosePanel: true,
              });
            }
            return;
          case 'next':
            resumeMusicAfterVoiceRef.current = false;
            state.onNext();
            replyWithVoice(aiAction.reply || 'Playing next song.', {
              autoClosePanel: true,
            });
            return;
          case 'previous':
            resumeMusicAfterVoiceRef.current = false;
            state.onPrev();
            replyWithVoice(aiAction.reply || 'Playing previous song.', {
              autoClosePanel: true,
            });
            return;
          case 'shuffle': {
            const nextVal =
              typeof aiAction.boolValue === 'boolean' ? aiAction.boolValue : !state.shuffle;
            state.onToggleShuffle(nextVal);
            replyWithVoice(
              aiAction.reply || (nextVal ? 'Shuffle is now on.' : 'Shuffle is now off.'),
              { resumePausedMusic: true }
            );
            return;
          }
          case 'repeat':
            state.onSetRepeatMode(aiAction.repeatMode || 'all');
            replyWithVoice(aiAction.reply || 'Updated repeat mode.', {
              resumePausedMusic: true,
            });
            return;
          case 'hook_mode': {
            const nextHook = Boolean(aiAction.boolValue);
            state.onSetHookMode(nextHook);
            replyWithVoice(
              aiAction.reply || (nextHook ? 'Hook mode activated.' : 'Switched to full song mode.'),
              { resumePausedMusic: true }
            );
            return;
          }
          case 'mute':
            state.onSetMuted(Boolean(aiAction.boolValue));
            replyWithVoice(
              aiAction.reply || (aiAction.boolValue ? 'Audio muted.' : 'Audio unmuted.'),
              { resumePausedMusic: true }
            );
            return;
          case 'volume_set': {
            const pct = Math.max(0, Math.min(100, Number(aiAction.volumePercent ?? 80)));
            state.onSetMuted(false);
            state.onSetVolume(pct / 100);
            replyWithVoice(aiAction.reply || `Volume set to ${pct} percent.`, {
              resumePausedMusic: true,
            });
            return;
          }
          case 'volume_delta': {
            const step = Number(aiAction.volumeDeltaPercent ?? 20) / 100;
            const nextVol = Math.max(0.05, Math.min(1, state.volume + step));
            state.onSetMuted(false);
            state.onSetVolume(nextVol);
            replyWithVoice(aiAction.reply || `Volume set to ${Math.round(nextVol * 100)} percent.`, {
              resumePausedMusic: true,
            });
            return;
          }
          case 'whats_playing':
            replyWithVoice(
              aiAction.reply ||
                (state.currentTrack
                  ? `Now playing ${state.currentTrack.title} by ${state.currentTrack.artist}.`
                  : 'Nothing is playing right now.'),
              { resumePausedMusic: true }
            );
            return;
          case 'favorite':
            if (state.currentTrack) {
              const like = aiAction.boolValue ?? true;
              if (like !== state.favorites.has(state.currentTrack.id)) {
                state.onToggleFavorite(state.currentTrack.id, state.currentTrack);
              }
            }
            replyWithVoice(aiAction.reply || 'Updated your favorites.', {
              resumePausedMusic: true,
            });
            return;
          case 'navigate':
            if (aiAction.navTarget === 'studio' && state.currentTrack) {
              state.onSetStudioConsoleOpen(true);
            } else if (aiAction.navTarget === 'minimize') {
              state.onSetStudioConsoleOpen(false);
            } else if (
              aiAction.navTarget === 'discover' ||
              aiAction.navTarget === 'playlists' ||
              aiAction.navTarget === 'search'
            ) {
              state.onSetStudioConsoleOpen(false);
              state.onNavigateTab(aiAction.navTarget);
            }
            replyWithVoice(aiAction.reply || 'Done.', { resumePausedMusic: true });
            return;
          case 'smalltalk':
          case 'dismiss':
          case 'unknown':
            replyWithVoice(
              aiAction.reply ||
                "I didn't quite catch a command. Try saying Play followed by a song or playlist.",
              { resumePausedMusic: true }
            );
            return;
        }
      }

      if (intent.type === 'search-and-play') {
        replyWithVoice(`I couldn't find "${intent.query}" in the catalog.`, {
          resumePausedMusic: true,
        });
      } else {
        replyWithVoice(
          `I heard "${cleaned}". Try saying Play followed by a song, artist, or playlist name.`,
          { resumePausedMusic: true }
        );
      }
    },
    [armListeningWindow, executeSearchAndPlay, replyWithVoice]
  );

  const stopRecognition = useCallback(() => {
    if (restartTimerRef.current) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    if (startDelayTimerRef.current) {
      window.clearTimeout(startDelayTimerRef.current);
      startDelayTimerRef.current = null;
    }
    const rec = recognitionRef.current;
    recognitionRef.current = null;
    recognitionModeRef.current = null;
    recognitionActiveRef.current = false;
    if (rec) {
      rec.onstart = null;
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      try {
        rec.abort();
      } catch {
        // ignore
      }
    }
  }, []);

  const startRecognition = useCallback(
    (mode: 'one-shot' | 'wake-standby') => {
      const Ctor = getSpeechRecognitionCtor();
      if (!Ctor) {
        setMicError(
          'Voice recognition is not supported in this browser. Use the command box below instead.'
        );
        return;
      }

      if (mode === 'one-shot') {
        if (isSpeakingRef.current) {
          stopGroovySpeech();
          isSpeakingRef.current = false;
        }

        // If wake-standby is already live, arm it directly instead of aborting/restarting the mic
        if (
          recognitionRef.current &&
          recognitionModeRef.current === 'wake-standby' &&
          recognitionActiveRef.current
        ) {
          setMicError(null);
          setLiveTranscript('');
          armListeningWindow(9000);
          return;
        }
      }

      const hadExistingRecognition = Boolean(recognitionRef.current);
      stopRecognition();
      setMicError(null);
      permissionDeniedRef.current = false;

      let didPauseMusic = false;
      if (mode === 'one-shot') {
        didPauseMusic = pauseMusicTemporarily();
        handledOneShotResultRef.current = false;
        activeListeningRef.current = true;
        triggerWakeChime();
        setPhase('listening');
        setLiveTranscript('');
      } else {
        activeListeningRef.current = false;
        setPhase(Date.now() < armedUntilRef.current ? 'listening' : 'standby');
      }

      const rec = new Ctor();
      rec.continuous = mode === 'wake-standby';
      rec.interimResults = true;
      // en-US catches "Groovy" / "Hey Groovy" reliably on the first call over music; one-shot uses en-IN for Indian song titles
      rec.lang = mode === 'wake-standby' ? 'en-US' : 'en-IN';
      rec.maxAlternatives = 5;

      rec.onstart = () => {
        if (recognitionRef.current !== rec) return;
        recognitionActiveRef.current = true;
        const now = Date.now();
        standbyStartedAtRef.current = now;
        lastStandbyActivityAtRef.current = now;
        if (mode === 'one-shot' || now < armedUntilRef.current) {
          setPhase('listening');
        } else {
          setPhase('standby');
        }
      };

      rec.onresult = (event) => {
        if (recognitionRef.current !== rec) return;
        lastStandbyActivityAtRef.current = Date.now();
        if (isSpeakingRef.current) return;
        consecutiveWakeErrorsRef.current = 0;

        let interim = '';
        let finalText = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const res = event.results[i];
          const text = pickBestTranscript(res);
          if (res.isFinal) {
            finalText += ` ${text}`;
          } else {
            interim += ` ${text}`;
          }
        }

        const interimTrimmed = interim.trim();
        if (interimTrimmed) {
          if (mode === 'one-shot' || Date.now() < armedUntilRef.current) {
            setLiveTranscript(interimTrimmed);
          } else {
            const wakeCheck = extractGroovyWakeCommand(interimTrimmed);
            if (wakeCheck.hasWakeWord) {
              armListeningWindow(8500);
              setLiveTranscript(wakeCheck.command || 'Listening...');
            }
          }
        }

        const finalTrimmed = finalText.trim();
        if (!finalTrimmed) return;

        if (mode === 'one-shot') {
          handledOneShotResultRef.current = true;
          activeListeningRef.current = false;
          armedUntilRef.current = 0;
          try {
            rec.stop();
          } catch {
            // ignore
          }
          void executeGroovyCommand(finalTrimmed);
          return;
        }

        // Wake-word standby mode (when opted-in)
        const { hasWakeWord, command } = extractGroovyWakeCommand(finalTrimmed);
        const isArmed = Date.now() < armedUntilRef.current;

        if (hasWakeWord) {
          if (!command) {
            void executeGroovyCommand('Groovy');
          } else {
            armedUntilRef.current = 0;
            if (armedTimerRef.current) window.clearTimeout(armedTimerRef.current);
            pauseMusicTemporarily();
            void executeGroovyCommand(command);
          }
        } else if (isArmed) {
          armedUntilRef.current = 0;
          if (armedTimerRef.current) window.clearTimeout(armedTimerRef.current);
          void executeGroovyCommand(finalTrimmed);
        }
      };

      rec.onerror = (event) => {
        if (recognitionRef.current !== rec) return;
        recognitionActiveRef.current = false;

        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          permissionDeniedRef.current = true;
          activeListeningRef.current = false;
          setHandsFreeWake(false);
          try {
            localStorage.setItem(HANDS_FREE_WAKE_STORAGE_KEY, 'false');
          } catch {
            // ignore
          }
          setPhase('idle');
          resumeMusicIfNeeded();
          setMicError(
            'Microphone permission was denied. Allow mic access in browser settings or type a command below.'
          );
          stopRecognition();
        } else if (event.error === 'no-speech' && mode === 'one-shot') {
          activeListeningRef.current = false;
          if (!handledOneShotResultRef.current) {
            resumeMusicIfNeeded();
          }
          setPhase(handsFreeWakeRef.current ? 'standby' : 'idle');
          setGroovyReply('No voice detected. Tap the mic to try again.');
        } else if (event.error === 'audio-capture' && mode === 'one-shot') {
          activeListeningRef.current = false;
          if (!handledOneShotResultRef.current) {
            resumeMusicIfNeeded();
          }
          setPhase(handsFreeWakeRef.current ? 'standby' : 'idle');
          setMicError(
            'Could not capture microphone audio. Tap the mic again or type a command below.'
          );
        } else if (
          mode === 'wake-standby' &&
          (event.error === 'audio-capture' || event.error === 'network')
        ) {
          const ranBriefly = Date.now() - standbyStartedAtRef.current < 2800;
          consecutiveWakeErrorsRef.current = ranBriefly
            ? Math.min(4, consecutiveWakeErrorsRef.current + 1)
            : 1;
        }
      };

      rec.onend = () => {
        if (recognitionRef.current !== rec) return;
        recognitionRef.current = null;
        recognitionModeRef.current = null;
        recognitionActiveRef.current = false;
        if (permissionDeniedRef.current) return;

        if (mode === 'one-shot') {
          activeListeningRef.current = false;
          if (!handledOneShotResultRef.current) {
            resumeMusicIfNeeded();
          }
          if (handsFreeWakeRef.current && !document.hidden) {
            restartTimerRef.current = window.setTimeout(() => {
              if (handsFreeWakeRef.current && !recognitionRef.current && !document.hidden) {
                startRecognition('wake-standby');
              }
            }, 220);
          } else if (!isSpeakingRef.current) {
            setPhase('idle');
          }
          return;
        }

        if (Date.now() - standbyStartedAtRef.current > 3500) {
          consecutiveWakeErrorsRef.current = 0;
        }

        if (handsFreeWakeRef.current && !document.hidden) {
          const backoffMs =
            consecutiveWakeErrorsRef.current > 0
              ? Math.min(3500, 800 * consecutiveWakeErrorsRef.current)
              : 60;
          restartTimerRef.current = window.setTimeout(() => {
            if (handsFreeWakeRef.current && !recognitionRef.current && !document.hidden) {
              startRecognition('wake-standby');
            }
          }, backoffMs);
        } else {
          setPhase('idle');
        }
      };

      recognitionRef.current = rec;
      recognitionModeRef.current = mode;

      const beginStart = () => {
        if (recognitionRef.current !== rec) return;
        try {
          rec.start();
        } catch {
          if (recognitionRef.current === rec) {
            recognitionRef.current = null;
            recognitionModeRef.current = null;
            recognitionActiveRef.current = false;
          }
          activeListeningRef.current = false;
          if (mode === 'one-shot' && !handledOneShotResultRef.current) {
            resumeMusicIfNeeded();
          }
          setPhase(handsFreeWakeRef.current ? 'standby' : 'idle');
        }
      };

      // Give Chromium/mobile audio focus ~160ms to settle when music was just paused or a prior recognizer was aborted
      if (hadExistingRecognition || didPauseMusic) {
        startDelayTimerRef.current = window.setTimeout(beginStart, 160);
      } else {
        beginStart();
      }
    },
    [
      armListeningWindow,
      executeGroovyCommand,
      pauseMusicTemporarily,
      resumeMusicIfNeeded,
      stopRecognition,
      triggerWakeChime,
    ]
  );

  // Manage optional Hands-Free Wake standby (off by default for best reliability)
  useEffect(() => {
    if (handsFreeWake) {
      if (!recognitionRef.current && !activeListeningRef.current && !document.hidden) {
        startRecognition('wake-standby');
      }
    } else if (!activeListeningRef.current) {
      stopRecognition();
      if (!isSpeakingRef.current) {
        setPhase('idle');
      }
    }
  }, [handsFreeWake, startRecognition, stopRecognition]);

  // Standby Watchdog when optional Hands-Free mode is turned ON
  useEffect(() => {
    if (!handsFreeWake) return;
    const watchdog = window.setInterval(() => {
      if (
        document.hidden ||
        !handsFreeWakeRef.current ||
        activeListeningRef.current ||
        isSpeakingRef.current ||
        Date.now() < armedUntilRef.current
      ) {
        return;
      }

      const rec = recognitionRef.current;
      if (!rec) {
        if (!restartTimerRef.current && !startDelayTimerRef.current) {
          startRecognition('wake-standby');
        }
        return;
      }

      const now = Date.now();
      if (
        recognitionModeRef.current === 'wake-standby' &&
        now - standbyStartedAtRef.current > 32_000 &&
        now - lastStandbyActivityAtRef.current > 15_000
      ) {
        try {
          rec.stop();
        } catch {
          stopRecognition();
          startRecognition('wake-standby');
        }
      }
    }, 8000);

    return () => window.clearInterval(watchdog);
  }, [handsFreeWake, startRecognition, stopRecognition]);

  // Pause wake recognition cleanly when tab becomes hidden
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        stopRecognition();
      } else if (handsFreeWakeRef.current && !recognitionRef.current) {
        startRecognition('wake-standby');
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stopRecognition();
      if (armedTimerRef.current) window.clearTimeout(armedTimerRef.current);
    };
  }, [startRecognition, stopRecognition]);

  const handleFloatingMicClick = useCallback(() => {
    if (phase === 'listening') {
      armedUntilRef.current = 0;
      if (armedTimerRef.current) window.clearTimeout(armedTimerRef.current);
      if (activeListeningRef.current) {
        activeListeningRef.current = false;
        stopRecognition();
      }
      resumeMusicIfNeeded();
      setPhase(handsFreeWakeRef.current ? 'standby' : 'idle');
      return;
    }

    if (isSpeakingRef.current) {
      greetingActiveRef.current = false;
      stopGroovySpeech();
      isSpeakingRef.current = false;
    }

    const isFirstSessionOpen = !hasGreetedSessionRef.current;
    hasGreetedSessionRef.current = true;
    panelOpenRef.current = true;
    setPanelOpen(true);

    if (isFirstSessionOpen) {
      const greeting = "Hey there! I'm Groovy. What's the vibe today?";
      setGroovyReply(greeting);
      setMicError(null);
      pauseMusicTemporarily();

      if (latestRef.current.voiceRepliesEnabled) {
        greetingActiveRef.current = true;
        isSpeakingRef.current = true;
        setPhase('speaking');
        speakGroovyReply(greeting, {
          onEnd: () => {
            window.setTimeout(() => {
              isSpeakingRef.current = false;
              const shouldListenNext = greetingActiveRef.current && panelOpenRef.current;
              greetingActiveRef.current = false;
              if (!shouldListenNext) return;
              if (speechSupported) {
                startRecognition('one-shot');
              } else {
                resumeMusicIfNeeded();
                setPhase(handsFreeWakeRef.current ? 'standby' : 'idle');
                setMicError(
                  'Voice input is unavailable in this browser. Type your command below for Groovy!'
                );
              }
            }, 200);
          },
        });
        return;
      }
    }

    if (speechSupported) {
      startRecognition('one-shot');
    } else {
      setMicError(
        'Voice input is unavailable in this browser. Type your command below for Groovy!'
      );
    }
  }, [
    pauseMusicTemporarily,
    phase,
    resumeMusicIfNeeded,
    speechSupported,
    startRecognition,
    stopRecognition,
  ]);

  // Desktop keyboard shortcut (Alt + G) for instant Tap-to-Talk
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && (e.key === 'g' || e.key === 'G')) {
        e.preventDefault();
        handleFloatingMicClick();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleFloatingMicClick]);

  const handleToggleHandsFreeWake = () => {
    if (!speechSupported) {
      setMicError(
        'Hands-free wake word requires Chrome, Edge, or Android browser speech support.'
      );
      return;
    }
    setMicError(null);
    consecutiveWakeErrorsRef.current = 0;
    setHandsFreeWake((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(HANDS_FREE_WAKE_STORAGE_KEY, next ? 'true' : 'false');
      } catch {
        // ignore
      }
      if (next) {
        setGroovyReply('Hands-free "Groovy" wake is on (works best with headphones or quiet rooms).');
      } else {
        setGroovyReply('Tap-to-Talk mode active — tap the mic button anytime for best reliability.');
      }
      return next;
    });
  };

  const handleClosePanel = () => {
    if (greetingActiveRef.current || isSpeakingRef.current) {
      greetingActiveRef.current = false;
      stopGroovySpeech();
      isSpeakingRef.current = false;
      resumeMusicIfNeeded();
      setPhase(handsFreeWakeRef.current ? 'standby' : 'idle');
    }
    if (phase === 'listening') {
      armedUntilRef.current = 0;
      if (armedTimerRef.current) window.clearTimeout(armedTimerRef.current);
      if (activeListeningRef.current) {
        activeListeningRef.current = false;
        stopRecognition();
      }
      resumeMusicIfNeeded();
      setPhase(handsFreeWakeRef.current ? 'standby' : 'idle');
    }
    panelOpenRef.current = false;
    setPanelOpen(false);
  };

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cmd = textCommand.trim();
    if (!cmd) return;
    setTextCommand('');
    void executeGroovyCommand(cmd);
  };

  // Position cleanly above bottom nav & mobile mini player / desktop player bar
  const containerBottomClass = studioConsoleOpen
    ? 'bottom-4 right-4 z-[65]'
    : currentTrack
      ? 'bottom-[192px] right-3 lg:bottom-[96px] lg:right-6 z-40'
      : 'bottom-[70px] right-3 lg:bottom-6 lg:right-6 z-40';

  const isListeningNow = phase === 'listening';
  const isStandbyNow = handsFreeWake && phase === 'standby';

  return (
    <div className={`fixed ${containerBottomClass} flex flex-col items-end gap-3 pointer-events-none`}>
      {/* Floating Groovy Assistant Panel */}
      {panelOpen ? (
        <div
          role="dialog"
          aria-label="Groovy Voice Assistant"
          className="pointer-events-auto w-[min(calc(100vw-1.5rem),296px)] rounded-2xl bg-[#11111B]/95 backdrop-blur-2xl border border-violet-500/35 shadow-[0_20px_56px_-14px_rgba(124,58,237,0.6)] overflow-hidden"
        >
          {/* Header */}
          <div className="px-3 py-2 border-b border-white/[0.08] bg-gradient-to-r from-violet-950/60 via-[#131322] to-blue-950/40">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div
                  className={`relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full overflow-hidden border border-violet-400/60 bg-[#141426] shadow-md ${
                    isListeningNow ? 'ring-2 ring-blue-300/80' : ''
                  }`}
                >
                  <img
                    src={groovyAvatarUrl}
                    alt="Groovy"
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover scale-110"
                  />
                </div>
                <div className="flex items-center gap-1.5 min-w-0">
                  <h2 className="font-display text-xs font-bold text-white leading-none">
                    Groovy
                  </h2>
                  <span
                    className={`inline-flex items-center gap-1 text-[10px] font-medium ${
                      isListeningNow
                        ? 'text-blue-300'
                        : phase === 'speaking'
                          ? 'text-violet-300'
                          : isStandbyNow
                            ? 'text-emerald-300'
                            : 'text-slate-400'
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        isListeningNow
                          ? 'bg-blue-400 animate-ping'
                          : phase === 'speaking'
                            ? 'bg-violet-400 animate-pulse'
                            : isStandbyNow
                              ? 'bg-emerald-400'
                              : 'bg-slate-500'
                      }`}
                    />
                    {isListeningNow
                      ? 'Listening...'
                      : phase === 'speaking'
                        ? 'Speaking'
                        : isStandbyNow
                          ? 'Hands-Free'
                          : 'Tap to Talk'}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-0.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setVoiceRepliesEnabled((prev) => !prev)}
                  aria-label={voiceRepliesEnabled ? 'Mute Groovy voice replies' : 'Enable Groovy voice replies'}
                  title={voiceRepliesEnabled ? 'Voice replies: On' : 'Voice replies: Off'}
                  className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${
                    voiceRepliesEnabled
                      ? 'text-blue-300 bg-blue-500/15'
                      : 'text-slate-500 hover:text-slate-200'
                  }`}
                >
                  <Volume2 className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={handleClosePanel}
                  aria-label="Minimize Groovy assistant"
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            <p className="text-[11px] font-medium text-violet-200/95 mt-1 leading-tight">
              Talk to Groovy to Find Music Quickly
            </p>
          </div>

          {/* Body */}
          <div className="p-2.5 space-y-2">
            {/* Optional Hands-Free Wake Toggle (Off by default for best reliability over loud speakers) */}
            <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl bg-white/[0.04] border border-white/[0.06]">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold text-white flex items-center gap-1.5">
                  <Radio
                    className={`w-3 h-3 ${
                      handsFreeWake ? 'text-emerald-400' : 'text-slate-400'
                    }`}
                  />
                  <span>Hands-Free &ldquo;Groovy&rdquo;</span>
                </p>
                <p className="text-[10px] text-slate-400 truncate">
                  Headphones or quiet rooms
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={handsFreeWake}
                onClick={handleToggleHandsFreeWake}
                aria-label="Toggle optional hands-free Groovy wake word"
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors duration-200 ${
                  handsFreeWake
                    ? 'bg-gradient-to-r from-violet-600 to-blue-500'
                    : 'bg-white/[0.14]'
                }`}
              >
                <span
                  className={`h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                    handsFreeWake ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Live Transcript / Groovy Response */}
            <div className="rounded-xl bg-[#090910] border border-white/[0.07] px-2.5 py-2 space-y-1">
              {liveTranscript ? (
                <p className="text-[11px] text-blue-300 font-medium leading-snug">
                  &ldquo;{liveTranscript}&rdquo;
                </p>
              ) : lastUserQuery ? (
                <p className="text-[10px] text-slate-400 truncate">
                  You: &ldquo;{lastUserQuery}&rdquo;
                </p>
              ) : null}

              <p className="text-[11px] text-slate-100 leading-snug">
                {groovyReply}
              </p>

              {micError ? (
                <p className="text-[10px] text-amber-300 pt-0.5">{micError}</p>
              ) : null}
            </div>

            {/* Quick Voice Shortcuts */}
            <div className="flex flex-wrap gap-1">
              {QUICK_COMMANDS.map((cmd) => (
                <button
                  key={cmd}
                  type="button"
                  onClick={() => void executeGroovyCommand(cmd)}
                  className="px-2 py-0.5 rounded-lg bg-white/[0.05] hover:bg-violet-500/20 border border-white/[0.07] hover:border-violet-400/35 text-[10px] text-slate-300 hover:text-white transition-colors"
                >
                  {cmd}
                </button>
              ))}
            </div>

            {/* Fallback Text Command Input + Push-to-Talk */}
            <form onSubmit={handleTextSubmit} className="flex items-center gap-1.5">
              <input
                type="text"
                value={textCommand}
                onChange={(e) => setTextCommand(e.target.value)}
                placeholder='Ask Groovy (e.g. "Play 2 AM")...'
                aria-label="Type a command for Groovy"
                className="flex-1 h-8 rounded-xl bg-[#090910] border border-white/10 px-2.5 text-[11px] text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-500"
              />
              <button
                type="submit"
                aria-label="Send command to Groovy"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/[0.08] hover:bg-white/[0.14] text-white transition-colors"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={handleFloatingMicClick}
                aria-label={isListeningNow ? 'Stop listening' : 'Tap to speak to Groovy'}
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-white transition-all ${
                  isListeningNow
                    ? 'bg-gradient-to-r from-blue-500 to-violet-600 shadow-lg shadow-blue-500/40 animate-pulse'
                    : 'bg-gradient-to-r from-violet-600 to-blue-500 hover:opacity-95'
                }`}
              >
                {speechSupported ? (
                  <Mic className="w-3.5 h-3.5" />
                ) : (
                  <MicOff className="w-3.5 h-3.5" />
                )}
              </button>
            </form>
          </div>
        </div>
      ) : null}

      {/* Floating Bottom-Right Cute Groovy Avatar Button */}
      <button
        type="button"
        onClick={handleFloatingMicClick}
        aria-label="Ask Groovy voice assistant"
        title='Tap to talk to Groovy (auto-pauses music) · Alt+G'
        className={`pointer-events-auto group relative flex h-14 w-14 sm:h-[60px] sm:w-[60px] items-center justify-center rounded-full bg-[#131324] text-white shadow-[0_12px_34px_-6px_rgba(124,58,237,0.9)] border-2 transition-transform duration-150 hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
          isListeningNow
            ? 'border-blue-400 ring-4 ring-blue-400/35'
            : phase === 'speaking'
              ? 'border-violet-300 ring-4 ring-violet-400/30'
              : 'border-violet-400/75'
        }`}
      >
        {isListeningNow ? (
          <span
            aria-hidden="true"
            className="absolute -inset-1 rounded-full bg-blue-400/40 animate-ping"
          />
        ) : null}

        <span className="relative z-10 h-full w-full rounded-full overflow-hidden">
          <img
            src={groovyAvatarUrl}
            alt="Groovy assistant"
            referrerPolicy="no-referrer"
            className={`h-full w-full object-cover transition-transform duration-200 ${
              isListeningNow ? 'scale-110' : 'scale-105 group-hover:scale-110'
            }`}
          />
        </span>

        {/* Subtle Mic / Status Mini Badge */}
        <span
          aria-hidden="true"
          className={`absolute -bottom-0.5 -right-0.5 z-20 flex h-5 w-5 items-center justify-center rounded-full border-2 border-[#09090D] shadow-md ${
            isListeningNow
              ? 'bg-blue-500 text-white animate-pulse'
              : isStandbyNow
                ? 'bg-emerald-500 text-white'
                : 'bg-gradient-to-br from-violet-600 to-blue-500 text-white'
          }`}
        >
          <Mic className="w-2.5 h-2.5" />
        </span>
      </button>
    </div>
  );
}
