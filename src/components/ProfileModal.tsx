import {
  Calendar,
  Cloud,
  FolderPlus,
  Heart,
  History,
  Loader2,
  Lock,
  LogIn,
  LogOut,
  Mail,
  ShieldCheck,
  User as UserIcon,
  X,
} from 'lucide-react';
import { createPortal } from 'react-dom';
import { useFirebase } from '../contexts/FirebaseContext';
import type { AppTheme } from './SettingsModal';

interface ProfileModalProps {
  open: boolean;
  theme: AppTheme;
  personalPlaylistsCount: number;
  likedCount: number;
  recentlyPlayedCount: number;
  onOpenCreatePlaylist: () => void;
  onClose: () => void;
}

export function ProfileModal({
  open,
  theme,
  personalPlaylistsCount,
  likedCount,
  recentlyPlayedCount,
  onOpenCreatePlaylist,
  onClose,
}: ProfileModalProps) {
  const {
    user,
    profile,
    authActionLoading,
    authError,
    signInWithGoogle,
    signOutUser,
    clearAuthError,
  } = useFirebase();

  if (!open || typeof document === 'undefined') return null;

  const isLight = theme === 'light';
  const displayName =
    profile?.displayName || user?.displayName || 'GullyGroove Listener';
  const email = profile?.email || user?.email || '';
  const photoURL = profile?.photoURL || user?.photoURL || '';
  const createdDate = profile?.createdAtIso
    ? new Date(profile.createdAtIso).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : user?.metadata.creationTime
      ? new Date(user.metadata.creationTime).toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        })
      : '';

  return createPortal(
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/65 backdrop-blur-sm p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="User Profile"
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
          <div>
            <h2
              className={`font-display text-lg font-bold ${
                isLight ? 'text-slate-900' : 'text-white'
              }`}
            >
              Profile
            </h2>
            <p className={`text-xs mt-0.5 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
              {user
                ? 'Synced with Google & Cloud Firestore'
                : 'Listening as Guest — sign in optionally'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close profile"
            className={`flex h-8 w-8 items-center justify-center rounded-xl transition-colors ${
              isLight
                ? 'text-slate-500 hover:bg-violet-50 hover:text-violet-700'
                : 'text-slate-400 hover:bg-white/10 hover:text-white'
            }`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {authError ? (
            <div className="rounded-xl border border-rose-500/35 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-300 flex items-center justify-between gap-2">
              <span>{authError}</span>
              <button
                type="button"
                onClick={clearAuthError}
                className="text-rose-200 hover:text-white font-semibold shrink-0"
              >
                Dismiss
              </button>
            </div>
          ) : null}

          {user ? (
            <>
              <div
                className={`rounded-2xl border p-4 flex items-center gap-3.5 ${
                  isLight
                    ? 'bg-white border-violet-200/80 shadow-sm'
                    : 'bg-white/[0.03] border-white/[0.08]'
                }`}
              >
                {photoURL ? (
                  <img
                    src={photoURL}
                    alt={displayName}
                    referrerPolicy="no-referrer"
                    className="h-14 w-14 rounded-full object-cover border-2 border-violet-500/60 shrink-0"
                  />
                ) : (
                  <div className="h-14 w-14 rounded-full bg-gradient-to-br from-violet-600 to-blue-500 flex items-center justify-center text-white text-lg font-bold shrink-0">
                    {displayName.slice(0, 1).toUpperCase()}
                  </div>
                )}

                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-1.5">
                    <h3
                      className={`font-display text-base font-bold truncate ${
                        isLight ? 'text-slate-900' : 'text-white'
                      }`}
                    >
                      {displayName}
                    </h3>
                    <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                  </div>
                  <p
                    className={`text-xs flex items-center gap-1.5 truncate ${
                      isLight ? 'text-slate-600' : 'text-slate-300'
                    }`}
                  >
                    <Mail className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                    <span className="truncate">{email}</span>
                  </p>
                  {createdDate ? (
                    <p
                      className={`text-[11px] flex items-center gap-1.5 ${
                        isLight ? 'text-slate-500' : 'text-slate-400'
                      }`}
                    >
                      <Calendar className="w-3 h-3 text-blue-400 shrink-0" />
                      <span>Member since {createdDate}</span>
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2.5">
                <div
                  className={`rounded-xl border p-3 text-center ${
                    isLight
                      ? 'bg-slate-50 border-slate-200'
                      : 'bg-white/[0.03] border-white/[0.08]'
                  }`}
                >
                  <Lock className="w-4 h-4 text-amber-400 mx-auto mb-1" />
                  <p className="font-mono-tabular text-sm font-bold">
                    {personalPlaylistsCount}
                  </p>
                  <p className={`text-[10px] ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                    Private Lists
                  </p>
                </div>
                <div
                  className={`rounded-xl border p-3 text-center ${
                    isLight
                      ? 'bg-slate-50 border-slate-200'
                      : 'bg-white/[0.03] border-white/[0.08]'
                  }`}
                >
                  <Heart className="w-4 h-4 text-rose-400 mx-auto mb-1" />
                  <p className="font-mono-tabular text-sm font-bold">{likedCount}</p>
                  <p className={`text-[10px] ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                    Liked Songs
                  </p>
                </div>
                <div
                  className={`rounded-xl border p-3 text-center ${
                    isLight
                      ? 'bg-slate-50 border-slate-200'
                      : 'bg-white/[0.03] border-white/[0.08]'
                  }`}
                >
                  <History className="w-4 h-4 text-blue-400 mx-auto mb-1" />
                  <p className="font-mono-tabular text-sm font-bold">
                    {recentlyPlayedCount}
                  </p>
                  <p className={`text-[10px] ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                    Recent Tracks
                  </p>
                </div>
              </div>

              <div
                className={`rounded-xl border px-3.5 py-2.5 flex items-center gap-2 text-xs ${
                  isLight
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : 'bg-emerald-500/10 border-emerald-500/25 text-emerald-200'
                }`}
              >
                <Cloud className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>
                  Your private playlists, liked songs, recently played history, and preferences sync automatically.
                </span>
              </div>

              <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenCreatePlaylist();
                  }}
                  className="flex-1 inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-blue-500 text-xs font-semibold text-white hover:opacity-95 transition-opacity"
                >
                  <FolderPlus className="w-4 h-4" />
                  New Playlist
                </button>
                <button
                  type="button"
                  disabled={authActionLoading}
                  onClick={() => void signOutUser()}
                  className={`inline-flex h-10 items-center justify-center gap-2 px-4 rounded-xl border text-xs font-semibold transition-colors disabled:opacity-60 ${
                    isLight
                      ? 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100'
                      : 'border-rose-500/30 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20'
                  }`}
                >
                  {authActionLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <LogOut className="w-4 h-4" />
                  )}
                  Sign out
                </button>
              </div>
            </>
          ) : (
            <div className="space-y-4">
              <div
                className={`rounded-2xl border p-5 text-center space-y-3 ${
                  isLight
                    ? 'bg-slate-50 border-slate-200'
                    : 'bg-white/[0.03] border-white/[0.08]'
                }`}
              >
                <div className="h-14 w-14 mx-auto rounded-full bg-gradient-to-br from-violet-600/25 to-blue-500/25 border border-violet-400/35 flex items-center justify-center text-violet-300">
                  <UserIcon className="w-7 h-7" />
                </div>
                <div className="space-y-1">
                  <h3
                    className={`font-display text-base font-bold ${
                      isLight ? 'text-slate-900' : 'text-white'
                    }`}
                  >
                    Sign in with Google
                  </h3>
                  <p
                    className={`text-xs leading-relaxed ${
                      isLight ? 'text-slate-600' : 'text-slate-400'
                    }`}
                  >
                    You can always browse and play music as a guest. Sign in anytime to save private playlists, liked songs, listening history, and settings across devices — without interrupting playback.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={authActionLoading}
                  onClick={() => void signInWithGoogle()}
                  className="w-full inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-blue-500 text-xs font-semibold text-white shadow-lg shadow-violet-950/40 hover:opacity-95 disabled:opacity-60"
                >
                  {authActionLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <LogIn className="w-4 h-4" />
                  )}
                  {authActionLoading ? 'Connecting to Google...' : 'Continue with Google'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
