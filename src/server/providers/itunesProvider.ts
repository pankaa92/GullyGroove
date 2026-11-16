import type { ProviderStatus, Track } from '../../types/music';
import type { MusicProviderAdapter } from './types';

interface ItunesResultItem {
  trackId: number;
  trackName: string;
  artistName: string;
  collectionName?: string;
  primaryGenreName?: string;
  trackTimeMillis?: number;
  releaseDate?: string;
  artworkUrl100?: string;
  previewUrl?: string;
  trackViewUrl?: string;
}

export class ItunesPreviewProvider implements MusicProviderAdapter {
  getStatus(): ProviderStatus {
    return {
      id: 'itunes-preview',
      name: 'Apple Music / iTunes India Preview API',
      category: 'Licensed Preview API',
      configured: true,
      active: true,
      playbackRights: 'preview-30s',
      licensePolicy: 'Official 30-second AAC preview clips only; full tracks link out to Apple Music.',
      description:
        'Public Indian & global catalog discovery returning metadata and explicitly permitted 30-second preview streams.',
      envKeysRequired: [],
    };
  }

  async search(query: string, limit = 8): Promise<Track[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);

    try {
      const url = `https://itunes.apple.com/search?term=${encodeURIComponent(
        trimmed
      )}&country=IN&media=music&entity=song&limit=${Math.min(limit, 15)}`;

      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) return [];

      const json = (await res.json()) as { results?: ItunesResultItem[] };
      if (!Array.isArray(json.results)) return [];

      return json.results
        .filter((item) => Boolean(item.previewUrl && item.trackName))
        .map((item): Track => {
          const year = item.releaseDate ? new Date(item.releaseDate).getFullYear() : 2025;
          const cover = item.artworkUrl100
            ? item.artworkUrl100.replace('100x100bb', '400x400bb')
            : '/src/assets/images/cover_international_chill_1794817360577.jpg';
          return {
            id: `itunes-${item.trackId}`,
            title: item.trackName,
            artist: item.artistName,
            album: item.collectionName || 'Single',
            genre: item.primaryGenreName || 'Pop',
            language: 'Multi-Regional',
            durationSec: 30,
            bpm: 110,
            year: Number.isFinite(year) ? year : 2025,
            coverUrl: cover,
            providerId: 'itunes-preview',
            providerName: 'iTunes India 30s Preview',
            licenseType: 'Permitted 30s Preview',
            licenseSummary:
              'Official 30-second preview stream provided via Apple iTunes Search API. Full playback requires external licensed platform.',
            playbackRights: 'preview-30s',
            streamUrl: item.previewUrl!,
            externalUrl: item.trackViewUrl,
            attribution: `Preview via iTunes Search API (${item.artistName})`,
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
