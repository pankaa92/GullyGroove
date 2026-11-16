import { Play } from 'lucide-react';
import type { PlaylistWithStats } from '../types/music';
import { formatTotalMinutes } from '../utils/format';
import { ArtworkImage } from './ArtworkImage';

interface PlaylistCardProps {
  playlist: PlaylistWithStats;
  onSelect: (playlistId: string) => void;
  onQuickPlay: (playlistId: string) => void;
}

export function PlaylistCard({ playlist, onSelect, onQuickPlay }: PlaylistCardProps) {
  return (
    <article className="group relative flex flex-col rounded-xl bg-[#12121A] border border-white/[0.07] p-2.5 sm:p-3.5 transition-colors duration-200 hover:bg-[#181823] hover:border-violet-500/35">
      <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-[#0D0D14]">
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
            className="w-full h-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.04]"
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/15 to-transparent" />
        </button>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onQuickPlay(playlist.id);
          }}
          aria-label={`Play ${playlist.title}`}
          className="absolute bottom-2 right-2 sm:bottom-2.5 sm:right-2.5 flex h-10 w-10 sm:h-11 sm:w-11 items-center justify-center rounded-full bg-gradient-to-r from-violet-600 to-blue-500 text-white shadow-lg shadow-violet-950/60 transition-transform duration-150 ease-out hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white md:opacity-0 md:translate-y-1 md:group-hover:opacity-100 md:group-hover:translate-y-0"
        >
          <Play className="w-4 h-4 fill-current ml-0.5" />
        </button>
      </div>

      <button
        type="button"
        onClick={() => onSelect(playlist.id)}
        className="mt-2.5 sm:mt-3 text-left focus-visible:outline-none min-w-0"
      >
        <h3 className="font-display text-sm sm:text-[15px] font-semibold text-slate-100 truncate group-hover:text-white">
          {playlist.title}
        </h3>
        <p className="mt-0.5 sm:mt-1 text-[11px] sm:text-xs text-slate-400 line-clamp-2 leading-relaxed">
          {playlist.subtitle}
        </p>
        <div className="mt-2 flex items-center gap-1 text-[10px] sm:text-[11px] text-slate-500 font-mono-tabular truncate">
          <span className="truncate">{playlist.mood}</span>
          <span aria-hidden="true">·</span>
          <span className="shrink-0">{playlist.trackCount} tracks</span>
          <span aria-hidden="true" className="hidden sm:inline">·</span>
          <span className="hidden sm:inline shrink-0">{formatTotalMinutes(playlist.totalDurationSec)}</span>
        </div>
      </button>
    </article>
  );
}
