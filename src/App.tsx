import {
  ArrowLeft,
  Compass,
  Library,
  Play,
  Search,
  Shuffle,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AddTrackModal } from './components/AddTrackModal';
import { ArtworkImage } from './components/ArtworkImage';
import { BrandLogo } from './components/BrandLogo';
import { MediaVaultView } from './components/MediaVaultView';
import { PlayerBar, type RepeatMode } from './components/PlayerBar';
import { PlaylistCard } from './components/PlaylistCard';
import { SearchExploreView } from './components/SearchExploreView';
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

type ActiveTab = 'discover' | 'playlists' | 'search' | 'vault' | 'playlist-detail';
type RegionFilter = 'All' | 'India' | 'Pan-India' | 'Global';

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
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string>('gapless-playback');
  const [regionFilter, setRegionFilter] = useState<RegionFilter>('All');

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
  const [metadataTrack, setMetadataTrack] = useState<Track | null>(null);

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
      const firstDirect = playable.find((t) => Boolean(t.streamUrl)) ?? playable[0] ?? null;
      setQueue((prev) => (prev.length > 0 ? prev : playable));
      setCurrentTrack((prev) => prev ?? firstDirect);
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

  const handleToggleFavorite = (trackId: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(trackId)) next.delete(trackId);
      else next.add(trackId);
      return next;
    });
  };

  const playTrackFromList = useCallback(
    (track: Track, list: Track[]) => {
      if (track.playbackRights === 'metadata-only' || (track.playbackRights === 'embed-only' && !track.embedId)) {
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
      recordTrackPlay(track.id);
    },
    [currentTrack?.id]
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

  const handleCrossfadeComplete = useCallback((nextTrack: Track) => {
    setCurrentTrack(nextTrack);
    setIsPlaying(true);
    recordTrackPlay(nextTrack.id);
  }, []);

  const handleNext = useCallback(() => {
    const next = getNextTrack(currentTrack?.id);
    if (!next) {
      setIsPlaying(false);
      return;
    }
    setCurrentTrack(next);
    setIsPlaying(true);
    recordTrackPlay(next.id);
  }, [getNextTrack, currentTrack?.id]);

  const handlePrev = useCallback(() => {
    const playable = queue.filter(isPlayableTrack);
    if (playable.length === 0) return;
    const idx = playable.findIndex((t) => t.id === currentTrack?.id);
    const prevIdx = idx <= 0 ? playable.length - 1 : idx - 1;
    const prev = playable[prevIdx];
    setCurrentTrack(prev);
    setIsPlaying(true);
    recordTrackPlay(prev.id);
  }, [queue, currentTrack?.id]);

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

  const openPlaylist = (playlistId: string) => {
    setSelectedPlaylistId(playlistId);
    setActiveTab('playlist-detail');
  };

  const quickPlayPlaylist = (playlistId: string) => {
    const plTracks = tracks.filter((t) => t.playlistIds.includes(playlistId));
    if (plTracks.length > 0) {
      playTrackFromList(plTracks[0], plTracks);
    }
  };

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

  const handleAddToPlaylist = async (
    trackId: string,
    playlistId: string,
    discoveredTrack?: Track
  ) => {
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
  };

  const filteredPlaylists = useMemo(() => {
    if (regionFilter === 'All') return playlists;
    return playlists.filter((pl) => pl.region === regionFilter);
  }, [playlists, regionFilter]);

  const activePlaylist = useMemo(() => {
    const pl = playlists.find((p) => p.id === selectedPlaylistId) || null;
    const plTracks = pl ? tracks.filter((t) => t.playlistIds.includes(pl.id)) : [];
    return { playlist: pl, tracks: plTracks };
  }, [selectedPlaylistId, playlists, tracks]);

  const vaultTracks = useMemo(() => tracks.filter((t) => t.isUserAdded), [tracks]);
  const studioTracks = useMemo(() => tracks.filter((t) => !t.isUserAdded), [tracks]);

  const topBreadcrumb =
    activeTab === 'discover'
      ? 'Discover'
      : activeTab === 'playlists'
        ? 'Curated Playlists'
        : activeTab === 'search'
          ? 'Search & Filter'
          : activeTab === 'vault'
            ? 'Media Vault'
            : `Playlists / ${activePlaylist.playlist?.title || 'Playlist'}`;

  return (
    <div className="min-h-screen bg-[#09090D] text-slate-100 flex flex-col lg:flex-row">
      {/* Desktop Left Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:shrink-0 lg:flex-col lg:fixed lg:inset-y-0 lg:left-0 bg-[#0C0C12] border-r border-white/[0.07] pb-24">
        {/* Brand Wordmark */}
        <div className="flex h-16 items-center px-6 border-b border-white/[0.06]">
          <button
            type="button"
            onClick={() => setActiveTab('discover')}
            className="flex items-center gap-2.5 text-left focus-visible:outline-none"
          >
            <BrandLogo size="md" />
            <span className="font-display text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0">
              GullyGroove
            </span>
          </button>
        </div>

        {/* Primary Sidebar Nav */}
        <nav aria-label="Sidebar Navigation" className="px-3 pt-4 space-y-1">
          <button
            type="button"
            onClick={() => setActiveTab('discover')}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              activeTab === 'discover'
                ? 'bg-white/[0.07] text-white'
                : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
            }`}
          >
            <Compass className="w-4 h-4 text-violet-400" />
            Discover
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('playlists')}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              activeTab === 'playlists' || activeTab === 'playlist-detail'
                ? 'bg-white/[0.07] text-white'
                : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
            }`}
          >
            <Library className="w-4 h-4 text-blue-400" />
            All Playlists
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('search')}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              activeTab === 'search'
                ? 'bg-white/[0.07] text-white'
                : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
            }`}
          >
            <Search className="w-4 h-4 text-violet-400" />
            Search & Filter
          </button>
        </nav>

        {/* Curated Playlists */}
        <div className="mt-6 px-3 flex-1 flex flex-col min-h-0">
          <div className="px-3 pb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400">
              Curated Playlists
            </span>
            <span className="text-[11px] font-mono-tabular text-slate-500">
              {playlists.length}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto space-y-0.5 pr-1">
            {playlists.map((pl) => {
              const selected =
                activeTab === 'playlist-detail' && selectedPlaylistId === pl.id;
              return (
                <button
                  key={pl.id}
                  type="button"
                  onClick={() => openPlaylist(pl.id)}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-xs text-left transition-colors ${
                    selected
                      ? 'bg-violet-500/15 text-white font-medium'
                      : 'text-slate-400 hover:text-slate-100 hover:bg-white/[0.04]'
                  }`}
                >
                  <span className="truncate">{pl.title}</span>
                  <span className="font-mono-tabular text-[11px] text-slate-500 shrink-0">
                    {pl.trackCount}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </aside>

      {/* Main Viewport Container */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0">
        {/* Desktop Top Bar */}
        <header className="hidden lg:flex sticky top-0 z-30 h-16 items-center justify-between gap-8 px-8 bg-[#09090D]/90 backdrop-blur-xl border-b border-white/[0.07]">
          {/* Zone 1: Single-line context / breadcrumb */}
          <span className="font-display text-sm font-semibold text-slate-200 whitespace-nowrap shrink-0 truncate max-w-xs">
            {topBreadcrumb}
          </span>

          {/* Zone 2: Clean single-line text nav links */}
          <nav className="flex items-center gap-6 text-sm font-medium">
            <button
              type="button"
              onClick={() => setActiveTab('discover')}
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
              onClick={() => setActiveTab('playlists')}
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
              onClick={() => setActiveTab('search')}
              className={`whitespace-nowrap shrink-0 py-1 transition-colors border-b-2 ${
                activeTab === 'search'
                  ? 'text-white border-violet-500'
                  : 'text-slate-400 border-transparent hover:text-white'
              }`}
            >
              Search
            </button>
          </nav>

          {/* Zone 3: Balanced layout spacer */}
          <div className="text-xs text-slate-400 whitespace-nowrap shrink-0">
            GullyGroove with Gapless Crossfade
          </div>
        </header>

        {/* Mobile Compact Sticky Top Bar (52px) */}
        <header className="lg:hidden sticky top-0 z-30 flex h-[52px] items-center justify-between gap-4 px-4 bg-[#09090D]/90 backdrop-blur-xl border-b border-white/[0.07]">
          <button
            type="button"
            onClick={() => setActiveTab('discover')}
            className="flex items-center gap-2 whitespace-nowrap shrink-0"
          >
            <BrandLogo size="sm" />
            <span className="font-display text-base font-bold text-white">
              GullyGroove
            </span>
          </button>

          <span className="text-[11px] font-medium text-blue-300 whitespace-nowrap shrink-0">
            Gapless 8s
          </span>
        </header>

        {/* Main Scrollable Content Area */}
        <main className="flex-1 px-3 sm:px-6 lg:px-8 py-4 sm:py-6 pb-40 lg:pb-28 max-w-7xl w-full mx-auto">
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
                <div className="space-y-8 sm:space-y-10">
                  {/* Hero Stage Banner */}
                  <section className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-[#12121A]">
                    <div className="absolute inset-0">
                      <ArtworkImage
                        src={COVER_ASSETS.heroStage}
                        alt="GullyGroove Mumbai recording studio"
                        className="w-full h-full object-cover object-center"
                      />
                      <div className="absolute inset-0 bg-gradient-to-r from-[#09090D] via-[#09090D]/85 to-[#09090D]/40" />
                    </div>

                    <div className="relative z-10 px-4 py-7 sm:px-10 sm:py-14 max-w-2xl space-y-3 sm:space-y-4">
                      <p className="text-xs font-semibold tracking-wide text-blue-400">
                        GullyGroove · Discover Music. Feel Every Beat.
                      </p>
                      <h1 className="font-display text-2xl sm:text-4xl lg:text-5xl font-extrabold text-white leading-[1.12] tracking-tight">
                        Built for Every Indian Road, Mehfil & Night.
                      </h1>
                      <p className="text-xs sm:text-base text-slate-300 leading-relaxed max-w-xl">
                        Stream curated Bollywood, Punjabi, Highway, Sufi, 90s Classics, DJ & Love Mashups with 8-second gapless crossfade playback.
                      </p>

                      <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2.5 sm:gap-3 pt-1 sm:pt-2">
                        <button
                          type="button"
                          onClick={() => quickPlayPlaylist('gapless-playback')}
                          className="inline-flex h-11 items-center justify-center gap-2 px-5 sm:px-6 rounded-xl bg-gradient-to-r from-violet-600 to-blue-500 text-sm font-semibold text-white shadow-lg shadow-violet-950/50 hover:opacity-95 active:scale-[0.99] transition-all whitespace-nowrap shrink-0"
                        >
                          <Play className="w-4 h-4 fill-current" />
                          Play Gapless Mix
                        </button>

                        <button
                          type="button"
                          onClick={() => setActiveTab('playlists')}
                          className="inline-flex h-11 items-center justify-center gap-2 px-5 rounded-xl bg-white/[0.07] hover:bg-white/[0.12] border border-white/10 text-sm font-medium text-white transition-colors whitespace-nowrap shrink-0"
                        >
                          Browse All {playlists.length} Playlists
                        </button>
                      </div>
                    </div>
                  </section>

                  {/* Curated Playlists Grid with Region Filter Tabs */}
                  <section className="space-y-4 sm:space-y-5">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <h2 className="font-display text-xl sm:text-2xl font-bold text-white">
                          Curated for India & Beyond
                        </h2>
                        <p className="text-xs sm:text-sm text-slate-400 mt-0.5">
                          From NH-48 Bus Driver classics and Saloon grooves to 90s hits & DJ mashups.
                        </p>
                      </div>

                      <div
                        className="inline-flex items-center gap-1 p-1 rounded-xl bg-[#12121A] border border-white/[0.08] self-start max-w-full overflow-x-auto"
                        role="tablist"
                        aria-label="Filter playlists by region"
                      >
                        {(['All', 'India', 'Pan-India', 'Global'] as const).map((region) => (
                          <button
                            key={region}
                            type="button"
                            role="tab"
                            aria-selected={regionFilter === region}
                            onClick={() => setRegionFilter(region)}
                            className={`px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap shrink-0 transition-colors ${
                              regionFilter === region
                                ? 'bg-gradient-to-r from-violet-600 to-blue-500 text-white'
                                : 'text-slate-400 hover:text-white'
                            }`}
                          >
                            {region}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
                      {filteredPlaylists.map((playlist) => (
                        <PlaylistCard
                          key={playlist.id}
                          playlist={playlist}
                          onSelect={openPlaylist}
                          onQuickPlay={quickPlayPlaylist}
                        />
                      ))}
                    </div>
                  </section>

                  {/* Trending Stream Queue */}
                  <section className="space-y-4">
                    <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
                      <div>
                        <h2 className="font-display text-xl font-bold text-white">
                          Top Authorised Streams
                        </h2>
                        <p className="text-xs text-slate-400 mt-0.5">
                          Instant royalty-free & Creative Commons playback across genres.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setActiveTab('search')}
                        className="text-xs font-semibold text-blue-400 hover:text-blue-300 whitespace-nowrap shrink-0"
                      >
                        Advanced Filter
                      </button>
                    </div>

                    <div className="divide-y divide-white/[0.04]">
                      {tracks
                        .filter((t) => Boolean(t.streamUrl))
                        .slice(0, 8)
                        .map((track, idx) => (
                          <TrackRow
                            key={track.id}
                            track={track}
                            index={idx}
                            isCurrent={currentTrack?.id === track.id}
                            isPlaying={isPlaying}
                            isFavorite={favorites.has(track.id)}
                            playlists={playlists}
                            onPlayToggle={(t) => playTrackFromList(t, tracks)}
                            onToggleFavorite={handleToggleFavorite}
                            onAddToPlaylist={handleAddToPlaylist}
                          />
                        ))}
                    </div>
                  </section>
                </div>
              ) : null}

              {/* ALL PLAYLISTS VIEW */}
              {activeTab === 'playlists' ? (
                <section className="space-y-6">
                  <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-white/[0.08] pb-5">
                    <div>
                      <h1 className="font-display text-2xl sm:text-3xl font-bold text-white">
                        All Curated Playlists
                      </h1>
                      <p className="text-sm text-slate-400 mt-1">
                        Every mood from Top 50 Hindi Songs and Evening Daru to Workout Motivation.
                      </p>
                    </div>

                    <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-[#12121A] border border-white/[0.08] self-start max-w-full overflow-x-auto">
                      {(['All', 'India', 'Pan-India', 'Global'] as const).map((region) => (
                        <button
                          key={region}
                          type="button"
                          onClick={() => setRegionFilter(region)}
                          className={`px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap shrink-0 transition-colors ${
                            regionFilter === region
                              ? 'bg-gradient-to-r from-violet-600 to-blue-500 text-white'
                              : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          {region}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-5">
                    {filteredPlaylists.map((playlist) => (
                      <PlaylistCard
                        key={playlist.id}
                        playlist={playlist}
                        onSelect={openPlaylist}
                        onQuickPlay={quickPlayPlaylist}
                      />
                    ))}
                  </div>
                </section>
              ) : null}

              {/* PLAYLIST DETAIL VIEW */}
              {activeTab === 'playlist-detail' && activePlaylist.playlist ? (
                <section className="space-y-5 sm:space-y-6">
                  <button
                    type="button"
                    onClick={() => setActiveTab('playlists')}
                    className="inline-flex h-9 items-center gap-2 text-xs font-medium text-slate-400 hover:text-white transition-colors"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    Back to Playlists
                  </button>

                  <div className="flex flex-col md:flex-row items-center md:items-end gap-5 sm:gap-6 p-4 sm:p-6 rounded-2xl bg-gradient-to-b from-violet-950/35 to-[#12121A] border border-white/[0.08] text-center md:text-left">
                    <div className="w-36 h-36 sm:w-52 sm:h-52 shrink-0 overflow-hidden rounded-xl shadow-2xl border border-white/10">
                      <ArtworkImage
                        src={activePlaylist.playlist.coverUrl}
                        alt={activePlaylist.playlist.title}
                      />
                    </div>

                    <div className="flex-1 min-w-0 w-full space-y-2.5 sm:space-y-3">
                      <p className="text-xs font-medium text-blue-400">
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
                        <span>{activePlaylist.tracks.length} tracks</span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {formatTotalMinutes(activePlaylist.playlist.totalDurationSec)}
                        </span>
                      </div>

                      <div className="flex items-center gap-3 pt-2">
                        <button
                          type="button"
                          disabled={activePlaylist.tracks.length === 0}
                          onClick={() => {
                            if (activePlaylist.tracks.length > 0) {
                              setShuffle(false);
                              playTrackFromList(
                                activePlaylist.tracks[0],
                                activePlaylist.tracks
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
                          disabled={activePlaylist.tracks.length === 0}
                          onClick={() => {
                            if (activePlaylist.tracks.length > 0) {
                              setShuffle(true);
                              const pick =
                                activePlaylist.tracks[
                                  Math.floor(Math.random() * activePlaylist.tracks.length)
                                ];
                              playTrackFromList(pick, activePlaylist.tracks);
                            }
                          }}
                          className="flex-1 sm:flex-none inline-flex h-11 items-center justify-center gap-2 px-4 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] border border-white/10 text-xs font-medium text-white disabled:opacity-40 whitespace-nowrap shrink-0"
                        >
                          <Shuffle className="w-4 h-4" />
                          Shuffle
                        </button>
                      </div>
                    </div>
                  </div>

                  {activePlaylist.tracks.length === 0 ? (
                    <div className="py-12 text-center rounded-xl bg-[#12121A] border border-white/[0.07]">
                      <p className="text-sm text-slate-300">
                        No tracks in this playlist yet.
                      </p>
                      <button
                        type="button"
                        onClick={() => setActiveTab('search')}
                        className="mt-3 px-4 py-2 text-xs font-semibold text-white rounded-lg bg-gradient-to-r from-violet-600 to-blue-500"
                      >
                        Discover Tracks to Add
                      </button>
                    </div>
                  ) : (
                    <div className="divide-y divide-white/[0.04]">
                      {activePlaylist.tracks.map((track, idx) => (
                        <TrackRow
                          key={track.id}
                          track={track}
                          index={idx}
                          isCurrent={currentTrack?.id === track.id}
                          isPlaying={isPlaying}
                          isFavorite={favorites.has(track.id)}
                          playlists={playlists}
                          onPlayToggle={(t) => playTrackFromList(t, activePlaylist.tracks)}
                          onToggleFavorite={handleToggleFavorite}
                          onAddToPlaylist={handleAddToPlaylist}
                        />
                      ))}
                    </div>
                  )}
                </section>
              ) : null}

              {/* SEARCH & ADVANCED FILTER VIEW */}
              {activeTab === 'search' ? (
                <SearchExploreView
                  playlists={playlists}
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
                  playlists={playlists}
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
              GullyGroove — Discover Music. Feel Every Beat. Streaming royalty-free, public-domain & explicitly licensed previews.
            </p>
            <button
              type="button"
              onClick={() => setActiveTab('vault')}
              className="text-slate-400 hover:text-white underline underline-offset-4"
            >
              Licensing & Provider Policies
            </button>
          </footer>
        </main>
      </div>

      {/* Mobile Bottom Navigation Bar (56px, 3 thumb-zone tabs) */}
      <nav
        aria-label="Mobile Navigation"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 h-14 bg-[#0B0B10]/95 backdrop-blur-xl border-t border-white/[0.08] grid grid-cols-3 items-center"
      >
        <button
          type="button"
          onClick={() => setActiveTab('discover')}
          className={`flex flex-col items-center justify-center h-full gap-0.5 text-[10px] font-medium ${
            activeTab === 'discover' ? 'text-violet-400' : 'text-slate-400'
          }`}
        >
          <Compass className="w-5 h-5" />
          <span>Discover</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('playlists')}
          className={`flex flex-col items-center justify-center h-full gap-0.5 text-[10px] font-medium ${
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
          onClick={() => setActiveTab('search')}
          className={`flex flex-col items-center justify-center h-full gap-0.5 text-[10px] font-medium ${
            activeTab === 'search' ? 'text-violet-400' : 'text-slate-400'
          }`}
        >
          <Search className="w-5 h-5" />
          <span>Search</span>
        </button>
      </nav>

      {/* Persistent Audio Player Bar + Dual-Deck 8s Gapless Crossfade + YouTube Mini-Player */}
      <PlayerBar
        currentTrack={currentTrack}
        queue={queue}
        isPlaying={isPlaying}
        shuffle={shuffle}
        repeatMode={repeatMode}
        isFavorite={currentTrack ? favorites.has(currentTrack.id) : false}
        embedTrack={metadataTrack}
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
        onPlaybackEnded={handleNext}
        onSetPlayingState={setIsPlaying}
      />

      {/* Register Authorised Media Track Modal */}
      <AddTrackModal
        open={addModalOpen}
        playlists={playlists}
        onClose={() => setAddModalOpen(false)}
        onCreated={handleCreateVaultTrack}
      />
    </div>
  );
}
