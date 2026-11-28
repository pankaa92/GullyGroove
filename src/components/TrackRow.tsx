import { ExternalLink, Globe, Heart, Lock, Pause, Play, Plus } from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';
import type { PlaylistWithStats, Track } from '../types/music';
import { formatDuration, formatPlays } from '../utils/format';
import { ArtworkImage } from './ArtworkImage';

interface TrackRowProps {
  track: Track;
  index: number;
  isCurrent: boolean;
  isPlaying: boolean;
  isFavorite: boolean;
  playlists: PlaylistWithStats[];
  onPlayToggle: (track: Track) => void;
  onToggleFavorite: (trackId: string, track?: Track) => void;
  onAddToPlaylist?: (trackId: string, playlistId: string, track?: Track) => void;
  showAlbum?: boolean;
}

export const TrackRow = memo(function TrackRow({
  track,
  index,
  isCurrent,
  isPlaying,
  isFavorite,
  playlists,
  onPlayToggle,
  onToggleFavorite,
  onAddToPlaylist,
  showAlbum = true,
}: TrackRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      if (
        menuContainerRef.current &&
        !menuContainerRef.current.contains(e.target as Node)
      ) {
        setMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown, { passive: true });
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  const rightsLabel =
    track.playbackRights === 'full-stream'
      ? track.licenseType
      : track.playbackRights === 'preview-30s'
        ? '30s Preview'
        : track.playbackRights === 'embed-only'
          ? 'Official Embed'
          : 'Metadata Only';

  return (
    <div
      className={`group relative flex items-center gap-2 sm:gap-4 px-2 sm:px-3 py-2 sm:py-2.5 rounded-xl transition-colors duration-150 ${
        isCurrent
          ? 'bg-gradient-to-r from-violet-600/14 via-violet-500/10 to-blue-500/10 border border-violet-500/30'
          : 'border border-transparent hover:bg-white/[0.05]'
      }`}
    >
      {/* Index / Play button */}
      <button
        type="button"
        onClick={() => onPlayToggle(track)}
        aria-label={isCurrent && isPlaying ? `Pause ${track.title}` : `Play ${track.title}`}
        className="flex h-10 w-8 shrink-0 items-center justify-center text-xs font-mono-tabular text-slate-400 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-lg"
      >
        {isCurrent && isPlaying ? (
          <>
            <span className="flex items-end gap-[2px] h-3.5 group-hover:hidden" aria-hidden="true">
              <span className="w-[2.5px] h-full rounded-full bg-violet-400 gg-eq-bar" />
              <span className="w-[2.5px] h-full rounded-full bg-blue-400 gg-eq-bar gg-eq-bar-delay-1" />
              <span className="w-[2.5px] h-full rounded-full bg-violet-300 gg-eq-bar gg-eq-bar-delay-2" />
            </span>
            <Pause className="hidden w-4 h-4 text-violet-300 fill-current group-hover:block" />
          </>
        ) : (
          <>
            <span className="group-hover:hidden">
              {isCurrent ? (
                <Play className="w-4 h-4 text-violet-400 fill-current" />
              ) : (
                String(index + 1).padStart(2, '0')
              )}
            </span>
            <Play className="hidden w-4 h-4 text-white fill-current group-hover:block" />
          </>
        )}
      </button>

      {/* Cover & Title / Artist */}
      <button
        type="button"
        onClick={() => onPlayToggle(track)}
        className="flex min-w-0 flex-1 items-center gap-2.5 sm:gap-3 text-left focus-visible:outline-none"
      >
        <div className="h-10 w-10 sm:h-11 sm:w-11 shrink-0 overflow-hidden rounded-md bg-[#181822]">
          <ArtworkImage
            src={track.coverUrl}
            alt={track.title}
            className="h-full w-full object-cover"
          />
        </div>
        <div className="min-w-0 flex-1">
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
            <span className="text-slate-500">{track.genre}</span>
          </p>
        </div>
      </button>

      {/* Album (Desktop) */}
      {showAlbum ? (
        <div className="hidden md:block w-44 shrink-0 text-xs text-slate-400 truncate">
          {track.album}
        </div>
      ) : null}

      {/* License & Language Metadata (Unboxed) */}
      <div className="hidden lg:flex w-52 shrink-0 items-center gap-1.5 text-xs text-slate-400 truncate">
        <span className="truncate">{track.language}</span>
        <span aria-hidden="true" className="text-slate-600">
          ·
        </span>
        <span
          className={
            track.playbackRights === 'full-stream'
              ? 'text-blue-300 truncate'
              : 'text-slate-400 truncate'
          }
          title={track.licenseSummary}
        >
          {rightsLabel}
        </span>
      </div>

      {/* Plays (XL) */}
      <div className="hidden xl:block w-16 shrink-0 text-right text-xs font-mono-tabular text-slate-500">
        {formatPlays(track.plays)}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
        <button
          type="button"
          onClick={() => onToggleFavorite(track.id, track)}
          aria-label={isFavorite ? `Remove ${track.title} from favorites` : `Save ${track.title}`}
          className={`flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
            isFavorite
              ? 'text-violet-400 hover:text-violet-300'
              : 'text-slate-500 hover:text-slate-200'
          }`}
        >
          <Heart className={`w-4 h-4 ${isFavorite ? 'fill-current' : ''}`} />
        </button>

        {onAddToPlaylist && playlists.length > 0 ? (
          <div ref={menuContainerRef} className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((prev) => !prev)}
              aria-label={`Add ${track.title} to playlist`}
              aria-expanded={menuOpen}
              className="flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-lg text-slate-500 hover:text-slate-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <Plus className="w-4 h-4" />
            </button>

            {menuOpen ? (
              <div
                className={`absolute right-0 z-40 w-60 max-w-[calc(100vw-2rem)] rounded-xl bg-[#161621] border border-white/10 p-1.5 shadow-2xl ${
                  index < 3 ? 'top-full mt-1' : 'bottom-full mb-1'
                }`}
              >
                <p className="px-2.5 py-1.5 text-[11px] font-medium text-slate-400">
                  Add to playlist
                </p>
                <div className="max-h-48 overflow-y-auto space-y-0.5">
                  {playlists.map((pl) => {
                    const isPrivate =
                      pl.id === 'my-playlist' || pl.id.startsWith('priv-');
                    const alreadyIn =
                      track.playlistIds.includes(pl.id) ||
                      (pl.id === 'my-playlist' && isFavorite);
                    return (
                      <button
                        key={pl.id}
                        type="button"
                        disabled={alreadyIn}
                        onClick={() => {
                          onAddToPlaylist(track.id, pl.id, track);
                          setMenuOpen(false);
                        }}
                        className="w-full flex items-center justify-between gap-2 text-left px-2.5 py-2 sm:py-1.5 text-xs rounded-lg transition-colors disabled:opacity-45 hover:bg-white/[0.06] text-slate-200"
                      >
                        <span className="truncate">
                          {alreadyIn ? `${pl.title} (Added)` : pl.title}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 shrink-0 text-[10px] font-medium ${
                            isPrivate ? 'text-violet-300' : 'text-blue-300/80'
                          }`}
                        >
                          {isPrivate ? (
                            <>
                              <Lock className="w-2.5 h-2.5" />
                              Private
                            </>
                          ) : (
                            <>
                              <Globe className="w-2.5 h-2.5" />
                              Shared
                            </>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        ) : track.externalUrl ? (
          <a
            href={track.externalUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open ${track.title} on ${track.providerName}`}
            className="flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-lg text-slate-500 hover:text-blue-400 transition-colors"
          >
            <ExternalLink className="w-4 h-4" />
          </a>
        ) : null}

        <span className="hidden xs:inline-block sm:inline-block w-10 sm:w-11 text-right text-[11px] sm:text-xs font-mono-tabular text-slate-400">
          {track.durationSec > 0 ? formatDuration(track.durationSec) : 'Embed'}
        </span>
      </div>
    </div>
  );
});
