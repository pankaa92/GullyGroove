import { Globe, RotateCcw, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { searchCatalog } from '../services/clientCatalog';
import type { PlaylistWithStats, ProviderStatus, Track } from '../types/music';
import { TrackRow } from './TrackRow';

interface SearchExploreViewProps {
  playlists: PlaylistWithStats[];
  providers: ProviderStatus[];
  facets: {
    artists: string[];
    albums: string[];
    genres: string[];
    languages: string[];
  };
  currentTrackId: string | null;
  isPlaying: boolean;
  favorites: Set<string>;
  onPlayTrack: (track: Track, list: Track[]) => void;
  onToggleFavorite: (trackId: string) => void;
  onAddToPlaylist: (trackId: string, playlistId: string, track?: Track) => void;
}

export function SearchExploreView({
  playlists,
  providers,
  facets,
  currentTrackId,
  isPlaying,
  favorites,
  onPlayTrack,
  onToggleFavorite,
  onAddToPlaylist,
}: SearchExploreViewProps) {
  const [query, setQuery] = useState('');
  const [artist, setArtist] = useState('all');
  const [album, setAlbum] = useState('all');
  const [genre, setGenre] = useState('all');
  const [language, setLanguage] = useState('all');
  const [providerId, setProviderId] = useState('all');
  const [includeExternal, setIncludeExternal] = useState(true);

  const [localTracks, setLocalTracks] = useState<Track[]>([]);
  const [externalTracks, setExternalTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setErrorMsg(null);
      try {
        const data = await searchCatalog(
          {
            query,
            artist,
            album,
            genre,
            language,
            providerId,
          },
          includeExternal,
          controller.signal
        );
        setLocalTracks(data.localTracks || []);
        setExternalTracks(data.externalTracks || []);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setErrorMsg('Unable to search the catalog right now. Please try again.');
        }
      } finally {
        setLoading(false);
      }
    }, 200);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, artist, album, genre, language, providerId, includeExternal]);

  const hasActiveFilters =
    Boolean(query.trim()) ||
    artist !== 'all' ||
    album !== 'all' ||
    genre !== 'all' ||
    language !== 'all' ||
    providerId !== 'all';

  const resetFilters = () => {
    setQuery('');
    setArtist('all');
    setAlbum('all');
    setGenre('all');
    setLanguage('all');
    setProviderId('all');
  };

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="font-display text-2xl sm:text-3xl font-bold text-white tracking-tight">
          Search & Discovery
        </h1>
        <p className="text-sm text-slate-400">
          Filter Indian and international tracks by artist, album, genre, language, or authorised provider.
        </p>
      </header>

      {/* Search Bar & Modular External Discovery Toggle */}
      <div className="flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search song, artist, or album (e.g. Atif Aslam, Namo Namo)..."
            aria-label="Search music catalog"
            className="w-full h-11 rounded-xl bg-[#12121A] border border-white/10 pl-10 pr-4 text-base sm:text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
          />
        </div>

        <button
          type="button"
          onClick={() => setIncludeExternal((prev) => !prev)}
          className={`inline-flex h-11 items-center justify-center gap-2 px-4 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 border transition-colors ${
            includeExternal
              ? 'bg-gradient-to-r from-violet-600/25 to-blue-500/25 border-blue-400/50 text-white'
              : 'bg-[#12121A] border-white/10 text-slate-300 hover:border-white/25'
          }`}
        >
          <Globe className="w-4 h-4 text-blue-400" />
          {includeExternal ? 'Live External APIs: On' : 'Include Live External APIs'}
        </button>
      </div>

      {/* Advanced Facet Filters */}
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-5 gap-2.5 sm:gap-3 p-3 sm:p-4 rounded-xl bg-[#12121A] border border-white/[0.07]">
        <div>
          <label htmlFor="filter-artist" className="block text-[11px] font-medium text-slate-400 mb-1.5">
            Artist
          </label>
          <select
            id="filter-artist"
            value={artist}
            onChange={(e) => setArtist(e.target.value)}
            className="w-full h-10 rounded-lg bg-[#0B0B10] border border-white/10 px-3 text-xs text-slate-100 focus:outline-none focus:border-violet-500"
          >
            <option value="all">All Artists</option>
            {facets.artists.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="filter-album" className="block text-[11px] font-medium text-slate-400 mb-1.5">
            Album
          </label>
          <select
            id="filter-album"
            value={album}
            onChange={(e) => setAlbum(e.target.value)}
            className="w-full h-10 rounded-lg bg-[#0B0B10] border border-white/10 px-3 text-xs text-slate-100 focus:outline-none focus:border-violet-500"
          >
            <option value="all">All Albums</option>
            {facets.albums.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="filter-genre" className="block text-[11px] font-medium text-slate-400 mb-1.5">
            Genre
          </label>
          <select
            id="filter-genre"
            value={genre}
            onChange={(e) => setGenre(e.target.value)}
            className="w-full h-10 rounded-lg bg-[#0B0B10] border border-white/10 px-3 text-xs text-slate-100 focus:outline-none focus:border-violet-500"
          >
            <option value="all">All Genres</option>
            {facets.genres.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="filter-language" className="block text-[11px] font-medium text-slate-400 mb-1.5">
            Language
          </label>
          <select
            id="filter-language"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="w-full h-10 rounded-lg bg-[#0B0B10] border border-white/10 px-3 text-xs text-slate-100 focus:outline-none focus:border-violet-500"
          >
            <option value="all">All Languages</option>
            {facets.languages.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="filter-provider" className="block text-[11px] font-medium text-slate-400 mb-1.5">
            Music Provider
          </label>
          <select
            id="filter-provider"
            value={providerId}
            onChange={(e) => setProviderId(e.target.value)}
            className="w-full h-10 rounded-lg bg-[#0B0B10] border border-white/10 px-3 text-xs text-slate-100 focus:outline-none focus:border-violet-500"
          >
            <option value="all">All Providers</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {hasActiveFilters ? (
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span className="font-mono-tabular">
            Showing {localTracks.length} studio/vault tracks
            {includeExternal && query.trim().length >= 2
              ? ` · ${externalTracks.length} external discovery matches`
              : ''}
          </span>
          <button
            type="button"
            onClick={resetFilters}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-400 hover:text-blue-300"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset Filters
          </button>
        </div>
      ) : null}

      {errorMsg ? (
        <div className="p-4 rounded-xl bg-red-950/30 border border-red-500/30 text-sm text-red-200">
          {errorMsg}
        </div>
      ) : null}

      {/* Live External Discovery Results (shown first when local playlists have no match) */}
      {includeExternal && query.trim().length >= 2 ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between border-b border-white/[0.08] pb-2">
            <div>
              <h2 className="font-display text-base font-semibold text-white">
                Live Music Discovery ({query.trim()})
              </h2>
              <p className="text-xs text-slate-400">
                Full independent tracks via Audius Open Streaming & official 30s previews via Apple Music India.
              </p>
            </div>
            <span className="text-xs font-mono-tabular text-slate-500">
              {externalTracks.length} results
            </span>
          </div>

          {loading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((row) => (
                <div
                  key={row}
                  className="h-14 rounded-lg bg-white/[0.04] animate-pulse"
                />
              ))}
            </div>
          ) : externalTracks.length === 0 ? (
            <p className="text-xs text-slate-500 py-3">
              No external tracks found for “{query}”.
            </p>
          ) : (
            <div className="divide-y divide-white/[0.04]">
              {externalTracks.map((track, idx) => (
                <TrackRow
                  key={track.id}
                  track={track}
                  index={idx}
                  isCurrent={currentTrackId === track.id}
                  isPlaying={isPlaying}
                  isFavorite={favorites.has(track.id)}
                  playlists={playlists}
                  onPlayToggle={(t) => onPlayTrack(t, externalTracks)}
                  onToggleFavorite={onToggleFavorite}
                  onAddToPlaylist={onAddToPlaylist}
                />
              ))}
            </div>
          )}
        </div>
      ) : null}

      {/* Curated Catalogue Results */}
      {localTracks.length > 0 || !includeExternal || query.trim().length < 2 ? (
        <div className="space-y-3 pt-1">
          <div className="flex items-center justify-between border-b border-white/[0.08] pb-2">
            <h2 className="font-display text-base font-semibold text-white">
              Curated Playlists
            </h2>
            <span className="text-xs font-mono-tabular text-slate-500">
              {localTracks.length} tracks
            </span>
          </div>

          {loading ? (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((row) => (
                <div
                  key={row}
                  className="h-14 rounded-lg bg-white/[0.04] animate-pulse"
                />
              ))}
            </div>
          ) : localTracks.length === 0 ? (
            <div className="py-12 text-center rounded-xl bg-[#12121A] border border-white/[0.06]">
              <p className="text-sm font-medium text-slate-300">
                No curated tracks matched those filters.
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Try clearing one of the artist, album, or genre filters, or type a song/artist name above.
              </p>
              <button
                type="button"
                onClick={resetFilters}
                className="mt-4 px-4 py-2 text-xs font-semibold text-white rounded-lg bg-gradient-to-r from-violet-600 to-blue-500"
              >
                Reset All Filters
              </button>
            </div>
          ) : (
            <div className="divide-y divide-white/[0.04]">
              {localTracks.map((track, idx) => (
                <TrackRow
                  key={track.id}
                  track={track}
                  index={idx}
                  isCurrent={currentTrackId === track.id}
                  isPlaying={isPlaying}
                  isFavorite={favorites.has(track.id)}
                  playlists={playlists}
                  onPlayToggle={(t) => onPlayTrack(t, localTracks)}
                  onToggleFavorite={onToggleFavorite}
                  onAddToPlaylist={onAddToPlaylist}
                />
              ))}
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
