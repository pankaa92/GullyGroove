import { Play } from 'lucide-react';
import { memo } from 'react';
import type { PlaylistWithStats } from '../types/music';
import { formatTotalMinutes } from '../utils/format';
import { ArtworkImage } from './ArtworkImage';

interface PlaylistCardProps {
  playlist: PlaylistWithStats;
  activeLanguage?: string;
  onSelect: (playlistId: string) => void;
  onQuickPlay: (playlistId: string) => void;
}

export const PlaylistCard = memo(function PlaylistCard({
  playlist,
  activeLanguage,
  onSelect,
  onQuickPlay,
}: PlaylistCardProps) {
  const countLabel =
    activeLanguage && activeLanguage !== 'All'
      ? `${playlist.trackCount} ${activeLanguage} songs`
      : `${playlist.trackCount} songs`;

  return (
    <article className="group relative flex flex-col rounded-2xl bg-[#12121B] border border-white/[0.06] p-2.5 sm:p-3.5 transform-gpu transition-[transform,background-color,border-color,box-shadow] duration-150 ease-out hover:-translate-y-0.5 hover:bg-[#191926] hover:border-violet-500/35 hover:shadow-[0_14px_34px_-14px_rgba(124,58,237,0.45)]">
      <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-[#0D0D14]">
        <button
          type="button"
          onClick={() => onSelect(playlist.id)}
          className="block w-full h-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          aria-label={`Open ${playlist.title}`}
        >
          <ArtworkImage
            src={playlist.coverUrl}
            alt={playlist.title}
            fallbackLabel={playlist.title}
            className="w-full h-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.05]"
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-black/15 to-transparent" />
        </button>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onQuickPlay(playlist.id);
          }}
          aria-label={`Play ${playlist.title}`}
          className="absolute bottom-2.5 right-2.5 flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-r from-violet-600 to-blue-500 text-white shadow-xl shadow-violet-950/70 transform-gpu transition-[transform,opacity] duration-150 ease-out hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white md:opacity-0 md:translate-y-2 md:group-hover:opacity-100 md:group-hover:translate-y-0"
        >
          <Play className="w-4 h-4 fill-current ml-0.5" />
        </button>
      </div>

      <button
        type="button"
        onClick={() => onSelect(playlist.id)}
        className="mt-3 text-left focus-visible:outline-none min-w-0"
      >
        <p className="text-[11px] font-medium text-blue-300/90 truncate">
          {playlist.mood}
        </p>
        <h3 className="mt-0.5 font-display text-sm sm:text-[15px] font-semibold text-slate-100 truncate transition-colors group-hover:text-white">
          {playlist.title}
        </h3>
        <p className="mt-0.5 sm:mt-1 text-[11px] sm:text-xs text-slate-400 line-clamp-2 leading-relaxed">
          {playlist.subtitle}
        </p>
        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-500 font-mono-tabular truncate">
          <span className="shrink-0 text-slate-400">{countLabel}</span>
          {playlist.totalDurationSec > 0 ? (
            <>
              <span aria-hidden="true" className="hidden sm:inline">
                ·
              </span>
              <span className="hidden sm:inline shrink-0">
                {formatTotalMinutes(playlist.totalDurationSec)}
              </span>
            </>
          ) : null}
        </div>
      </button>
    </article>
  );
});
