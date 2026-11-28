import { Disc3, Info, Mic, Sparkles, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import groovyAvatarUrl from '../assets/images/groovy_girl_avatar_1795443866890.jpg';
import type { AppTheme } from './SettingsModal';

interface AboutModalProps {
  open: boolean;
  theme: AppTheme;
  playlistCount: number;
  onClose: () => void;
}

export function AboutModal({
  open,
  theme,
  playlistCount,
  onClose,
}: AboutModalProps) {
  if (!open || typeof document === 'undefined') return null;

  const isLight = theme === 'light';

  return createPortal(
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/65 backdrop-blur-sm p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="About GullyGroove and Groovy"
      onClick={onClose}
    >
      <div
        className={`w-full max-w-md max-h-[88dvh] overflow-y-auto rounded-2xl border shadow-2xl ${
          isLight
            ? 'bg-gradient-to-b from-white via-[#FAF9FF] to-[#F5F7FF] border-violet-200 text-slate-900'
            : 'bg-[#101018] border-violet-500/30 text-slate-100'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={`sticky top-0 z-10 flex items-center justify-between gap-3 px-5 py-4 border-b backdrop-blur-xl ${
            isLight
              ? 'bg-white/90 border-violet-200/70'
              : 'bg-[#101018]/95 border-white/[0.08]'
          }`}
        >
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 text-blue-400" />
            <h2
              className={`font-display text-lg font-bold ${
                isLight ? 'text-slate-900' : 'text-white'
              }`}
            >
              About GullyGroove
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close about dialog"
            className={`flex h-8 w-8 items-center justify-center rounded-xl transition-colors ${
              isLight
                ? 'text-slate-500 hover:bg-violet-50 hover:text-violet-700'
                : 'text-slate-400 hover:bg-white/10 hover:text-white'
            }`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div
            className={`rounded-2xl border p-4 space-y-3 ${
              isLight
                ? 'bg-gradient-to-br from-violet-50 via-white to-blue-50 border-violet-200'
                : 'bg-gradient-to-br from-violet-950/35 via-[#131322] to-blue-950/25 border-violet-500/25'
            }`}
          >
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 shrink-0 overflow-hidden rounded-full border-2 border-violet-400/70 bg-[#141426] shadow-md">
                <img
                  src={groovyAvatarUrl}
                  alt="Groovy assistant"
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-cover scale-105"
                />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3
                    className={`font-display text-sm font-bold ${
                      isLight ? 'text-slate-900' : 'text-white'
                    }`}
                  >
                    Groovy Voice Assistant
                  </h3>
                  <span
                    className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${
                      isLight
                        ? 'bg-violet-100 text-violet-700'
                        : 'bg-violet-500/20 text-violet-200'
                    }`}
                  >
                    <Sparkles className="w-2.5 h-2.5" />
                    Tap-to-Talk
                  </span>
                </div>
                <p
                  className={`text-[11px] mt-0.5 ${
                    isLight ? 'text-slate-600' : 'text-slate-300'
                  }`}
                >
                  Smart music discovery &amp; voice control for GullyGroove
                </p>
              </div>
            </div>

            <p
              className={`text-xs leading-relaxed rounded-xl px-3 py-2.5 border ${
                isLight
                  ? 'bg-white/80 border-violet-200/80 text-slate-600'
                  : 'bg-[#0B0B14]/70 border-white/[0.06] text-slate-300'
              }`}
            >
              <span
                className={`block font-display font-bold mb-1 ${
                  isLight ? 'text-violet-700' : 'text-violet-300'
                }`}
              >
                Your Music. Your Voice. Your Vibe.
              </span>
              GullyGroove brings curated Hindi, Punjabi, South, Bhojpuri, Bhakti, and regional mixes together with intelligent early crossfade, Hook Mode, and optional Google Cloud sync.
            </p>

            <div
              className={`flex items-center justify-between gap-2 pt-2 border-t text-[11px] ${
                isLight
                  ? 'border-violet-200/70 text-slate-500'
                  : 'border-white/[0.08] text-slate-400'
              }`}
            >
              <span className="inline-flex items-center gap-1">
                <Mic className="w-3 h-3 text-violet-400" />
                {playlistCount} playlists &amp; DJ crossfade
              </span>
              <span className="inline-flex items-center gap-1 font-mono-tabular">
                <Disc3 className="w-3 h-3 text-blue-400" />
                GullyGroove v2.0
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
