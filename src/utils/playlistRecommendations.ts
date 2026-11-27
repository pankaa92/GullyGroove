import type { PlaylistWithStats, Track } from '../types/music';

export type RecommendationFilterMode = 'balanced' | 'popular' | 'gems';

export interface PlaylistVibeProfile {
  playlistId: string;
  trackCount: number;
  medianBpm: number;
  bpmRange: [number, number];
  dominantLanguages: string[];
  topArtists: string[];
  topGenres: string[];
  dominantGrooves: string[];
  avgYear: number;
}

export interface SmartRecommendation {
  track: Track;
  score: number;
  tier: 'popular' | 'gem';
  reason: string;
  matchedArtist?: string;
}

export interface SmartRecommendationResult {
  profile: PlaylistVibeProfile;
  items: SmartRecommendation[];
  totalCandidates: number;
  popularCount: number;
  gemCount: number;
}

const IGNORED_ARTIST_TOKENS = new Set([
  'various',
  'various artists',
  'unknown',
  'dj',
  'remix',
  'official',
  'music',
  'records',
  't-series',
  'sony music',
  'zee music',
  'traditional',
]);

const STOP_STYLE_TOKENS = new Set([
  'song',
  'songs',
  'hits',
  'hit',
  'playlist',
  'mix',
  'best',
  'top',
  'official',
  'video',
  'audio',
  'music',
  'collection',
  'nonstop',
  'non',
  'stop',
  'full',
  'hd',
  'track',
  'tracks',
  'new',
  'latest',
  'the',
  'and',
  'for',
  'with',
]);

const DEVOTIONAL_REGEX =
  /bhakti|bhajan|aarti|arti|chalisa|stotram|mantra|shiva?|hanuman|krishna|ram|ganesha|ganpati|bappa|mauli|vithu|devotional|vandana|shlok|gayatri|mahadev|bhole|khatu|shyam|mata|radha/i;
const KOREAN_REGEX = /korean|k-pop|kpop|bts|blackpink|seoul|kdrama|k-drama|ost|bangtan/i;
const NEPALI_NE_REGEX =
  /nepali|assamese|manipuri|nagamese|mizo|khasi|bodo|himalayan|kathmandu|sikkim|shillong|guwahati|north\s*east|seven\s*sisters|sajjan\s*raj|swoopna|papon|zubeen/i;
const SOUTH_LANGS = new Set(['tamil', 'telugu', 'malayalam', 'kannada']);
const NINETIES_VOCALISTS = [
  'kumar sanu',
  'udit narayan',
  'alka yagnik',
  'sonu nigam',
  'abhijeet',
  'kavita krishnamurthy',
  'lata mangeshkar',
  'asha bhosle',
  'poornima',
  'sadhana sargam',
  'kishore kumar',
  'anuradha paudwal',
  's. p. balasubrahmanyam',
];

export function splitArtists(raw: string): string[] {
  if (!raw) return [];
  return raw
    .split(/,|&|\bfeat\.?\b|\bft\.?\b|\bx\b|\bvs\.?\b|\band\b|\|/i)
    .map((part) => part.trim())
    .filter((part) => {
      const lower = part.toLowerCase();
      return lower.length >= 2 && !IGNORED_ARTIST_TOKENS.has(lower);
    });
}

function tokenizeStyle(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !STOP_STYLE_TOKENS.has(t));
}

function computeMedian(values: number[], fallback: number): number {
  if (values.length === 0) return fallback;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : Math.round(sorted[mid]);
}

function computePercentile(sortedAsc: number[], p: number, fallback: number): number {
  if (sortedAsc.length === 0) return fallback;
  const idx = Math.min(
    sortedAsc.length - 1,
    Math.max(0, Math.floor((sortedAsc.length - 1) * p))
  );
  return sortedAsc[idx];
}

function normalizeLang(lang: string): string {
  const lower = (lang || '').trim().toLowerCase();
  if (!lower) return 'hindi';
  if (lower === 'k-pop' || lower === 'kpop') return 'korean';
  return lower;
}

function formatDisplayList(items: string[], max = 2): string {
  return items.slice(0, max).join(', ');
}

export function analyzePlaylistProfile(
  playlist: PlaylistWithStats,
  playlistTracks: Track[],
  userTasteTracks: Track[] = []
): PlaylistVibeProfile {
  const sourceTracks =
    playlistTracks.length > 0 ? playlistTracks : userTasteTracks.slice(0, 12);

  const langCounts = new Map<string, { label: string; count: number }>();
  const artistCounts = new Map<string, { label: string; count: number }>();
  const genreCounts = new Map<string, { label: string; count: number }>();
  const grooveCounts = new Map<string, number>();
  const bpms: number[] = [];
  const years: number[] = [];

  for (const track of sourceTracks) {
    const langKey = normalizeLang(track.language);
    const prevLang = langCounts.get(langKey);
    langCounts.set(langKey, {
      label: prevLang?.label || track.language || 'Hindi',
      count: (prevLang?.count || 0) + 1,
    });

    for (const artist of splitArtists(track.artist)) {
      const key = artist.toLowerCase();
      const prev = artistCounts.get(key);
      artistCounts.set(key, {
        label: prev?.label || artist,
        count: (prev?.count || 0) + 1,
      });
    }

    if (track.genre) {
      const gKey = track.genre.toLowerCase().trim();
      const prevG = genreCounts.get(gKey);
      genreCounts.set(gKey, {
        label: prevG?.label || track.genre.trim(),
        count: (prevG?.count || 0) + 1,
      });
    }

    if (track.audioProfile?.groove) {
      grooveCounts.set(
        track.audioProfile.groove,
        (grooveCounts.get(track.audioProfile.groove) || 0) + 1
      );
    }

    if (track.bpm >= 60 && track.bpm <= 200) {
      bpms.push(track.bpm);
    }
    if (track.year >= 1950 && track.year <= 2030) {
      years.push(track.year);
    }
  }

  const sortedLangs = Array.from(langCounts.values())
    .sort((a, b) => b.count - a.count)
    .map((entry) => entry.label);

  const sortedArtists = Array.from(artistCounts.values())
    .sort((a, b) => b.count - a.count)
    .map((entry) => entry.label);

  const sortedGenres = Array.from(genreCounts.values())
    .sort((a, b) => b.count - a.count)
    .map((entry) => entry.label);

  const sortedGrooves = Array.from(grooveCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([groove]) => groove);

  const sortedBpms = [...bpms].sort((a, b) => a - b);
  const fallbackBpm =
    playlist.id === 'workout-motivation'
      ? 132
      : playlist.id === '2am-playlist'
        ? 92
        : playlist.id === 'party-dj-hits' || playlist.id === 'shadi-sangeet-playlist'
          ? 122
          : 108;

  const medianBpm = computeMedian(sortedBpms, fallbackBpm);
  const p25Bpm = computePercentile(sortedBpms, 0.25, Math.max(72, medianBpm - 14));
  const p75Bpm = computePercentile(sortedBpms, 0.75, Math.min(165, medianBpm + 14));

  const avgYear =
    years.length > 0
      ? Math.round(years.reduce((sum, y) => sum + y, 0) / years.length)
      : playlist.id === '90s-hindi-classics'
        ? 1996
        : 2022;

  return {
    playlistId: playlist.id,
    trackCount: playlistTracks.length,
    medianBpm,
    bpmRange: [p25Bpm, p75Bpm],
    dominantLanguages: sortedLangs,
    topArtists: sortedArtists,
    topGenres: sortedGenres,
    dominantGrooves: sortedGrooves,
    avgYear,
  };
}

export function getSmartPlaylistRecommendations(params: {
  playlist: PlaylistWithStats;
  playlistTracks: Track[];
  allTracks: Track[];
  favorites: Set<string>;
  recentlyPlayed: Track[];
  filterMode?: RecommendationFilterMode;
  batchOffset?: number;
  limit?: number;
}): SmartRecommendationResult {
  const {
    playlist,
    playlistTracks,
    allTracks,
    favorites,
    recentlyPlayed,
    filterMode = 'balanced',
    batchOffset = 0,
    limit = 10,
  } = params;

  const existingIds = new Set(playlistTracks.map((t) => t.id));
  const existingTitles = new Set(
    playlistTracks.map((t) => `${t.title.toLowerCase().trim()}::${t.artist.toLowerCase().trim()}`)
  );

  // User taste signals from favorites and listening history
  const tasteTracks = [
    ...allTracks.filter((t) => favorites.has(t.id)),
    ...recentlyPlayed,
  ];
  const profile = analyzePlaylistProfile(playlist, playlistTracks, tasteTracks);

  // Build weighted maps from existing playlist tracks
  const artistWeights = new Map<string, { label: string; weight: number }>();
  const languageWeights = new Map<string, number>();
  const styleTokenWeights = new Map<string, number>();
  const grooveWeights = new Map<string, number>();
  const scaleWeights = new Map<string, number>();

  const basisTracks =
    playlistTracks.length > 0 ? playlistTracks : tasteTracks.slice(0, 15);
  const basisTotal = Math.max(1, basisTracks.length);

  for (const track of basisTracks) {
    for (const artist of splitArtists(track.artist)) {
      const key = artist.toLowerCase();
      const prev = artistWeights.get(key);
      artistWeights.set(key, {
        label: prev?.label || artist,
        weight: (prev?.weight || 0) + 1,
      });
    }

    const lang = normalizeLang(track.language);
    languageWeights.set(lang, (languageWeights.get(lang) || 0) + 1);

    const styleTokens = new Set([
      ...tokenizeStyle(track.genre),
      ...tokenizeStyle(track.album),
    ]);
    for (const token of styleTokens) {
      styleTokenWeights.set(token, (styleTokenWeights.get(token) || 0) + 1);
    }

    if (track.audioProfile?.groove) {
      grooveWeights.set(
        track.audioProfile.groove,
        (grooveWeights.get(track.audioProfile.groove) || 0) + 1
      );
    }
    if (track.audioProfile?.scale) {
      scaleWeights.set(
        track.audioProfile.scale,
        (scaleWeights.get(track.audioProfile.scale) || 0) + 1
      );
    }
  }

  // Playlist identity metadata tokens (mood, title, subtitle)
  const playlistContextTokens = new Set([
    ...tokenizeStyle(playlist.title),
    ...tokenizeStyle(playlist.mood),
    ...tokenizeStyle(playlist.subtitle),
  ]);

  // User personal artist/genre preference boost (soft personalization)
  const userArtistSet = new Set<string>();
  const userLangSet = new Set<string>();
  for (const t of tasteTracks) {
    for (const a of splitArtists(t.artist)) {
      userArtistSet.add(a.toLowerCase());
    }
    userLangSet.add(normalizeLang(t.language));
  }

  // Catalog play count distribution for Popular vs. Hidden Gem separation
  const eligiblePool = allTracks.filter((track) => {
    if (existingIds.has(track.id)) return false;
    if (track.durationSec > 0 && track.durationSec <= 30) return false;
    const key = `${track.title.toLowerCase().trim()}::${track.artist.toLowerCase().trim()}`;
    if (existingTitles.has(key)) return false;
    return Boolean(track.streamUrl || track.embedId);
  });

  const sortedPlays = eligiblePool
    .map((t) => t.plays || 0)
    .sort((a, b) => a - b);
  const gemUpperThreshold = computePercentile(sortedPlays, 0.45, 350000);
  const popularLowerThreshold = computePercentile(sortedPlays, 0.58, 700000);

  // Detect playlist thematic guardrails from existing tracks + playlist ID
  const devotionalShare =
    basisTracks.filter((t) => DEVOTIONAL_REGEX.test(`${t.genre} ${t.title}`)).length /
    basisTotal;
  const isDevotionalPlaylist =
    playlist.id === 'bhakti-bhajan-aarti' || devotionalShare >= 0.45;
  const isKoreanPlaylist =
    playlist.id === 'bts-korean-songs' ||
    (languageWeights.get('korean') || 0) / basisTotal >= 0.45;
  const isNepaliNePlaylist =
    playlist.id === 'nepali-northeast-hits' ||
    basisTracks.filter((t) =>
      NEPALI_NE_REGEX.test(`${t.language} ${t.genre} ${t.artist}`)
    ).length /
      basisTotal >=
      0.4;
  const isSouthPlaylist =
    playlist.id === 'south-hits' ||
    basisTracks.filter((t) => SOUTH_LANGS.has(normalizeLang(t.language))).length /
      basisTotal >=
      0.45;
  const isBhojpuriPlaylist =
    playlist.id === 'bhojpuri-hits' ||
    (languageWeights.get('bhojpuri') || 0) / basisTotal >= 0.45;
  const is90sPlaylist =
    playlist.id === '90s-hindi-classics' ||
    (profile.avgYear <= 2004 && playlistTracks.length >= 3);
  const isMidnightChill =
    playlist.id === '2am-playlist' ||
    (profile.medianBpm <= 104 &&
      (styleTokenWeights.has('lofi') ||
        styleTokenWeights.has('romantic') ||
        styleTokenWeights.has('midnight') ||
        styleTokenWeights.has('sufi')));
  const isWorkoutPlaylist = playlist.id === 'workout-motivation';
  const isAllInOne = playlist.id === 'sab-chalega' || playlist.id === 'my-playlist';

  // Determine strong language focus when existing playlist has clear language affinity
  const topLangShare =
    profile.dominantLanguages.length > 0
      ? (languageWeights.get(normalizeLang(profile.dominantLanguages[0])) || 0) /
        basisTotal
      : 0;
  const allowedLangs = new Set<string>();
  for (const [langKey, count] of languageWeights.entries()) {
    if (count / basisTotal >= 0.12) {
      allowedLangs.add(langKey);
    }
  }

  const scoredCandidates: SmartRecommendation[] = [];

  for (const candidate of eligiblePool) {
    const candLang = normalizeLang(candidate.language);
    const candMetaText = `${candidate.title} ${candidate.genre} ${candidate.album} ${candidate.artist}`;
    const isCandDevotional = DEVOTIONAL_REGEX.test(candMetaText);
    const isCandKorean =
      candLang === 'korean' || KOREAN_REGEX.test(candMetaText);
    const isCandNepaliNe = NEPALI_NE_REGEX.test(
      `${candidate.language} ${candidate.genre} ${candidate.artist}`
    );
    const isCandSouth = SOUTH_LANGS.has(candLang);
    const isCandBhojpuri = candLang === 'bhojpuri';

    // 1. Hard thematic / regional relevance guardrails (reject unrelated tracks)
    if (isDevotionalPlaylist && !isCandDevotional) continue;
    if (!isDevotionalPlaylist && !isAllInOne && isCandDevotional) continue;
    if (isKoreanPlaylist && !isCandKorean) continue;
    if (isNepaliNePlaylist && !isCandNepaliNe) continue;
    if (isSouthPlaylist && !isCandSouth) continue;
    if (isBhojpuriPlaylist && !isCandBhojpuri) continue;

    // Prevent unrelated cross-regional leakage into Hindi/Punjabi/90s playlists
    if (
      !isAllInOne &&
      !isKoreanPlaylist &&
      !isNepaliNePlaylist &&
      !isSouthPlaylist &&
      !isBhojpuriPlaylist &&
      allowedLangs.size > 0 &&
      !allowedLangs.has(candLang)
    ) {
      // Allow English/Hindi crossover in Party/Workout/Salon, but block mismatched regional niches
      const softCrossAllowed =
        (playlist.id === 'party-dj-hits' ||
          playlist.id === 'workout-motivation' ||
          playlist.id === 'shadi-sangeet-playlist') &&
        (candLang === 'hindi' || candLang === 'punjabi' || candLang === 'english');
      if (!softCrossAllowed) continue;
    }

    let score = 0;
    const reasons: string[] = [];
    let matchedArtistName: string | undefined;

    // 2. Artist similarity (strongest signal of belonging)
    const candArtists = splitArtists(candidate.artist);
    let artistMatchScore = 0;
    for (const artist of candArtists) {
      const found = artistWeights.get(artist.toLowerCase());
      if (found) {
        artistMatchScore += Math.min(34, 18 + found.weight * 4);
        if (!matchedArtistName) matchedArtistName = found.label;
      } else if (userArtistSet.has(artist.toLowerCase())) {
        artistMatchScore += 10;
        if (!matchedArtistName) matchedArtistName = artist;
      }
    }
    // 90s vocalist consistency bonus
    if (
      is90sPlaylist &&
      NINETIES_VOCALISTS.some((v) => candidate.artist.toLowerCase().includes(v))
    ) {
      artistMatchScore += 16;
    }
    score += Math.min(38, artistMatchScore);
    if (matchedArtistName) {
      reasons.push(`Similar artist: ${matchedArtistName}`);
    }

    // 3. Language alignment
    const langCount = languageWeights.get(candLang) || 0;
    if (langCount > 0) {
      const langRatio = langCount / basisTotal;
      score += Math.round(12 + langRatio * 14);
    } else if (topLangShare >= 0.7 && !isAllInOne) {
      score -= 10;
    }

    // 4. Genre, Groove & Mood/Context alignment
    const candTokens = new Set([
      ...tokenizeStyle(candidate.genre),
      ...tokenizeStyle(candidate.album),
      ...tokenizeStyle(candidate.title),
    ]);
    let styleHits = 0;
    let matchedStyleLabel = '';
    for (const token of candTokens) {
      const w = styleTokenWeights.get(token) || 0;
      if (w > 0) {
        styleHits += Math.min(4, w);
        if (!matchedStyleLabel) matchedStyleLabel = token;
      } else if (playlistContextTokens.has(token)) {
        styleHits += 2;
        if (!matchedStyleLabel) matchedStyleLabel = token;
      }
    }
    score += Math.min(24, styleHits * 5);

    if (
      candidate.audioProfile?.groove &&
      grooveWeights.has(candidate.audioProfile.groove)
    ) {
      score += 14;
      if (reasons.length === 0) {
        reasons.push(`${candidate.genre} groove`);
      }
    }
    if (
      candidate.audioProfile?.scale &&
      scaleWeights.has(candidate.audioProfile.scale)
    ) {
      score += 5;
    }

    // 5. BPM / Tempo consistency
    const candBpm = candidate.bpm || 108;
    const bpmDiff = Math.abs(candBpm - profile.medianBpm);
    if (bpmDiff <= 8) {
      score += 16;
      if (reasons.length < 2) reasons.push(`${candBpm} BPM match`);
    } else if (bpmDiff <= 18) {
      score += 10;
    } else if (bpmDiff <= 28) {
      score += 3;
    } else if (bpmDiff >= 42) {
      score -= 12;
    }

    // 6. Specific mood / era coherence checks
    if (is90sPlaylist) {
      if (
        candidate.year <= 2005 ||
        /80s?|90s?|retro|classic|evergreen|cassette|golden/i.test(candMetaText)
      ) {
        score += 18;
        if (!reasons.some((r) => r.includes('Retro'))) {
          reasons.push('Retro Classics era');
        }
      } else if (candidate.year >= 2018) {
        score -= 18;
      }
    }

    if (playlist.id === 'party-dj-hits') {
      if (/\b(dj|party|club|remix|dance|bhangra)\b/i.test(candMetaText)) {
        score += 16;
      } else if (
        /\b(2\s*am|lofi|lo-fi|hurt|pain|heartbreak|ghazal|sufi|sad|unplugged)\b/i.test(
          candMetaText
        ) ||
        candBpm < 88
      ) {
        score -= 26;
      }
    }

    if (isMidnightChill) {
      if (
        /lofi|2\s*am|acoustic|sufi|ghazal|soulful|romantic|sad|unplugged|love/i.test(
          candMetaText
        ) ||
        candBpm <= 106
      ) {
        score += 12;
      } else if (candBpm >= 132 || /baraat|dj|gym|workout|club/i.test(candMetaText)) {
        score -= 22;
      }
    }

    if (isWorkoutPlaylist) {
      if (
        candBpm >= 118 ||
        /gym|workout|anthem|bass|rap|hip-hop|rock|motivation|edm/i.test(candMetaText)
      ) {
        score += 14;
      } else if (candBpm < 95) {
        score -= 18;
      }
    }

    // 7. Soft user-history personalization
    if (userLangSet.has(candLang)) {
      score += 4;
    }
    // Slight preference for tracks with clean direct audio or full metadata
    if (candidate.streamUrl) {
      score += 4;
    }

    // Require genuine musical consistency before surfacing
    const minScore =
      basisTracks.length === 0 ? 8 : playlistTracks.length === 0 ? 16 : 24;
    if (score < minScore) continue;

    const plays = candidate.plays || 0;
    const isHiddenGem =
      plays <= gemUpperThreshold ||
      candidate.providerId === 'audius-open' ||
      candidate.providerId === 'jamendo-cc' ||
      Boolean(candidate.streamUrl && plays < popularLowerThreshold);

    const tier: 'popular' | 'gem' = isHiddenGem ? 'gem' : 'popular';

    if (reasons.length === 0) {
      if (matchedStyleLabel) {
        reasons.push(
          `${matchedStyleLabel.charAt(0).toUpperCase()}${matchedStyleLabel.slice(1)} vibe`
        );
      } else {
        reasons.push(`${candidate.language} · ${candidate.genre}`);
      }
    }

    const reasonPrefix = tier === 'gem' ? 'Hidden gem' : 'Popular match';
    const fullReason = `${reasonPrefix} · ${reasons.slice(0, 2).join(' · ')}`;

    scoredCandidates.push({
      track: candidate,
      score,
      tier,
      reason: fullReason,
      matchedArtist: matchedArtistName,
    });
  }

  // Sort by musical consistency score, breaking ties by plays for popular or freshness for gems
  const popularCandidates = scoredCandidates
    .filter((item) => item.tier === 'popular')
    .sort((a, b) => b.score - a.score || b.track.plays - a.track.plays);

  const gemCandidates = scoredCandidates
    .filter((item) => item.tier === 'gem')
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.track.streamUrl ? 1 : 0) - (b.track.streamUrl ? 1 : 0) ||
        a.track.plays - b.track.plays
    );

  // Build diverse list capping repeated lead artist to 2 per batch so recommendations feel rich
  const pickDiverse = (
    pool: SmartRecommendation[],
    targetCount: number,
    offset: number
  ): SmartRecommendation[] => {
    if (pool.length === 0) return [];
    const safeOffset = pool.length > targetCount ? offset % pool.length : 0;
    const rotated =
      safeOffset === 0
        ? pool
        : [...pool.slice(safeOffset), ...pool.slice(0, safeOffset)];

    const picked: SmartRecommendation[] = [];
    const artistCount = new Map<string, number>();

    for (const item of rotated) {
      const lead = (splitArtists(item.track.artist)[0] || item.track.artist).toLowerCase();
      const count = artistCount.get(lead) || 0;
      if (count >= 2) continue;
      picked.push(item);
      artistCount.set(lead, count + 1);
      if (picked.length >= targetCount) break;
    }

    if (picked.length < targetCount) {
      const used = new Set(picked.map((p) => p.track.id));
      for (const item of rotated) {
        if (used.has(item.track.id)) continue;
        picked.push(item);
        if (picked.length >= targetCount) break;
      }
    }
    return picked;
  };

  let items: SmartRecommendation[] = [];
  if (filterMode === 'popular') {
    items = pickDiverse(popularCandidates, limit, batchOffset);
  } else if (filterMode === 'gems') {
    items = pickDiverse(gemCandidates, limit, batchOffset);
  } else {
    // Interleave Popular Matches & Hidden Gems cleanly (50/50 or proportional if one pool is smaller)
    const half = Math.ceil(limit / 2);
    const popPick = pickDiverse(popularCandidates, half + 2, batchOffset);
    const gemPick = pickDiverse(gemCandidates, half + 2, batchOffset);
    const merged: SmartRecommendation[] = [];
    const seen = new Set<string>();
    const maxLen = Math.max(popPick.length, gemPick.length);
    for (let i = 0; i < maxLen && merged.length < limit; i++) {
      if (i < popPick.length && !seen.has(popPick[i].track.id)) {
        merged.push(popPick[i]);
        seen.add(popPick[i].track.id);
      }
      if (merged.length >= limit) break;
      if (i < gemPick.length && !seen.has(gemPick[i].track.id)) {
        merged.push(gemPick[i]);
        seen.add(gemPick[i].track.id);
      }
    }
    items = merged;
  }

  return {
    profile,
    items,
    totalCandidates: scoredCandidates.length,
    popularCount: popularCandidates.length,
    gemCount: gemCandidates.length,
  };
}

export function formatPlaylistVibeLine(profile: PlaylistVibeProfile): string {
  const parts: string[] = [];
  if (profile.medianBpm > 0) {
    parts.push(`~${profile.medianBpm} BPM`);
  }
  if (profile.dominantLanguages.length > 0) {
    parts.push(formatDisplayList(profile.dominantLanguages, 2));
  }
  if (profile.topArtists.length > 0) {
    parts.push(`Voices: ${formatDisplayList(profile.topArtists, 2)}`);
  }
  return parts.join(' · ');
}
