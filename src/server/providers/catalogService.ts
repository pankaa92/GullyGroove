import fs from 'fs';
import path from 'path';
import { COVER_ASSETS, INITIAL_PLAYLISTS, INITIAL_TRACKS } from '../../data/catalog';
import type {
  NewAuthorisedTrackInput,
  PlaylistWithStats,
  ProviderStatus,
  SearchFilters,
  Track,
} from '../../types/music';
import { refineTrackPlaylistIds, sequencePlaylistBajaoStyle } from '../../utils/playlistRefinement';
import { AudiusOpenProvider } from './audiusProvider';
import { JamendoCcProvider } from './jamendoProvider';
import { YoutubeDataProvider } from './youtubeProvider';

export const PRIVATE_PLAYLIST_ID = 'my-playlist';

const LEGACY_PLAYLIST_MAP: Record<string, string> = {
  'traveling-vibes': 'bus-driver-playlist',
  'evergreen-bollywood': '90s-hindi-classics',
  'nepali-hits': 'nepali-northeast-hits',
  'northeast-hits': 'nepali-northeast-hits',
  'punjabi-party-hits': 'party-dj-hits',
  'dj-love-mashups': 'party-dj-hits',
  'bollywood-romantic-hits': 'top-50-hindi',
};

const SHARED_STORE_PATH = path.resolve(process.cwd(), 'data', 'shared-catalog.json');

interface PersistedSharedStore {
  sharedTracks: Track[];
  sharedAssignments: Record<string, string[]>;
}

function isFullLengthTrack(track: Track): boolean {
  if (track.playbackRights === 'preview-30s' || track.providerId === 'itunes-preview') {
    return false;
  }
  return track.durationSec === 0 || track.durationSec > 30;
}

function sanitizeSharedPlaylistIds(ids: string[] | undefined): string[] {
  return Array.from(
    new Set(
      (ids || [])
        .filter(
          (id) =>
            id !== PRIVATE_PLAYLIST_ID &&
            id !== 'relaxing-music' &&
            id !== 'gapless-playback' &&
            id !== 'trending-international'
        )
        .map((id) => LEGACY_PLAYLIST_MAP[id] || id)
    )
  );
}

type CatalogChangeListener = (event: {
  version: number;
  playlistId?: string;
  trackId?: string;
}) => void;

class CatalogService {
  private tracks: Track[] = INITIAL_TRACKS.filter(isFullLengthTrack).map((t) => ({
    ...t,
    playlistIds: sanitizeSharedPlaylistIds(t.playlistIds),
  }));
  private playlists = [...INITIAL_PLAYLISTS];
  private sharedTracks: Track[] = [];
  private sharedAssignments: Record<string, string[]> = {};
  private catalogVersion = 1;
  private changeListeners = new Set<CatalogChangeListener>();
  private audius = new AudiusOpenProvider();
  private youtube = new YoutubeDataProvider();
  private jamendo = new JamendoCcProvider();

  constructor() {
    this.loadPersistedSharedStore();
  }

  private loadPersistedSharedStore(): void {
    try {
      if (!fs.existsSync(SHARED_STORE_PATH)) return;
      const raw = fs.readFileSync(SHARED_STORE_PATH, 'utf8');
      const parsed = JSON.parse(raw) as Partial<PersistedSharedStore>;
      const validPlaylistIds = new Set(
        this.playlists
          .filter((p) => p.id !== PRIVATE_PLAYLIST_ID)
          .map((p) => p.id)
      );

      if (Array.isArray(parsed.sharedTracks)) {
        for (const item of parsed.sharedTracks) {
          if (!item || !item.id || !item.title || !isFullLengthTrack(item)) continue;
          const cleanIds = sanitizeSharedPlaylistIds(item.playlistIds).filter((id) =>
            validPlaylistIds.has(id)
          );
          if (cleanIds.length === 0) continue;
          const normalized: Track = {
            ...item,
            playlistIds: cleanIds,
          };
          this.sharedTracks.push(normalized);
          const existing = this.tracks.find((t) => t.id === normalized.id);
          if (existing) {
            existing.playlistIds = Array.from(
              new Set([...existing.playlistIds, ...cleanIds])
            );
          } else {
            this.tracks.unshift(normalized);
          }
        }
      }

      if (parsed.sharedAssignments && typeof parsed.sharedAssignments === 'object') {
        for (const [trackId, rawIds] of Object.entries(parsed.sharedAssignments)) {
          if (!Array.isArray(rawIds)) continue;
          const cleanIds = sanitizeSharedPlaylistIds(rawIds).filter((id) =>
            validPlaylistIds.has(id)
          );
          if (cleanIds.length === 0) continue;
          this.sharedAssignments[trackId] = cleanIds;
          const target = this.tracks.find((t) => t.id === trackId);
          if (target) {
            target.playlistIds = Array.from(
              new Set([...target.playlistIds, ...cleanIds])
            );
          }
        }
      }
    } catch {
      // Ignore corrupt/unavailable persistence file and run with curated catalog
    }
  }

  private persistSharedStore(): void {
    try {
      const dir = path.dirname(SHARED_STORE_PATH);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const payload: PersistedSharedStore = {
        sharedTracks: this.sharedTracks,
        sharedAssignments: this.sharedAssignments,
      };
      const tmpPath = `${SHARED_STORE_PATH}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf8');
      fs.renameSync(tmpPath, SHARED_STORE_PATH);
    } catch {
      // Ignore disk persistence errors in read-only environments
    }
  }

  private notifyCatalogChange(playlistId?: string, trackId?: string): void {
    this.catalogVersion += 1;
    const payload = { version: this.catalogVersion, playlistId, trackId };
    for (const listener of this.changeListeners) {
      try {
        listener(payload);
      } catch {
        // ignore listener failures
      }
    }
  }

  getCatalogVersion(): number {
    return this.catalogVersion;
  }

  onCatalogChange(listener: CatalogChangeListener): () => void {
    this.changeListeners.add(listener);
    return () => {
      this.changeListeners.delete(listener);
    };
  }

  getProviderStatuses(): ProviderStatus[] {
    return [
      {
        id: 'gullygroove-studio',
        name: 'GullyGroove Authorised Studio',
        category: 'Authorised Studio',
        configured: true,
        active: true,
        playbackRights: 'full-stream',
        licensePolicy:
          '100% original royalty-free, Creative Commons, and public-domain master audio served directly by GullyGroove.',
        description:
          'Built-in Indian and international studio library synthesized and cleared for unrestricted playback and testing.',
        envKeysRequired: [],
      },
      {
        id: 'user-vault',
        name: 'Authorised Media Vault (Local / Custom)',
        category: 'User Media Vault',
        configured: true,
        active: true,
        playbackRights: 'full-stream',
        licensePolicy:
          'User-registered royalty-free, CC-BY, or self-owned audio files and direct stream URLs with explicit rights attestation.',
        description:
          'Manage your own legally cleared independent tracks, audio uploads, and royalty-free URLs inside GullyGroove playlists.',
        envKeysRequired: [],
      },
      this.audius.getStatus(),
      this.youtube.getStatus(),
      this.jamendo.getStatus(),
    ];
  }

  getPlaylists(): PlaylistWithStats[] {
    return this.playlists.map((pl) => {
      if (pl.id === PRIVATE_PLAYLIST_ID) {
        return {
          ...pl,
          trackCount: 0,
          totalDurationSec: 0,
        };
      }
      const playlistTracks = this.tracks.filter((t) => t.playlistIds.includes(pl.id));
      const totalDurationSec = playlistTracks.reduce((acc, t) => acc + t.durationSec, 0);
      return {
        ...pl,
        trackCount: playlistTracks.length,
        totalDurationSec,
      };
    });
  }

  getPlaylistById(playlistId: string): {
    playlist: PlaylistWithStats | null;
    tracks: Track[];
  } {
    const found = this.getPlaylists().find((p) => p.id === playlistId || p.slug === playlistId);
    if (!found) return { playlist: null, tracks: [] };
    if (found.id === PRIVATE_PLAYLIST_ID) {
      return { playlist: found, tracks: [] };
    }
    const matched = this.tracks.filter((t) => t.playlistIds.includes(found.id));
    const tracks = sequencePlaylistBajaoStyle(matched, { seedKey: found.id });
    return { playlist: found, tracks };
  }

  getTrackById(trackId: string): Track | undefined {
    return this.tracks.find((t) => t.id === trackId);
  }

  getFilterFacets() {
    const artists = Array.from(new Set(this.tracks.map((t) => t.artist))).sort();
    const albums = Array.from(new Set(this.tracks.map((t) => t.album))).sort();
    const genres = Array.from(new Set(this.tracks.map((t) => t.genre))).sort();
    const languages = Array.from(new Set(this.tracks.map((t) => t.language))).sort();
    return { artists, albums, genres, languages };
  }

  filterLocalTracks(filters: Partial<SearchFilters>): Track[] {
    const q = (filters.query || '').trim().toLowerCase();
    const artist = (filters.artist || '').trim().toLowerCase();
    const album = (filters.album || '').trim().toLowerCase();
    const genre = (filters.genre || '').trim().toLowerCase();
    const language = (filters.language || '').trim().toLowerCase();
    const providerId = (filters.providerId || '').trim().toLowerCase();

    return this.tracks.filter((track) => {
      if (q) {
        const hay = `${track.title} ${track.artist} ${track.album} ${track.genre} ${track.language}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (artist && artist !== 'all' && track.artist.toLowerCase() !== artist) {
        return false;
      }
      if (album && album !== 'all' && track.album.toLowerCase() !== album) {
        return false;
      }
      if (genre && genre !== 'all' && track.genre.toLowerCase() !== genre) {
        return false;
      }
      if (language && language !== 'all' && track.language.toLowerCase() !== language) {
        return false;
      }
      if (providerId && providerId !== 'all' && track.providerId.toLowerCase() !== providerId) {
        return false;
      }
      return true;
    });
  }

  async searchExternalProviders(query: string): Promise<Track[]> {
    if (!query.trim()) return [];

    const tasks: Promise<Track[]>[] = [
      this.audius.search(query, 10),
    ];
    if (this.youtube.getStatus().configured) {
      tasks.push(this.youtube.search(query, 4));
    }
    if (this.jamendo.getStatus().configured) {
      tasks.push(this.jamendo.search(query, 4));
    }

    const settled = await Promise.allSettled(tasks);
    const merged: Track[] = [];
    for (const res of settled) {
      if (res.status === 'fulfilled') {
        merged.push(...res.value.filter(isFullLengthTrack));
      }
    }
    return merged;
  }

  addAuthorisedTrack(input: NewAuthorisedTrackInput): Track {
    const targetPlaylistId =
      input.playlistId && input.playlistId !== PRIVATE_PLAYLIST_ID
        ? input.playlistId
        : 'top-50-hindi';
    const id = `vault-${Date.now().toString(36)}`;
    const newTrack: Track = {
      id,
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
      playlistIds: [targetPlaylistId],
      plays: 1,
      isUserAdded: true,
    };

    newTrack.playlistIds = Array.from(
      new Set([...refineTrackPlaylistIds(newTrack), targetPlaylistId])
    ).filter((pid) => pid !== PRIVATE_PLAYLIST_ID);

    this.tracks.unshift(newTrack);
    this.sharedTracks.unshift(newTrack);
    this.persistSharedStore();
    this.notifyCatalogChange(targetPlaylistId, newTrack.id);
    return newTrack;
  }

  removeVaultTrack(trackId: string): boolean {
    const idx = this.tracks.findIndex((t) => t.id === trackId && t.isUserAdded);
    if (idx === -1) return false;
    this.tracks.splice(idx, 1);
    this.sharedTracks = this.sharedTracks.filter((t) => t.id !== trackId);
    delete this.sharedAssignments[trackId];
    this.persistSharedStore();
    this.notifyCatalogChange(undefined, trackId);
    return true;
  }

  assignTrackToPlaylist(
    trackId: string,
    playlistId: string,
    discoveredTrack?: Track
  ): Track | null {
    if (playlistId === PRIVATE_PLAYLIST_ID) {
      return null;
    }

    const playlist = this.playlists.find((p) => p.id === playlistId);
    if (!playlist) return null;

    let track = this.tracks.find((t) => t.id === trackId);
    let addedNewGlobalTrack = false;

    if (!track && discoveredTrack && discoveredTrack.id === trackId) {
      if (!isFullLengthTrack(discoveredTrack)) return null;
      const basePlaylistIds = sanitizeSharedPlaylistIds([
        ...(discoveredTrack.playlistIds || []),
        playlistId,
      ]);
      track = {
        ...discoveredTrack,
        playlistIds: Array.from(
          new Set([
            ...refineTrackPlaylistIds({
              ...discoveredTrack,
              playlistIds: basePlaylistIds,
            }),
            playlistId,
          ])
        ).filter((pid) => pid !== PRIVATE_PLAYLIST_ID),
      };
      this.tracks.unshift(track);
      this.sharedTracks.unshift(track);
      addedNewGlobalTrack = true;
    }
    if (!track) return null;

    let changed = addedNewGlobalTrack;
    if (!track.playlistIds.includes(playlistId)) {
      track.playlistIds.push(playlistId);
      changed = true;
    }

    const existingSharedTrack = this.sharedTracks.find((t) => t.id === track!.id);
    if (existingSharedTrack) {
      existingSharedTrack.playlistIds = Array.from(
        new Set([...existingSharedTrack.playlistIds, ...track.playlistIds])
      ).filter((pid) => pid !== PRIVATE_PLAYLIST_ID);
    } else if (!addedNewGlobalTrack) {
      const currentExtra = new Set(this.sharedAssignments[track.id] || []);
      if (!currentExtra.has(playlistId)) {
        currentExtra.add(playlistId);
        this.sharedAssignments[track.id] = Array.from(currentExtra);
      }
    }

    if (changed) {
      this.persistSharedStore();
      this.notifyCatalogChange(playlistId, track.id);
    }

    return track;
  }

  incrementPlays(trackId: string): void {
    const track = this.tracks.find((t) => t.id === trackId);
    if (track) {
      track.plays += 1;
    }
  }
}

export const catalogService = new CatalogService();
