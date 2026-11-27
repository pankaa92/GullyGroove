import type { Track } from '../types/music';

export const LANGUAGE_FILTERS = [
  'All',
  'Hindi',
  'Punjabi',
  'Marathi',
  'Gujarati',
  'Rajasthani',
  'Haryanvi',
  'Bhojpuri',
  'Bengali',
  'South',
  'Nepali & NE',
  'Devotional',
  'Korean',
  'English',
] as const;

export type LanguageFilter = (typeof LANGUAGE_FILTERS)[number];

const SOUTH_TOKENS = ['tamil', 'telugu', 'malayalam', 'kannada', 'south'];
const NE_NEPALI_TOKENS = [
  'nepali',
  'assamese',
  'manipuri',
  'nagamese',
  'chokri',
  'mizo',
  'khasi',
  'bodo',
];
const DEVOTIONAL_TOKENS = ['devotional', 'bhakti', 'bhajan', 'aarti', 'mantra', 'sanskrit'];

export function matchesLanguageFilter(track: Track, filter: LanguageFilter): boolean {
  if (filter === 'All') return true;

  const lang = (track.language || '').toLowerCase();
  const genre = (track.genre || '').toLowerCase();
  const playlists = track.playlistIds || [];

  switch (filter) {
    case 'Hindi':
      return lang.includes('hindi') || lang.includes('urdu');
    case 'Punjabi':
      return lang.includes('punjabi');
    case 'Marathi':
      return lang.includes('marathi');
    case 'Gujarati':
      return lang.includes('gujarati');
    case 'Rajasthani':
      return lang.includes('rajasthani');
    case 'Haryanvi':
      return lang.includes('haryanvi');
    case 'Bhojpuri':
      return lang.includes('bhojpuri');
    case 'Bengali':
      return lang.includes('bengali') || lang.includes('bangla');
    case 'South':
      return SOUTH_TOKENS.some((tok) => lang.includes(tok));
    case 'Nepali & NE':
      return NE_NEPALI_TOKENS.some((tok) => lang.includes(tok));
    case 'Devotional':
      return (
        playlists.includes('bhakti-bhajan-aarti') ||
        DEVOTIONAL_TOKENS.some((tok) => lang.includes(tok) || genre.includes(tok))
      );
    case 'Korean':
      return (
        lang.includes('korean') ||
        genre.includes('k-pop') ||
        genre.includes('k-drama') ||
        playlists.includes('bts-korean-songs')
      );
    case 'English':
      return lang.includes('english') || lang.includes('instrumental');
    default:
      return true;
  }
}
