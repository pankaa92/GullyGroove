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
  onToggleFavorite: (trackId: string, track?: Track) => void;
  onAddToPlaylist: (trackId: string, playlistId: string, track?: Track) => void;
}

export function SearchExploreView({
  playlists,
  currentTrackId,
  isPlaying,
  favorites,
  onPlayTrack,
  onToggleFavorite,
  onAddToPlaylist,
}: SearchExploreViewProps) {
  const [query, setQuery] = useState('');
  const [includeExternal, setIncludeExternal] = useState(true);

  const [localTracks, setLocalTracks] = useState<Track[]>([]);
  const [externalTracks, setExternalTracks] = useState<Track[]>([]);
  const [visibleLocalCount, setVisibleLocalCount] = useState(80);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const trimmedQuery = query.trim();
  const hasSearchQuery = trimmedQuery.length > 0;

  useEffect(() => {
    setVisibleLocalCount(80);
  }, [trimmedQuery]);

  useEffect(() => {
    if (!hasSearchQuery) {
      setLocalTracks([]);
      setExternalTracks([]);
      setLoading(false);
      setErrorMsg(null);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setErrorMsg(null);
      try {
        const data = await searchCatalog(
          {
            query: trimmedQuery,
            artist: 'all',
            album: 'all',
            genre: 'all',
            language: 'all',
            providerId: 'all',
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
  }, [hasSearchQuery, trimmedQuery, includeExternal]);

  const resetSearch = () => {
    setQuery('');
  };

  return (
    <section className="space-y-6 gg-view-enter">
      <header className="space-y-1">
        <h1 className="font-display text-2xl sm:text-3xl font-bold text-white tracking-tight">
          Search & Discovery
        </h1>
        <p className="text-sm text-slate-400">
          Search songs, artists, albums, or mixes across our curated catalog and online discovery.
        </p>
      </header>

      {/* Search Bar & Online Discovery Toggle */}
      <div className="flex flex-col md:flex-row gap-2.5 sm:gap-3">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search song, artist, or album (e.g. Arijit Singh, Kumar Sanu, BTS)..."
            aria-label="Search music catalog"
            className="w-full h-11 rounded-xl bg-[#12121B] border border-white/10 pl-10 pr-4 text-base sm:text-sm text-white placeholder:text-slate-500 transition-colors focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
          />
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setIncludeExternal((prev) => !prev)}
            className={`flex-1 sm:flex-none inline-flex h-11 items-center justify-center gap-2 px-4 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 border transition-all duration-150 ${
              includeExternal
                ? 'bg-gradient-to-r from-violet-600/25 to-blue-500/25 border-blue-400/50 text-white'
                : 'bg-[#12121B] border-white/10 text-slate-300 hover:border-white/25'
            }`}
          >
            <Globe className="w-4 h-4 text-blue-400" />
            {includeExternal ? 'Search Online: On' : 'Search Online: Off'}
          </button>
        </div>
      </div>

      {hasSearchQuery ? (
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span className="font-mono-tabular">
            Showing {localTracks.length} curated track matches
            {includeExternal && trimmedQuery.length >= 2
              ? ` · ${externalTracks.length} online discovery matches`
              : ''}
          </span>
          <button
            type="button"
            onClick={resetSearch}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-400 hover:text-blue-300"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Clear Search
          </button>
        </div>
      ) : null}

      {errorMsg ? (
        <div className="p-4 rounded-xl bg-red-950/30 border border-red-500/30 text-sm text-red-200">
          {errorMsg}
        </div>
      ) : null}

      {!hasSearchQuery ? (
        <div className="py-14 px-6 text-center rounded-2xl bg-[#12121B] border border-white/[0.06] space-y-2.5">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-600/20 to-blue-500/20 border border-violet-500/25 text-violet-300">
            <Search className="w-5 h-5" />
          </div>
          <p className="font-display text-base font-semibold text-white">
            Find your next track
          </p>
          <p className="text-xs sm:text-sm text-slate-400 max-w-md mx-auto">
            Enter a song title, artist, album, or genre in the search box above to view matching tracks.
          </p>
        </div>
      ) : (
        <>
          {/* Live External Discovery Results */}
          {includeExternal && trimmedQuery.length >= 2 ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between border-b border-white/[0.08] pb-2">
                <div>
                  <h2 className="font-display text-base font-semibold text-white">
                    Live Music Discovery ({trimmedQuery})
                  </h2>
                  <p className="text-xs text-slate-400">
                    Full-length independent tracks (&gt;30s) via Audius Open Streaming.
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
                  No online discovery tracks found for “{trimmedQuery}”.
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

          {/* Matching Curated Catalogue Results */}
          <div className="space-y-3 pt-1">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-2">
              <h2 className="font-display text-base font-semibold text-white">
                Search Results
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
              <div className="py-12 text-center rounded-2xl bg-[#12121B] border border-white/[0.06]">
                <p className="text-sm font-medium text-slate-300">
                  No curated tracks matched “{trimmedQuery}”.
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Try another song title, artist name, or album keyword.
                </p>
                <button
                  type="button"
                  onClick={resetSearch}
                  className="mt-4 px-4 py-2 text-xs font-semibold text-white rounded-lg bg-gradient-to-r from-violet-600 to-blue-500"
                >
                  Clear Search
                </button>
              </div>
            ) : (
              <>
                <div className="divide-y divide-white/[0.04]">
                  {localTracks
                    .slice(0, visibleLocalCount)
                    .map((track, idx) => (
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

                {localTracks.length > visibleLocalCount ? (
                  <div className="pt-4 flex flex-wrap items-center justify-center gap-3">
                    <button
                      type="button"
                      onClick={() => setVisibleLocalCount((prev) => prev + 100)}
                      className="inline-flex h-10 items-center justify-center px-5 rounded-xl bg-white/[0.07] hover:bg-white/[0.12] border border-white/10 text-xs font-semibold text-white transition-colors"
                    >
                      Load 100 More ({visibleLocalCount} of {localTracks.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setVisibleLocalCount(localTracks.length)}
                      className="inline-flex h-10 items-center justify-center px-4 rounded-xl text-xs font-medium text-blue-300 hover:text-blue-200 transition-colors"
                    >
                      Show All {localTracks.length} Songs
                    </button>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
}
