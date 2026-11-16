export type LicenseType =
  | 'Royalty-Free Studio'
  | 'Creative Commons (CC-BY)'
  | 'Public Domain'
  | 'Permitted 30s Preview'
  | 'Metadata & Official Embed';

export type PlaybackRights =
  | 'full-stream'
  | 'preview-30s'
  | 'embed-only'
  | 'metadata-only';

export type ProviderId =
  | 'gullygroove-studio'
  | 'audius-open'
  | 'itunes-preview'
  | 'youtube-data'
  | 'spotify-web'
  | 'jamendo-cc'
  | 'user-vault';

export type MusicalGroove =
  | 'bollywood-romantic'
  | 'punjabi-dhol'
  | 'highway-folk'
  | 'sufi-chill'
  | 'lofi-ambient'
  | 'workout-edm'
  | 'retro-vinyl'
  | 'global-pop';

export type MusicalScale =
  | 'yaman'
  | 'bhairavi'
  | 'pentatonic'
  | 'minor'
  | 'major'
  | 'dorian';

export interface AudioProfile {
  bpm: number;
  rootHz: number;
  scale: MusicalScale;
  groove: MusicalGroove;
  intensity: number;
}

export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  genre: string;
  language: string;
  durationSec: number;
  bpm: number;
  year: number;
  coverUrl: string;
  providerId: ProviderId;
  providerName: string;
  licenseType: LicenseType;
  licenseSummary: string;
  playbackRights: PlaybackRights;
  streamUrl: string;
  externalUrl?: string;
  embedId?: string;
  attribution?: string;
  playlistIds: string[];
  audioProfile?: AudioProfile;
  plays: number;
  isUserAdded?: boolean;
}

export interface Playlist {
  id: string;
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  mood: string;
  region: 'India' | 'Pan-India' | 'Global';
  coverUrl: string;
  curatedBy: string;
  featured?: boolean;
}

export interface PlaylistWithStats extends Playlist {
  trackCount: number;
  totalDurationSec: number;
}

export interface ProviderStatus {
  id: ProviderId;
  name: string;
  category: 'Authorised Studio' | 'Licensed Preview API' | 'Metadata & Discovery' | 'User Media Vault';
  configured: boolean;
  active: boolean;
  playbackRights: PlaybackRights;
  licensePolicy: string;
  description: string;
  envKeysRequired: string[];
}

export interface SearchFilters {
  query: string;
  artist: string;
  album: string;
  genre: string;
  language: string;
  providerId: string;
}

export interface NewAuthorisedTrackInput {
  title: string;
  artist: string;
  album: string;
  genre: string;
  language: string;
  durationSec: number;
  licenseType: LicenseType;
  streamUrl: string;
  coverUrl?: string;
  playlistId?: string;
  attribution?: string;
}
