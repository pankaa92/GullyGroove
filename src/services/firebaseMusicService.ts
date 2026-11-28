import type { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { COVER_ASSETS } from '../data/catalog';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  isServerSyncAvailable,
  toDirectAudiusStreamUrl,
} from './clientCatalog';
import type {
  LicenseType,
  PlaylistWithStats,
  ProviderId,
  Track,
} from '../types/music';
import type { AppTheme, NotificationSettings } from '../components/SettingsModal';
import type { CrossfadeSettings } from '../utils/hookTiming';

export interface UserProfileRecord {
  uid: string;
  displayName: string;
  email: string;
  photoURL: string;
  createdAtIso: string;
  updatedAtIso: string;
}

export interface UserPreferencesRecord {
  theme: AppTheme;
  crossfadeSec: number;
  djCrossfadeSec: number;
  djMode: boolean;
  notifications: NotificationSettings;
}

export interface PersonalPlaylistRecord {
  id: string;
  ownerId: string;
  title: string;
  subtitle: string;
  description: string;
  isPrivate: true;
  createdAtMs: number;
}

export interface SharedPlaylistRecord {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  mood: string;
  region: 'India' | 'Pan-India' | 'Global';
  coverUrl: string;
  ownerId: string;
  ownerName: string;
  isShared: true;
  allowContributions: boolean;
  createdAtMs: number;
}

export interface PlaylistContributorRecord {
  uid: string;
  playlistId: string;
  displayName: string;
  photoURL: string;
  role: 'owner' | 'contributor';
  contributionCount: number;
  lastContributedAtMs: number;
}

export const PRIVATE_MY_PLAYLIST_ID = 'my-playlist';

export function sanitizeFirestoreId(raw: string, fallback = 'item'): string {
  const cleaned = String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 128);
  return cleaned || fallback;
}

function clampStr(value: string | undefined | null, maxLen: number, fallback = ''): string {
  const raw = String(value ?? '').trim();
  if (!raw) return fallback;
  return raw.slice(0, maxLen);
}

function normalizeRights(value: unknown): Track['playbackRights'] {
  if (
    value === 'full-stream' ||
    value === 'preview-30s' ||
    value === 'embed-only' ||
    value === 'metadata-only'
  ) {
    return value;
  }
  return 'full-stream';
}

function normalizeProviderId(value: unknown): ProviderId {
  switch (value) {
    case 'gullygroove-studio':
    case 'audius-open':
    case 'itunes-preview':
    case 'youtube-data':
    case 'spotify-web':
    case 'jamendo-cc':
    case 'user-vault':
      return value;
    default:
      return 'gullygroove-studio';
  }
}

function normalizeLicenseType(value: unknown): LicenseType {
  switch (value) {
    case 'Royalty-Free Studio':
    case 'Creative Commons (CC-BY)':
    case 'Public Domain':
    case 'Permitted 30s Preview':
    case 'Metadata & Official Embed':
      return value;
    default:
      return 'Metadata & Official Embed';
  }
}

function timestampToMs(ts: unknown): number {
  if (ts instanceof Timestamp) return ts.toMillis();
  if (ts && typeof ts === 'object' && 'toMillis' in ts && typeof (ts as { toMillis: () => number }).toMillis === 'function') {
    return (ts as { toMillis: () => number }).toMillis();
  }
  return Date.now();
}

function timestampToIso(ts: unknown, fallbackIso?: string): string {
  if (ts instanceof Timestamp) return ts.toDate().toISOString();
  if (ts && typeof ts === 'object' && 'toDate' in ts && typeof (ts as { toDate: () => Date }).toDate === 'function') {
    return (ts as { toDate: () => Date }).toDate().toISOString();
  }
  return fallbackIso || new Date().toISOString();
}

function buildTrackCoreFields(track: Track) {
  const durationSec = Math.max(0, Math.min(86400, Number(track.durationSec) || 0));
  const bpm = Math.max(0, Math.min(400, Number(track.bpm) || 110));
  const rawYear = Number(track.year) || 2025;
  const year = Math.max(1900, Math.min(2100, rawYear));

  return {
    title: clampStr(track.title, 240, 'Untitled Track'),
    artist: clampStr(track.artist, 200, 'Independent Artist'),
    album: clampStr(track.album, 200, 'GullyGroove'),
    genre: clampStr(track.genre, 100, 'Music'),
    language: clampStr(track.language, 80, 'Hindi'),
    durationSec,
    bpm,
    year,
    coverUrl: clampStr(track.coverUrl, 1000, COVER_ASSETS.heroStage),
    providerId: clampStr(track.providerId, 80, 'gullygroove-studio'),
    providerName: clampStr(track.providerName, 120, 'GullyGroove Studio'),
    licenseType: clampStr(track.licenseType, 120, 'Metadata & Official Embed'),
    licenseSummary: clampStr(track.licenseSummary, 400, ''),
    playbackRights:
      normalizeRights(track.playbackRights) === 'preview-30s'
        ? 'metadata-only'
        : normalizeRights(track.playbackRights),
    streamUrl: clampStr(track.streamUrl, 1500, ''),
    ...(track.embedId ? { embedId: clampStr(track.embedId, 120) } : {}),
    ...(track.externalUrl ? { externalUrl: clampStr(track.externalUrl, 1500) } : {}),
    ...(track.attribution ? { attribution: clampStr(track.attribution, 300) } : {}),
  };
}

function docDataToTrack(
  docId: string,
  data: Record<string, unknown>,
  playlistIds: string[]
): Track {
  const trackId = String(data.trackId || docId);
  const rawStreamUrl = String(data.streamUrl || '');
  const streamUrl =
    !isServerSyncAvailable() && rawStreamUrl.startsWith('/api/audius/stream/')
      ? toDirectAudiusStreamUrl(rawStreamUrl)
      : rawStreamUrl;
  return {
    id: trackId,
    title: String(data.title || 'Untitled Track'),
    artist: String(data.artist || 'Independent Artist'),
    album: String(data.album || 'GullyGroove'),
    genre: String(data.genre || 'Music'),
    language: String(data.language || 'Hindi'),
    durationSec: Number(data.durationSec) || 0,
    bpm: Number(data.bpm) || 110,
    year: Number(data.year) || 2025,
    coverUrl: String(data.coverUrl || COVER_ASSETS.heroStage),
    providerId: normalizeProviderId(data.providerId),
    providerName: String(data.providerName || 'GullyGroove Studio'),
    licenseType: normalizeLicenseType(data.licenseType),
    licenseSummary: String(data.licenseSummary || ''),
    playbackRights: normalizeRights(data.playbackRights),
    streamUrl,
    ...(data.embedId ? { embedId: String(data.embedId) } : {}),
    ...(data.externalUrl ? { externalUrl: String(data.externalUrl) } : {}),
    attribution: String(data.attribution || ''),
    playlistIds,
    plays: 1000,
    ...(typeof data.isUserAdded === 'boolean' ? { isUserAdded: data.isUserAdded } : {}),
  };
}

export async function ensureUserProfileAndDefaults(user: User): Promise<UserProfileRecord> {
  const uid = sanitizeFirestoreId(user.uid);
  const userPath = `users/${uid}`;
  const userRef = doc(db, 'users', uid);

  const displayName = clampStr(
    user.displayName || user.email?.split('@')[0] || 'GullyGroove Listener',
    120,
    'GullyGroove Listener'
  );
  const email = clampStr(user.email, 254, 'listener@gullygroove.app');
  const photoURL = clampStr(user.photoURL, 1000, '');

  let createdAtIso = user.metadata.creationTime
    ? new Date(user.metadata.creationTime).toISOString()
    : new Date().toISOString();
  let updatedAtIso = new Date().toISOString();

  try {
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      await setDoc(userRef, {
        uid,
        displayName,
        email,
        photoURL,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      const refreshed = await getDoc(userRef);
      if (refreshed.exists()) {
        const d = refreshed.data();
        createdAtIso = timestampToIso(d.createdAt, createdAtIso);
        updatedAtIso = timestampToIso(d.updatedAt, updatedAtIso);
      }
    } else {
      const existingData = snap.data();
      createdAtIso = timestampToIso(existingData.createdAt, createdAtIso);
      await updateDoc(userRef, {
        displayName,
        email,
        photoURL,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, userPath);
  }

  // Ensure default private My Playlist container exists
  const myPlaylistPath = `users/${uid}/personalPlaylists/${PRIVATE_MY_PLAYLIST_ID}`;
  const myPlaylistRef = doc(db, 'users', uid, 'personalPlaylists', PRIVATE_MY_PLAYLIST_ID);
  try {
    const plSnap = await getDoc(myPlaylistRef);
    if (!plSnap.exists()) {
      await setDoc(myPlaylistRef, {
        id: PRIVATE_MY_PLAYLIST_ID,
        ownerId: uid,
        title: 'My Playlist',
        subtitle: 'Private Mix',
        description:
          'Your personal private collection — synced securely to your Google account and only visible to you.',
        isPrivate: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, myPlaylistPath);
  }

  return {
    uid,
    displayName,
    email,
    photoURL,
    createdAtIso,
    updatedAtIso,
  };
}

export async function setLikedSongInFirestore(
  uid: string,
  track: Track,
  liked: boolean
): Promise<void> {
  const safeUid = sanitizeFirestoreId(uid);
  const safeTrackId = sanitizeFirestoreId(track.id);
  const path = `users/${safeUid}/likedSongs/${safeTrackId}`;
  const ref = doc(db, 'users', safeUid, 'likedSongs', safeTrackId);

  try {
    if (liked) {
      const existing = await getDoc(ref);
      if (existing.exists()) return;
      await setDoc(ref, {
        ownerId: safeUid,
        trackId: safeTrackId,
        ...buildTrackCoreFields(track),
        likedAt: serverTimestamp(),
      });
    } else {
      await deleteDoc(ref);
    }
  } catch (error) {
    handleFirestoreError(
      error,
      liked ? OperationType.CREATE : OperationType.DELETE,
      path
    );
  }
}

export function subscribeLikedSongs(
  uid: string,
  onData: (items: Track[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const safeUid = sanitizeFirestoreId(uid);
  const path = `users/${safeUid}/likedSongs`;
  const q = query(
    collection(db, 'users', safeUid, 'likedSongs'),
    where('ownerId', '==', safeUid)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs
        .map((d) => ({
          track: docDataToTrack(d.id, d.data(), [PRIVATE_MY_PLAYLIST_ID]),
          ms: timestampToMs(d.data().likedAt),
        }))
        .sort((a, b) => b.ms - a.ms)
        .map((entry) => entry.track);
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError?.(wrapped as Error);
      }
    }
  );
}

export async function recordRecentlyPlayedInFirestore(
  uid: string,
  track: Track
): Promise<void> {
  const safeUid = sanitizeFirestoreId(uid);
  const safeTrackId = sanitizeFirestoreId(track.id);
  const path = `users/${safeUid}/recentlyPlayed/${safeTrackId}`;
  const ref = doc(db, 'users', safeUid, 'recentlyPlayed', safeTrackId);

  try {
    const existing = await getDoc(ref);
    if (existing.exists()) {
      await updateDoc(ref, {
        title: clampStr(track.title, 240, 'Untitled Track'),
        artist: clampStr(track.artist, 200, 'Independent Artist'),
        coverUrl: clampStr(track.coverUrl, 1000, COVER_ASSETS.heroStage),
        playedAt: serverTimestamp(),
      });
    } else {
      await setDoc(ref, {
        ownerId: safeUid,
        trackId: safeTrackId,
        ...buildTrackCoreFields(track),
        playedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function clearRecentlyPlayedInFirestore(uid: string): Promise<void> {
  const safeUid = sanitizeFirestoreId(uid);
  const path = `users/${safeUid}/recentlyPlayed`;
  try {
    const q = query(
      collection(db, 'users', safeUid, 'recentlyPlayed'),
      where('ownerId', '==', safeUid)
    );
    const snap = await getDocs(q);
    if (snap.empty) return;
    const batch = writeBatch(db);
    for (const d of snap.docs) {
      batch.delete(d.ref);
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export function subscribeRecentlyPlayed(
  uid: string,
  onData: (items: Track[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const safeUid = sanitizeFirestoreId(uid);
  const path = `users/${safeUid}/recentlyPlayed`;
  const q = query(
    collection(db, 'users', safeUid, 'recentlyPlayed'),
    where('ownerId', '==', safeUid),
    orderBy('playedAt', 'desc')
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs
        .slice(0, 30)
        .map((d) => docDataToTrack(d.id, d.data(), []));
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError?.(wrapped as Error);
      }
    }
  );
}

export async function saveUserPreferencesInFirestore(
  uid: string,
  prefs: {
    theme: AppTheme;
    crossfadeSettings: CrossfadeSettings;
    notifications: NotificationSettings;
  }
): Promise<void> {
  const safeUid = sanitizeFirestoreId(uid);
  const path = `users/${safeUid}/preferences/settings`;
  const ref = doc(db, 'users', safeUid, 'preferences', 'settings');

  const payload = {
    ownerId: safeUid,
    theme: prefs.theme === 'light' ? 'light' : 'dark',
    crossfadeSec: Math.max(1, Math.min(30, Number(prefs.crossfadeSettings.crossfadeSec) || 8)),
    djCrossfadeSec: Math.max(4, Math.min(30, Number(prefs.crossfadeSettings.djCrossfadeSec) || 12)),
    djMode: Boolean(prefs.crossfadeSettings.djMode),
    nowPlayingAlerts: Boolean(prefs.notifications.nowPlayingAlerts),
    curatedPlaylistDrops: Boolean(prefs.notifications.curatedPlaylistDrops),
    groovyVoiceTips: Boolean(prefs.notifications.groovyVoiceTips),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(ref, payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export function subscribeUserPreferences(
  uid: string,
  onData: (prefs: UserPreferencesRecord | null) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const safeUid = sanitizeFirestoreId(uid);
  const path = `users/${safeUid}/preferences/settings`;
  const ref = doc(db, 'users', safeUid, 'preferences', 'settings');

  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }
      const d = snap.data();
      onData({
        theme: d.theme === 'light' ? 'light' : 'dark',
        crossfadeSec: Number(d.crossfadeSec) || 8,
        djCrossfadeSec: Number(d.djCrossfadeSec) || 12,
        djMode: Boolean(d.djMode),
        notifications: {
          nowPlayingAlerts: Boolean(d.nowPlayingAlerts),
          curatedPlaylistDrops: d.curatedPlaylistDrops ?? true,
          groovyVoiceTips: d.groovyVoiceTips ?? true,
        },
      });
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, path);
      } catch (wrapped) {
        onError?.(wrapped as Error);
      }
    }
  );
}

export async function createPersonalPlaylistInFirestore(
  uid: string,
  input: { title: string; subtitle?: string; description?: string }
): Promise<PersonalPlaylistRecord> {
  const safeUid = sanitizeFirestoreId(uid);
  const slug = input.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 48);
  const id = sanitizeFirestoreId(`priv-${slug || 'mix'}-${Date.now().toString(36)}`);
  const path = `users/${safeUid}/personalPlaylists/${id}`;
  const ref = doc(db, 'users', safeUid, 'personalPlaylists', id);

  const title = clampStr(input.title, 120, 'Personal Mix');
  const subtitle = clampStr(input.subtitle, 160, 'Private Mix');
  const description = clampStr(
    input.description,
    500,
    'Private personal playlist — only visible to you.'
  );

  try {
    await setDoc(ref, {
      id,
      ownerId: safeUid,
      title,
      subtitle,
      description,
      isPrivate: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }

  return {
    id,
    ownerId: safeUid,
    title,
    subtitle,
    description,
    isPrivate: true,
    createdAtMs: Date.now(),
  };
}

export async function deletePersonalPlaylistInFirestore(
  uid: string,
  playlistId: string
): Promise<void> {
  const safeUid = sanitizeFirestoreId(uid);
  const safePid = sanitizeFirestoreId(playlistId);
  if (safePid === PRIVATE_MY_PLAYLIST_ID) return;
  const path = `users/${safeUid}/personalPlaylists/${safePid}`;

  try {
    const tracksQ = query(
      collection(db, 'users', safeUid, 'personalPlaylists', safePid, 'tracks'),
      where('ownerId', '==', safeUid)
    );
    const tracksSnap = await getDocs(tracksQ);
    const batch = writeBatch(db);
    for (const d of tracksSnap.docs) {
      batch.delete(d.ref);
    }
    batch.delete(doc(db, 'users', safeUid, 'personalPlaylists', safePid));
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function addTrackToPersonalPlaylistInFirestore(
  uid: string,
  playlistId: string,
  track: Track
): Promise<void> {
  const safeUid = sanitizeFirestoreId(uid);
  const safePid = sanitizeFirestoreId(playlistId);
  const safeTrackId = sanitizeFirestoreId(track.id);
  const path = `users/${safeUid}/personalPlaylists/${safePid}/tracks/${safeTrackId}`;
  const playlistRef = doc(db, 'users', safeUid, 'personalPlaylists', safePid);
  const trackRef = doc(db, 'users', safeUid, 'personalPlaylists', safePid, 'tracks', safeTrackId);

  try {
    const [playlistSnap, trackSnap] = await Promise.all([
      getDoc(playlistRef),
      getDoc(trackRef),
    ]);
    if (playlistSnap.exists() && trackSnap.exists()) {
      return;
    }
    const batch = writeBatch(db);
    if (!playlistSnap.exists()) {
      batch.set(playlistRef, {
        id: safePid,
        ownerId: safeUid,
        title: safePid === PRIVATE_MY_PLAYLIST_ID ? 'My Playlist' : 'Personal Mix',
        subtitle: 'Private Mix',
        description: 'Private personal playlist — only visible to you.',
        isPrivate: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    if (!trackSnap.exists()) {
      batch.set(trackRef, {
        ownerId: safeUid,
        playlistId: safePid,
        trackId: safeTrackId,
        ...buildTrackCoreFields(track),
        ...(typeof track.isUserAdded === 'boolean' ? { isUserAdded: track.isUserAdded } : {}),
        addedAt: serverTimestamp(),
      });
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function removeTrackFromPersonalPlaylistInFirestore(
  uid: string,
  playlistId: string,
  trackId: string
): Promise<void> {
  const safeUid = sanitizeFirestoreId(uid);
  const safePid = sanitizeFirestoreId(playlistId);
  const safeTrackId = sanitizeFirestoreId(trackId);
  const path = `users/${safeUid}/personalPlaylists/${safePid}/tracks/${safeTrackId}`;
  try {
    await deleteDoc(doc(db, 'users', safeUid, 'personalPlaylists', safePid, 'tracks', safeTrackId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export function subscribePersonalPlaylists(
  uid: string,
  onData: (playlists: PersonalPlaylistRecord[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const safeUid = sanitizeFirestoreId(uid);
  const path = `users/${safeUid}/personalPlaylists`;
  const q = query(
    collection(db, 'users', safeUid, 'personalPlaylists'),
    where('ownerId', '==', safeUid)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const records: PersonalPlaylistRecord[] = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          id: String(data.id || d.id),
          ownerId: String(data.ownerId || safeUid),
          title: String(data.title || 'My Playlist'),
          subtitle: String(data.subtitle || 'Private Mix'),
          description: String(data.description || 'Private personal playlist.'),
          isPrivate: true,
          createdAtMs: timestampToMs(data.createdAt),
        };
      });
      onData(records);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError?.(wrapped as Error);
      }
    }
  );
}

export function subscribePersonalPlaylistTracks(
  uid: string,
  playlistId: string,
  onData: (tracks: Track[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const safeUid = sanitizeFirestoreId(uid);
  const safePid = sanitizeFirestoreId(playlistId);
  const path = `users/${safeUid}/personalPlaylists/${safePid}/tracks`;
  const q = query(
    collection(db, 'users', safeUid, 'personalPlaylists', safePid, 'tracks'),
    where('ownerId', '==', safeUid)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs
        .map((d) => ({
          track: docDataToTrack(d.id, d.data(), [safePid]),
          ms: timestampToMs(d.data().addedAt),
        }))
        .sort((a, b) => b.ms - a.ms)
        .map((entry) => entry.track);
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError?.(wrapped as Error);
      }
    }
  );
}

export async function createSharedPlaylistInFirestore(
  user: User,
  input: {
    title: string;
    subtitle?: string;
    description?: string;
    mood?: string;
    region?: 'India' | 'Pan-India' | 'Global';
    coverUrl?: string;
    allowContributions?: boolean;
  }
): Promise<SharedPlaylistRecord> {
  const safeUid = sanitizeFirestoreId(user.uid);
  const slug = input.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 48);
  const id = sanitizeFirestoreId(`shared-${slug || 'vibe'}-${Date.now().toString(36)}`);
  const path = `sharedPlaylists/${id}`;
  const playlistRef = doc(db, 'sharedPlaylists', id);
  const contributorRef = doc(db, 'sharedPlaylists', id, 'contributors', safeUid);

  const ownerName = clampStr(
    user.displayName || user.email?.split('@')[0] || 'GullyGroove Creator',
    120,
    'GullyGroove Creator'
  );
  const title = clampStr(input.title, 120, 'Shared Community Mix');
  const subtitle = clampStr(input.subtitle, 160, `Shared by ${ownerName}`);
  const description = clampStr(
    input.description,
    500,
    'Collaborative shared playlist open to the GullyGroove community.'
  );
  const mood = clampStr(input.mood, 80, 'Community Mix');
  const region = input.region || 'Pan-India';
  const coverUrl = clampStr(input.coverUrl, 1000, COVER_ASSETS.heroStage);
  const allowContributions = input.allowContributions ?? true;

  try {
    const batch = writeBatch(db);
    batch.set(playlistRef, {
      id,
      title,
      subtitle,
      description,
      mood,
      region,
      coverUrl,
      ownerId: safeUid,
      ownerName,
      isShared: true,
      allowContributions,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(contributorRef, {
      uid: safeUid,
      playlistId: id,
      displayName: ownerName,
      photoURL: clampStr(user.photoURL, 1000, ''),
      role: 'owner',
      contributionCount: 1,
      isShared: true,
      firstContributedAt: serverTimestamp(),
      lastContributedAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }

  return {
    id,
    title,
    subtitle,
    description,
    mood,
    region,
    coverUrl,
    ownerId: safeUid,
    ownerName,
    isShared: true,
    allowContributions,
    createdAtMs: Date.now(),
  };
}

export async function contributeTrackToSharedPlaylistInFirestore(
  user: User,
  playlistMeta: Pick<PlaylistWithStats, 'id' | 'title' | 'subtitle' | 'description' | 'mood' | 'region' | 'coverUrl'>,
  track: Track
): Promise<void> {
  const safeUid = sanitizeFirestoreId(user.uid);
  const safePid = sanitizeFirestoreId(playlistMeta.id);
  const safeTrackId = sanitizeFirestoreId(track.id);
  const path = `sharedPlaylists/${safePid}/sharedTracks/${safeTrackId}`;

  const playlistRef = doc(db, 'sharedPlaylists', safePid);
  const contributorRef = doc(db, 'sharedPlaylists', safePid, 'contributors', safeUid);
  const trackRef = doc(db, 'sharedPlaylists', safePid, 'sharedTracks', safeTrackId);

  const displayName = clampStr(
    user.displayName || user.email?.split('@')[0] || 'GullyGroove User',
    120,
    'GullyGroove User'
  );
  const photoURL = clampStr(user.photoURL, 1000, '');

  try {
    const [plSnap, contribSnap, trackSnap] = await Promise.all([
      getDoc(playlistRef),
      getDoc(contributorRef),
      getDoc(trackRef),
    ]);

    if (trackSnap.exists()) {
      return;
    }

    const batch = writeBatch(db);
    const playlistIsNew = !plSnap.exists();

    if (playlistIsNew) {
      batch.set(playlistRef, {
        id: safePid,
        title: clampStr(playlistMeta.title, 120, 'Shared Playlist'),
        subtitle: clampStr(playlistMeta.subtitle, 160, 'Shared Playlist'),
        description: clampStr(playlistMeta.description, 500, 'Shared GullyGroove playlist.'),
        mood: clampStr(playlistMeta.mood, 80, 'Curated & Shared'),
        region: playlistMeta.region || 'Pan-India',
        coverUrl: clampStr(playlistMeta.coverUrl, 1000, COVER_ASSETS.heroStage),
        ownerId: safeUid,
        ownerName: displayName,
        isShared: true,
        allowContributions: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    if (!contribSnap.exists()) {
      batch.set(contributorRef, {
        uid: safeUid,
        playlistId: safePid,
        displayName,
        photoURL,
        role: playlistIsNew ? 'owner' : 'contributor',
        contributionCount: 1,
        isShared: true,
        firstContributedAt: serverTimestamp(),
        lastContributedAt: serverTimestamp(),
      });
    } else {
      const prevCount = Number(contribSnap.data().contributionCount) || 1;
      batch.update(contributorRef, {
        displayName,
        photoURL,
        contributionCount: Math.min(100000, prevCount + 1),
        lastContributedAt: serverTimestamp(),
      });
    }

    batch.set(trackRef, {
      trackId: safeTrackId,
      playlistId: safePid,
      ...buildTrackCoreFields(track),
      addedByUid: safeUid,
      addedByName: displayName,
      isShared: true,
      ...(typeof track.isUserAdded === 'boolean' ? { isUserAdded: track.isUserAdded } : {}),
      addedAt: serverTimestamp(),
    });

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function updateSharedPlaylistPermissionsInFirestore(
  playlistId: string,
  allowContributions: boolean
): Promise<void> {
  const safePid = sanitizeFirestoreId(playlistId);
  const path = `sharedPlaylists/${safePid}`;
  const ref = doc(db, 'sharedPlaylists', safePid);
  try {
    await updateDoc(ref, {
      allowContributions: Boolean(allowContributions),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export function subscribeSharedPlaylists(
  onData: (playlists: SharedPlaylistRecord[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = 'sharedPlaylists';
  const q = query(collection(db, 'sharedPlaylists'), where('isShared', '==', true));

  return onSnapshot(
    q,
    (snapshot) => {
      const items: SharedPlaylistRecord[] = snapshot.docs.map((d) => {
        const data = d.data();
        const regionRaw = String(data.region || 'Pan-India');
        const region =
          regionRaw === 'India' || regionRaw === 'Global' ? regionRaw : 'Pan-India';
        return {
          id: String(data.id || d.id),
          title: String(data.title || 'Shared Playlist'),
          subtitle: String(data.subtitle || 'Shared Playlist'),
          description: String(data.description || 'Collaborative shared playlist.'),
          mood: String(data.mood || 'Community Mix'),
          region,
          coverUrl: String(data.coverUrl || COVER_ASSETS.heroStage),
          ownerId: String(data.ownerId || ''),
          ownerName: String(data.ownerName || 'Community'),
          isShared: true,
          allowContributions: Boolean(data.allowContributions),
          createdAtMs: timestampToMs(data.createdAt),
        };
      });
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError?.(wrapped as Error);
      }
    }
  );
}

export function subscribeSharedPlaylistTracks(
  playlistId: string,
  onData: (tracks: Track[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const safePid = sanitizeFirestoreId(playlistId);
  const path = `sharedPlaylists/${safePid}/sharedTracks`;
  const q = query(
    collection(db, 'sharedPlaylists', safePid, 'sharedTracks'),
    where('isShared', '==', true)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs
        .map((d) => {
          const data = d.data();
          const pid = String(data.playlistId || safePid);
          const track = docDataToTrack(d.id, data, pid ? [pid] : []);
          if (data.addedByName) {
            track.attribution = track.attribution
              ? `${track.attribution} · Added by ${String(data.addedByName)}`
              : `Added by ${String(data.addedByName)}`;
          }
          return {
            track,
            ms: timestampToMs(data.addedAt),
          };
        })
        .sort((a, b) => b.ms - a.ms)
        .map((entry) => entry.track);
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError?.(wrapped as Error);
      }
    }
  );
}

export function subscribePlaylistContributors(
  playlistId: string,
  onData: (contributors: PlaylistContributorRecord[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const safePid = sanitizeFirestoreId(playlistId);
  const path = `sharedPlaylists/${safePid}/contributors`;
  const q = query(
    collection(db, 'sharedPlaylists', safePid, 'contributors'),
    where('isShared', '==', true)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const items: PlaylistContributorRecord[] = snapshot.docs
        .map((d) => {
          const data = d.data();
          return {
            uid: String(data.uid || d.id),
            playlistId: String(data.playlistId || safePid),
            displayName: String(data.displayName || 'Contributor'),
            photoURL: String(data.photoURL || ''),
            role: data.role === 'owner' ? ('owner' as const) : ('contributor' as const),
            contributionCount: Number(data.contributionCount) || 1,
            lastContributedAtMs: timestampToMs(data.lastContributedAt),
          };
        })
        .sort((a, b) => b.contributionCount - a.contributionCount);
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError?.(wrapped as Error);
      }
    }
  );
}

export async function syncGuestStateToFirestore(
  user: User,
  guestState: {
    favoriteTracks: Track[];
    myPlaylistTracks: Track[];
    recentlyPlayed: Track[];
    theme: AppTheme;
    crossfadeSettings: CrossfadeSettings;
    notifications: NotificationSettings;
  }
): Promise<void> {
  const safeUid = sanitizeFirestoreId(user.uid);

  // Sync guest preferences only if the user has no saved preferences yet
  const prefRef = doc(db, 'users', safeUid, 'preferences', 'settings');
  try {
    const prefSnap = await getDoc(prefRef);
    if (!prefSnap.exists()) {
      await saveUserPreferencesInFirestore(safeUid, {
        theme: guestState.theme,
        crossfadeSettings: guestState.crossfadeSettings,
        notifications: guestState.notifications,
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `users/${safeUid}/preferences/settings`);
  }

  // Merge guest favorites & My Playlist items into private Firestore records if missing
  for (const track of guestState.favoriteTracks.slice(0, 20)) {
    const safeTrackId = sanitizeFirestoreId(track.id);
    const likedRef = doc(db, 'users', safeUid, 'likedSongs', safeTrackId);
    try {
      const snap = await getDoc(likedRef);
      if (!snap.exists()) {
        await setLikedSongInFirestore(safeUid, track, true);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `users/${safeUid}/likedSongs/${safeTrackId}`);
    }
  }

  for (const track of guestState.myPlaylistTracks.slice(0, 20)) {
    const safeTrackId = sanitizeFirestoreId(track.id);
    const plTrackRef = doc(
      db,
      'users',
      safeUid,
      'personalPlaylists',
      PRIVATE_MY_PLAYLIST_ID,
      'tracks',
      safeTrackId
    );
    try {
      const snap = await getDoc(plTrackRef);
      if (!snap.exists()) {
        await addTrackToPersonalPlaylistInFirestore(safeUid, PRIVATE_MY_PLAYLIST_ID, track);
      }
    } catch (error) {
      handleFirestoreError(
        error,
        OperationType.WRITE,
        `users/${safeUid}/personalPlaylists/${PRIVATE_MY_PLAYLIST_ID}/tracks/${safeTrackId}`
      );
    }
  }

  for (const track of guestState.recentlyPlayed.slice(0, 10)) {
    const safeTrackId = sanitizeFirestoreId(track.id);
    const recentRef = doc(db, 'users', safeUid, 'recentlyPlayed', safeTrackId);
    try {
      const snap = await getDoc(recentRef);
      if (!snap.exists()) {
        await recordRecentlyPlayedInFirestore(safeUid, track);
      }
    } catch (error) {
      handleFirestoreError(
        error,
        OperationType.WRITE,
        `users/${safeUid}/recentlyPlayed/${safeTrackId}`
      );
    }
  }
}
