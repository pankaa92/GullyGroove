import { CheckCircle2, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import type { PlaylistWithStats, ProviderStatus, Track } from '../types/music';
import { formatDuration } from '../utils/format';
import { ArtworkImage } from './ArtworkImage';

interface MediaVaultViewProps {
  providers: ProviderStatus[];
  vaultTracks: Track[];
  studioTracks: Track[];
  playlists: PlaylistWithStats[];
  currentTrackId: string | null;
  isPlaying: boolean;
  onOpenAddModal: () => void;
  onPlayTrack: (track: Track, list: Track[]) => void;
  onRemoveVaultTrack: (trackId: string) => void;
}

export function MediaVaultView({
  providers,
  vaultTracks,
  studioTracks,
  currentTrackId,
  isPlaying,
  onOpenAddModal,
  onPlayTrack,
  onRemoveVaultTrack,
}: MediaVaultViewProps) {
  const allManagedTracks = [...vaultTracks, ...studioTracks];

  return (
    <section className="space-y-8 gg-view-enter">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-white/[0.08] pb-6">
        <div className="space-y-1.5 max-w-2xl">
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-white tracking-tight">
            Authorised Media Vault & API Layer
          </h1>
          <p className="text-sm text-slate-400 leading-relaxed">
            Manage royalty-free, Creative Commons, and public-domain audio assets alongside modular licensed discovery providers.
          </p>
        </div>

        <button
          type="button"
          onClick={onOpenAddModal}
          className="inline-flex h-11 items-center justify-center gap-2 px-5 rounded-xl bg-gradient-to-r from-violet-600 to-blue-500 text-xs font-semibold text-white shadow-lg shadow-violet-950/40 whitespace-nowrap shrink-0 hover:opacity-95 transition-opacity"
        >
          <Plus className="w-4 h-4" />
          Register Authorised Audio
        </button>
      </div>

      {/* Modular Music API Providers Grid */}
      <div className="space-y-4">
        <div>
          <h2 className="font-display text-lg font-semibold text-white">
            Modular Music Provider Architecture
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Each adapter enforces explicit licensing boundaries—separating full licensed streams, 30-second permitted previews, and official embeds.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {providers.map((provider) => (
            <article
              key={provider.id}
              className="flex flex-col justify-between rounded-xl bg-[#12121A] border border-white/[0.08] p-4 space-y-3"
            >
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-display text-sm font-semibold text-white">
                    {provider.name}
                  </h3>
                  <span
                    className={`inline-flex items-center gap-1 text-[11px] font-medium whitespace-nowrap shrink-0 ${
                      provider.configured ? 'text-blue-400' : 'text-slate-400'
                    }`}
                  >
                    {provider.configured ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Ready
                      </>
                    ) : (
                      'Key Required'
                    )}
                  </span>
                </div>

                <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                  <span>{provider.category}</span>
                  <span aria-hidden="true">·</span>
                  <span className="text-slate-300">
                    {provider.playbackRights === 'full-stream'
                      ? 'Full Stream Permitted'
                      : provider.playbackRights === 'preview-30s'
                        ? '30s Preview Only'
                        : 'Official Embed / Metadata'}
                  </span>
                </div>

                <p className="text-xs text-slate-400 leading-relaxed">
                  {provider.description}
                </p>
              </div>

              <div className="pt-3 border-t border-white/[0.06] space-y-1.5">
                <p className="text-[11px] text-slate-300 leading-relaxed flex items-start gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-violet-400 shrink-0 mt-0.5" />
                  <span>{provider.licensePolicy}</span>
                </p>
                {provider.envKeysRequired.length > 0 && !provider.configured ? (
                  <p className="text-[11px] font-mono-tabular text-slate-500">
                    Server env: {provider.envKeysRequired.join(', ')}
                  </p>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </div>

      {/* Registered User Vault & Studio Audio Assets */}
      <div className="space-y-4">
        <div className="flex items-center justify-between border-b border-white/[0.08] pb-2">
          <div>
            <h2 className="font-display text-lg font-semibold text-white">
              Licensed & Royalty-Free Audio Catalogue
            </h2>
            <p className="text-xs text-slate-400">
              {vaultTracks.length} custom registered tracks · {studioTracks.length} studio master tracks
            </p>
          </div>
        </div>

        <div className="divide-y divide-white/[0.05] rounded-xl bg-[#12121A] border border-white/[0.08] overflow-hidden">
          {allManagedTracks.map((track) => {
            const active = currentTrackId === track.id;
            return (
              <div
                key={track.id}
                className={`flex items-center justify-between gap-4 px-4 py-3 transition-colors ${
                  active ? 'bg-violet-500/10' : 'hover:bg-white/[0.03]'
                }`}
              >
                <button
                  type="button"
                  onClick={() => onPlayTrack(track, allManagedTracks)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md">
                    <ArtworkImage src={track.coverUrl} alt={track.title} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-white truncate">
                      {track.title}
                      {active && isPlaying ? ' · Playing' : ''}
                    </p>
                    <p className="text-xs text-slate-400 truncate">
                      {track.artist} · {track.licenseType} · {track.language}
                    </p>
                  </div>
                </button>

                <div className="hidden md:block max-w-xs text-xs text-slate-500 truncate">
                  {track.attribution || track.licenseSummary}
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs font-mono-tabular text-slate-400">
                    {formatDuration(track.durationSec)}
                  </span>
                  {track.isUserAdded ? (
                    <button
                      type="button"
                      onClick={() => onRemoveVaultTrack(track.id)}
                      aria-label={`Remove ${track.title}`}
                      className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
