import type { ProviderStatus, Track } from '../../types/music';
import type { MusicProviderAdapter } from './types';

interface SpotifyTrackItem {
  id: string;
  name: string;
  duration_ms: number;
  preview_url: string | null;
  external_urls?: { spotify?: string };
  artists?: Array<{ name: string }>;
  album?: {
    name?: string;
    release_date?: string;
    images?: Array<{ url: string }>;
  };
}

export class SpotifyWebProvider implements MusicProviderAdapter {
  private cachedToken: { token: string; expiresAt: number } | null = null;

  private get clientId(): string {
    return process.env.SPOTIFY_CLIENT_ID?.trim() || '';
  }

  private get clientSecret(): string {
    return process.env.SPOTIFY_CLIENT_SECRET?.trim() || '';
  }

  getStatus(): ProviderStatus {
    const configured = Boolean(this.clientId && this.clientSecret);
    return {
      id: 'spotify-web',
      name: 'Spotify Web API',
      category: 'Metadata & Discovery',
      configured,
      active: configured,
      playbackRights: 'preview-30s',
      licensePolicy:
        'Metadata & permitted 30-second preview clips only when provided by Spotify. Never assumes full-song streaming rights.',
      description:
        'Connects via Client Credentials to discover catalog metadata and authorised 30-second preview snippets.',
      envKeysRequired: ['SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET'],
    };
  }

  private async getAccessToken(): Promise<string | null> {
    if (!this.clientId || !this.clientSecret) return null;
    if (this.cachedToken && Date.now() < this.cachedToken.expiresAt) {
      return this.cachedToken.token;
    }

    try {
      const creds = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
      const res = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${creds}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
      });
      if (!res.ok) return null;

      const data = (await res.json()) as { access_token?: string; expires_in?: number };
      if (!data.access_token) return null;

      this.cachedToken = {
        token: data.access_token,
        expiresAt: Date.now() + ((data.expires_in || 3600) - 60) * 1000,
      };
      return this.cachedToken.token;
    } catch {
      return null;
    }
  }

  async search(query: string, limit = 6): Promise<Track[]> {
    const token = await this.getAccessToken();
    if (!token || !query.trim()) return [];

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);

    try {
      const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(
        query
      )}&type=track&market=IN&limit=${Math.min(limit, 10)}`;

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      if (!res.ok) return [];

      const json = (await res.json()) as { tracks?: { items?: SpotifyTrackItem[] } };
      const items = json.tracks?.items || [];

      return items.map((item): Track => {
        const hasPreview = Boolean(item.preview_url);
        const year = item.album?.release_date
          ? Number.parseInt(item.album.release_date.slice(0, 4), 10)
          : 2025;
        return {
          id: `sp-${item.id}`,
          title: item.name,
          artist: item.artists?.map((a) => a.name).join(', ') || 'Unknown Artist',
          album: item.album?.name || 'Single',
          genre: 'Spotify Discovery',
          language: 'Multi-Regional',
          durationSec: hasPreview ? 30 : Math.round(item.duration_ms / 1000),
          bpm: 112,
          year: Number.isFinite(year) ? year : 2025,
          coverUrl:
            item.album?.images?.[0]?.url ||
            '/src/assets/images/cover_international_chill_1794817360577.jpg',
          providerId: 'spotify-web',
          providerName: 'Spotify Web API',
          licenseType: hasPreview ? 'Permitted 30s Preview' : 'Metadata & Official Embed',
          licenseSummary: hasPreview
            ? '30-second preview explicitly supplied by Spotify Web API.'
            : 'Metadata-only result; no preview stream supplied by rights holder.',
          playbackRights: hasPreview ? 'preview-30s' : 'metadata-only',
          streamUrl: item.preview_url || '',
          externalUrl: item.external_urls?.spotify,
          attribution: 'Metadata & discovery via Spotify Web API',
          playlistIds: [],
          plays: 0,
        };
      });
    } catch {
      return [];
    } finally {
      clearTimeout(timer);
    }
  }
}
