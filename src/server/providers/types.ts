import type { ProviderStatus, Track } from '../../types/music';

export interface MusicProviderAdapter {
  getStatus(): ProviderStatus;
  search(query: string, limit?: number): Promise<Track[]>;
}
