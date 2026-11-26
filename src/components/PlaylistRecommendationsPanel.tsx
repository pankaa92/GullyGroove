import { Check, Pause, Play, Plus, RefreshCw, Sparkles } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import type { PlaylistWithStats, Track } from '../types/music';
import { formatDuration, formatPlays } from '../utils/format';
import {
  formatPlaylistVibeLine,
  getSmartPlaylistRecommendations,
  type RecommendationFilterMode,
} from '../utils/playlistRecommendations';
import { ArtworkImage } from './ArtworkImage';

interface PlaylistRecommendationsPanelProps {
  playlist: PlaylistWithStats;
  playlistTracks: Track[];
  allTracks: Track[];
  favorites: Set<string>;
  recentlyPlayed: Track[];
  currentTrackId: string | null;
  isPlaying: boolean;
  onPlayTrack: (track: Track, list: Track[]) => void;
  onAddTrack: (trackId: string, playlistId: string, track?: Track) => Promise<void> | void;
}

export const PlaylistRecommendationsPanel = memo(function PlaylistRecommendationsPanel({
  playlist,
  playlistTracks,
  allTracks,
  favorites,
  recentlyPlayed,
  currentTrackId,
  isPlaying,
  onPlayTrack,
  onAddTrack,
}: PlaylistRecommendationsPanelProps) {
  const [filterMode, setFilterMode] = useState<RecommendationFilterMode>('balanced');
  const [batchOffset, setBatchOffset] = useState(0);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [justAddedIds, setJustAddedIds] = useState<Set<string>>(() => new Set());

  const result = useMemo(
    () =>
      getSmartPlaylistRecommendations({
        playlist,
        playlistTracks,
        allTracks,
        favorites,
        recentlyPlayed,
        filterMode,
        batchOffset,
        limit: 8,
      }),
    [
      playlist,
      playlistTracks,
      allTracks,
      favorites,
      recentlyPlayed,
      filterMode,
      batchOffset,
    ]
  );

  const recommendedQueue = useMemo(
    () => result.items.map((item) => item.track),
    [result.items]
  );

  const vibeSummary = useMemo(
    () => formatPlaylistVibeLine(result.profile),
    [result.profile]
  );

  const handleAddSingle = async (track: Track) => {
    if (addingId === track.id) return;
    setAddingId(track.id);
    try {
      await onAddTrack(track.id, playlist.id, track);
      setJustAddedIds((prev) => {
        const next = new Set(prev);
        next.add(track.id);
        return next;
      });
    } finally {
      setAddingId((prev) => (prev === track.id ? null : prev));
    }
  };

  if (result.totalCandidates === 0) {
    return null;
  }

  return (
    <section
      aria-label="Recommended for this playlist"
      className="pt-4 sm:pt-6 border-t border-white/[0.07] space-y-4"
    >
      {/* Header & Interactive Controls */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-violet-400 shrink-0" />
            <h2 className="font-display text-lg sm:text-xl font-bold text-white tracking-tight">
              Recommended for this playlist
            </h2>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">
            {playlistTracks.length > 0
              ? `Tailored from ${playlistTracks.length} existing tracks`
              : 'Personalized from your listening activity & favorites'}
            {vibeSummary ? ` · ${vibeSummary}` : ''}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 shrink-0">
          <div
            role="tablist"
            aria-label="Recommendation style"
            className="inline-flex items-center rounded-xl bg-[#12121B] border border-white/[0.08] p-1 gap-1"
          >
            {(
              [
                { id: 'balanced', label: 'Smart Mix' },
                { id: 'popular', label: `Popular (${result.popularCount})` },
                { id: 'gems', label: `Hidden Gems (${result.gemCount})` },
              ] as const
            ).map((tab) => {
              const active = filterMode === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => {
                    setFilterMode(tab.id);
                    setBatchOffset(0);
                  }}
                  className={`h-8 px-2.5 sm:px-3 rounded-lg text-[11px] font-medium transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-gradient-to-r from-violet-600 to-blue-500 text-white shadow-sm'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => setBatchOffset((prev) => prev + 4)}
            title="Refresh smart recommendations"
            className="inline-flex h-10 items-center gap-1.5 px-3 rounded-xl bg-[#12121B] hover:bg-[#191926] border border-white/10 text-xs font-medium text-slate-200 hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5 text-blue-400" />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Recommendations Grid */}
      {result.items.length === 0 ? (
        <div className="rounded-xl bg-[#12121B] border border-white/[0.07] p-4 text-xs text-slate-400">
          No tracks in this specific filter match the playlist’s musical style right now. Switch back to Smart Mix to see all compatible tracks.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 sm:gap-3">
          {result.items.map(({ track, tier, reason }) => {
            const isCurrent = currentTrackId === track.id;
            const isAdded = justAddedIds.has(track.id);
            const isAdding = addingId === track.id;

            return (
              <article
                key={track.id}
                className={`group flex items-center gap-3 rounded-xl p-2.5 sm:p-3 border transition-colors ${
                  isCurrent
                    ? 'bg-gradient-to-r from-violet-600/14 via-violet-500/10 to-blue-500/10 border-violet-500/35'
                    : 'bg-[#12121B] border-white/[0.07] hover:bg-[#191926] hover:border-violet-500/30'
                }`}
              >
                {/* Audition Play Thumbnail */}
                <button
                  type="button"
                  onClick={() => onPlayTrack(track, recommendedQueue)}
                  aria-label={
                    isCurrent && isPlaying
                      ? `Pause ${track.title}`
                      : `Preview ${track.title}`
                  }
                  className="gg-keep-dark relative h-12 w-12 sm:h-13 sm:w-13 shrink-0 overflow-hidden rounded-lg bg-[#0D0D14] border border-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
                >
                  <ArtworkImage
                    src={track.coverUrl}
                    alt={track.title}
                    className="h-full w-full object-cover"
                  />
                  <span
                    className={`absolute inset-0 flex items-center justify-center bg-black/45 transition-opacity ${
                      isCurrent
                        ? 'opacity-100'
                        : 'opacity-0 group-hover:opacity-100'
                    }`}
                  >
                    {isCurrent && isPlaying ? (
                      <Pause className="w-4 h-4 text-white fill-current" />
                    ) : (
                      <Play className="w-4 h-4 text-white fill-current ml-0.5" />
                    )}
                  </span>
                </button>

                {/* Track Info & Unboxed Musical Fit Reason */}
                <button
                  type="button"
                  onClick={() => onPlayTrack(track, recommendedQueue)}
                  className="min-w-0 flex-1 text-left focus-visible:outline-none"
                >
                  <p
                    className={`text-sm font-semibold truncate ${
                      isCurrent
                        ? 'bg-gradient-to-r from-violet-300 to-blue-300 bg-clip-text text-transparent'
                        : 'text-slate-100'
                    }`}
                  >
                    {track.title}
                  </p>
                  <p className="text-xs text-slate-400 truncate mt-0.5">
                    {track.artist}
                    <span className="mx-1.5 text-slate-600" aria-hidden="true">
                      ·
                    </span>
                    <span className="font-mono-tabular">
                      {track.durationSec > 0
                        ? formatDuration(track.durationSec)
                        : `${track.bpm} BPM`}
                    </span>
                    {track.plays > 0 ? (
                      <>
                        <span className="mx-1.5 text-slate-600" aria-hidden="true">
                          ·
                        </span>
                        <span className="font-mono-tabular text-slate-500">
                          {formatPlays(track.plays)}
                        </span>
                      </>
                    ) : null}
                  </p>
                  <p
                    className={`text-[11px] truncate mt-0.5 ${
                      tier === 'gem' ? 'text-blue-300' : 'text-violet-300'
                    }`}
                  >
                    {reason}
                  </p>
                </button>

                {/* One-Click Add to Playlist */}
                <button
                  type="button"
                  disabled={isAdding || isAdded}
                  onClick={() => handleAddSingle(track)}
                  aria-label={`Add ${track.title} to ${playlist.title}`}
                  className={`inline-flex h-10 items-center justify-center gap-1.5 px-3 rounded-xl text-xs font-semibold transition-all whitespace-nowrap shrink-0 ${
                    isAdded
                      ? 'bg-emerald-500/20 border border-emerald-400/40 text-emerald-300'
                      : 'bg-white/[0.07] hover:bg-gradient-to-r hover:from-violet-600 hover:to-blue-500 border border-white/10 hover:border-violet-400/40 text-slate-100 hover:text-white'
                  }`}
                >
                  {isAdded ? (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>Added</span>
                    </>
                  ) : (
                    <>
                      <Plus className="w-3.5 h-3.5" />
                      <span>{isAdding ? 'Adding' : 'Add'}</span>
                    </>
                  )}
                </button>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
});
