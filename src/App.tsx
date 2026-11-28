import {
  ArrowLeft,
  AudioLines,
  Compass,
  FolderPlus,
  Globe,
  Library,
  Lock,
  Music2,
  Play,
  Plus,
  Search,
  Shuffle,
  Trash2,
  Users,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AboutModal } from './components/AboutModal';
import { AddTrackModal } from './components/AddTrackModal';
import { ArtworkImage } from './components/ArtworkImage';
import { BrandLogo } from './components/BrandLogo';
import { CreatePlaylistModal } from './components/CreatePlaylistModal';
import { GroovyAssistant } from './components/GroovyAssistant';
import { HeaderMenu } from './components/HeaderMenu';
import { MediaVaultView } from './components/MediaVaultView';
import { OfflineIndicator } from './components/OfflineIndicator';
import { PlayerBar, type RepeatMode } from './components/PlayerBar';
import { PlaylistCard } from './components/PlaylistCard';
import { ProfileModal } from './components/ProfileModal';
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
import { useFirebase } from './contexts/FirebaseContext';
import { COVER_ASSETS } from './data/catalog';
import {
  assignTrackToPlaylist,
  createVaultTrack,
  fetchCatalogOverview,
  fetchCatalogVersion,
  isPrivatePlaylistId,
  isServerSyncAvailable,
  loadPrivateMyPlaylistIds,
  loadPrivateMyPlaylistTracks,
  PRIVATE_PLAYLIST_ID,
  recordTrackPlay,
  removeVaultTrack,
  savePrivateMyPlaylistIds,
} from './services/clientCatalog';
import {
  addTrackToPersonalPlaylistInFirestore,
  clearRecentlyPlayedInFirestore,
  contributeTrackToSharedPlaylistInFirestore,
  createPersonalPlaylistInFirestore,
  createSharedPlaylistInFirestore,
  deletePersonalPlaylistInFirestore,
  recordRecentlyPlayedInFirestore,
  saveUserPreferencesInFirestore,
  setLikedSongInFirestore,
  subscribeLikedSongs,
  subscribePersonalPlaylists,
  subscribePersonalPlaylistTracks,
  subscribePlaylistContributors,
  subscribeRecentlyPlayed,
  subscribeSharedPlaylists,
  subscribeSharedPlaylistTracks,
  subscribeUserPreferences,
  syncGuestStateToFirestore,
  updateSharedPlaylistPermissionsInFirestore,
  type PersonalPlaylistRecord,
  type PlaylistContributorRecord,
  type SharedPlaylistRecord,
} from './services/firebaseMusicService';
import type {
  NewAuthorisedTrackInput,
  PlaylistWithStats,
  ProviderStatus,
  Track,
} from './types/music';
import {
  loadCrossfadeSettings,
  saveCrossfadeSettings,
  type CrossfadeSettings,
} from './utils/hookTiming';
import {
  LANGUAGE_FILTERS,
  matchesLanguageFilter,
  type LanguageFilter,
} from './utils/languageFilter';
import { sequencePlaylistBajaoStyle } from './utils/playlistRefinement';

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
    name: 'Retro Classics & 90s Gold',
    subtitle: '80s & 90s timeless hits',
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

  // Favorites, Private My Playlist & Modals
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('gg_favorites');
      if (saved) return new Set(JSON.parse(saved) as string[]);
    } catch {
      // ignore storage errors
    }
    return new Set(['gg-01', 'gg-02', 'gg-07']);
  });
  const [privateMyPlaylistTracks, setPrivateMyPlaylistTracks] = useState<Track[]>(() =>
    loadPrivateMyPlaylistTracks()
  );
  const [privateMyPlaylistIds, setPrivateMyPlaylistIds] = useState<Set<string>>(() =>
    loadPrivateMyPlaylistIds()
  );
  const [catalogNotice, setCatalogNotice] = useState<{
    id: number;
    text: string;
    scope: 'private' | 'shared';
  } | null>(null);
  const { user, authError, clearAuthError } = useFirebase();
  const [cloudLikedTracks, setCloudLikedTracks] = useState<Track[]>([]);
  const [cloudPersonalPlaylists, setCloudPersonalPlaylists] = useState<PersonalPlaylistRecord[]>([]);
  const [cloudPersonalTracksByPlaylist, setCloudPersonalTracksByPlaylist] = useState<
    Record<string, Track[]>
  >({});
  const [cloudRecentlyPlayed, setCloudRecentlyPlayed] = useState<Track[]>([]);
  const [cloudSharedPlaylists, setCloudSharedPlaylists] = useState<SharedPlaylistRecord[]>([]);
  const [cloudSharedTracksByPlaylist, setCloudSharedTracksByPlaylist] = useState<
    Record<string, Track[]>
  >({});
  const [activePlaylistContributors, setActivePlaylistContributors] = useState<
    PlaylistContributorRecord[]
  >([]);

  const lastSilentSyncRef = useRef<number>(0);
  const catalogVersionRef = useRef<number>(0);
  const syncedUidRef = useRef<string | null>(null);
  const applyingRemotePrefsRef = useRef(false);

  const [addModalOpen, setAddModalOpen] = useState(false);
  const [requestModalOpen, setRequestModalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [createPlaylistOpen, setCreatePlaylistOpen] = useState(false);

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

  const [crossfadeSettings, setCrossfadeSettings] = useState<CrossfadeSettings>(() =>
    loadCrossfadeSettings()
  );

  useEffect(() => {
    saveCrossfadeSettings(crossfadeSettings);
  }, [crossfadeSettings]);

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

  const showCatalogNotice = useCallback((text: string, scope: 'private' | 'shared') => {
    setCatalogNotice({ id: Date.now(), text, scope });
  }, []);

  useEffect(() => {
    if (!catalogNotice) return;
    const timer = window.setTimeout(() => {
      setCatalogNotice((prev) => (prev?.id === catalogNotice.id ? null : prev));
    }, 3500);
    return () => window.clearTimeout(timer);
  }, [catalogNotice]);

  const refreshSharedCatalogSilently = useCallback(async () => {
    lastSilentSyncRef.current = Date.now();
    try {
      const data = await fetchCatalogOverview();
      if (typeof data.version === 'number') {
        catalogVersionRef.current = Math.max(catalogVersionRef.current, data.version);
      }
      setPlaylists(data.playlists);
      setTracks(data.tracks);
      setFacets(data.facets);
      setProviders(data.providers);
    } catch {
      // keep current catalog state during transient offline moments
    }
  }, []);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchCatalogOverview();
      if (typeof data.version === 'number') {
        catalogVersionRef.current = Math.max(catalogVersionRef.current, data.version);
      }
      setPlaylists(data.playlists);
      setTracks(data.tracks);
      setFacets(data.facets);
      setProviders(data.providers);
      lastSilentSyncRef.current = Date.now();

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
    if (typeof window === 'undefined') return;
    let source: EventSource | null = null;
    const handleVersionEvent = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data) as { version?: number };
        if (
          typeof payload.version === 'number' &&
          payload.version > catalogVersionRef.current
        ) {
          void refreshSharedCatalogSilently();
        }
      } catch {
        void refreshSharedCatalogSilently();
      }
    };

    if (isServerSyncAvailable() && typeof EventSource !== 'undefined') {
      source = new EventSource('/api/catalog/events');
      source.addEventListener('connected', handleVersionEvent);
      source.addEventListener('catalog-updated', handleVersionEvent);
    }

    const syncIfChanged = async () => {
      if (document.hidden || !isServerSyncAvailable()) return;
      const remoteVersion = await fetchCatalogVersion();
      if (remoteVersion !== null && remoteVersion > catalogVersionRef.current) {
        await refreshSharedCatalogSilently();
      }
    };

    const handleFocus = () => {
      if (Date.now() - lastSilentSyncRef.current > 4000) {
        void syncIfChanged();
      }
    };

    const handleVisibility = () => {
      if (!document.hidden && Date.now() - lastSilentSyncRef.current > 4000) {
        void syncIfChanged();
      }
    };

    const pollTimer = window.setInterval(() => {
      void syncIfChanged();
    }, 10000);

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      source?.close();
      window.clearInterval(pollTimer);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [refreshSharedCatalogSilently]);

  useEffect(() => {
    if (!authError) return;
    showCatalogNotice(authError, 'private');
    clearAuthError();
  }, [authError, clearAuthError, showCatalogNotice]);

  // Always subscribe to shared community playlists & tracks (guests and authenticated users)
  useEffect(() => {
    const unsubSharedPlaylists = subscribeSharedPlaylists(
      (items) => setCloudSharedPlaylists(items),
      () => {
        // Fallback to server/static catalog cleanly if offline
      }
    );
    return () => {
      unsubSharedPlaylists();
    };
  }, []);

  // Subscribe per shared playlist using standard subcollection queries (no collectionGroup index required)
  useEffect(() => {
    const activeIds = new Set(
      cloudSharedPlaylists
        .map((p) => p.id)
        .filter((pid) => pid && !isPrivatePlaylistId(pid))
    );

    if (activeIds.size === 0) {
      setCloudSharedTracksByPlaylist({});
      return;
    }

    setCloudSharedTracksByPlaylist((prev) => {
      const next: Record<string, Track[]> = {};
      for (const pid of activeIds) {
        if (prev[pid]) next[pid] = prev[pid];
      }
      return next;
    });

    const unsubs = Array.from(activeIds).map((pid) =>
      subscribeSharedPlaylistTracks(
        pid,
        (items) => {
          setCloudSharedTracksByPlaylist((prev) => ({
            ...prev,
            [pid]: items,
          }));
        },
        () => {
          // Fallback to server catalog cleanly if offline
        }
      )
    );

    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [cloudSharedPlaylists]);

  // Subscribe to contributors for the currently open shared playlist
  useEffect(() => {
    if (
      activeTab !== 'playlist-detail' ||
      !selectedPlaylistId ||
      isPrivatePlaylistId(selectedPlaylistId)
    ) {
      setActivePlaylistContributors([]);
      return;
    }
    const unsub = subscribePlaylistContributors(
      selectedPlaylistId,
      (items) => setActivePlaylistContributors(items),
      () => setActivePlaylistContributors([])
    );
    return () => unsub();
  }, [activeTab, selectedPlaylistId]);

  // Subscribe to authenticated user's private Firestore data
  useEffect(() => {
    if (!user) {
      syncedUidRef.current = null;
      setCloudLikedTracks([]);
      setCloudPersonalPlaylists([]);
      setCloudPersonalTracksByPlaylist({});
      setCloudRecentlyPlayed([]);
      return;
    }

    const uid = user.uid;
    const unsubLiked = subscribeLikedSongs(uid, setCloudLikedTracks);
    const unsubRecent = subscribeRecentlyPlayed(uid, setCloudRecentlyPlayed);
    const unsubPersonalPlaylists = subscribePersonalPlaylists(
      uid,
      setCloudPersonalPlaylists
    );
    const unsubPrefs = subscribeUserPreferences(uid, (remotePrefs) => {
      if (!remotePrefs) return;
      applyingRemotePrefsRef.current = true;
      setTheme(remotePrefs.theme);
      setCrossfadeSettings({
        crossfadeSec: remotePrefs.crossfadeSec,
        djCrossfadeSec: remotePrefs.djCrossfadeSec,
        djMode: remotePrefs.djMode,
      });
      setNotifications(remotePrefs.notifications);
      window.setTimeout(() => {
        applyingRemotePrefsRef.current = false;
      }, 150);
    });

    if (syncedUidRef.current !== uid) {
      syncedUidRef.current = uid;
      const favTracks = tracks.filter((t) => favorites.has(t.id));
      const myTracks = [
        ...privateMyPlaylistTracks,
        ...tracks.filter((t) => privateMyPlaylistIds.has(t.id)),
      ];
      void syncGuestStateToFirestore(user, {
        favoriteTracks: favTracks,
        myPlaylistTracks: myTracks,
        recentlyPlayed,
        theme,
        crossfadeSettings,
        notifications,
      }).catch(() => {
        // ignore transient sync failure on initial sign-in
      });
    }

    return () => {
      unsubLiked();
      unsubRecent();
      unsubPersonalPlaylists();
      unsubPrefs();
    };
  }, [user]);

  // Subscribe to tracks inside each private personal playlist owned by the authenticated user
  useEffect(() => {
    if (!user) return;
    const playlistIds = Array.from(
      new Set([PRIVATE_PLAYLIST_ID, ...cloudPersonalPlaylists.map((p) => p.id)])
    );
    const unsubs = playlistIds.map((pid) =>
      subscribePersonalPlaylistTracks(user.uid, pid, (items) => {
        setCloudPersonalTracksByPlaylist((prev) => ({
          ...prev,
          [pid]: items,
        }));
      })
    );
    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [user, cloudPersonalPlaylists]);

  // Persist user preferences to Firestore when signed in
  useEffect(() => {
    if (!user || applyingRemotePrefsRef.current) return;
    const timer = window.setTimeout(() => {
      void saveUserPreferencesInFirestore(user.uid, {
        theme,
        crossfadeSettings,
        notifications,
      }).catch(() => {
        // ignore offline preference save errors
      });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [user, theme, crossfadeSettings, notifications]);

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

  const activeFavorites = useMemo(
    () => (user ? new Set(cloudLikedTracks.map((t) => t.id)) : favorites),
    [user, cloudLikedTracks, favorites]
  );

  const activeRecentlyPlayed = useMemo(
    () => (user ? cloudRecentlyPlayed : recentlyPlayed),
    [user, cloudRecentlyPlayed, recentlyPlayed]
  );

  const allKnownTracks = useMemo(() => {
    const map = new Map<string, Track>();
    for (const t of tracks) map.set(t.id, t);
    for (const t of privateMyPlaylistTracks) if (!map.has(t.id)) map.set(t.id, t);
    for (const list of Object.values(cloudSharedTracksByPlaylist)) {
      for (const t of list) if (!map.has(t.id)) map.set(t.id, t);
    }
    for (const list of Object.values(cloudPersonalTracksByPlaylist)) {
      for (const t of list) if (!map.has(t.id)) map.set(t.id, t);
    }
    for (const t of cloudLikedTracks) if (!map.has(t.id)) map.set(t.id, t);
    return Array.from(map.values());
  }, [
    tracks,
    privateMyPlaylistTracks,
    cloudSharedTracksByPlaylist,
    cloudPersonalTracksByPlaylist,
    cloudLikedTracks,
  ]);

  const mergedPlaylists = useMemo<PlaylistWithStats[]>(() => {
    const map = new Map<string, PlaylistWithStats>();
    for (const pl of playlists) {
      map.set(pl.id, pl);
    }
    if (user) {
      for (const ppl of cloudPersonalPlaylists) {
        if (ppl.id === PRIVATE_PLAYLIST_ID) continue;
        if (!map.has(ppl.id)) {
          map.set(ppl.id, {
            id: ppl.id,
            slug: ppl.id,
            title: ppl.title,
            subtitle: ppl.subtitle || 'Private Mix',
            description: ppl.description,
            mood: 'Private Personal',
            region: 'Pan-India',
            coverUrl: COVER_ASSETS.heroStage,
            curatedBy: 'Private · Only You',
            trackCount: 0,
            totalDurationSec: 0,
          });
        }
      }
    }
    for (const spl of cloudSharedPlaylists) {
      if (!map.has(spl.id)) {
        map.set(spl.id, {
          id: spl.id,
          slug: spl.id,
          title: spl.title,
          subtitle: spl.subtitle || `Shared by ${spl.ownerName}`,
          description: spl.description,
          mood: spl.mood || 'Community Mix',
          region: spl.region || 'Pan-India',
          coverUrl: spl.coverUrl || COVER_ASSETS.heroStage,
          curatedBy: `Shared · ${spl.ownerName}`,
          trackCount: 0,
          totalDurationSec: 0,
        });
      }
    }
    return Array.from(map.values());
  }, [playlists, user, cloudPersonalPlaylists, cloudSharedPlaylists]);

  const pushRecentlyPlayed = useCallback(
    (track: Track) => {
      setRecentlyPlayed((prev) =>
        [track, ...prev.filter((t) => t.id !== track.id)].slice(0, 30)
      );
      if (user) {
        void recordRecentlyPlayedInFirestore(user.uid, track).catch(() => {
          // ignore transient sync error
        });
      }
    },
    [user]
  );

  const handleAddToPlaylist = useCallback(
    async (trackId: string, playlistId: string, discoveredTrack?: Track) => {
      const targetPlaylist = mergedPlaylists.find((p) => p.id === playlistId);
      const targetTitle =
        targetPlaylist?.title ||
        (isPrivatePlaylistId(playlistId) ? 'My Playlist' : 'Shared Playlist');
      const targetTrack =
        discoveredTrack || allKnownTracks.find((t) => t.id === trackId);

      if (isPrivatePlaylistId(playlistId)) {
        if (user && targetTrack) {
          try {
            await addTrackToPersonalPlaylistInFirestore(
              user.uid,
              playlistId,
              targetTrack
            );
            if (playlistId === PRIVATE_PLAYLIST_ID && !activeFavorites.has(trackId)) {
              await setLikedSongInFirestore(user.uid, targetTrack, true);
            }
            showCatalogNotice(
              `"${targetTrack.title}" saved privately to ${targetTitle}.`,
              'private'
            );
          } catch {
            showCatalogNotice(
              `Could not save "${targetTrack.title}" to ${targetTitle}.`,
              'private'
            );
          }
          return;
        }

        const data = await assignTrackToPlaylist(
          playlistId,
          trackId,
          targetTrack,
          tracks
        );
        if (!data) return;

        setFavorites((prev) => {
          if (prev.has(trackId)) return prev;
          const next = new Set(prev);
          next.add(trackId);
          return next;
        });
        setPrivateMyPlaylistIds((prev) => {
          if (prev.has(trackId)) return prev;
          const next = new Set(prev);
          next.add(trackId);
          savePrivateMyPlaylistIds(next);
          return next;
        });
        if (!tracks.some((t) => t.id === trackId)) {
          setPrivateMyPlaylistTracks((prev) => [
            data.track,
            ...prev.filter((t) => t.id !== trackId),
          ]);
        }
        showCatalogNotice(
          `"${data.track.title}" saved privately to ${targetTitle}.`,
          'private'
        );
        return;
      }

      // Shared playlist path
      let firestoreSynced = false;
      let firestoreFailed = false;
      if (user && targetTrack) {
        const sharedMeta = cloudSharedPlaylists.find((p) => p.id === playlistId);
        if (
          sharedMeta &&
          !sharedMeta.allowContributions &&
          sharedMeta.ownerId !== user.uid
        ) {
          showCatalogNotice(
            `Contributions to "${targetTitle}" are currently restricted by the playlist owner.`,
            'private'
          );
          return;
        }

        try {
          await contributeTrackToSharedPlaylistInFirestore(
            user,
            targetPlaylist || {
              id: playlistId,
              title: targetTitle,
              subtitle: 'Shared Playlist',
              description: 'Shared GullyGroove playlist',
              mood: 'Shared Mix',
              region: 'Pan-India',
              coverUrl: targetTrack.coverUrl || COVER_ASSETS.heroStage,
            },
            targetTrack
          );
          firestoreSynced = true;
        } catch {
          firestoreFailed = true;
        }
      }

      const data = await assignTrackToPlaylist(
        playlistId,
        trackId,
        targetTrack,
        tracks,
        targetPlaylist
      );
      if (data) {
        if (typeof data.version === 'number') {
          catalogVersionRef.current = Math.max(catalogVersionRef.current, data.version);
        }
        setTracks((prev) => {
          const exists = prev.some((t) => t.id === trackId);
          return exists
            ? prev.map((t) => (t.id === trackId ? data.track : t))
            : [data.track, ...prev];
        });
        if (data.playlists) setPlaylists(data.playlists);
        if (data.facets) setFacets(data.facets);
      }

      const resolvedTrack = data?.track || targetTrack;
      if (data || firestoreSynced) {
        showCatalogNotice(
          firestoreFailed
            ? `"${resolvedTrack?.title || 'Track'}" added to ${targetTitle} on server (cloud sync warning).`
            : `"${resolvedTrack?.title || 'Track'}" added to ${targetTitle} — shared with all users.`,
          'shared'
        );
      } else {
        showCatalogNotice(
          `Could not add "${resolvedTrack?.title || 'track'}" to ${targetTitle}.`,
          'private'
        );
      }
    },
    [
      mergedPlaylists,
      allKnownTracks,
      user,
      activeFavorites,
      tracks,
      cloudSharedPlaylists,
      showCatalogNotice,
    ]
  );

  const handleToggleFavorite = useCallback(
    (trackId: string, discoveredTrack?: Track) => {
      const wasFavorite = activeFavorites.has(trackId);
      const targetTrack =
        discoveredTrack || allKnownTracks.find((t) => t.id === trackId);

      if (user && targetTrack) {
        void setLikedSongInFirestore(user.uid, targetTrack, !wasFavorite).catch(
          () => {
            showCatalogNotice('Could not update liked song in cloud.', 'private');
          }
        );
        return;
      }

      setFavorites((prev) => {
        const next = new Set(prev);
        if (next.has(trackId)) next.delete(trackId);
        else next.add(trackId);
        return next;
      });
      if (wasFavorite) {
        setPrivateMyPlaylistIds((prev) => {
          if (!prev.has(trackId)) return prev;
          const next = new Set(prev);
          next.delete(trackId);
          savePrivateMyPlaylistIds(next);
          return next;
        });
        return;
      }
      if (discoveredTrack && !tracks.some((t) => t.id === trackId)) {
        void handleAddToPlaylist(trackId, PRIVATE_PLAYLIST_ID, discoveredTrack);
      }
    },
    [
      activeFavorites,
      allKnownTracks,
      user,
      tracks,
      handleAddToPlaylist,
      showCatalogNotice,
    ]
  );

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
      if (isPrivatePlaylistId(playlistId)) {
        if (playlistId === PRIVATE_PLAYLIST_ID) {
          const merged = new Map<string, Track>();
          if (user) {
            for (const t of cloudPersonalTracksByPlaylist[PRIVATE_PLAYLIST_ID] || []) {
              merged.set(t.id, t);
            }
            for (const t of cloudLikedTracks) {
              merged.set(t.id, t);
            }
          } else {
            for (const t of privateMyPlaylistTracks) {
              if (favorites.has(t.id) || privateMyPlaylistIds.has(t.id)) {
                merged.set(t.id, t);
              }
            }
            for (const t of tracks) {
              if (
                favorites.has(t.id) ||
                privateMyPlaylistIds.has(t.id) ||
                t.playlistIds.includes(PRIVATE_PLAYLIST_ID)
              ) {
                merged.set(t.id, t);
              }
            }
          }
          return Array.from(merged.values());
        }
        return cloudPersonalTracksByPlaylist[playlistId] || [];
      }

      const merged = new Map<string, Track>();
      for (const t of cloudSharedTracksByPlaylist[playlistId] || []) {
        merged.set(t.id, t);
      }
      for (const t of tracks) {
        if (t.playlistIds.includes(playlistId) && !merged.has(t.id)) {
          merged.set(t.id, t);
        }
      }
      return Array.from(merged.values());
    },
    [
      user,
      tracks,
      favorites,
      privateMyPlaylistTracks,
      privateMyPlaylistIds,
      cloudPersonalTracksByPlaylist,
      cloudLikedTracks,
      cloudSharedTracksByPlaylist,
    ]
  );

  const quickPlayPlaylist = useCallback(
    (playlistId: string) => {
      const baseTracks = getPlaylistTracks(playlistId);
      const matchingTracks =
        languageFilter === 'All'
          ? baseTracks
          : baseTracks.filter((t) => matchesLanguageFilter(t, languageFilter));
      const pool = matchingTracks.length > 0 ? matchingTracks : baseTracks;
      const listToPlay = sequencePlaylistBajaoStyle(pool, { seedKey: playlistId });
      if (listToPlay.length > 0) {
        playTrackFromList(listToPlay[0], listToPlay);
      }
    },
    [getPlaylistTracks, languageFilter, playTrackFromList]
  );

  const handleCreatePlaylist = async (input: {
    title: string;
    description: string;
    visibility: 'private' | 'shared';
    allowContributions: boolean;
  }) => {
    if (!user) {
      setCreatePlaylistOpen(false);
      setProfileOpen(true);
      return;
    }

    if (input.visibility === 'private') {
      const created = await createPersonalPlaylistInFirestore(user.uid, {
        title: input.title,
        description: input.description,
      });
      showCatalogNotice(`Created private playlist "${created.title}".`, 'private');
      openPlaylist(created.id);
      return;
    }

    const created = await createSharedPlaylistInFirestore(user, {
      title: input.title,
      description: input.description,
      allowContributions: input.allowContributions,
    });
    showCatalogNotice(
      `Created shared playlist "${created.title}" for all listeners.`,
      'shared'
    );
    openPlaylist(created.id);
  };

  const handleDeletePersonalPlaylist = async (playlistId: string) => {
    if (!user || !playlistId.startsWith('priv-')) return;
    await deletePersonalPlaylistInFirestore(user.uid, playlistId);
    showCatalogNotice('Private playlist removed.', 'private');
    navigateToTab('playlists');
  };

  const handleClearRecentlyPlayed = () => {
    setRecentlyPlayed([]);
    if (user) {
      void clearRecentlyPlayedInFirestore(user.uid).catch(() => {
        // ignore transient errors
      });
    }
  };

  const handleCreateVaultTrack = async (input: NewAuthorisedTrackInput) => {
    const data = await createVaultTrack(input);
    if (data.scope === 'private' || isPrivatePlaylistId(input.playlistId || '')) {
      if (user) {
        await addTrackToPersonalPlaylistInFirestore(
          user.uid,
          input.playlistId || PRIVATE_PLAYLIST_ID,
          data.track
        );
      } else {
        setPrivateMyPlaylistTracks((prev) => [
          data.track,
          ...prev.filter((t) => t.id !== data.track.id),
        ]);
        setPrivateMyPlaylistIds((prev) => {
          const next = new Set(prev);
          next.add(data.track.id);
          savePrivateMyPlaylistIds(next);
          return next;
        });
        setFavorites((prev) => {
          const next = new Set(prev);
          next.add(data.track.id);
          return next;
        });
      }
      showCatalogNotice(`"${data.track.title}" saved privately.`, 'private');
      return;
    }

    if (typeof data.version === 'number') {
      catalogVersionRef.current = Math.max(catalogVersionRef.current, data.version);
    }

    if (user) {
      const targetMeta = mergedPlaylists.find((p) => p.id === input.playlistId);
      await contributeTrackToSharedPlaylistInFirestore(
        user,
        targetMeta || {
          id: input.playlistId || 'top-50-hindi',
          title: 'Shared Playlist',
          subtitle: 'Shared Playlist',
          description: 'Shared GullyGroove playlist',
          mood: 'Shared Mix',
          region: 'Pan-India',
          coverUrl: data.track.coverUrl || COVER_ASSETS.heroStage,
        },
        data.track
      ).catch(() => {
        // Keep Express catalog update even if Firestore offline
      });
    }

    setTracks((prev) => [data.track, ...prev]);
    if (data.playlists) setPlaylists(data.playlists);
    if (data.facets) setFacets(data.facets);
    showCatalogNotice(
      `"${data.track.title}" published to shared GullyGroove catalog.`,
      'shared'
    );
  };

  const handleRemoveVaultTrack = async (trackId: string) => {
    const data = await removeVaultTrack(trackId);
    if (!data) return;
    if (data.scope === 'private') {
      setPrivateMyPlaylistTracks((prev) => prev.filter((t) => t.id !== trackId));
      setPrivateMyPlaylistIds((prev) => {
        if (!prev.has(trackId)) return prev;
        const next = new Set(prev);
        next.delete(trackId);
        savePrivateMyPlaylistIds(next);
        return next;
      });
      setFavorites((prev) => {
        if (!prev.has(trackId)) return prev;
        const next = new Set(prev);
        next.delete(trackId);
        return next;
      });
      return;
    }

    setTracks((prev) => prev.filter((t) => t.id !== trackId));
    if (data.playlists) setPlaylists(data.playlists);
    if (data.facets) setFacets(data.facets);
  };

  const playlistsWithLiveCounts = useMemo(() => {
    return mergedPlaylists.map((pl) => {
      const plTracks = getPlaylistTracks(pl.id);
      if (plTracks.length === 0 && !isPrivatePlaylistId(pl.id) && !pl.id.startsWith('shared-')) {
        return pl;
      }
      const totalDurationSec = plTracks.reduce((acc, t) => acc + t.durationSec, 0);
      return {
        ...pl,
        trackCount: plTracks.length,
        totalDurationSec,
      };
    });
  }, [mergedPlaylists, getPlaylistTracks]);

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

    if (playlistSort === 'curated') {
      displayedTracks = sequencePlaylistBajaoStyle(displayedTracks, {
        seedKey: pl?.id || 'playlist',
      });
    } else {
      displayedTracks = [...displayedTracks].sort((a, b) => {
        if (playlistSort === 'popular') return (b.plays || 0) - (a.plays || 0);
        if (playlistSort === 'bpm') return (b.bpm || 0) - (a.bpm || 0);
        return a.title.localeCompare(b.title);
      });
    }

    return {
      playlist: pl,
      allTracks,
      languageMatchedCount: languageMatchedTracks.length,
      displayedTracks,
      directCount,
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

  const vaultTracks = useMemo(() => {
    const map = new Map<string, Track>();
    for (const t of privateMyPlaylistTracks) {
      if (t.isUserAdded) map.set(t.id, t);
    }
    for (const t of tracks) {
      if (t.isUserAdded) map.set(t.id, t);
    }
    return Array.from(map.values());
  }, [privateMyPlaylistTracks, tracks]);
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
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono-tabular text-slate-500">
                {playlistsWithLiveCounts.length}
              </span>
              <button
                type="button"
                onClick={() =>
                  user ? setCreatePlaylistOpen(true) : setProfileOpen(true)
                }
                title={user ? 'Create Playlist' : 'Sign in to create playlists'}
                aria-label="Create Playlist"
                className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-white/[0.06] hover:bg-violet-500/25 text-slate-300 hover:text-white transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
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

          {/* Zone 3: Compact Request Song + Top-Right Menu */}
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
            <HeaderMenu
              theme={theme}
              onOpenProfile={() => setProfileOpen(true)}
              onOpenSettings={() => setSettingsOpen(true)}
              onOpenAbout={() => setAboutOpen(true)}
            />
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
            <HeaderMenu
              theme={theme}
              compact
              onOpenProfile={() => setProfileOpen(true)}
              onOpenSettings={() => setSettingsOpen(true)}
              onOpenAbout={() => setAboutOpen(true)}
            />
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
                  {activeRecentlyPlayed.length > 0 ? (
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
                          onClick={handleClearRecentlyPlayed}
                          className="text-xs font-medium text-slate-400 hover:text-white whitespace-nowrap shrink-0"
                        >
                          Clear History
                        </button>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
                        {activeRecentlyPlayed.slice(0, 8).map((track) => {
                          const active = currentTrack?.id === track.id;
                          return (
                            <button
                              key={track.id}
                              type="button"
                              onClick={() => playTrackFromList(track, activeRecentlyPlayed)}
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

                      {isPrivatePlaylistId(activePlaylist.playlist.id) ? (
                        <div className="flex flex-wrap items-center justify-center md:justify-start gap-2 pt-0.5">
                          <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500/15 border border-amber-400/30 px-2.5 py-1 text-[11px] font-medium text-amber-200">
                            <Lock className="w-3 h-3" />
                            Private · Only visible to you
                          </span>
                          {user && activePlaylist.playlist.id.startsWith('priv-') ? (
                            <button
                              type="button"
                              onClick={() =>
                                void handleDeletePersonalPlaylist(activePlaylist.playlist!.id)
                              }
                              className="inline-flex items-center gap-1 rounded-lg bg-rose-500/15 border border-rose-400/30 px-2.5 py-1 text-[11px] font-medium text-rose-200 hover:bg-rose-500/25 transition-colors"
                            >
                              <Trash2 className="w-3 h-3" />
                              Delete Playlist
                            </button>
                          ) : null}
                        </div>
                      ) : activePlaylistContributors.length > 0 ||
                        cloudSharedPlaylists.some(
                          (p) =>
                            p.id === activePlaylist.playlist?.id && p.ownerId === user?.uid
                        ) ? (
                        <div className="flex flex-wrap items-center justify-center md:justify-start gap-2 pt-0.5">
                          {activePlaylistContributors.length > 0 ? (
                            <div className="inline-flex flex-wrap items-center gap-1.5 rounded-lg bg-white/[0.06] border border-white/10 px-2.5 py-1 text-[11px] text-slate-300">
                              <Users className="w-3 h-3 text-emerald-400 shrink-0" />
                              <span>Contributors:</span>
                              {activePlaylistContributors.slice(0, 4).map((contrib) => (
                                <span
                                  key={contrib.uid}
                                  className="inline-flex items-center gap-1 rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-slate-200"
                                >
                                  {contrib.photoURL ? (
                                    <img
                                      src={contrib.photoURL}
                                      alt={contrib.displayName}
                                      referrerPolicy="no-referrer"
                                      className="h-3.5 w-3.5 rounded-full object-cover"
                                    />
                                  ) : null}
                                  <span>{contrib.displayName.split(' ')[0]}</span>
                                  <span className="text-slate-400 font-mono-tabular">
                                    ({contrib.contributionCount})
                                  </span>
                                </span>
                              ))}
                            </div>
                          ) : null}
                          {(() => {
                            const sharedMeta = cloudSharedPlaylists.find(
                              (p) => p.id === activePlaylist.playlist?.id
                            );
                            if (!sharedMeta || !user || sharedMeta.ownerId !== user.uid) {
                              return null;
                            }
                            return (
                              <button
                                type="button"
                                onClick={() =>
                                  void updateSharedPlaylistPermissionsInFirestore(
                                    sharedMeta.id,
                                    !sharedMeta.allowContributions
                                  )
                                }
                                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                                  sharedMeta.allowContributions
                                    ? 'bg-emerald-500/15 border-emerald-400/30 text-emerald-200 hover:bg-emerald-500/25'
                                    : 'bg-amber-500/15 border-amber-400/30 text-amber-200 hover:bg-amber-500/25'
                                }`}
                              >
                                <Globe className="w-3 h-3" />
                                {sharedMeta.allowContributions
                                  ? 'Open to Contributions'
                                  : 'Owner-Only Edits'}
                              </button>
                            );
                          })()}
                        </div>
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
                              isFavorite={activeFavorites.has(track.id)}
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
                    allTracks={allKnownTracks}
                    favorites={activeFavorites}
                    recentlyPlayed={activeRecentlyPlayed}
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
                  allTracks={allKnownTracks}
                  providers={providers}
                  facets={facets}
                  currentTrackId={currentTrack?.id || null}
                  isPlaying={isPlaying}
                  favorites={activeFavorites}
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
        recentlyPlayed={activeRecentlyPlayed}
        isPlaying={isPlaying}
        shuffle={shuffle}
        repeatMode={repeatMode}
        isFavorite={currentTrack ? activeFavorites.has(currentTrack.id) : false}
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
        onClearRecentlyPlayed={handleClearRecentlyPlayed}
        onPlaybackEnded={handleNext}
        onSetPlayingState={setIsPlaying}
        onOpenTuneRequest={() => setRequestModalOpen(true)}
        volume={volume}
        muted={muted}
        hookMode={hookMode}
        crossfadeSettings={crossfadeSettings}
        audioDucking={groovyDucking}
        onVolumeChange={setVolume}
        onMutedChange={setMuted}
        onHookModeChange={setHookMode}
        onChangeCrossfadeSettings={setCrossfadeSettings}
        onClosePlayer={() => {
          setIsPlaying(false);
          setStudioConsoleOpen(false);
          setCurrentTrack(null);
        }}
      />

      {/* Groovy Floating Alexa-Style Voice Assistant */}
      <GroovyAssistant
        playlists={playlistsWithLiveCounts}
        tracks={allKnownTracks}
        currentTrack={currentTrack}
        isPlaying={isPlaying}
        shuffle={shuffle}
        hookMode={hookMode}
        volume={volume}
        muted={muted}
        studioConsoleOpen={studioConsoleOpen}
        favorites={activeFavorites}
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

      {/* Settings Modal (Theme Dark/Light, Crossfade & DJ Mode, Notifications) */}
      <SettingsModal
        open={settingsOpen}
        theme={theme}
        notifications={notifications}
        crossfadeSettings={crossfadeSettings}
        onChangeTheme={setTheme}
        onChangeNotifications={setNotifications}
        onChangeCrossfadeSettings={setCrossfadeSettings}
        onClose={() => setSettingsOpen(false)}
      />

      {/* User Profile & Google Sign-In Modal */}
      <ProfileModal
        open={profileOpen}
        theme={theme}
        personalPlaylistsCount={user ? Math.max(1, cloudPersonalPlaylists.length) : 1}
        likedCount={activeFavorites.size}
        recentlyPlayedCount={activeRecentlyPlayed.length}
        onOpenCreatePlaylist={() => setCreatePlaylistOpen(true)}
        onClose={() => setProfileOpen(false)}
      />

      {/* About GullyGroove & Groovy Modal */}
      <AboutModal
        open={aboutOpen}
        theme={theme}
        playlistCount={playlistsWithLiveCounts.length}
        onClose={() => setAboutOpen(false)}
      />

      {/* Create Personal (Private) or Shared Playlist Modal */}
      <CreatePlaylistModal
        open={createPlaylistOpen}
        theme={theme}
        onCreate={handleCreatePlaylist}
        onClose={() => setCreatePlaylistOpen(false)}
      />

      {catalogNotice ? (
        <div
          role="status"
          aria-live="polite"
          className={`fixed right-4 z-50 max-w-sm rounded-xl border px-3.5 py-2.5 shadow-2xl backdrop-blur-xl flex items-center gap-2.5 text-xs font-medium transition-all ${
            currentTrack ? 'bottom-36 lg:bottom-24' : 'bottom-16 lg:bottom-5'
          } ${
            catalogNotice.scope === 'private'
              ? 'bg-[#141422]/95 border-amber-400/35 text-amber-100'
              : 'bg-[#121626]/95 border-emerald-400/35 text-emerald-100'
          }`}
        >
          {catalogNotice.scope === 'private' ? (
            <Lock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          ) : (
            <Globe className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          )}
          <span className="leading-snug">{catalogNotice.text}</span>
        </div>
      ) : null}

      <OfflineIndicator />
    </div>
  );
}
