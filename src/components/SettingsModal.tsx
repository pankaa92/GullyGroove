import {
  Bell,
  Check,
  Info,
  Mic,
  Moon,
  Sparkles,
  Sun,
  X,
} from 'lucide-react';
import { createPortal } from 'react-dom';
import groovyAvatarUrl from '../assets/images/groovy_girl_avatar_1795443866890.jpg';

export type AppTheme = 'dark' | 'light';

export interface NotificationSettings {
  nowPlayingAlerts: boolean;
  curatedPlaylistDrops: boolean;
  groovyVoiceTips: boolean;
}

interface SettingsModalProps {
  open: boolean;
  theme: AppTheme;
  notifications: NotificationSettings;
  onChangeTheme: (theme: AppTheme) => void;
  onChangeNotifications: (next: NotificationSettings) => void;
  onClose: () => void;
}

export function SettingsModal({
  open,
  theme,
  notifications,
  onChangeTheme,
  onChangeNotifications,
  onClose,
}: SettingsModalProps) {
  if (!open || typeof document === 'undefined') return null;

  const isLight = theme === 'light';

  const handleToggleNotification = async (key: keyof NotificationSettings) => {
    const nextValue = !notifications[key];
    onChangeNotifications({
      ...notifications,
      [key]: nextValue,
    });

    if (
      nextValue &&
      key === 'nowPlayingAlerts' &&
      typeof window !== 'undefined' &&
      'Notification' in window &&
      window.Notification.permission === 'default'
    ) {
      try {
        await window.Notification.requestPermission();
      } catch {
        // Ignore browser notification permission blocks
      }
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/65 backdrop-blur-sm p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
      onClick={onClose}
    >
      <div
        className={`w-full max-w-md max-h-[88dvh] overflow-y-auto rounded-2xl border shadow-2xl transition-colors ${
          isLight
            ? 'bg-gradient-to-b from-[#FFFFFF] via-[#FAF9FF] to-[#F5F7FF] border-violet-200/80 text-slate-900 shadow-[0_28px_70px_-18px_rgba(76,29,149,0.22)]'
            : 'bg-[#101018] border-violet-500/30 text-slate-100 shadow-violet-950/60'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Modal Header */}
        <div
          className={`sticky top-0 z-10 flex items-center justify-between gap-3 px-5 py-4 border-b backdrop-blur-xl ${
            isLight
              ? 'bg-white/88 border-violet-200/60'
              : 'bg-[#101018]/95 border-white/[0.08]'
          }`}
        >
          <div>
            <h2
              className={`font-display text-lg font-bold leading-tight ${
                isLight ? 'text-slate-900' : 'text-white'
              }`}
            >
              Settings
            </h2>
            <p
              className={`text-xs mt-0.5 ${
                isLight ? 'text-slate-500' : 'text-slate-400'
              }`}
            >
              Appearance, notifications &amp; Groovy assistant info
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className={`flex h-8 w-8 items-center justify-center rounded-xl transition-colors ${
              isLight
                ? 'text-slate-500 hover:bg-violet-50 hover:text-violet-700'
                : 'text-slate-400 hover:bg-white/10 hover:text-white'
            }`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-6">
          {/* 1. Theme Section */}
          <section className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h3
                className={`text-xs font-semibold uppercase tracking-wider ${
                  isLight ? 'text-slate-500' : 'text-slate-400'
                }`}
              >
                Theme
              </h3>
              <span
                className={`text-[11px] font-medium ${
                  isLight ? 'text-violet-600' : 'text-violet-300'
                }`}
              >
                Default: Dark
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => onChangeTheme('dark')}
                aria-pressed={theme === 'dark'}
                className={`flex items-center gap-3 rounded-xl border p-3 text-left transition-all ${
                  theme === 'dark'
                    ? 'border-violet-500 bg-gradient-to-r from-violet-600/20 to-blue-500/15 ring-1 ring-violet-500/40'
                    : isLight
                      ? 'border-slate-200/90 bg-white/90 hover:bg-violet-50/60 hover:border-violet-200 shadow-sm'
                      : 'border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.07]'
                }`}
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#09090D] text-violet-300 border border-white/10">
                  <Moon className="w-4 h-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1">
                    <span
                      className={`text-xs font-semibold ${
                        isLight ? 'text-slate-900' : 'text-white'
                      }`}
                    >
                      Dark
                    </span>
                    {theme === 'dark' ? (
                      <Check className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                    ) : null}
                  </div>
                  <p
                    className={`text-[11px] truncate ${
                      isLight ? 'text-slate-500' : 'text-slate-400'
                    }`}
                  >
                    Midnight Studio
                  </p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => onChangeTheme('light')}
                aria-pressed={theme === 'light'}
                className={`flex items-center gap-3 rounded-xl border p-3 text-left transition-all ${
                  theme === 'light'
                    ? 'border-violet-500 bg-gradient-to-br from-violet-50 via-white to-sky-50 ring-1 ring-violet-500/35 shadow-[0_8px_20px_-8px_rgba(109,40,217,0.3)]'
                    : isLight
                      ? 'border-slate-200 bg-white hover:bg-slate-50'
                      : 'border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.07]'
                }`}
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-amber-100 via-orange-50 to-violet-100 text-amber-600 border border-amber-200/80 shadow-sm">
                  <Sun className="w-4 h-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1">
                    <span
                      className={`text-xs font-semibold ${
                        isLight ? 'text-slate-900' : 'text-white'
                      }`}
                    >
                      Light
                    </span>
                    {theme === 'light' ? (
                      <Check className="w-3.5 h-3.5 text-violet-600 shrink-0" />
                    ) : null}
                  </div>
                  <p
                    className={`text-[11px] truncate ${
                      isLight ? 'text-violet-700/80' : 'text-slate-400'
                    }`}
                  >
                    Bright Daylight
                  </p>
                </div>
              </button>
            </div>
          </section>

          {/* 2. Notifications Section */}
          <section className="space-y-2.5">
            <h3
              className={`text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5 ${
                isLight ? 'text-slate-500' : 'text-slate-400'
              }`}
            >
              <Bell className="w-3.5 h-3.5 text-violet-400" />
              Notifications
            </h3>

            <div
              className={`divide-y rounded-2xl border overflow-hidden ${
                isLight
                  ? 'bg-slate-50 border-slate-200 divide-slate-200'
                  : 'bg-white/[0.03] border-white/[0.08] divide-white/[0.06]'
              }`}
            >
              {[
                {
                  key: 'nowPlayingAlerts' as const,
                  title: 'Now Playing Alerts',
                  desc: 'Track & playlist transition alerts while listening',
                },
                {
                  key: 'curatedPlaylistDrops' as const,
                  title: 'Playlist & Vibe Updates',
                  desc: 'Notify when new regional mixes or tracks are added',
                },
                {
                  key: 'groovyVoiceTips' as const,
                  title: 'Groovy Voice Prompts',
                  desc: 'Show quick spoken greeting & command suggestions',
                },
              ].map((item) => {
                const enabled = notifications[item.key];
                return (
                  <div
                    key={item.key}
                    className="flex items-center justify-between gap-3 px-3.5 py-3"
                  >
                    <div className="min-w-0">
                      <p
                        className={`text-xs font-semibold ${
                          isLight ? 'text-slate-900' : 'text-white'
                        }`}
                      >
                        {item.title}
                      </p>
                      <p
                        className={`text-[11px] mt-0.5 ${
                          isLight ? 'text-slate-500' : 'text-slate-400'
                        }`}
                      >
                        {item.desc}
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={enabled}
                      aria-label={item.title}
                      onClick={() => void handleToggleNotification(item.key)}
                      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors duration-200 ${
                        enabled
                          ? 'bg-gradient-to-r from-violet-600 to-blue-500'
                          : isLight
                            ? 'bg-slate-300'
                            : 'bg-white/[0.15]'
                      }`}
                    >
                      <span
                        className={`h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                          enabled ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                );
              })}
            </div>
          </section>

          {/* 3. About Groovy Section */}
          <section className="space-y-2.5">
            <h3
              className={`text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5 ${
                isLight ? 'text-slate-500' : 'text-slate-400'
              }`}
            >
              <Info className="w-3.5 h-3.5 text-blue-400" />
              About Groovy
            </h3>

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
                    <h4
                      className={`font-display text-sm font-bold ${
                        isLight ? 'text-slate-900' : 'text-white'
                      }`}
                    >
                      Groovy Voice Assistant
                    </h4>
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
                Groovy is more than just a music player — it&apos;s your personal music
                companion, designed to make listening effortless, fun, and interactive.
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
                  Supports all 16 playlists &amp; artists
                </span>
                <span className="font-mono-tabular">GullyGroove v2.0</span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>,
    document.body
  );
}
