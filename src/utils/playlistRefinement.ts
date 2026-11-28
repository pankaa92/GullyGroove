import type { Track } from '../types/music';

const DJ_OR_PARTY_REGEX =
  /\b(dj|party|club|dance\s+mashup|party\s+mix|dj\s+mix|dj\s+remix|nonstop\s+remix)\b/i;
const DJ_OR_PARTY_FALSE_POSITIVE_REGEX = /\(\s*kirik\s+party\s*\)/i;

const RETRO_ERA_REGEX =
  /\b(80s?|90s?|198\d|199\d|retro|evergreen|golden\s+era|old\s+is\s+gold|old\s+hindi|old\s+bengali|old\s+songs?|old\s+song|cassette\s+era|90s\s+hindi\s+classic|retro\s+classics?|kishore\s+kumar|kumar\s+sanu|udit\s+narayan|alka\s+yagnik|jagjit\s+singh|mohammed\s+rafi|lata\s+mangeshkar)\b/i;
const CLASSIC_WORD_REGEX = /\bclassics?\b/i;
const RETRO_FALSE_POSITIVE_REGEX = /\bold\s+skool\b/i;

const SLOW_MOOD_MISFIT_REGEX =
  /\b(2\s*am|lofi|lo-fi|hurt|pain|heartbreak|ghazal|sufi|unplugged|acoustic|sad|chillout)\b/i;
const DEVOTIONAL_REGEX =
  /\b(bhakti|bhajan|aarti|arti|chalisa|stotram|mantra|gayatri|vandana|ashtak)\b/i;

const SOUTH_LANGS = new Set(['tamil', 'telugu', 'malayalam', 'kannada']);

export function refineTrackPlaylistIds(track: Track): string[] {
  const ids = new Set<string>(track.playlistIds || []);
  const title = track.title || '';
  const genre = track.genre || '';
  const album = track.album || '';
  const lang = (track.language || '').toLowerCase();
  const metaText = `${title} ${genre} ${album}`;
  const titleAndAlbum = `${title} ${album}`;

  const isFalsePartyTitle =
    DJ_OR_PARTY_FALSE_POSITIVE_REGEX.test(title) &&
    !/\b(dj|mashup|remix|club)\b/i.test(title);

  const isExplicitDjOrParty =
    !isFalsePartyTitle && DJ_OR_PARTY_REGEX.test(metaText);

  const isRetroFalsePositive =
    RETRO_FALSE_POSITIVE_REGEX.test(title) &&
    !/(80s?|90s?|198\d|199\d|retro|classic)/i.test(title);

  const hasClassicTitle =
    CLASSIC_WORD_REGEX.test(titleAndAlbum) &&
    !(
      (lang.includes('nepali') || lang.includes('bhojpuri')) &&
      track.year >= 2005 &&
      !/\b(80s?|90s?|retro)\b/i.test(metaText)
    );

  const isRetroOrClassic =
    !isRetroFalsePositive &&
    (RETRO_ERA_REGEX.test(metaText) ||
      hasClassicTitle ||
      (track.year > 1940 && track.year <= 1999));

  // Rule 1: Songs containing DJ or Party route cleanly into Party and DJ Hits
  if (isExplicitDjOrParty) {
    ids.add('party-dj-hits');
  }

  // Rule 2: Songs containing 80/90/Classic/Retro route cleanly into Retro Classics
  if (isRetroOrClassic) {
    ids.add('90s-hindi-classics');
  }

  const isDevotionalText = DEVOTIONAL_REGEX.test(`${title} ${genre}`);
  const isDevotionalTrack = isDevotionalText || ids.has('bhakti-bhajan-aarti');

  // Rule 3: Remove slow/2AM/Lofi/Ghazal/Sufi/soft Love Mashup misfits from Party and DJ Hits
  const isSlowMood =
    SLOW_MOOD_MISFIT_REGEX.test(`${title} ${genre}`) ||
    genre.toLowerCase() === 'love mashup';
  if (isSlowMood && !isExplicitDjOrParty) {
    ids.delete('party-dj-hits');
    if (
      !isDevotionalTrack &&
      /\b(2\s*am|lofi|lo-fi|hurt|pain|heartbreak)\b/i.test(`${title} ${genre}`)
    ) {
      ids.add('2am-playlist');
    } else if (/\b(ghazal|sufi)\b/i.test(`${title} ${genre}`)) {
      ids.add('evening-daru-playlist');
    }
  }

  // Rule 4: Regional & devotional consistency
  if (Array.from(SOUTH_LANGS).some((s) => lang.includes(s))) {
    ids.add('south-hits');
  }
  if (lang.includes('bhojpuri')) {
    ids.add('bhojpuri-hits');
  }
  if (isDevotionalText && !isExplicitDjOrParty) {
    ids.add('bhakti-bhajan-aarti');
  }

  return Array.from(ids);
}

// --- Bajao-Style Smart DJ Sequencer (Harmonic Camelot Key, BPM, Energy Arc & Diversity) ---

const SEQ_WEIGHTS = {
  tempo: 0.4,
  energy: 0.25,
  key: 0.15,
  arc: 0.1,
  language: 0.05,
  artist: 0.05,
} as const;

const MAX_SAME_LANG_STREAK = 3;
const TEMPO_MIN_PENALTY = 0.03;
const TEMPO_MAX_PENALTY = 0.16;
const ENERGY_WAVE_PERIOD = 8;
const TOP_K_CANDIDATES = 4;

interface CamelotKey {
  n: number;
  mode: 'A' | 'B';
}

function parseCamelotKey(raw?: string): CamelotKey | null {
  const m = /^(1[0-2]|[1-9])([AB])$/.exec(raw || '');
  return m ? { n: Number(m[1]), mode: m[2] as 'A' | 'B' } : null;
}

function tempoTransitionCost(bpmA: number, bpmB: number): number {
  if (!bpmA || !bpmB) return 0.5;
  const logDiff = Math.abs(Math.log2(bpmB / bpmA));
  const linearRatio = Math.pow(2, logDiff) - 1;
  const octaveRatio = Math.pow(2, Math.abs(logDiff - 1)) - 1;
  const norm = (val: number) =>
    Math.min(
      1,
      Math.max(0, (val - TEMPO_MIN_PENALTY) / (TEMPO_MAX_PENALTY - TEMPO_MIN_PENALTY))
    );
  return Math.min(norm(linearRatio), norm(octaveRatio) + 0.15, 1);
}

function energyTransitionCost(energyA: number, energyB: number): number {
  const diff = energyB - energyA;
  const weighted = Math.abs(diff) * (diff < 0 ? 1.25 : 1);
  return Math.min(1, Math.max(0, (weighted - 1) / 4));
}

function targetWaveEnergy(step: number, minEnergy: number, maxEnergy: number): number {
  const mid = (minEnergy + maxEnergy) / 2;
  const amp = (maxEnergy - minEnergy) / 2;
  return mid + amp * Math.cos((2 * Math.PI * step) / ENERGY_WAVE_PERIOD);
}

function primaryArtistKey(artist: string): string {
  return (artist || '')
    .split(/,|&|\bft\.?\b|\bfeat\.?\b/i)[0]
    .trim()
    .toLowerCase();
}

function deriveTrackEnergy(track: Track): number {
  if (typeof track.energy === 'number' && Number.isFinite(track.energy)) {
    return Math.min(10, Math.max(1, track.energy));
  }
  const intensity = track.audioProfile?.intensity;
  if (typeof intensity === 'number' && Number.isFinite(intensity)) {
    return Math.min(10, Math.max(1, Math.round(intensity * 10)));
  }
  const bpm = track.bpm || 112;
  if (bpm >= 132) return 8;
  if (bpm >= 118) return 7;
  if (bpm >= 102) return 6;
  return 4;
}

interface SequencerItem {
  track: Track;
  bpm: number;
  energy: number;
  camelot: CamelotKey | null;
  lang: string;
  artistKey: string;
}

function fastCamelotCost(a: CamelotKey | null, b: CamelotKey | null): number {
  if (!a || !b) return 0.5;
  const dist = Math.min((a.n - b.n + 12) % 12, (b.n - a.n + 12) % 12);
  if (a.mode === b.mode) {
    if (dist === 0) return 0;
    if (dist === 1) return 0.1;
    if (dist === 2) return 0.45;
    return 1;
  }
  if (dist === 0) return 0.15;
  if (dist === 1) return 0.5;
  return 1;
}

function itemTransitionCost(
  from: SequencerItem,
  to: SequencerItem,
  step: number,
  energyBounds: [number, number]
): number {
  const arcCost = Math.min(
    1,
    Math.abs(to.energy - targetWaveEnergy(step, energyBounds[0], energyBounds[1])) / 4
  );
  const langSwitchCost = from.lang && to.lang && from.lang !== to.lang ? 1 : 0;
  const artistCollision = from.artistKey === to.artistKey ? 1 : 0;

  return (
    SEQ_WEIGHTS.tempo * tempoTransitionCost(from.bpm, to.bpm) +
    SEQ_WEIGHTS.energy * energyTransitionCost(from.energy, to.energy) +
    SEQ_WEIGHTS.key * fastCamelotCost(from.camelot, to.camelot) +
    SEQ_WEIGHTS.arc * arcCost +
    SEQ_WEIGHTS.language * langSwitchCost +
    SEQ_WEIGHTS.artist * artistCollision
  );
}

function createSeededRng(seedStr: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let state = h >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sequenceCache = new Map<string, Track[]>();

export function sequencePlaylistBajaoStyle(
  tracks: Track[],
  options?: {
    seedKey?: string;
    randomize?: boolean;
  }
): Track[] {
  if (tracks.length <= 2) return tracks;

  const seedKey = options?.seedKey || 'playlist';
  const cacheKey = options?.randomize
    ? ''
    : `${seedKey}:${tracks.length}:${tracks[0]?.id || ''}:${tracks[tracks.length - 1]?.id || ''}`;

  if (cacheKey) {
    const cached = sequenceCache.get(cacheKey);
    if (cached) return cached;
  }

  const rng = options?.randomize ? Math.random : createSeededRng(seedKey);
  const remaining: SequencerItem[] = tracks.map((track) => ({
    track,
    bpm: track.bpm || 112,
    energy: deriveTrackEnergy(track),
    camelot: parseCamelotKey(track.musicalKey),
    lang: (track.language || '').toLowerCase(),
    artistKey: primaryArtistKey(track.artist),
  }));

  let minE = 10;
  let maxE = 1;
  for (const item of remaining) {
    if (item.energy < minE) minE = item.energy;
    if (item.energy > maxE) maxE = item.energy;
  }
  const energyBounds: [number, number] = [minE, maxE];

  // Pick a high-energy, popular opening track from the top quartile
  const topQuartileCount = Math.max(3, Math.ceil(remaining.length / 4));
  const openers = [...remaining]
    .sort(
      (a, b) =>
        b.energy - a.energy || (b.track.plays || 0) - (a.track.plays || 0)
    )
    .slice(0, topQuartileCount);
  const opener = openers[Math.floor(rng() * openers.length)] || remaining[0];
  remaining.splice(remaining.indexOf(opener), 1);

  const ordered: Track[] = [opener.track];
  let current = opener;
  let currentLang = current.lang;
  let langStreak = 1;

  while (remaining.length > 0) {
    const step = ordered.length;
    const enforceLangSwitch = langStreak >= MAX_SAME_LANG_STREAK;
    const candidatePool: SequencerItem[] = [];

    if (remaining.length <= 160) {
      if (enforceLangSwitch) {
        for (const item of remaining) {
          if (item.lang !== currentLang) candidatePool.push(item);
        }
      }
      if (candidatePool.length === 0) {
        for (const item of remaining) candidatePool.push(item);
      }
    } else {
      const stride = Math.max(1, Math.floor(remaining.length / 120));
      const offset = step % stride;
      for (let i = offset; i < remaining.length && candidatePool.length < 120; i += stride) {
        const item = remaining[i];
        if (!enforceLangSwitch || item.lang !== currentLang) {
          candidatePool.push(item);
        }
      }
      if (candidatePool.length === 0) {
        for (let i = offset; i < remaining.length && candidatePool.length < 120; i += stride) {
          candidatePool.push(remaining[i]);
        }
      }
    }

    const scored = candidatePool
      .map((item) => ({
        item,
        cost: itemTransitionCost(current, item, step, energyBounds),
      }))
      .sort((a, b) => a.cost - b.cost)
      .slice(0, TOP_K_CANDIDATES);

    const weights = scored.map((entry) =>
      Math.exp(-(entry.cost - scored[0].cost) / 0.05)
    );
    let pickWeight = rng() * weights.reduce((acc, w) => acc + w, 0);
    let chosen = scored[0].item;
    for (let i = 0; i < scored.length; i++) {
      pickWeight -= weights[i];
      if (pickWeight <= 0) {
        chosen = scored[i].item;
        break;
      }
    }

    const chosenIdx = remaining.indexOf(chosen);
    if (chosenIdx !== -1) {
      remaining[chosenIdx] = remaining[remaining.length - 1];
      remaining.pop();
    }
    ordered.push(chosen.track);
    current = chosen;

    if (chosen.lang && chosen.lang === currentLang) {
      langStreak += 1;
    } else {
      currentLang = chosen.lang;
      langStreak = 1;
    }
  }

  if (cacheKey) {
    if (sequenceCache.size > 40) {
      sequenceCache.clear();
    }
    sequenceCache.set(cacheKey, ordered);
  }

  return ordered;
}
