import {
  Info,
  Loader2,
  LogIn,
  LogOut,
  Menu,
  Settings,
  User as UserIcon,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useFirebase } from '../contexts/FirebaseContext';
import type { AppTheme } from './SettingsModal';

interface HeaderMenuProps {
  theme: AppTheme;
  compact?: boolean;
  onOpenProfile: () => void;
  onOpenSettings: () => void;
  onOpenAbout: () => void;
}

export function HeaderMenu({
  theme,
  compact = false,
  onOpenProfile,
  onOpenSettings,
  onOpenAbout,
}: HeaderMenuProps) {
  const { user, profile, authActionLoading, signInWithGoogle, signOutUser } =
    useFirebase();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const isLight = theme === 'light';
  const displayName =
    profile?.displayName || user?.displayName || user?.email?.split('@')[0] || '';
  const photoURL = profile?.photoURL || user?.photoURL || '';
  const email = profile?.email || user?.email || '';

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const handleAuthAction = async () => {
    if (user) {
      await signOutUser();
      setOpen(false);
    } else {
      const signedIn = await signInWithGoogle();
      if (signedIn) {
        setOpen(false);
      }
    }
  };

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label="Open Menu"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Menu"
        className={`inline-flex items-center justify-center gap-1.5 rounded-lg bg-white/[0.07] hover:bg-white/[0.14] border border-white/10 text-slate-200 hover:text-white transition-colors shrink-0 ${
          compact ? 'h-7 px-1.5 sm:h-8 sm:px-2' : 'h-8 px-2.5'
        }`}
      >
        {user && photoURL ? (
          <img
            src={photoURL}
            alt={displayName || 'User avatar'}
            referrerPolicy="no-referrer"
            className="h-5 w-5 rounded-full object-cover border border-violet-400/60"
          />
        ) : user ? (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-blue-500 text-[10px] font-bold text-white">
            {(displayName || 'U').slice(0, 1).toUpperCase()}
          </span>
        ) : null}
        <Menu className={compact ? 'w-3.5 h-3.5 sm:w-4 sm:h-4' : 'w-4 h-4'} />
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Account and app menu"
          className={`absolute right-0 mt-2 w-64 rounded-2xl border shadow-2xl overflow-hidden z-50 backdrop-blur-xl ${
            isLight
              ? 'bg-white/95 border-violet-200 text-slate-900 shadow-[0_20px_50px_-12px_rgba(76,29,149,0.25)]'
              : 'bg-[#12121D]/95 border-white/12 text-slate-100 shadow-black/70'
          }`}
        >
          {/* User Account Status Strip */}
          <div
            className={`px-3.5 py-3 border-b flex items-center gap-2.5 ${
              isLight
                ? 'border-violet-100 bg-violet-50/50'
                : 'border-white/[0.07] bg-white/[0.03]'
            }`}
          >
            {user && photoURL ? (
              <img
                src={photoURL}
                alt={displayName}
                referrerPolicy="no-referrer"
                className="h-9 w-9 rounded-full object-cover border border-violet-400/50 shrink-0"
              />
            ) : (
              <div
                className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 border ${
                  user
                    ? 'bg-gradient-to-br from-violet-600 to-blue-500 border-violet-400/40 text-white font-bold text-xs'
                    : isLight
                      ? 'bg-slate-100 border-slate-200 text-slate-500'
                      : 'bg-white/[0.06] border-white/10 text-slate-400'
                }`}
              >
                {user ? (
                  (displayName || 'U').slice(0, 1).toUpperCase()
                ) : (
                  <UserIcon className="w-4 h-4" />
                )}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p
                className={`text-xs font-semibold truncate ${
                  isLight ? 'text-slate-900' : 'text-white'
                }`}
              >
                {user ? displayName || 'GullyGroove Listener' : 'Guest Listener'}
              </p>
              <p
                className={`text-[11px] truncate ${
                  isLight ? 'text-slate-500' : 'text-slate-400'
                }`}
              >
                {user ? email : 'Browse & play freely · Sign in optional'}
              </p>
            </div>
          </div>

          <div className="p-1.5 space-y-0.5">
            <button
              type="button"
              role="menuitem"
              disabled={authActionLoading}
              onClick={() => void handleAuthAction()}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors text-left ${
                user
                  ? isLight
                    ? 'text-rose-600 hover:bg-rose-50'
                    : 'text-rose-300 hover:bg-rose-500/15'
                  : isLight
                    ? 'text-violet-700 hover:bg-violet-50 font-semibold'
                    : 'text-violet-300 hover:bg-violet-500/15 font-semibold'
              } disabled:opacity-60`}
            >
              {authActionLoading ? (
                <Loader2 className="w-4 h-4 animate-spin shrink-0" />
              ) : user ? (
                <LogOut className="w-4 h-4 shrink-0" />
              ) : (
                <LogIn className="w-4 h-4 shrink-0" />
              )}
              <span>
                {authActionLoading
                  ? user
                    ? 'Signing out...'
                    : 'Signing in with Google...'
                  : user
                    ? 'Sign out'
                    : 'Sign in'}
              </span>
            </button>

            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onOpenProfile();
              }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors text-left ${
                isLight
                  ? 'text-slate-700 hover:bg-slate-100'
                  : 'text-slate-200 hover:bg-white/[0.07]'
              }`}
            >
              <UserIcon className="w-4 h-4 text-blue-400 shrink-0" />
              <span>Profile</span>
            </button>

            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onOpenSettings();
              }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors text-left ${
                isLight
                  ? 'text-slate-700 hover:bg-slate-100'
                  : 'text-slate-200 hover:bg-white/[0.07]'
              }`}
            >
              <Settings className="w-4 h-4 text-violet-400 shrink-0" />
              <span>Setting</span>
            </button>

            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onOpenAbout();
              }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors text-left ${
                isLight
                  ? 'text-slate-700 hover:bg-slate-100'
                  : 'text-slate-200 hover:bg-white/[0.07]'
              }`}
            >
              <Info className="w-4 h-4 text-cyan-400 shrink-0" />
              <span>About</span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
