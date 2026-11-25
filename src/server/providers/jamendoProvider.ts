import type { ProviderStatus, Track } from '../../types/music';
import type { MusicProviderAdapter } from './types';

interface JamendoTrackItem {
  id: string;
  name: string;
  duration: number;
  artist_name: string;
  album_name?: string;
  album_image?: string;
  audio?: string;
  shareurl?: string;
  releasedate?: string;
  license_ccurl?: string;
}

export class JamendoCcProvider implements MusicProviderAdapter {
  private get clientId(): string {
    return process.env.JAMENDO_CLIENT_ID?.trim() || '';
  }

  getStatus(): ProviderStatus {
    const configured = Boolean(this.clientId);
    return {
      id: 'jamendo-cc',
      name: 'Jamendo Creative Commons API',
      category: 'Licensed Preview API',
      configured,
      active: configured,
      playbackRights: 'full-stream',
      licensePolicy:
        'Independent artist tracks licensed under Creative Commons (CC-BY / CC-BY-SA) for full streaming.',
      description:
        'Streams full-length independent music cleared under Creative Commons licenses with proper artist attribution.',
      envKeysRequired: ['JAMENDO_CLIENT_ID'],
    };
  }

  async search(query: string, limit = 6): Promise<Track[]> {
    if (!this.clientId || !query.trim()) return [];

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);

    try {
      const url = `https://api.jamendo.com/v3.0/tracks/?client_id=${encodeURIComponent(
        this.clientId
      )}&format=json&limit=${Math.min(limit, 10)}&search=${encodeURIComponent(query)}&audioformat=mp32`;

      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) return [];

      const json = (await res.json()) as { results?: JamendoTrackItem[] };
      if (!Array.isArray(json.results)) return [];

      return json.results
        .filter((item) => Boolean(item.audio) && Math.round(item.duration || 0) > 30)
        .map((item): Track => {
          const year = item.releasedate ? new Date(item.releasedate).getFullYear() : 2025;
          return {
            id: `jam-${item.id}`,
            title: item.name,
            artist: item.artist_name,
            album: item.album_name || 'Independent Release',
            genre: 'Independent / CC',
            language: 'Global',
            durationSec: item.duration || 180,
            bpm: 105,
            year: Number.isFinite(year) ? year : 2025,
            coverUrl:
              item.album_image ||
              '/src/assets/images/cover_international_chill_1794817360577.jpg',
            providerId: 'jamendo-cc',
            providerName: 'Jamendo Creative Commons',
            licenseType: 'Creative Commons (CC-BY)',
            licenseSummary: 'Cleared independent Creative Commons master for full streaming.',
            playbackRights: 'full-stream',
            streamUrl: item.audio!,
            externalUrl: item.shareurl,
            attribution: `${item.artist_name} (${item.license_ccurl || 'CC License'})`,
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
