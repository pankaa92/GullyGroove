import type { ProviderStatus, Track } from '../../types/music';
import type { MusicProviderAdapter } from './types';

interface AudiusTrackItem {
  id: string;
  title: string;
  duration?: number;
  genre?: string;
  mood?: string;
  release_date?: string;
  play_count?: number;
  permalink?: string;
  artwork?: {
    '150x150'?: string;
    '480x480'?: string;
    '1000x1000'?: string;
  };
  user?: {
    name?: string;
    handle?: string;
  };
}

export class AudiusOpenProvider implements MusicProviderAdapter {
  getStatus(): ProviderStatus {
    return {
      id: 'audius-open',
      name: 'Audius Open Streaming API',
      category: 'Licensed Preview API',
      configured: true,
      active: true,
      playbackRights: 'full-stream',
      licensePolicy:
        'Public independent-artist full-length audio streams published on Audius for open API streaming with artist attribution.',
      description:
        'Streams full-length independent Bollywood mashups, Punjabi remixes, Sufi, Lo-Fi, and global tracks with no API key required.',
      envKeysRequired: [],
    };
  }

  async search(query: string, limit = 8): Promise<Track[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);

    try {
      const url = `https://api.audius.co/v1/tracks/search?query=${encodeURIComponent(
        trimmed
      )}&app_name=GullyGroove&limit=${Math.min(limit, 15)}`;

      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) return [];

      const json = (await res.json()) as { data?: AudiusTrackItem[] };
      if (!Array.isArray(json.data)) return [];

      return json.data
        .filter((item) => Boolean(item.id && item.title && (item.duration || 0) > 20))
        .map((item): Track => {
          const year = item.release_date
            ? new Date(item.release_date).getFullYear()
            : 2025;
          const cover =
            item.artwork?.['480x480'] ||
            item.artwork?.['150x150'] ||
            '/src/assets/images/cover_international_chill_1794817360577.jpg';

          return {
            id: `aud-${item.id}`,
            title: item.title,
            artist: item.user?.name || 'Independent Artist',
            album: item.mood ? `${item.mood} Sessions` : 'Audius Release',
            genre: item.genre || 'Independent',
            language: 'Multi-Regional',
            durationSec: Math.round(item.duration || 180),
            bpm: 110,
            year: Number.isFinite(year) ? year : 2025,
            coverUrl: cover,
            providerId: 'audius-open',
            providerName: 'Audius Open Streaming',
            licenseType: 'Creative Commons (CC-BY)',
            licenseSummary:
              'Full-length independent artist audio stream via Audius Public Discovery API.',
            playbackRights: 'full-stream',
            streamUrl: `/api/audius/stream/${encodeURIComponent(item.id)}`,
            externalUrl: item.permalink
              ? `https://audius.co${item.permalink}`
              : undefined,
            attribution: `${item.user?.name || 'Artist'} via Audius`,
            playlistIds: [],
            plays: item.play_count || 0,
          };
        });
    } catch {
      return [];
    } finally {
      clearTimeout(timer);
    }
  }
}
