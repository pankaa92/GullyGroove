import type { ProviderStatus, Track } from '../../types/music';
import type { MusicProviderAdapter } from './types';

interface YoutubeSearchItem {
  id?: { videoId?: string };
  snippet?: {
    title?: string;
    channelTitle?: string;
    publishedAt?: string;
    thumbnails?: { high?: { url?: string }; medium?: { url?: string } };
  };
}

export class YoutubeDataProvider implements MusicProviderAdapter {
  private get apiKey(): string {
    return process.env.YOUTUBE_API_KEY?.trim() || '';
  }

  getStatus(): ProviderStatus {
    const configured = Boolean(this.apiKey);
    return {
      id: 'youtube-data',
      name: 'YouTube Data API v3',
      category: 'Metadata & Discovery',
      configured,
      active: configured,
      playbackRights: 'embed-only',
      licensePolicy:
        'Discovery metadata and official YouTube embedded player only. Audio extraction or stream downloading is strictly disabled.',
      description:
        'Searches official artist channels and music videos in India & globally via YouTube Data API v3, respecting YouTube Terms of Service.',
      envKeysRequired: ['YOUTUBE_API_KEY'],
    };
  }

  async search(query: string, limit = 6): Promise<Track[]> {
    if (!this.apiKey || !query.trim()) return [];

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);

    try {
      const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoCategoryId=10&regionCode=IN&maxResults=${Math.min(
        limit,
        10
      )}&q=${encodeURIComponent(query)}&key=${encodeURIComponent(this.apiKey)}`;

      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) return [];

      const json = (await res.json()) as { items?: YoutubeSearchItem[] };
      if (!Array.isArray(json.items)) return [];

      return json.items
        .filter((item) => Boolean(item.id?.videoId && item.snippet?.title))
        .map((item): Track => {
          const videoId = item.id!.videoId!;
          const snippet = item.snippet!;
          const year = snippet.publishedAt
            ? new Date(snippet.publishedAt).getFullYear()
            : 2026;
          return {
            id: `yt-${videoId}`,
            title: snippet.title || 'Untitled Track',
            artist: snippet.channelTitle || 'Official Channel',
            album: 'YouTube Music Discovery',
            genre: 'Official Video / Discovery',
            language: 'Multi-Regional',
            durationSec: 0,
            bpm: 100,
            year: Number.isFinite(year) ? year : 2026,
            coverUrl:
              snippet.thumbnails?.high?.url ||
              snippet.thumbnails?.medium?.url ||
              '/src/assets/images/cover_international_chill_1794817360577.jpg',
            providerId: 'youtube-data',
            providerName: 'YouTube Data API v3',
            licenseType: 'Metadata & Official Embed',
            licenseSummary:
              'Playback occurs exclusively through the official YouTube watch/embed policy. No direct audio stream is extracted.',
            playbackRights: 'embed-only',
            streamUrl: '',
            embedId: videoId,
            externalUrl: `https://www.youtube.com/watch?v=${videoId}`,
            attribution: `Official YouTube Channel: ${snippet.channelTitle || 'Creator'}`,
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
