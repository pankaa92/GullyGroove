import { COVER_ASSETS, INITIAL_PLAYLISTS, INITIAL_TRACKS } from '../../data/catalog';
import type {
  NewAuthorisedTrackInput,
  PlaylistWithStats,
  ProviderStatus,
  SearchFilters,
  Track,
} from '../../types/music';
import { AudiusOpenProvider } from './audiusProvider';
import { JamendoCcProvider } from './jamendoProvider';
import { YoutubeDataProvider } from './youtubeProvider';

const LEGACY_PLAYLIST_MAP: Record<string, string> = {
  'traveling-vibes': 'bus-driver-playlist',
  'evergreen-bollywood': '90s-hindi-classics',
  'nepali-hits': 'nepali-northeast-hits',
  'northeast-hits': 'nepali-northeast-hits',
  'punjabi-party-hits': 'party-dj-hits',
  'dj-love-mashups': 'party-dj-hits',
  'bollywood-romantic-hits': 'top-50-hindi',
};

function isFullLengthTrack(track: Track): boolean {
  if (track.playbackRights === 'preview-30s' || track.providerId === 'itunes-preview') {
    return false;
  }
  return track.durationSec === 0 || track.durationSec > 30;
}

class CatalogService {
  private tracks: Track[] = INITIAL_TRACKS.filter(isFullLengthTrack).map((t) => ({
    ...t,
    playlistIds: Array.from(
      new Set(
        t.playlistIds
          .filter(
            (id) =>
              id !== 'relaxing-music' &&
              id !== 'gapless-playback' &&
              id !== 'trending-international'
          )
          .map((id) => LEGACY_PLAYLIST_MAP[id] || id)
      )
    ),
  }));
  private playlists = [...INITIAL_PLAYLISTS];
  private audius = new AudiusOpenProvider();
  private youtube = new YoutubeDataProvider();
  private jamendo = new JamendoCcProvider();

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
    const tracks = this.tracks.filter((t) => t.playlistIds.includes(found.id));
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
      playlistIds: Array.from(
        new Set([input.playlistId || 'top-50-hindi'])
      ),
      plays: 1,
      isUserAdded: true,
    };

    this.tracks.unshift(newTrack);
    return newTrack;
  }

  removeVaultTrack(trackId: string): boolean {
    const idx = this.tracks.findIndex((t) => t.id === trackId && t.isUserAdded);
    if (idx === -1) return false;
    this.tracks.splice(idx, 1);
    return true;
  }

  assignTrackToPlaylist(
    trackId: string,
    playlistId: string,
    discoveredTrack?: Track
  ): Track | null {
    const playlist = this.playlists.find((p) => p.id === playlistId);
    if (!playlist) return null;

    let track = this.tracks.find((t) => t.id === trackId);
    if (!track && discoveredTrack && discoveredTrack.id === trackId) {
      if (!isFullLengthTrack(discoveredTrack)) return null;
      track = {
        ...discoveredTrack,
        playlistIds: Array.from(new Set(discoveredTrack.playlistIds || [])),
      };
      this.tracks.unshift(track);
    }
    if (!track) return null;

    if (!track.playlistIds.includes(playlistId)) {
      track.playlistIds.push(playlistId);
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
