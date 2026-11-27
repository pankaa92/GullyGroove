import { COVER_ASSETS, INITIAL_PLAYLISTS, INITIAL_TRACKS } from '../data/catalog';
import type {
  NewAuthorisedTrackInput,
  PlaylistWithStats,
  ProviderStatus,
  SearchFilters,
  Track,
} from '../types/music';
import { refineTrackPlaylistIds } from '../utils/playlistRefinement';

export interface CatalogOverviewData {
  playlists: PlaylistWithStats[];
  tracks: Track[];
  facets: {
    artists: string[];
    albums: string[];
    genres: string[];
    languages: string[];
  };
  providers: ProviderStatus[];
}

export interface SearchCatalogResult {
  localTracks: Track[];
  externalTracks: Track[];
  facets: CatalogOverviewData['facets'];
}

const STATIC_TRACKS_KEY = 'gg_static_tracks_v1';
const STATIC_ASSIGNMENTS_KEY = 'gg_static_assignments_v1';

let backendDetected: boolean | null = null;

function isJsonResponse(res: Response): boolean {
  const ct = res.headers.get('content-type') || '';
  return res.ok && ct.includes('application/json');
}

function toDirectAudiusStreamUrl(streamUrl: string): string {
  const match = streamUrl.match(/^\/api\/audius\/stream\/([a-zA-Z0-9_-]+)/);
  if (match) {
    return `https://api.audius.co/v1/tracks/${encodeURIComponent(match[1])}/stream?app_name=GullyGroove`;
  }
  return streamUrl;
}

const LEGACY_PLAYLIST_MAP: Record<string, string> = {
  'traveling-vibes': 'bus-driver-playlist',
  'evergreen-bollywood': '90s-hindi-classics',
  'nepali-hits': 'nepali-northeast-hits',
  'northeast-hits': 'nepali-northeast-hits',
  'punjabi-party-hits': 'party-dj-hits',
  'dj-love-mashups': 'party-dj-hits',
  'bollywood-romantic-hits': 'top-50-hindi',
};

function mapPlaylistIds(ids: string[]): string[] {
  return Array.from(
    new Set(
      ids
        .filter(
          (id) =>
            id !== 'relaxing-music' &&
            id !== 'gapless-playback' &&
            id !== 'trending-international'
        )
        .map((id) => LEGACY_PLAYLIST_MAP[id] || id)
    )
  );
}

function normalizeStaticTrack(track: Track): Track {
  const mapped: Track = {
    ...track,
    streamUrl: track.streamUrl ? toDirectAudiusStreamUrl(track.streamUrl) : '',
    playlistIds: mapPlaylistIds(track.playlistIds || []),
  };
  mapped.playlistIds = refineTrackPlaylistIds(mapped);
  return mapped;
}

function isEligibleCatalogTrack(track: Track): boolean {
  if (track.playbackRights === 'preview-30s' || track.providerId === 'itunes-preview') {
    return false;
  }
  return track.durationSec === 0 || track.durationSec > 30;
}

function readStoredTracks(): Track[] {
  try {
    const raw = localStorage.getItem(STATIC_TRACKS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Track[];
    if (!Array.isArray(parsed)) return [];
    const normalized = parsed.map(normalizeStaticTrack);
    const filtered = normalized.filter(isEligibleCatalogTrack);
    if (filtered.length !== parsed.length) {
      try {
        localStorage.setItem(STATIC_TRACKS_KEY, JSON.stringify(filtered));
      } catch {
        // ignore storage quota errors
      }
    }
    return filtered;
  } catch {
    return [];
  }
}

function readStoredAssignments(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(STATIC_ASSIGNMENTS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, string[]>;
  } catch {
    return {};
  }
}

function getStaticTracks(): Track[] {
  const stored = readStoredTracks();
  const assignments = readStoredAssignments();
  const map = new Map<string, Track>();

  for (const t of [...stored, ...INITIAL_TRACKS]) {
    if (!isEligibleCatalogTrack(t)) continue;
    const normalized = normalizeStaticTrack(t);
    const extraPlaylists = assignments[normalized.id] || [];
    normalized.playlistIds = mapPlaylistIds([...normalized.playlistIds, ...extraPlaylists]);
    map.set(normalized.id, normalized);
  }
  return Array.from(map.values());
}

function buildStaticPlaylists(tracks: Track[]): PlaylistWithStats[] {
  return INITIAL_PLAYLISTS.map((pl) => {
    const plTracks = tracks.filter((t) => t.playlistIds.includes(pl.id));
    const totalDurationSec = plTracks.reduce((acc, t) => acc + t.durationSec, 0);
    return {
      ...pl,
      trackCount: plTracks.length,
      totalDurationSec,
    };
  });
}

function buildFacets(tracks: Track[]): CatalogOverviewData['facets'] {
  return {
    artists: Array.from(new Set(tracks.map((t) => t.artist))).sort(),
    albums: Array.from(new Set(tracks.map((t) => t.album))).sort(),
    genres: Array.from(new Set(tracks.map((t) => t.genre))).sort(),
    languages: Array.from(new Set(tracks.map((t) => t.language))).sort(),
  };
}

function getStaticProviders(): ProviderStatus[] {
  return [
    {
      id: 'audius-open',
      name: 'Audius Open Streaming',
      category: 'Licensed Preview API',
      configured: true,
      active: true,
      playbackRights: 'full-stream',
      licensePolicy:
        'Streams full-length (>30s) Creative Commons / independent artist tracks via Audius decentralized open API.',
      description:
        'Full-song direct MP3 streaming across Bollywood mixes, Punjabi, Haryanvi, Bhojpuri, 90s classics, and DJ mashups.',
      envKeysRequired: [],
    },
    {
      id: 'youtube-data',
      name: 'YouTube Official Embed',
      category: 'Metadata & Discovery',
      configured: true,
      active: true,
      playbackRights: 'embed-only',
      licensePolicy:
        'Plays exclusively through the official YouTube IFrame Player API, respecting YouTube playback policies.',
      description:
        'Integrated dual-deck YouTube player with automatic 8-second crossfade transitions.',
      envKeysRequired: [],
    },
  ];
}

export async function fetchCatalogOverview(): Promise<CatalogOverviewData> {
  if (backendDetected !== false) {
    try {
      const res = await fetch('/api/catalog/overview');
      if (isJsonResponse(res)) {
        backendDetected = true;
        return (await res.json()) as CatalogOverviewData;
      }
    } catch {
      // Static hosting fallback (GitHub Pages)
    }
    backendDetected = false;
  }

  const tracks = getStaticTracks();
  return {
    playlists: buildStaticPlaylists(tracks),
    tracks,
    facets: buildFacets(tracks),
    providers: getStaticProviders(),
  };
}

function filterTracksClient(tracks: Track[], filters: Partial<SearchFilters>): Track[] {
  const q = (filters.query || '').trim().toLowerCase();
  const artist = (filters.artist || '').trim().toLowerCase();
  const album = (filters.album || '').trim().toLowerCase();
  const genre = (filters.genre || '').trim().toLowerCase();
  const language = (filters.language || '').trim().toLowerCase();
  const providerId = (filters.providerId || '').trim().toLowerCase();

  return tracks.filter((track) => {
    if (q) {
      const hay = `${track.title} ${track.artist} ${track.album} ${track.genre} ${track.language}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (artist && artist !== 'all' && track.artist.toLowerCase() !== artist) return false;
    if (album && album !== 'all' && track.album.toLowerCase() !== album) return false;
    if (genre && genre !== 'all' && track.genre.toLowerCase() !== genre) return false;
    if (language && language !== 'all' && track.language.toLowerCase() !== language) return false;
    if (providerId && providerId !== 'all' && track.providerId.toLowerCase() !== providerId)
      return false;
    return true;
  });
}

async function searchAudiusClient(query: string, limit = 10): Promise<Track[]> {
  try {
    const url = `https://api.audius.co/v1/tracks/search?query=${encodeURIComponent(
      query
    )}&limit=${limit}&app_name=GullyGroove`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = (await res.json()) as {
      data?: Array<{
        id: string;
        title?: string;
        duration?: number;
        genre?: string;
        play_count?: number;
        permalink?: string;
        artwork?: { '480x480'?: string; '150x150'?: string };
        user?: { name?: string };
      }>;
    };

    return (json.data || [])
      .filter((item) => item.id && item.title && Math.round(item.duration || 0) > 30)
      .map((item) => ({
        id: `audius-${item.id}`,
        title: item.title || 'Untitled Track',
        artist: item.user?.name || 'Independent Artist',
        album: 'Audius Open Catalog',
        genre: item.genre || 'Independent',
        language: 'Hindi / Global',
        durationSec: Math.round(item.duration || 180),
        bpm: 108,
        year: 2025,
        coverUrl:
          item.artwork?.['480x480'] ||
          item.artwork?.['150x150'] ||
          COVER_ASSETS.heroStage,
        providerId: 'audius-open',
        providerName: 'Audius Open Streaming',
        licenseType: 'Creative Commons (CC-BY)',
        licenseSummary: 'Full-length independent stream via Audius Open API.',
        playbackRights: 'full-stream',
        streamUrl: `https://api.audius.co/v1/tracks/${encodeURIComponent(
          item.id
        )}/stream?app_name=GullyGroove`,
        externalUrl: item.permalink ? `https://audius.co${item.permalink}` : 'https://audius.co',
        attribution: `${item.user?.name || 'Artist'} via Audius`,
        playlistIds: [],
        plays: Number(item.play_count) || 12000,
      }));
  } catch {
    return [];
  }
}

export async function searchCatalog(
  filters: Partial<SearchFilters>,
  includeExternal: boolean,
  signal?: AbortSignal
): Promise<SearchCatalogResult> {
  if (backendDetected !== false) {
    try {
      const params = new URLSearchParams({
        query: filters.query || '',
        artist: filters.artist || 'all',
        album: filters.album || 'all',
        genre: filters.genre || 'all',
        language: filters.language || 'all',
        providerId: filters.providerId || 'all',
        includeExternal: includeExternal ? 'true' : 'false',
      });
      const res = await fetch(`/api/tracks?${params.toString()}`, { signal });
      if (isJsonResponse(res)) {
        backendDetected = true;
        return (await res.json()) as SearchCatalogResult;
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw err;
    }
    backendDetected = false;
  }

  const allTracks = getStaticTracks();
  const localTracks = filterTracksClient(allTracks, filters);
  let externalTracks: Track[] = [];

  const q = (filters.query || '').trim();
  if (includeExternal && q.length >= 2) {
    const [audiusRes] = await Promise.allSettled([
      searchAudiusClient(q, 10),
    ]);
    if (audiusRes.status === 'fulfilled') {
      externalTracks.push(...audiusRes.value.filter(isEligibleCatalogTrack));
    }

    if (filters.providerId && filters.providerId !== 'all') {
      externalTracks = externalTracks.filter((t) => t.providerId === filters.providerId);
    }
    if (filters.artist && filters.artist !== 'all') {
      externalTracks = externalTracks.filter((t) =>
        t.artist.toLowerCase().includes(filters.artist!.toLowerCase())
      );
    }
    if (filters.genre && filters.genre !== 'all') {
      externalTracks = externalTracks.filter((t) =>
        t.genre.toLowerCase().includes(filters.genre!.toLowerCase())
      );
    }
  }

  return {
    localTracks,
    externalTracks,
    facets: buildFacets(allTracks),
  };
}

export async function assignTrackToPlaylist(
  playlistId: string,
  trackId: string,
  discoveredTrack?: Track
): Promise<{
  track: Track;
  playlists: PlaylistWithStats[];
  facets: CatalogOverviewData['facets'];
} | null> {
  if (backendDetected !== false) {
    try {
      const res = await fetch(`/api/playlists/${encodeURIComponent(playlistId)}/tracks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackId, track: discoveredTrack }),
      });
      if (isJsonResponse(res)) {
        backendDetected = true;
        return (await res.json()) as {
          track: Track;
          playlists: PlaylistWithStats[];
          facets: CatalogOverviewData['facets'];
        };
      }
    } catch {
      // Static fallback
    }
    backendDetected = false;
  }

  const stored = readStoredTracks();
  const assignments = readStoredAssignments();
  const existingLocal = getStaticTracks().find((t) => t.id === trackId);

  let targetTrack = existingLocal;
  if (!targetTrack && discoveredTrack && discoveredTrack.id === trackId) {
    if (!isEligibleCatalogTrack(discoveredTrack)) return null;
    targetTrack = normalizeStaticTrack(discoveredTrack);
    stored.unshift(targetTrack);
    try {
      localStorage.setItem(STATIC_TRACKS_KEY, JSON.stringify(stored));
    } catch {
      // ignore storage quota errors
    }
  }
  if (!targetTrack) return null;

  const updatedPlaylists = Array.from(
    new Set([...(targetTrack.playlistIds || []), playlistId])
  );
  assignments[trackId] = updatedPlaylists;
  try {
    localStorage.setItem(STATIC_ASSIGNMENTS_KEY, JSON.stringify(assignments));
  } catch {
    // ignore
  }

  const allTracks = getStaticTracks();
  const updatedTrack = allTracks.find((t) => t.id === trackId) || {
    ...targetTrack,
    playlistIds: updatedPlaylists,
  };

  return {
    track: updatedTrack,
    playlists: buildStaticPlaylists(allTracks),
    facets: buildFacets(allTracks),
  };
}

export async function createVaultTrack(input: NewAuthorisedTrackInput): Promise<{
  track: Track;
  playlists: PlaylistWithStats[];
  facets: CatalogOverviewData['facets'];
}> {
  if (backendDetected !== false) {
    try {
      const res = await fetch('/api/vault/tracks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (isJsonResponse(res)) {
        backendDetected = true;
        return (await res.json()) as {
          track: Track;
          playlists: PlaylistWithStats[];
          facets: CatalogOverviewData['facets'];
        };
      }
    } catch {
      // Static fallback
    }
    backendDetected = false;
  }

  const created: Track = {
    id: `vault-${Date.now().toString(36)}`,
    title: input.title.trim(),
    artist: input.artist.trim(),
    album: input.album.trim() || 'Independent Release',
    genre: input.genre.trim() || 'Indipop',
    language: input.language.trim() || 'Hindi',
    durationSec: Math.max(31, Math.min(Number(input.durationSec) || 218, 3600)),
    bpm: 108,
    year: 2026,
    coverUrl: input.coverUrl?.trim() || COVER_ASSETS.heroStage,
    providerId: 'user-vault',
    providerName: 'Authorised Media Vault',
    licenseType: input.licenseType || 'Royalty-Free Studio',
    licenseSummary: `Registered in Authorised Media Vault (${input.licenseType}).`,
    playbackRights: 'full-stream',
    streamUrl: input.streamUrl.trim(),
    attribution: input.attribution?.trim() || `${input.artist.trim()} (${input.licenseType})`,
    playlistIds: Array.from(
      new Set([input.playlistId || 'top-50-hindi'])
    ),
    plays: 1,
    isUserAdded: true,
  };
  created.playlistIds = refineTrackPlaylistIds(created);

  const stored = readStoredTracks();
  stored.unshift(created);
  try {
    localStorage.setItem(STATIC_TRACKS_KEY, JSON.stringify(stored));
  } catch {
    // ignore
  }

  const allTracks = getStaticTracks();
  return {
    track: created,
    playlists: buildStaticPlaylists(allTracks),
    facets: buildFacets(allTracks),
  };
}

export async function removeVaultTrack(trackId: string): Promise<{
  playlists: PlaylistWithStats[];
  facets: CatalogOverviewData['facets'];
} | null> {
  if (backendDetected !== false) {
    try {
      const res = await fetch(`/api/vault/tracks/${encodeURIComponent(trackId)}`, {
        method: 'DELETE',
      });
      if (isJsonResponse(res)) {
        backendDetected = true;
        return (await res.json()) as {
          playlists: PlaylistWithStats[];
          facets: CatalogOverviewData['facets'];
        };
      }
    } catch {
      // Static fallback
    }
    backendDetected = false;
  }

  const stored = readStoredTracks().filter((t) => !(t.id === trackId && t.isUserAdded));
  try {
    localStorage.setItem(STATIC_TRACKS_KEY, JSON.stringify(stored));
  } catch {
    // ignore
  }
  const allTracks = getStaticTracks();
  return {
    playlists: buildStaticPlaylists(allTracks),
    facets: buildFacets(allTracks),
  };
}

export function recordTrackPlay(trackId: string): void {
  if (backendDetected === false) return;
  fetch(`/api/tracks/${encodeURIComponent(trackId)}/play`, { method: 'POST' }).catch(
    () => {}
  );
}

export interface SongRequestResult {
  ok: boolean;
  status: 'sent' | 'activation-required' | 'fallback-mailto';
  message: string;
  mailtoUrl: string;
}

export const SONG_REQUEST_EMAIL = 'iampank3@gmail.com';

export function buildSongRequestMailto(songName: string, feedback: string): string {
  const subject = songName
    ? `GullyGroove Tune Request: ${songName}`
    : 'GullyGroove Tune Request & Feedback';
  const lines = ['Hi,', '', 'New Tune Request / Feedback on GullyGroove:', ''];
  if (songName) lines.push(`Song Name: ${songName}`);
  if (feedback) lines.push(`Feedback / Comment: ${feedback}`);
  const body = `${lines.join('\n')}\n`;
  return `mailto:${SONG_REQUEST_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export async function submitSongRequest(input: {
  songName: string;
  feedback: string;
}): Promise<SongRequestResult> {
  const songName = input.songName.trim();
  const feedback = input.feedback.trim();
  const mailtoUrl = buildSongRequestMailto(songName, feedback);

  let serverRecorded = false;
  if (backendDetected !== false) {
    try {
      const res = await fetch('/api/song-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ songName, feedback }),
      });
      if (isJsonResponse(res)) {
        backendDetected = true;
        const data = (await res.json()) as {
          ok?: boolean;
          error?: string;
          deliveredVia?: string;
        };
        if (!res.ok) {
          throw new Error(data.error || 'Unable to submit tune request.');
        }
        if (data.deliveredVia === 'server-email') {
          return {
            ok: true,
            status: 'sent',
            message: 'Your tune request has been sent successfully.',
            mailtoUrl,
          };
        }
        serverRecorded = Boolean(data.ok);
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Please enter')) {
        throw err;
      }
      // Static fallback or relay attempt below
    }
  }

  try {
    const relayRes = await fetch(`https://formsubmit.co/ajax/${SONG_REQUEST_EMAIL}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        _subject: songName
          ? `GullyGroove Tune Request: ${songName}`
          : 'GullyGroove Tune Request & Feedback',
        song_name: songName || '(Feedback only)',
        feedback_comment: feedback || '(No additional comment)',
        source: 'GullyGroove Music App',
        _template: 'table',
        _captcha: 'false',
      }),
    });

    const relayJson = (await relayRes.json().catch(() => ({}))) as {
      success?: boolean | string;
      message?: string;
    };

    const succeeded =
      relayRes.ok &&
      (relayJson.success === true || relayJson.success === 'true');

    if (succeeded) {
      return {
        ok: true,
        status: 'sent',
        message: 'Your tune request has been sent successfully.',
        mailtoUrl,
      };
    }

    if (
      typeof relayJson.message === 'string' &&
      relayJson.message.toLowerCase().includes('activat')
    ) {
      return {
        ok: true,
        status: 'activation-required',
        message: 'Request submitted! You can also click "Open in Email App" below to send right away.',
        mailtoUrl,
      };
    }
  } catch {
    // Network / CSP fallback below
  }

  return {
    ok: serverRecorded,
    status: 'fallback-mailto',
    message: serverRecorded
      ? 'Your request has been saved. Click "Open in Email App" below to send it right away.'
      : 'Click "Open in Email App" below to send your tune request.',
    mailtoUrl,
  };
}
