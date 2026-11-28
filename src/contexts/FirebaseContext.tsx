import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { auth, googleProvider } from '../firebase';
import {
  ensureUserProfileAndDefaults,
  type UserProfileRecord,
} from '../services/firebaseMusicService';

interface FirebaseContextValue {
  user: User | null;
  profile: UserProfileRecord | null;
  isAuthReady: boolean;
  authLoading: boolean;
  authActionLoading: boolean;
  authError: string | null;
  signInWithGoogle: () => Promise<User | null>;
  signOutUser: () => Promise<void>;
  clearAuthError: () => void;
}

const FirebaseContext = createContext<FirebaseContextValue | null>(null);

function formatFirebaseAuthError(error: unknown): string {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code: unknown }).code)
      : '';
  switch (code) {
    case 'auth/popup-closed-by-user':
      return 'Google Sign-In was closed before completing.';
    case 'auth/popup-blocked':
      return 'Browser blocked the Google Sign-In popup. Please allow popups and try again.';
    case 'auth/cancelled-popup-request':
      return 'Another sign-in popup is already open.';
    case 'auth/network-request-failed':
      return 'Network error during sign-in. Please check your connection.';
    case 'auth/unauthorized-domain':
      return 'This domain is not authorized for Google Sign-In yet.';
    default:
      return error instanceof Error
        ? error.message
        : 'Unable to sign in with Google right now.';
  }
}

export function FirebaseProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfileRecord | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [authActionLoading, setAuthActionLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
      if (cancelled) return;
      setUser(nextUser);
      if (!nextUser) {
        setProfile(null);
        setIsAuthReady(true);
        return;
      }

      try {
        const syncedProfile = await ensureUserProfileAndDefaults(nextUser);
        if (!cancelled) {
          setProfile(syncedProfile);
        }
      } catch (err) {
        if (!cancelled) {
          setAuthError(
            err instanceof Error
              ? 'Signed in, but could not sync profile details cleanly.'
              : 'Profile sync warning.'
          );
          setProfile({
            uid: nextUser.uid,
            displayName: nextUser.displayName || nextUser.email?.split('@')[0] || 'Listener',
            email: nextUser.email || '',
            photoURL: nextUser.photoURL || '',
            createdAtIso: nextUser.metadata.creationTime
              ? new Date(nextUser.metadata.creationTime).toISOString()
              : new Date().toISOString(),
            updatedAtIso: new Date().toISOString(),
          });
        }
      } finally {
        if (!cancelled) {
          setIsAuthReady(true);
        }
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const signInWithGoogle = useCallback(async (): Promise<User | null> => {
    setAuthError(null);
    setAuthActionLoading(true);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      return result.user;
    } catch (err) {
      setAuthError(formatFirebaseAuthError(err));
      return null;
    } finally {
      setAuthActionLoading(false);
    }
  }, []);

  const signOutUser = useCallback(async () => {
    setAuthError(null);
    setAuthActionLoading(true);
    try {
      await signOut(auth);
      setProfile(null);
    } catch (err) {
      setAuthError(formatFirebaseAuthError(err));
    } finally {
      setAuthActionLoading(false);
    }
  }, []);

  const clearAuthError = useCallback(() => {
    setAuthError(null);
  }, []);

  const value = useMemo<FirebaseContextValue>(
    () => ({
      user,
      profile,
      isAuthReady,
      authLoading: !isAuthReady,
      authActionLoading,
      authError,
      signInWithGoogle,
      signOutUser,
      clearAuthError,
    }),
    [
      user,
      profile,
      isAuthReady,
      authActionLoading,
      authError,
      signInWithGoogle,
      signOutUser,
      clearAuthError,
    ]
  );

  return (
    <FirebaseContext.Provider value={value}>{children}</FirebaseContext.Provider>
  );
}

export function useFirebase(): FirebaseContextValue {
  const ctx = useContext(FirebaseContext);
  if (!ctx) {
    throw new Error('useFirebase must be used inside FirebaseProvider');
  }
  return ctx;
}
