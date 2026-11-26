import {
  ArrowLeft,
  AudioLines,
  Compass,
  FolderPlus,
  Library,
  Music2,
  Play,
  Search,
  Settings,
  Shuffle,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AddTrackModal } from './components/AddTrackModal';
import { ArtworkImage } from './components/ArtworkImage';
import { BrandLogo } from './components/BrandLogo';
import { GroovyAssistant } from './components/GroovyAssistant';
import { MediaVaultView } from './components/MediaVaultView';
import { OfflineIndicator } from './components/OfflineIndicator';
import { PlayerBar, type RepeatMode } from './components/PlayerBar';
import { PlaylistCard } from './components/PlaylistCard';
import { PWAInstallButton } from './components/PWAInstallButton';
import { RequestSongModal } from './components/RequestSongModal';
import { SearchExploreView } from './components/SearchExploreView';
import { PlaylistRecommendationsPanel } from './components/PlaylistRecommendationsPanel';
import {
  SettingsModal,
  type AppTheme,
  type NotificationSettings,
} from './components/SettingsModal';
import { TrackRow } from './components/TrackRow';
import { COVER_ASSETS } from './data/catalog';
import {
  assignTrackToPlaylist,
  createVaultTrack,
  fetchCatalogOverview,
  recordTrackPlay,
  removeVaultTrack,
} from './services/clientCatalog';
import type {
  NewAuthorisedTrackInput,
  PlaylistWithStats,
  ProviderStatus,
  Track,
} from './types/music';
import { formatTotalMinutes } from './utils/format';
import {
  LANGUAGE_FILTERS,
  matchesLanguageFilter,
  type LanguageFilter,
} from './utils/languageFilter';
import {
  analyzePlaylistProfile,
  formatPlaylistVibeLine,
} from './utils/playlistRecommendations';

type ActiveTab = 'discover' | 'playlists' | 'search' | 'vault' | 'playlist-detail';
type RegionFilter = 'All' | 'India' | 'Pan-India' | 'Global';

interface FeaturedVoiceCard {
  id: string;
  name: string;
  subtitle: string;
  playlistId: string;
  coverUrl: string;
}

const FEATURED_VOICES: FeaturedVoiceCard[] = [
  {
    id: 'voice-arijit',
    name: 'Arijit Singh & Midnight Soul',
    subtitle: '2 AM ballads & mashups',
    playlistId: '2am-playlist',
    coverUrl: COVER_ASSETS.arijitMidnight,
  },
  {
    id: 'voice-90s',
    name: 'Kumar Sanu & 90s Gold',
    subtitle: 'Golden cassette romance',
    playlistId: '90s-hindi-classics',
    coverUrl: COVER_ASSETS.evergreenRetro,
  },
  {
    id: 'voice-shadi',
    name: 'Shadi, Baraat & Sangeet',
    subtitle: 'Wedding DJ floor bangers',
    playlistId: 'shadi-sangeet-playlist',
    coverUrl: COVER_ASSETS.shadiSangeet,
  },
  {
    id: 'voice-south',
    name: 'Anirudh & South Cinema',
    subtitle: 'Tamil, Telugu & Kannada',
    playlistId: 'south-hits',
    coverUrl: COVER_ASSETS.southCinema,
  },
  {
    id: 'voice-himalayan',
    name: 'Sajjan Raj & Himalayan Folk',
    subtitle: 'Nepali & North East gems',
    playlistId: 'nepali-northeast-hits',
    coverUrl: COVER_ASSETS.himalayanFolk,
  },
  {
    id: 'voice-salon',
    name: 'Salon Grooves & Indipop',
    subtitle: 'Crisp studio bounce',
    playlistId: 'saloon-playlist',
    coverUrl: COVER_ASSETS.salonGroove,
  },
];

function isPlayableTrack(track: Track): boolean {
  return Boolean(track.streamUrl) || (track.playbackRights === 'embed-only' && Boolean(track.embedId));
}

interface OverviewResponse {
  playlists: PlaylistWithStats[];
  tracks: Track[];
  facets: {
    artists: string[];
    albums: string[];
    genres: string[];
    languages: string[];
  };
  providers: ProviderStatus[];
}

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('discover');
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string>('top-50-hindi');
  const [regionFilter, setRegionFilter] = useState<RegionFilter>('All');
  const [languageFilter, setLanguageFilter] = useState<LanguageFilter>('All');
  const [playlistDirectAudioOnly, setPlaylistDirectAudioOnly] = useState(false);
  const [playlistQuery, setPlaylistQuery] = useState('');
  const [playlistSort, setPlaylistSort] = useState<'curated' | 'popular' | 'bpm' | 'title'>('curated');
  const [visibleTrackLimit, setVisibleTrackLimit] = useState(80);

  const [playlists, setPlaylists] = useState<PlaylistWithStats[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [facets, setFacets] = useState<OverviewResponse['facets']>({
    artists: [],
    albums: [],
    genres: [],
    languages: [],
  });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Playback state
  const [queue, setQueue] = useState<Track[]>([]);
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('all');
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [hookMode, setHookMode] = useState(false);
  const [groovyDucking, setGroovyDucking] = useState(false);
  const [metadataTrack, setMetadataTrack] = useState<Track | null>(null);
  const [studioConsoleOpen, setStudioConsoleOpen] = useState(false);
  const [recentlyPlayed, setRecentlyPlayed] = useState<Track[]>(() => {
    try {
      const saved = localStorage.getItem('gg_recently_played_v1');
      if (saved) {
        const parsed = JSON.parse(saved) as Track[];
        if (Array.isArray(parsed)) {
          return parsed.filter(
            (t) =>
              t &&
              t.playbackRights !== 'preview-30s' &&
              t.providerId !== 'itunes-preview' &&
              (t.durationSec === 0 || t.durationSec > 30)
          );
        }
      }
    } catch {
      // ignore storage errors
    }
    return [];
  });

  // Favorites & Modals
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('gg_favorites');
      if (saved) return new Set(JSON.parse(saved) as string[]);
    } catch {
      // ignore storage errors
    }
    return new Set(['gg-01', 'gg-02', 'gg-07']);
  });
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [requestModalOpen, setRequestModalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Theme (always defaults to Dark) & Notification preferences
  const [theme, setTheme] = useState<AppTheme>(() => {
    try {
      return localStorage.getItem('gg_theme_v1') === 'light' ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  });
  const [notifications, setNotifications] = useState<NotificationSettings>(() => {
    try {
      const saved = localStorage.getItem('gg_notifications_v1');
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<NotificationSettings>;
        return {
          nowPlayingAlerts: Boolean(parsed.nowPlayingAlerts),
          curatedPlaylistDrops: parsed.curatedPlaylistDrops ?? true,
          groovyVoiceTips: parsed.groovyVoiceTips ?? true,
        };
      }
    } catch {
      // ignore
    }
    return {
      nowPlayingAlerts: false,
      curatedPlaylistDrops: true,
      groovyVoiceTips: true,
    };
  });

  useEffect(() => {
    try {
      localStorage.setItem('gg_theme_v1', theme);
    } catch {
      // ignore
    }
    const root = document.documentElement;
    if (theme === 'light') {
      root.classList.remove('dark');
      root.classList.add('light');
      document.body.style.backgroundColor = '#F4F5FA';
      document.body.style.color = '#0F172A';
    } else {
      root.classList.remove('light');
      root.classList.add('dark');
      document.body.style.backgroundColor = '#09090D';
      document.body.style.color = '#F4F4F5';
    }
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) {
      themeMeta.setAttribute('content', theme === 'light' ? '#F4F5FA' : '#09090D');
    }
  }, [theme]);

  useEffect(() => {
    try {
      localStorage.setItem('gg_notifications_v1', JSON.stringify(notifications));
    } catch {
      // ignore
    }
  }, [notifications]);

  useEffect(() => {
    if (
      !notifications.nowPlayingAlerts ||
      !isPlaying ||
      !currentTrack ||
      typeof window === 'undefined' ||
      !('Notification' in window) ||
      window.Notification.permission !== 'granted' ||
      !document.hidden
    ) {
      return;
    }
    try {
      const notif = new window.Notification(`Now Playing: ${currentTrack.title}`, {
        body: currentTrack.artist,
        icon: '/pwa-192x192.png',
        silent: true,
      });
      window.setTimeout(() => notif.close(), 3500);
    } catch {
      // ignore notification errors
    }
  }, [currentTrack?.id, isPlaying, notifications.nowPlayingAlerts]);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchCatalogOverview();
      setPlaylists(data.playlists);
      setTracks(data.tracks);
      setFacets(data.facets);
      setProviders(data.providers);

      const playable = data.tracks.filter(isPlayableTrack);
      setQueue((prev) => (prev.length > 0 ? prev : playable));
    } catch {
      setLoadError('Unable to load the GullyGroove music catalog.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    try {
      localStorage.setItem('gg_favorites', JSON.stringify(Array.from(favorites)));
    } catch {
      // ignore
    }
  }, [favorites]);

  useEffect(() => {
    try {
      localStorage.setItem(
        'gg_recently_played_v1',
        JSON.stringify(recentlyPlayed.slice(0, 30))
      );
    } catch {
      // ignore
    }
  }, [recentlyPlayed]);

  const pushRecentlyPlayed = useCallback((track: Track) => {
    setRecentlyPlayed((prev) => [
      track,
      ...prev.filter((t) => t.id !== track.id),
    ].slice(0, 30));
  }, []);

  const handleToggleFavorite = useCallback((trackId: string, discoveredTrack?: Track) => {
    const wasFavorite = favorites.has(trackId);
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(trackId)) next.delete(trackId);
      else next.add(trackId);
      return next;
    });
    if (!wasFavorite && discoveredTrack && !tracks.some((t) => t.id === trackId)) {
      void handleAddToPlaylist(trackId, 'my-playlist', discoveredTrack);
    }
  }, [favorites, tracks]);

  const playTrackFromList = useCallback(
    (track: Track, list: Track[]) => {
      if (
        track.playbackRights === 'metadata-only' ||
        (track.playbackRights === 'embed-only' && !track.embedId)
      ) {
        setIsPlaying(false);
        setMetadataTrack(track);
        return;
      }

      if (currentTrack?.id === track.id) {
        setIsPlaying((prev) => !prev);
        return;
      }

      if (list.length > 0) {
        setQueue(list.filter(isPlayableTrack));
      }
      setMetadataTrack(null);
      setCurrentTrack(track);
      setIsPlaying(true);
      setStudioConsoleOpen(true);
      pushRecentlyPlayed(track);
      recordTrackPlay(track.id);
    },
    [currentTrack?.id, pushRecentlyPlayed]
  );

  const handlePlayPause = useCallback(() => {
    if (!currentTrack) return;
    setIsPlaying((prev) => !prev);
  }, [currentTrack]);

  const getNextTrack = useCallback(
    (fromTrackId?: string): Track | null => {
      const playable = queue.filter(isPlayableTrack);
      if (playable.length === 0) return null;

      if (shuffle && playable.length > 1) {
        const pool = playable.filter((t) => t.id !== fromTrackId);
        return pool[Math.floor(Math.random() * pool.length)] ?? playable[0];
      }

      const idx = playable.findIndex((t) => t.id === fromTrackId);
      if (idx === -1) return playable[0];
      if (idx === playable.length - 1 && repeatMode === 'off') {
        return null;
      }
      return playable[(idx + 1) % playable.length];
    },
    [queue, shuffle, repeatMode]
  );

  const handleCrossfadeComplete = useCallback(
    (nextTrack: Track) => {
      setCurrentTrack(nextTrack);
      setIsPlaying(true);
      pushRecentlyPlayed(nextTrack);
      recordTrackPlay(nextTrack.id);
    },
    [pushRecentlyPlayed]
  );

  const handleNext = useCallback(() => {
    const next = getNextTrack(currentTrack?.id);
    if (!next) {
      setIsPlaying(false);
      return;
    }
    setCurrentTrack(next);
    setIsPlaying(true);
    pushRecentlyPlayed(next);
    recordTrackPlay(next.id);
  }, [getNextTrack, currentTrack?.id, pushRecentlyPlayed]);

  const handlePrev = useCallback(() => {
    const playable = queue.filter(isPlayableTrack);
    if (playable.length === 0) return;
    const idx = playable.findIndex((t) => t.id === currentTrack?.id);
    const prevIdx = idx <= 0 ? playable.length - 1 : idx - 1;
    const prev = playable[prevIdx];
    setCurrentTrack(prev);
    setIsPlaying(true);
    pushRecentlyPlayed(prev);
    recordTrackPlay(prev.id);
  }, [queue, currentTrack?.id, pushRecentlyPlayed]);

  // Global spacebar Play/Pause shortcut
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') {
        return;
      }
      e.preventDefault();
      handlePlayPause();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handlePlayPause]);

  const navigateToTab = useCallback((tab: ActiveTab) => {
    setActiveTab(tab);
    requestAnimationFrame(() => {
      if (window.scrollY > 12) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
  }, []);

  const openPlaylist = useCallback((playlistId: string) => {
    setSelectedPlaylistId(playlistId);
    setPlaylistDirectAudioOnly(false);
    setPlaylistQuery('');
    setPlaylistSort('curated');
    setVisibleTrackLimit(80);
    setActiveTab('playlist-detail');
    requestAnimationFrame(() => {
      if (window.scrollY > 12) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
  }, []);

  const getPlaylistTracks = useCallback(
    (playlistId: string) => {
      if (playlistId === 'my-playlist') {
        return tracks.filter(
          (t) => favorites.has(t.id) || t.playlistIds.includes('my-playlist')
        );
      }
      return tracks.filter((t) => t.playlistIds.includes(playlistId));
    },
    [tracks, favorites]
  );

  const quickPlayPlaylist = useCallback((playlistId: string) => {
    const baseTracks = getPlaylistTracks(playlistId);
    const matchingTracks =
      languageFilter === 'All'
        ? baseTracks
        : baseTracks.filter((t) => matchesLanguageFilter(t, languageFilter));
    const listToPlay = matchingTracks.length > 0 ? matchingTracks : baseTracks;
    if (listToPlay.length > 0) {
      playTrackFromList(listToPlay[0], listToPlay);
    }
  }, [getPlaylistTracks, languageFilter, playTrackFromList]);

  const handleCreateVaultTrack = async (input: NewAuthorisedTrackInput) => {
    const data = await createVaultTrack(input);
    setTracks((prev) => [data.track, ...prev]);
    setPlaylists(data.playlists);
    setFacets(data.facets);
  };

  const handleRemoveVaultTrack = async (trackId: string) => {
    const data = await removeVaultTrack(trackId);
    if (!data) return;
    setTracks((prev) => prev.filter((t) => t.id !== trackId));
    setPlaylists(data.playlists);
    setFacets(data.facets);
  };

  const handleAddToPlaylist = useCallback(async (
    trackId: string,
    playlistId: string,
    discoveredTrack?: Track
  ) => {
    if (playlistId === 'my-playlist') {
      setFavorites((prev) => {
        if (prev.has(trackId)) return prev;
        const next = new Set(prev);
        next.add(trackId);
        return next;
      });
    }
    const data = await assignTrackToPlaylist(playlistId, trackId, discoveredTrack);
    if (!data) return;
    setTracks((prev) => {
      const exists = prev.some((t) => t.id === trackId);
      return exists
        ? prev.map((t) => (t.id === trackId ? data.track : t))
        : [data.track, ...prev];
    });
    setPlaylists(data.playlists);
    setFacets(data.facets);
  }, []);

  const playlistsWithLiveCounts = useMemo(() => {
    return playlists.map((pl) => {
      const plTracks = getPlaylistTracks(pl.id);
      if (plTracks.length === 0 && pl.id !== 'my-playlist') return pl;
      const totalDurationSec = plTracks.reduce((acc, t) => acc + t.durationSec, 0);
      return {
        ...pl,
        trackCount: plTracks.length,
        totalDurationSec,
      };
    });
  }, [playlists, getPlaylistTracks]);

  const playlistsWithLanguageCounts = useMemo(() => {
    if (languageFilter === 'All') return playlistsWithLiveCounts;
    return playlistsWithLiveCounts
      .map((pl) => {
        const matching = getPlaylistTracks(pl.id).filter((t) =>
          matchesLanguageFilter(t, languageFilter)
        );
        const totalDurationSec = matching.reduce((acc, t) => acc + t.durationSec, 0);
        return {
          ...pl,
          trackCount: matching.length,
          totalDurationSec,
        };
      })
      .filter((pl) => pl.trackCount > 0);
  }, [playlistsWithLiveCounts, languageFilter, getPlaylistTracks]);

  const filteredPlaylists = useMemo(() => {
    if (regionFilter === 'All') return playlistsWithLanguageCounts;
    return playlistsWithLanguageCounts.filter((pl) => pl.region === regionFilter);
  }, [playlistsWithLanguageCounts, regionFilter]);

  const totalMatchingLanguageTracks = useMemo(() => {
    if (languageFilter === 'All') return tracks.length;
    return tracks.filter((t) => matchesLanguageFilter(t, languageFilter)).length;
  }, [tracks, languageFilter]);

  const activePlaylist = useMemo(() => {
    const pl =
      playlistsWithLiveCounts.find((p) => p.id === selectedPlaylistId) || null;
    const allTracks = pl ? getPlaylistTracks(pl.id) : [];
    const languageMatchedTracks =
      languageFilter === 'All'
        ? allTracks
        : allTracks.filter((t) => matchesLanguageFilter(t, languageFilter));
    const baseTracks =
      languageFilter !== 'All' && languageMatchedTracks.length > 0
        ? languageMatchedTracks
        : allTracks;
    const directCount = baseTracks.filter((t) => Boolean(t.streamUrl)).length;
    const queryNorm = playlistQuery.trim().toLowerCase();
    let displayedTracks = playlistDirectAudioOnly
      ? baseTracks.filter((t) => Boolean(t.streamUrl))
      : baseTracks;

    if (queryNorm) {
      displayedTracks = displayedTracks.filter(
        (t) =>
          t.title.toLowerCase().includes(queryNorm) ||
          t.artist.toLowerCase().includes(queryNorm) ||
          t.genre.toLowerCase().includes(queryNorm) ||
          t.language.toLowerCase().includes(queryNorm)
      );
    }

    if (playlistSort !== 'curated') {
      displayedTracks = [...displayedTracks].sort((a, b) => {
        if (playlistSort === 'popular') return (b.plays || 0) - (a.plays || 0);
        if (playlistSort === 'bpm') return (b.bpm || 0) - (a.bpm || 0);
        return a.title.localeCompare(b.title);
      });
    }

    const vibeLine = pl
      ? formatPlaylistVibeLine(analyzePlaylistProfile(pl, allTracks))
      : '';

    return {
      playlist: pl,
      allTracks,
      languageMatchedCount: languageMatchedTracks.length,
      displayedTracks,
      directCount,
      vibeLine,
    };
  }, [
    selectedPlaylistId,
    playlistsWithLiveCounts,
    getPlaylistTracks,
    playlistDirectAudioOnly,
    playlistQuery,
    playlistSort,
    languageFilter,
  ]);

  const vaultTracks = useMemo(() => tracks.filter((t) => t.isUserAdded), [tracks]);
  const studioTracks = useMemo(() => tracks.filter((t) => !t.isUserAdded), [tracks]);

  const topBreadcrumb =
    activeTab === 'discover'
      ? 'Discover'
      : activeTab === 'playlists'
        ? 'Curated Playlists'
        : activeTab === 'search'
          ? 'Search'
          : activeTab === 'vault'
            ? 'Media Vault'
            : `Playlists / ${activePlaylist.playlist?.title || 'Playlist'}`;

  return (
    <div className="min-h-screen bg-[#09090D] text-slate-100 flex flex-col lg:flex-row">
      {/* Desktop Left Sidebar — Dual-Panel Spotify-Style Dark Studio Rail */}
      <aside
        className={`hidden lg:flex lg:w-64 xl:w-72 lg:shrink-0 lg:flex-col lg:fixed lg:inset-y-0 lg:left-0 bg-[#07070B] p-2.5 gap-2.5 ${
          currentTrack ? 'pb-24' : 'pb-2.5'
        }`}
      >
        {/* Top Navigation Panel */}
        <div className="rounded-2xl bg-[#101017] border border-white/[0.07] p-3 space-y-3">
          <button
            type="button"
            onClick={() => navigateToTab('discover')}
            className="flex items-center gap-2.5 px-2 py-1 text-left focus-visible:outline-none"
          >
            <BrandLogo size="md" />
            <span className="font-display text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0">
              Gully
              <span className="bg-gradient-to-r from-violet-400 to-cyan-400 bg-clip-text text-transparent">
                Groove
              </span>
            </span>
          </button>

          <nav aria-label="Sidebar Navigation" className="space-y-1">
            <button
              type="button"
              onClick={() => navigateToTab('discover')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-[background-color,border-color,color] duration-150 ease-out ${
                activeTab === 'discover'
                  ? 'bg-gradient-to-r from-violet-600/25 to-blue-500/20 text-white border border-violet-500/30'
                  : 'text-slate-400 hover:text-white hover:bg-white/[0.05] border border-transparent'
              }`}
            >
              <Compass className="w-4 h-4 text-violet-400 shrink-0" />
              Discover
            </button>

            <button
              type="button"
              onClick={() => navigateToTab('playlists')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-[background-color,border-color,color] duration-150 ease-out ${
                activeTab === 'playlists' || activeTab === 'playlist-detail'
                  ? 'bg-gradient-to-r from-violet-600/25 to-blue-500/20 text-white border border-violet-500/30'
                  : 'text-slate-400 hover:text-white hover:bg-white/[0.05] border border-transparent'
              }`}
            >
              <Library className="w-4 h-4 text-blue-400 shrink-0" />
              All Playlists
            </button>

            <button
              type="button"
              onClick={() => navigateToTab('vault')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-[background-color,border-color,color] duration-150 ease-out ${
                activeTab === 'vault'
                  ? 'bg-gradient-to-r from-violet-600/25 to-blue-500/20 text-white border border-violet-500/30'
                  : 'text-slate-400 hover:text-white hover:bg-white/[0.05] border border-transparent'
              }`}
            >
              <FolderPlus className="w-4 h-4 text-blue-400 shrink-0" />
              Media Vault
            </button>
          </nav>
        </div>

        {/* Curated Library Panel with Artwork Thumbnails */}
        <div className="flex-1 flex flex-col min-h-0 rounded-2xl bg-[#101017] border border-white/[0.07] p-3">
          <div className="px-2 pb-2.5 flex items-center justify-between border-b border-white/[0.06]">
            <span className="text-xs font-semibold text-slate-300">
              Your Library
            </span>
            <span className="text-[11px] font-mono-tabular text-slate-500">
              {playlistsWithLiveCounts.length} playlists
            </span>
          </div>

          <div className="flex-1 overflow-y-auto scroll-smooth space-y-1 pt-2 pr-1">
            {playlistsWithLiveCounts.map((pl) => {
              const selected =
                activeTab === 'playlist-detail' && selectedPlaylistId === pl.id;
              return (
                <button
                  key={pl.id}
                  type="button"
                  onClick={() => openPlaylist(pl.id)}
                  className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-xl text-left transition-all duration-150 ${
                    selected
                      ? 'bg-gradient-to-r from-violet-600/25 to-blue-500/15 text-white border border-violet-500/30'
                      : 'text-slate-400 hover:text-slate-100 hover:bg-white/[0.05] border border-transparent'
                  }`}
                >
                  <div className="h-9 w-9 shrink-0 overflow-hidden rounded-lg bg-[#161622]">
                    <ArtworkImage
                      src={pl.coverUrl}
                      alt={pl.title}
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-slate-100">
                      {pl.title}
                    </div>
                    <div className="truncate text-[11px] text-slate-500 font-mono-tabular">
                      {pl.trackCount} tracks
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </aside>

      {/* Main Viewport Container */}
      <div className="flex-1 lg:pl-64 xl:pl-72 flex flex-col min-w-0 gg-studio-ambient">
        {/* Desktop Top Bar — 3 Clean Zones */}
        <header className="hidden lg:flex sticky top-0 z-30 h-16 items-center justify-between gap-6 px-8 bg-[#09090D]/85 backdrop-blur-xl border-b border-white/[0.07]">
          {/* Zone 1: Single-line context / breadcrumb */}
          <span className="font-display text-sm font-semibold text-slate-200 whitespace-nowrap shrink-0 truncate max-w-xs">
            {topBreadcrumb}
          </span>

          {/* Zone 2: Clean single-line text nav links */}
          <nav className="flex items-center gap-6 text-sm font-medium">
            <button
              type="button"
              onClick={() => navigateToTab('discover')}
              className={`whitespace-nowrap shrink-0 py-1 transition-colors border-b-2 ${
                activeTab === 'discover'
                  ? 'text-white border-violet-500'
                  : 'text-slate-400 border-transparent hover:text-white'
              }`}
            >
              Discover
            </button>
            <button
              type="button"
              onClick={() => navigateToTab('playlists')}
              className={`whitespace-nowrap shrink-0 py-1 transition-colors border-b-2 ${
                activeTab === 'playlists' || activeTab === 'playlist-detail'
                  ? 'text-white border-violet-500'
                  : 'text-slate-400 border-transparent hover:text-white'
              }`}
            >
              Playlists
            </button>
            <button
              type="button"
              onClick={() => navigateToTab('search')}
              className={`whitespace-nowrap shrink-0 py-1 transition-colors border-b-2 ${
                activeTab === 'search'
                  ? 'text-white border-violet-500'
                  : 'text-slate-400 border-transparent hover:text-white'
              }`}
            >
              Search
            </button>
          </nav>

          {/* Zone 3: Compact Request Song + Top-Right Settings */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setRequestModalOpen(true)}
              aria-label="Request a song"
              title="Request a missing song"
              className="inline-flex h-7 items-center gap-1 px-2.5 rounded-full bg-gradient-to-r from-violet-600 via-fuchsia-600/90 to-blue-500 border border-violet-300/35 text-[11px] font-semibold tracking-tight text-white shadow-[0_3px_12px_-2px_rgba(124,58,237,0.65)] hover:brightness-110 active:scale-[0.97] transform-gpu transition-all whitespace-nowrap shrink-0"
            >
              <Music2 className="w-3 h-3 text-violet-100 shrink-0" />
              <span>Request Song</span>
            </button>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              aria-label="Open Settings"
              title="Settings"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-slate-200 hover:text-white transition-colors shrink-0"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Mobile & Tablet Compact Sticky Top Bar (52px) */}
        <header className="lg:hidden sticky top-0 z-30 flex h-[52px] items-center justify-between gap-2 px-3 sm:px-4 bg-[#09090D]/90 backdrop-blur-xl border-b border-white/[0.07]">
          <button
            type="button"
            onClick={() => navigateToTab('discover')}
            className="flex items-center gap-1.5 sm:gap-2 whitespace-nowrap shrink-0 min-w-0"
          >
            <BrandLogo size="sm" />
            <span className="font-display text-[15px] sm:text-base font-bold tracking-tight text-white truncate">
              Gully
              <span className="bg-gradient-to-r from-violet-400 to-cyan-400 bg-clip-text text-transparent">
                Groove
              </span>
            </span>
          </button>

          <div className="flex items-center gap-1.5 shrink-0">
            <PWAInstallButton variant="header" />
            <button
              type="button"
              onClick={() => setRequestModalOpen(true)}
              aria-label="Request a song"
              title="Request a missing song"
              className="inline-flex h-6 sm:h-7 items-center gap-0.5 sm:gap-1 px-1.5 sm:px-2 rounded-full bg-gradient-to-r from-violet-600 via-fuchsia-600/90 to-blue-500 border border-violet-300/35 text-[9.5px] sm:text-[10.5px] font-semibold tracking-tight text-white shadow-[0_3px_10px_-2px_rgba(124,58,237,0.65)] hover:brightness-110 active:scale-[0.97] transition-all whitespace-nowrap shrink-0"
            >
              <Music2 className="w-2.5 h-2.5 text-violet-100 shrink-0" />
              <span>Request Song</span>
            </button>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              aria-label="Open Settings"
              title="Settings"
              className="inline-flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-lg bg-white/[0.08] hover:bg-white/[0.14] border border-white/10 text-slate-200 hover:text-white transition-colors shrink-0"
            >
              <Settings className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </button>
          </div>
        </header>

        {/* Main Scrollable Content Area */}
        <main
          className={`flex-1 px-3 sm:px-6 lg:px-8 py-4 sm:py-6 max-w-7xl w-full mx-auto ${
            currentTrack ? 'pb-48 lg:pb-28' : 'pb-20 lg:pb-10'
          }`}
        >
          {loadError ? (
            <div className="p-6 rounded-2xl bg-red-950/30 border border-red-500/30 text-sm text-red-200 flex items-center justify-between gap-4">
              <span>{loadError}</span>
              <button
                type="button"
                onClick={loadOverview}
                className="px-4 py-2 rounded-lg bg-white/10 text-xs font-semibold text-white hover:bg-white/15"
              >
                Retry
              </button>
            </div>
          ) : loading ? (
            <div className="space-y-6">
              <div className="h-56 sm:h-64 rounded-2xl bg-white/[0.04] animate-pulse" />
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="h-16 rounded-xl bg-white/[0.04] animate-pulse" />
                ))}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="aspect-square rounded-xl bg-white/[0.04] animate-pulse" />
                ))}
              </div>
            </div>
          ) : (
            <>
              {/* DISCOVER VIEW */}
              {activeTab === 'discover' ? (
                <div className="space-y-8 sm:space-y-10 gg-view-enter">
                  {/* Hero Stage Banner */}
                  <section className="gg-keep-dark relative overflow-hidden rounded-2xl border border-violet-500/20 bg-[#101018] shadow-[0_24px_60px_-28px_rgba(124,58,237,0.45)]">
                    <div className="absolute inset-0">
                      <ArtworkImage
                        src={COVER_ASSETS.heroStage}
                        alt="GullyGroove studio stage"
                        className="w-full h-full object-cover object-center"
                      />
                      <div className="absolute inset-0 bg-gradient-to-r from-[#09090D] via-[#09090D]/88 to-[#1E1038]/55" />
                    </div>

                    <div className="relative z-10 px-4 py-7 sm:px-10 sm:py-12 max-w-2xl space-y-3 sm:space-y-4">
                      <p className="text-xs font-semibold tracking-wide text-blue-300">
                        GullyGroove – Feel the Beat. Live the Vibe.
                      </p>
                      <h1 className="font-display text-2xl sm:text-4xl lg:text-5xl font-extrabold text-white leading-[1.1] tracking-tight">
                        Built for Every Indian Road, Mehfil &amp; Night.
                      </h1>
                      <p className="text-xs sm:text-base text-slate-300 leading-relaxed max-w-xl">
                        Stream seamless audio and curated regional collections with smooth crossfade transitions and immersive Hook Mode.
                      </p>

                      <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2.5 sm:gap-3 pt-1 sm:pt-2">
                        <button
                          type="button"
                          onClick={() => quickPlayPlaylist('top-50-hindi')}
                          className="inline-flex h-11 items-center justify-center gap-2 px-5 sm:px-6 rounded-xl bg-gradient-to-r from-violet-600 to-blue-500 text-sm font-semibold text-white shadow-lg shadow-violet-950/60 hover:opacity-95 active:scale-[0.99] transition-all whitespace-nowrap shrink-0"
                        >
                          <Play className="w-4 h-4 fill-current" />
                          Top Hindi Songs Playlist
                        </button>

                        <button
                          type="button"
                          onClick={() => navigateToTab('playlists')}
                          className="inline-flex h-11 items-center justify-center gap-2 px-5 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] border border-white/15 text-sm font-medium text-white transition-colors whitespace-nowrap shrink-0"
                        >
                          Browse All {playlistsWithLiveCounts.length} Playlists
                        </button>

                        <PWAInstallButton variant="hero" />
                      </div>
                    </div>
                  </section>

                  {/* iPhone / iPad Safari Home Screen Guide Card (auto-hidden on Android/Desktop/Standalone) */}
                  <PWAInstallButton variant="ios-card" />

                  {/* Recently Played Songs Strip (appears cleanly once user has played music) */}
                  {recentlyPlayed.length > 0 ? (
                    <section className="space-y-3.5">
                      <div className="flex items-center justify-between">
                        <div>
                          <h2 className="font-display text-lg sm:text-xl font-bold text-white">
                            Recently Played
                          </h2>
                          <p className="text-xs text-slate-400 mt-0.5">
                            Jump back into your latest tracks in the Studio Player.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setRecentlyPlayed([])}
                          className="text-xs font-medium text-slate-400 hover:text-white whitespace-nowrap shrink-0"
                        >
                          Clear History
                        </button>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
                        {recentlyPlayed.slice(0, 8).map((track) => {
                          const active = currentTrack?.id === track.id;
                          return (
                            <button
                              key={track.id}
                              type="button"
                              onClick={() => playTrackFromList(track, recentlyPlayed)}
                              className={`group flex items-center gap-3 rounded-xl p-2.5 text-left border transition-all duration-150 ${
                                active
                                  ? 'bg-gradient-to-r from-violet-600/20 to-blue-500/15 border-violet-500/40'
                                  : 'bg-[#12121B] border-white/[0.06] hover:bg-[#191926] hover:border-violet-500/35'
                              }`}
                            >
                              <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-[#0D0D14]">
                                <ArtworkImage
                                  src={track.coverUrl}
                                  alt={track.title}
                                  className="h-full w-full object-cover"
                                />
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-semibold text-white truncate">
                                  {track.title}
                                </p>
                                <p className="text-[11px] text-slate-400 truncate mt-0.5">
                                  {track.artist}
                                </p>
                              </div>
                              <Play className="w-3.5 h-3.5 text-violet-300 opacity-70 group-hover:opacity-100 shrink-0" />
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  ) : null}

                  {/* Curated Playlists Grid with Bhasha (Language) & Region Filter Tabs */}
                  <section className="space-y-4 sm:space-y-5">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <h2 className="font-display text-xl sm:text-2xl font-bold text-white">
                          Pick Your Mood &amp; Vibe
                        </h2>
                        <p className="text-xs sm:text-sm text-slate-400 mt-0.5">
                          {languageFilter === 'All'
                            ? `${filteredPlaylists.length} curated playlists across ${tracks.length} tracks — Hindi, Punjabi, South, Bhakti & beyond.`
                            : `Showing ${filteredPlaylists.length} vibes · ${totalMatchingLanguageTracks} songs in ${languageFilter}`}
                        </p>
                      </div>
                    </div>

                    {/* Bhasha / Language Filter Bar (Bajao-style multi-language selector) */}
                    <div
                      className="flex items-center gap-1.5 overflow-x-auto pb-1"
                      role="tablist"
                      aria-label="Filter playlists by language"
                    >
                      {LANGUAGE_FILTERS.map((lang) => (
                        <button
                          key={lang}
                          type="button"
                          role="tab"
                          aria-selected={languageFilter === lang}
                          onClick={() => setLanguageFilter(lang)}
                          className={`px-3.5 py-2 text-xs font-medium rounded-xl border whitespace-nowrap shrink-0 transition-all duration-150 ${
                            languageFilter === lang
                              ? 'bg-gradient-to-r from-violet-600/90 to-blue-500/90 border-violet-400/50 text-white shadow-md shadow-violet-950/40'
                              : 'bg-[#12121B] border-white/[0.07] text-slate-300 hover:text-white hover:border-violet-500/35'
                          }`}
                        >
                          {lang}
                        </button>
                      ))}
                      {(languageFilter !== 'All' || regionFilter !== 'All') ? (
                        <button
                          type="button"
                          onClick={() => {
                            setLanguageFilter('All');
                            setRegionFilter('All');
                          }}
                          className="px-3 py-2 text-xs font-medium text-blue-400 hover:text-blue-300 whitespace-nowrap shrink-0"
                        >
                          Reset filters
                        </button>
                      ) : null}
                    </div>

                    {filteredPlaylists.length === 0 ? (
                      <div className="py-10 px-4 text-center rounded-2xl bg-[#12121B] border border-white/[0.07]">
                        <p className="text-sm text-slate-300">
                          No playlists matched {languageFilter} in the {regionFilter} filter.
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            setLanguageFilter('All');
                            setRegionFilter('All');
                          }}
                          className="mt-3 px-4 py-2 text-xs font-semibold text-white rounded-xl bg-gradient-to-r from-violet-600 to-blue-500"
                        >
                          Show All Playlists
                        </button>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
                        {filteredPlaylists.map((playlist) => (
                          <PlaylistCard
                            key={playlist.id}
                            playlist={playlist}
                            activeLanguage={languageFilter}
                            onSelect={openPlaylist}
                            onQuickPlay={quickPlayPlaylist}
                          />
                        ))}
                      </div>
                    )}
                  </section>

                  {/* Featured Voices & Soundscapes — Visual Artist / Editorial Showcase */}
                  <section className="space-y-4">
                    <div>
                      <h2 className="font-display text-xl font-bold text-white">
                        Featured Voices &amp; Soundscapes
                      </h2>
                      <p className="text-xs sm:text-sm text-slate-400 mt-0.5">
                        Jump straight into signature artists, wedding floors, and regional studios.
                      </p>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
                      {FEATURED_VOICES.map((voice) => (
                        <button
                          key={voice.id}
                          type="button"
                          onClick={() => openPlaylist(voice.playlistId)}
                          className="group flex flex-col items-center text-center rounded-2xl bg-[#12121B] border border-white/[0.06] p-3.5 transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#191926] hover:border-violet-500/35"
                        >
                          <div className="w-24 h-24 sm:w-28 sm:h-28 overflow-hidden rounded-full border-2 border-violet-500/25 shadow-lg shadow-violet-950/40 bg-[#0D0D14]">
                            <ArtworkImage
                              src={voice.coverUrl}
                              alt={voice.name}
                              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                            />
                          </div>
                          <span className="mt-3 font-display text-xs sm:text-sm font-semibold text-slate-100 line-clamp-1 group-hover:text-white">
                            {voice.name}
                          </span>
                          <span className="mt-0.5 text-[11px] text-slate-400 line-clamp-1">
                            {voice.subtitle}
                          </span>
                        </button>
                      ))}
                    </div>
                  </section>
                </div>
              ) : null}

              {/* ALL PLAYLISTS VIEW */}
              {activeTab === 'playlists' ? (
                <section className="space-y-5 gg-view-enter">
                  <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-white/[0.08] pb-5">
                    <div>
                      <h1 className="font-display text-2xl sm:text-3xl font-bold text-white">
                        All Curated Playlists
                      </h1>
                      <p className="text-sm text-slate-400 mt-1">
                        {languageFilter === 'All'
                          ? 'Every vibe from Top Hindi Songs, Bhakti & All in One to Shadi Sangeet and Highway Classics.'
                          : `Filtered by ${languageFilter} · ${filteredPlaylists.length} matching playlists`}
                      </p>
                    </div>
                  </div>

                  {/* Bhasha Filter Strip */}
                  <div
                    className="flex items-center gap-1.5 overflow-x-auto pb-1"
                    role="tablist"
                    aria-label="Filter playlists by language"
                  >
                    {LANGUAGE_FILTERS.map((lang) => (
                      <button
                        key={lang}
                        type="button"
                        role="tab"
                        aria-selected={languageFilter === lang}
                        onClick={() => setLanguageFilter(lang)}
                        className={`px-3.5 py-2 text-xs font-medium rounded-xl border whitespace-nowrap shrink-0 transition-all duration-150 ${
                          languageFilter === lang
                            ? 'bg-gradient-to-r from-violet-600/90 to-blue-500/90 border-violet-400/50 text-white shadow-md shadow-violet-950/40'
                            : 'bg-[#12121B] border-white/[0.07] text-slate-300 hover:text-white hover:border-violet-500/35'
                        }`}
                      >
                        {lang}
                      </button>
                    ))}
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-5">
                    {filteredPlaylists.map((playlist) => (
                      <PlaylistCard
                        key={playlist.id}
                        playlist={playlist}
                        activeLanguage={languageFilter}
                        onSelect={openPlaylist}
                        onQuickPlay={quickPlayPlaylist}
                      />
                    ))}
                  </div>
                </section>
              ) : null}

              {/* PLAYLIST DETAIL VIEW */}
              {activeTab === 'playlist-detail' && activePlaylist.playlist ? (
                <section key={`detail-${selectedPlaylistId}`} className="space-y-5 sm:space-y-6 gg-view-enter">
                  <button
                    type="button"
                    onClick={() => navigateToTab('playlists')}
                    className="inline-flex h-9 items-center gap-2 text-xs font-medium text-slate-400 hover:text-white transition-colors"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    Back to Playlists
                  </button>

                  <div className="relative overflow-hidden flex flex-col md:flex-row items-center md:items-end gap-5 sm:gap-6 p-4 sm:p-6 rounded-2xl bg-gradient-to-br from-violet-950/55 via-[#131320] to-blue-950/40 border border-violet-500/20 text-center md:text-left">
                    <div className="w-36 h-36 sm:w-52 sm:h-52 shrink-0 overflow-hidden rounded-xl shadow-2xl shadow-violet-950/70 border border-white/10">
                      <ArtworkImage
                        src={activePlaylist.playlist.coverUrl}
                        alt={activePlaylist.playlist.title}
                      />
                    </div>

                    <div className="flex-1 min-w-0 w-full space-y-2.5 sm:space-y-3">
                      <p className="text-xs font-medium text-blue-300">
                        {activePlaylist.playlist.mood} · {activePlaylist.playlist.region}
                      </p>
                      <h1 className="font-display text-2xl sm:text-4xl font-extrabold text-white tracking-tight">
                        {activePlaylist.playlist.title}
                      </h1>
                      <p className="text-xs sm:text-sm text-slate-300 max-w-2xl leading-relaxed">
                        {activePlaylist.playlist.description}
                      </p>

                      <div className="flex flex-wrap items-center justify-center md:justify-start gap-2 text-xs text-slate-400 font-mono-tabular">
                        <span>Curated by {activePlaylist.playlist.curatedBy}</span>
                        <span aria-hidden="true">·</span>
                        <span>{activePlaylist.allTracks.length} tracks</span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {formatTotalMinutes(activePlaylist.playlist.totalDurationSec)}
                        </span>
                      </div>

                      {activePlaylist.vibeLine ? (
                        <p className="text-[11px] text-slate-300/90 font-mono-tabular">
                          Musical DNA · {activePlaylist.vibeLine}
                        </p>
                      ) : null}

                      <div className="flex flex-wrap items-center justify-center md:justify-start gap-2.5 pt-2">
                        <button
                          type="button"
                          disabled={activePlaylist.displayedTracks.length === 0}
                          onClick={() => {
                            if (activePlaylist.displayedTracks.length > 0) {
                              setShuffle(false);
                              playTrackFromList(
                                activePlaylist.displayedTracks[0],
                                activePlaylist.displayedTracks
                              );
                            }
                          }}
                          className="flex-1 sm:flex-none inline-flex h-11 items-center justify-center gap-2 px-6 rounded-xl bg-gradient-to-r from-violet-600 to-blue-500 text-xs font-semibold text-white shadow-lg shadow-violet-950/50 hover:opacity-95 disabled:opacity-40 whitespace-nowrap shrink-0"
                        >
                          <Play className="w-4 h-4 fill-current" />
                          Play Playlist
                        </button>

                        <button
                          type="button"
                          disabled={activePlaylist.displayedTracks.length === 0}
                          onClick={() => {
                            if (activePlaylist.displayedTracks.length > 0) {
                              setShuffle(true);
                              const pick =
                                activePlaylist.displayedTracks[
                                  Math.floor(Math.random() * activePlaylist.displayedTracks.length)
                                ];
                              playTrackFromList(pick, activePlaylist.displayedTracks);
                            }
                          }}
                          className="flex-1 sm:flex-none inline-flex h-11 items-center justify-center gap-2 px-4 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-xs font-medium text-white disabled:opacity-40 whitespace-nowrap shrink-0"
                        >
                          <Shuffle className="w-4 h-4" />
                          Shuffle
                        </button>

                        <button
                          type="button"
                          onClick={() => setPlaylistDirectAudioOnly((prev) => !prev)}
                          aria-pressed={playlistDirectAudioOnly}
                          className={`inline-flex h-11 items-center justify-center gap-2 px-4 rounded-xl border text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                            playlistDirectAudioOnly
                              ? 'bg-gradient-to-r from-violet-600/35 to-blue-500/30 border-violet-400/50 text-white'
                              : 'bg-[#12121B] border-white/10 text-slate-300 hover:text-white hover:border-violet-500/35'
                          }`}
                        >
                          <AudioLines className="w-4 h-4 text-blue-400" />
                          {playlistDirectAudioOnly
                            ? `Direct Audio Only (${activePlaylist.directCount})`
                            : 'Direct Audio Only (Ad-Free)'}
                        </button>

                        {languageFilter !== 'All' && activePlaylist.languageMatchedCount > 0 ? (
                          <button
                            type="button"
                            onClick={() => setLanguageFilter('All')}
                            className="inline-flex h-11 items-center justify-center gap-2 px-4 rounded-xl bg-violet-500/15 border border-violet-400/35 text-xs font-medium text-violet-200 hover:bg-violet-500/25 transition-colors whitespace-nowrap shrink-0"
                          >
                            {languageFilter} Only ({activePlaylist.languageMatchedCount}) · Show All
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  {/* In-Playlist Filter & Sort Bar */}
                  {activePlaylist.allTracks.length > 0 ? (
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
                      <div className="relative flex-1 sm:max-w-xs">
                        <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                          type="search"
                          value={playlistQuery}
                          onChange={(e) => setPlaylistQuery(e.target.value)}
                          placeholder="Filter songs or artists in playlist..."
                          aria-label="Filter songs or artists in playlist"
                          className="w-full h-10 pl-8 pr-3 rounded-xl bg-[#12121B] border border-white/10 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-violet-400"
                        />
                      </div>

                      <div className="flex items-center justify-between sm:justify-end gap-2">
                        <span className="text-[11px] font-mono-tabular text-slate-400">
                          {activePlaylist.displayedTracks.length} shown
                        </span>
                        <select
                          aria-label="Sort playlist tracks"
                          value={playlistSort}
                          onChange={(e) =>
                            setPlaylistSort(
                              e.target.value as 'curated' | 'popular' | 'bpm' | 'title'
                            )
                          }
                          className="h-10 px-3 rounded-xl bg-[#12121B] border border-white/10 text-xs font-medium text-slate-200 focus:outline-none focus:border-violet-400"
                        >
                          <option value="curated">Curated Order</option>
                          <option value="popular">Most Popular</option>
                          <option value="bpm">Tempo (BPM)</option>
                          <option value="title">Title (A–Z)</option>
                        </select>
                      </div>
                    </div>
                  ) : null}

                  {activePlaylist.displayedTracks.length === 0 ? (
                    <div className="py-12 px-4 text-center rounded-xl bg-[#12121B] border border-white/[0.07]">
                      <p className="text-sm text-slate-300">
                        {playlistQuery.trim()
                          ? `No tracks in this playlist match “${playlistQuery.trim()}”.`
                          : playlistDirectAudioOnly && activePlaylist.allTracks.length > 0
                            ? 'This playlist uses embedded YouTube tracks and has no direct HTML5 audio streams yet.'
                            : 'No tracks in this playlist yet.'}
                      </p>
                      {playlistQuery.trim() ? (
                        <button
                          type="button"
                          onClick={() => setPlaylistQuery('')}
                          className="mt-3 px-4 py-2 text-xs font-semibold text-white rounded-lg bg-gradient-to-r from-violet-600 to-blue-500"
                        >
                          Clear Filter
                        </button>
                      ) : playlistDirectAudioOnly && activePlaylist.allTracks.length > 0 ? (
                        <button
                          type="button"
                          onClick={() => setPlaylistDirectAudioOnly(false)}
                          className="mt-3 px-4 py-2 text-xs font-semibold text-white rounded-lg bg-gradient-to-r from-violet-600 to-blue-500"
                        >
                          Show All {activePlaylist.allTracks.length} Tracks
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => navigateToTab('search')}
                          className="mt-3 px-4 py-2 text-xs font-semibold text-white rounded-lg bg-gradient-to-r from-violet-600 to-blue-500"
                        >
                          Discover Tracks to Add
                        </button>
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="divide-y divide-white/[0.04]">
                        {activePlaylist.displayedTracks
                          .slice(0, visibleTrackLimit)
                          .map((track, idx) => (
                            <TrackRow
                              key={track.id}
                              track={track}
                              index={idx}
                              isCurrent={currentTrack?.id === track.id}
                              isPlaying={isPlaying}
                              isFavorite={favorites.has(track.id)}
                              playlists={playlistsWithLiveCounts}
                              onPlayToggle={(t) =>
                                playTrackFromList(t, activePlaylist.displayedTracks)
                              }
                              onToggleFavorite={handleToggleFavorite}
                              onAddToPlaylist={handleAddToPlaylist}
                            />
                          ))}
                      </div>

                      {activePlaylist.displayedTracks.length > visibleTrackLimit ? (
                        <div className="pt-4 flex flex-wrap items-center justify-center gap-3">
                          <button
                            type="button"
                            onClick={() => setVisibleTrackLimit((prev) => prev + 100)}
                            className="inline-flex h-10 items-center justify-center px-5 rounded-xl bg-white/[0.07] hover:bg-white/[0.12] border border-white/10 text-xs font-semibold text-white transition-colors"
                          >
                            Load 100 More ({visibleTrackLimit} of {activePlaylist.displayedTracks.length})
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setVisibleTrackLimit(activePlaylist.displayedTracks.length)
                            }
                            className="inline-flex h-10 items-center justify-center px-4 rounded-xl text-xs font-medium text-blue-300 hover:text-blue-200 transition-colors"
                          >
                            Show All {activePlaylist.displayedTracks.length} Songs
                          </button>
                        </div>
                      ) : null}
                    </>
                  )}

                  {/* Smart Song Recommendations tailored to existing playlist DNA */}
                  <PlaylistRecommendationsPanel
                    key={activePlaylist.playlist.id}
                    playlist={activePlaylist.playlist}
                    playlistTracks={activePlaylist.allTracks}
                    allTracks={tracks}
                    favorites={favorites}
                    recentlyPlayed={recentlyPlayed}
                    currentTrackId={currentTrack?.id || null}
                    isPlaying={isPlaying}
                    onPlayTrack={playTrackFromList}
                    onAddTrack={handleAddToPlaylist}
                  />
                </section>
              ) : null}

              {/* SEARCH & ADVANCED FILTER VIEW */}
              {activeTab === 'search' ? (
                <SearchExploreView
                  playlists={playlistsWithLiveCounts}
                  providers={providers}
                  facets={facets}
                  currentTrackId={currentTrack?.id || null}
                  isPlaying={isPlaying}
                  favorites={favorites}
                  onPlayTrack={playTrackFromList}
                  onToggleFavorite={handleToggleFavorite}
                  onAddToPlaylist={handleAddToPlaylist}
                />
              ) : null}

              {/* MEDIA VAULT & MODULAR API PROVIDERS VIEW */}
              {activeTab === 'vault' ? (
                <MediaVaultView
                  providers={providers}
                  vaultTracks={vaultTracks}
                  studioTracks={studioTracks}
                  playlists={playlistsWithLiveCounts}
                  currentTrackId={currentTrack?.id || null}
                  isPlaying={isPlaying}
                  onOpenAddModal={() => setAddModalOpen(true)}
                  onPlayTrack={playTrackFromList}
                  onRemoveVaultTrack={handleRemoveVaultTrack}
                />
              ) : null}
            </>
          )}

          {/* Clean Editorial Footer */}
          <footer className="mt-16 pt-6 border-t border-white/[0.07] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-slate-500">
            <p>
              GullyGroove — Discover Music. Feel Every Beat. Streaming full-length royalty-free, public-domain &amp; explicitly licensed tracks.
            </p>
            <button
              type="button"
              onClick={() => navigateToTab('vault')}
              className="text-slate-400 hover:text-white underline underline-offset-4"
            >
              Licensing &amp; Provider Policies
            </button>
          </footer>
        </main>
      </div>

      {/* Mobile Bottom Navigation Bar (56px, 3 thumb-zone tabs) */}
      <nav
        aria-label="Mobile Navigation"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 h-14 bg-[#0B0B11]/95 backdrop-blur-xl border-t border-white/[0.08] grid grid-cols-3 items-center"
      >
        <button
          type="button"
          onClick={() => navigateToTab('discover')}
          className={`flex flex-col items-center justify-center h-full gap-0.5 text-[10px] font-medium transition-colors active:scale-95 transform-gpu ${
            activeTab === 'discover' ? 'text-violet-400' : 'text-slate-400'
          }`}
        >
          <Compass className="w-5 h-5" />
          <span>Discover</span>
        </button>
        <button
          type="button"
          onClick={() => navigateToTab('playlists')}
          className={`flex flex-col items-center justify-center h-full gap-0.5 text-[10px] font-medium transition-colors active:scale-95 transform-gpu ${
            activeTab === 'playlists' || activeTab === 'playlist-detail'
              ? 'text-violet-400'
              : 'text-slate-400'
          }`}
        >
          <Library className="w-5 h-5" />
          <span>Playlists</span>
        </button>
        <button
          type="button"
          onClick={() => navigateToTab('search')}
          className={`flex flex-col items-center justify-center h-full gap-0.5 text-[10px] font-medium transition-colors active:scale-95 transform-gpu ${
            activeTab === 'search' ? 'text-violet-400' : 'text-slate-400'
          }`}
        >
          <Search className="w-5 h-5" />
          <span>Search</span>
        </button>
      </nav>

      {/* Persistent Audio Player Bar + Bajao-Inspired Studio Console + Dual-Deck 8s Crossfade */}
      <PlayerBar
        currentTrack={currentTrack}
        queue={queue}
        recentlyPlayed={recentlyPlayed}
        isPlaying={isPlaying}
        shuffle={shuffle}
        repeatMode={repeatMode}
        isFavorite={currentTrack ? favorites.has(currentTrack.id) : false}
        embedTrack={metadataTrack}
        studioConsoleOpen={studioConsoleOpen}
        onSetStudioConsoleOpen={setStudioConsoleOpen}
        getNextTrack={getNextTrack}
        onCrossfadeComplete={handleCrossfadeComplete}
        onCloseEmbed={() => setMetadataTrack(null)}
        onPlayPause={handlePlayPause}
        onNext={handleNext}
        onPrev={handlePrev}
        onToggleShuffle={() => setShuffle((prev) => !prev)}
        onCycleRepeat={() =>
          setRepeatMode((prev) =>
            prev === 'all' ? 'one' : prev === 'one' ? 'off' : 'all'
          )
        }
        onToggleFavorite={handleToggleFavorite}
        onSelectTrack={(track) => playTrackFromList(track, queue)}
        onClearRecentlyPlayed={() => setRecentlyPlayed([])}
        onPlaybackEnded={handleNext}
        onSetPlayingState={setIsPlaying}
        onOpenTuneRequest={() => setRequestModalOpen(true)}
        volume={volume}
        muted={muted}
        hookMode={hookMode}
        audioDucking={groovyDucking}
        onVolumeChange={setVolume}
        onMutedChange={setMuted}
        onHookModeChange={setHookMode}
        onClosePlayer={() => {
          setIsPlaying(false);
          setStudioConsoleOpen(false);
          setCurrentTrack(null);
        }}
      />

      {/* Groovy Floating Alexa-Style Voice Assistant */}
      <GroovyAssistant
        playlists={playlistsWithLiveCounts}
        tracks={tracks}
        currentTrack={currentTrack}
        isPlaying={isPlaying}
        shuffle={shuffle}
        hookMode={hookMode}
        volume={volume}
        muted={muted}
        studioConsoleOpen={studioConsoleOpen}
        favorites={favorites}
        onPlayTrack={playTrackFromList}
        onPlayPlaylist={quickPlayPlaylist}
        onSetPlaying={setIsPlaying}
        onNext={handleNext}
        onPrev={handlePrev}
        onToggleShuffle={(value) =>
          setShuffle((prev) => (typeof value === 'boolean' ? value : !prev))
        }
        onSetRepeatMode={setRepeatMode}
        onSetHookMode={setHookMode}
        onSetVolume={setVolume}
        onSetMuted={setMuted}
        onToggleFavorite={handleToggleFavorite}
        onNavigateTab={(tab) => navigateToTab(tab)}
        onSetStudioConsoleOpen={setStudioConsoleOpen}
        onDuckAudioChange={setGroovyDucking}
      />

      {/* Register Authorised Media Track Modal */}
      <AddTrackModal
        open={addModalOpen}
        playlists={playlistsWithLiveCounts}
        onClose={() => setAddModalOpen(false)}
        onCreated={handleCreateVaultTrack}
      />

      {/* Request a Song Modal */}
      <RequestSongModal
        open={requestModalOpen}
        onClose={() => setRequestModalOpen(false)}
      />

      {/* Settings Modal (Theme Dark/Light, Notifications, About Groovy) */}
      <SettingsModal
        open={settingsOpen}
        theme={theme}
        notifications={notifications}
        onChangeTheme={setTheme}
        onChangeNotifications={setNotifications}
        onClose={() => setSettingsOpen(false)}
      />

      <OfflineIndicator />
    </div>
  );
}
