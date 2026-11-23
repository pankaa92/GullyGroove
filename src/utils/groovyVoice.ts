import type { PlaylistWithStats, Track } from '../types/music';

export type GroovyIntent =
  | { type: 'wake-only' }
  | { type: 'dismiss'; reply?: string }
  | { type: 'smalltalk'; reply: string }
  | { type: 'help' }
  | { type: 'play-resume' }
  | { type: 'pause' }
  | { type: 'next' }
  | { type: 'previous' }
  | { type: 'shuffle'; enabled: boolean | 'toggle' }
  | { type: 'repeat'; mode: 'off' | 'all' | 'one' }
  | { type: 'hook-mode'; enabled: boolean }
  | { type: 'mute'; muted: boolean }
  | { type: 'volume-set'; volume01: number }
  | { type: 'volume-delta'; delta01: number }
  | { type: 'whats-playing' }
  | { type: 'favorite'; like: boolean }
  | { type: 'navigate'; target: 'discover' | 'playlists' | 'search' | 'studio' | 'minimize' }
  | { type: 'play-playlist'; playlist: PlaylistWithStats }
  | { type: 'play-track'; track: Track; queue: Track[] }
  | { type: 'search-and-play'; query: string }
  | { type: 'unknown'; raw: string };

const WAKE_WORD_PREFIX = '(?:hey|ok|okay|hi|hello|yo|oye|a|aye)';

const WAKE_WORD_CORE =
  '(?:groovy|groovie|groovey|groovi|grovy|gruvy|gruvi|groov|grooby|groobey|gravy|roovy|ruvy|roovi|ruby|rooby|rubi|roobi|gru|groo|grew\\s+we|grew\\s+be|grew\\s+v|grow\\s+we|guru\\s+ve|guru\\s+we|guru\\s+v)';

const WAKE_WORD_REGEX = new RegExp(
  `(?:\\b${WAKE_WORD_PREFIX}\\s+)?\\b${WAKE_WORD_CORE}\\b[,:;.!?]*|\\b${WAKE_WORD_PREFIX}\\s+(?:groove|grew|movie|kuroobi|guru|doobie|truly|ravi|bro)\\b[,:;.!?]*`,
  'i'
);

const WAKE_WORD_GLOBAL_REGEX = new RegExp(
  `(?:\\b${WAKE_WORD_PREFIX}\\s+)?\\b${WAKE_WORD_CORE}\\b[,:;.!?]*|\\b${WAKE_WORD_PREFIX}\\s+(?:groove|grew|movie|kuroobi|guru|doobie|truly|ravi|bro)\\b[,:;.!?]*`,
  'gi'
);

const DIRECT_PRE_WAKE_COMMAND_REGEX =
  /^(?:pause|stop|play|resume|next|skip|previous|prev|back|mute|unmute|shuffle|repeat|what(?:'s| is)? playing|hook mode|full song|volume\s+\d+|volume\s+(?:up|down)|louder|quieter)\b/i;

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      if (a[i - 1] === b[j - 1]) {
        dp[j] = prev;
      } else {
        dp[j] = 1 + Math.min(prev, dp[j], dp[j - 1]);
      }
      prev = temp;
    }
  }
  return dp[n];
}

const FUZZY_EXCLUDE = new Set([
  'great',
  'green',
  'grass',
  'grand',
  'grace',
  'grade',
  'graph',
  'group',
  'ground',
  'grow',
  'grows',
  'grown',
  'grief',
  'grill',
  'grind',
  'gully',
  'good',
  'grab',
  'gram',
]);

function findFuzzyGroovyToken(cleaned: string): { index: number; length: number } | null {
  const lower = cleaned.toLowerCase();
  if (/\bgully\s+groove\b/i.test(lower)) return null;

  const wordRegex = /\b([a-z]{4,9})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = wordRegex.exec(cleaned)) !== null) {
    const word = m[1].toLowerCase();
    if (FUZZY_EXCLUDE.has(word)) continue;
    if (word === 'groove') {
      return { index: m.index, length: m[0].length };
    }
    const looksLikeGroovy =
      word.startsWith('gr') ||
      word.endsWith('ovy') ||
      word.endsWith('uvy') ||
      word.endsWith('oovy') ||
      word.endsWith('ooby') ||
      word.endsWith('ubi');
    if (looksLikeGroovy && levenshtein(word, 'groovy') <= 2) {
      return { index: m.index, length: m[0].length };
    }
  }
  return null;
}

export function extractGroovyWakeCommand(transcript: string): {
  hasWakeWord: boolean;
  command: string;
} {
  const cleaned = transcript.trim();
  if (!cleaned) return { hasWakeWord: false, command: '' };

  let matchIndex = -1;
  let matchLength = 0;

  const match = WAKE_WORD_REGEX.exec(cleaned);
  if (match) {
    matchIndex = match.index;
    matchLength = match[0].length;
  } else {
    const fuzzy = findFuzzyGroovyToken(cleaned);
    if (fuzzy) {
      matchIndex = fuzzy.index;
      matchLength = fuzzy.length;
    }
  }

  if (matchIndex < 0) {
    return { hasWakeWord: false, command: cleaned };
  }

  const afterWake = cleaned
    .slice(matchIndex + matchLength)
    .replace(/^[,:;.!?\s]+/, '')
    .trim();

  if (afterWake) {
    return {
      hasWakeWord: true,
      command: afterWake,
    };
  }

  const beforeWake = cleaned
    .slice(0, matchIndex)
    .replace(WAKE_WORD_GLOBAL_REGEX, ' ')
    .replace(/\b(?:hey|ok|okay|hi|hello|yo|oye)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    hasWakeWord: true,
    command: DIRECT_PRE_WAKE_COMMAND_REGEX.test(beforeWake) ? beforeWake : '',
  };
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(\d{1,2})\s*:\s*00\s*(?:a\.?\s*m\.?)?/g, '$1 am')
    .replace(/\b(\d{1,2}|two|to|too|three)\s+a\.?\s*m\.?\b/g, '$1 am')
    .replace(/\ba\.m\.?/g, 'am')
    .replace(/\bp\.m\.?/g, 'pm')
    .replace(/\b90'?s\b/g, '90s')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const NUMBER_WORDS: Record<string, number> = {
  zero: 0,
  ten: 10,
  fifteen: 15,
  twenty: 20,
  twentyfive: 25,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100,
  half: 50,
  full: 100,
  max: 100,
};

function convertSpokenNumbers(norm: string): string {
  return norm
    .replace(/\btwenty\s+five\b/g, '25')
    .replace(/\bthirty\s+five\b/g, '35')
    .replace(/\bforty\s+five\b/g, '45')
    .replace(/\bfifty\s+five\b/g, '55')
    .replace(/\bsixty\s+five\b/g, '65')
    .replace(/\bseventy\s+five\b/g, '75')
    .replace(/\beighty\s+five\b/g, '85')
    .replace(/\bninety\s+five\b/g, '95')
    .replace(/\b(?:zero|ten|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)\b/g, (w) =>
      String(NUMBER_WORDS[w] ?? w)
    );
}

function stripPoliteFillers(norm: string): string {
  return norm
    .replace(
      /^(?:please\s+|ok\s+|okay\s+|hey\s+|hi\s+|buddy\s+|bro\s+|yaar\s+|can you\s+|could you\s+|would you\s+|will you\s+|i want to\s+|i would like to\s+|i wanna\s+|just\s+|go ahead and\s+|tell me\s+)+/gi,
      ''
    )
    .replace(/\s+(?:please|for me|right now|now|bro|buddy|yaar|on gullygroove)$/gi, '')
    .trim();
}

const PLAYLIST_ALIASES: Record<string, string[]> = {
  'top-50-hindi': [
    'top hindi songs',
    'top hindi',
    'top 50 hindi',
    'top fifty hindi',
    'hindi',
    'hindi songs',
    'bollywood',
    'bollywood hits',
    'top 50',
    'hindi chartbusters',
    'romantic',
    'romantic hindi',
    'love songs',
  ],
  'my-playlist': [
    'my playlist',
    'liked songs',
    'my favorites',
    'my favourites',
    'favorite songs',
    'favourite songs',
    'saved songs',
    'personal mix',
    'favorites',
    'favourites',
  ],
  'saloon-playlist': [
    'salon playlist',
    'saloon playlist',
    'salon',
    'saloon',
    'salon songs',
    'barber',
    'indipop',
    'upbeat groove',
  ],
  'bus-driver-playlist': [
    'bus driver playlist',
    'bus driver',
    'bus driver songs',
    'bus',
    'driver',
    'highway',
    'road trip',
    'travel',
    'safarnama',
    'dhaba',
    'dhabha',
    'long drive',
    'driving',
  ],
  '2am-playlist': [
    '2 am playlist',
    '2am playlist',
    '2 am',
    '2am',
    'two am',
    'two am playlist',
    'to am',
    'to am playlist',
    'too am',
    '2 am songs',
    '2am songs',
    '2 am late night',
    '3 am',
    '3am',
    'midnight',
    'late night',
    'sad',
    'chill',
    'arijit',
    'arijit singh',
  ],
  'shadi-sangeet-playlist': [
    'shadi and sangeet playlist',
    'shaadi and sangeet playlist',
    'shadi sangeet playlist',
    'shaadi sangeet playlist',
    'shadi and sangeet',
    'shaadi and sangeet',
    'shadi sangeet',
    'shaadi sangeet',
    'shadi',
    'shaadi',
    'sangeet',
    'wedding',
    'wedding and sangeet',
    'baraat',
    'haldi',
    'mehendi',
    'marriage',
  ],
  'evening-daru-playlist': [
    'evening daru playlist',
    'evening daaru playlist',
    'evening daru',
    'evening daaru',
    'daru playlist',
    'daru',
    'daaru',
    'wine',
    'drinks',
    'ghazal',
    'sufi',
    'after hours',
    'evening',
  ],
  'party-dj-hits': [
    'party and dj hits',
    'party dj hits',
    'party and dj',
    'party dj',
    'dj hits',
    'party hits',
    'party',
    'dj',
    'club',
    'bhangra',
    'dance',
    'remix',
    'mashup',
    'punjabi',
  ],
  'south-hits': [
    'south indian hits',
    'south hits',
    'south indian',
    'south beats',
    'south',
    'tamil',
    'telugu',
    'malayalam',
    'kannada',
    'anirudh',
    'kollywood',
    'tollywood',
  ],
  'nepali-northeast-hits': [
    'nepali and north east hits',
    'nepali and northeast hits',
    'nepali north east hits',
    'nepali northeast hits',
    'nepali and north east',
    'nepali north east',
    'nepali northeast',
    'north east hits',
    'northeast hits',
    'nepali',
    'north east',
    'northeast',
    'assamese',
    'manipuri',
    'seven sisters',
    'himalayan',
    'sajjan',
  ],
  'bhojpuri-hits': [
    'bhojpuri hits',
    'bhojpuri',
    'bhojpuri songs',
    'desi swag',
    'pawan singh',
    'khesari',
  ],
  '90s-hindi-classics': [
    '90s hindi classics',
    '90s classics',
    '90s hindi',
    '90s',
    '90 s',
    'nineties',
    'nineties hindi',
    '1990s',
    'retro',
    'evergreen',
    'old hindi',
    'old songs',
    'classic',
    'kumar sanu',
    'udit narayan',
  ],
  'workout-motivation': [
    'workout motivation',
    'workout',
    'motivation',
    'gym',
    'fitness',
    'exercise',
    'running',
    'adrenaline',
    'cardio',
    'training',
  ],
  'bhakti-bhajan-aarti': [
    'bhakti bhajan and aarti',
    'bhakti bhajan aarti',
    'bhakti bhajan',
    'bhakti aarti',
    'bhakti',
    'bhajan',
    'aarti',
    'arti',
    'hanuman chalisa',
    'shiv',
    'krishna',
    'devotional',
    'morning prayer',
    'god',
    'bhagwan',
  ],
  'sab-chalega': [
    'all in one',
    'all in one playlist',
    'all in one mix',
    'allinone',
    'sab chalega',
    'everything',
    'jukebox',
    'mix all',
    'anything',
    'something good',
  ],
  'bts-korean-songs': [
    'bts and korean songs',
    'bts korean songs',
    'bts and korean',
    'bts korean',
    'bts',
    'korean',
    'korean songs',
    'kpop',
    'k pop',
    'blackpink',
    'kdrama',
    'k drama',
    'bangtan',
  ],
};

function hasWholePhrase(haystack: string, needle: string): boolean {
  if (!haystack || !needle) return false;
  if (haystack === needle) return true;
  return ` ${haystack} `.includes(` ${needle} `);
}

function scoreMatch(queryNorm: string, candidateNorm: string): number {
  if (!queryNorm || !candidateNorm) return 0;
  if (candidateNorm === queryNorm) return 100;
  if (candidateNorm.startsWith(queryNorm)) return 90;
  if (hasWholePhrase(candidateNorm, queryNorm)) return 84;
  if (queryNorm.length >= 4 && candidateNorm.includes(queryNorm)) return 78;

  const qTokens = queryNorm.split(' ').filter((t) => t.length >= 2 || /^\d+$/.test(t));
  if (qTokens.length === 0) return 0;

  let matched = 0;
  for (const tok of qTokens) {
    if (hasWholePhrase(candidateNorm, tok) || (tok.length >= 3 && candidateNorm.includes(tok))) {
      matched += 1;
    } else if (tok.length >= 4) {
      const candWords = candidateNorm.split(' ');
      if (candWords.some((cw) => cw.length >= 4 && levenshtein(tok, cw) <= 1)) {
        matched += 0.85;
      }
    }
  }
  if (matched === 0) return 0;
  return Math.round((matched / qTokens.length) * 72);
}

function findBestPlaylist(
  query: string,
  playlists: PlaylistWithStats[]
): { playlist: PlaylistWithStats; score: number } | null {
  const fullNorm = normalizeText(query);
  const strippedNorm = normalizeText(
    query.replace(/\b(playlist|songs|song|hits|mix|music|play|tracks|track|some|gaana|gane|gana)\b/gi, ' ')
  );
  const candidates = Array.from(new Set([fullNorm, strippedNorm].filter(Boolean)));
  if (candidates.length === 0) return null;

  let best: { playlist: PlaylistWithStats; score: number } | null = null;

  for (const pl of playlists) {
    const titleNorm = normalizeText(pl.title);
    const moodNorm = normalizeText(pl.mood);
    const aliases = PLAYLIST_ALIASES[pl.id] || [];
    let score = 0;

    for (const qNorm of candidates) {
      score = Math.max(
        score,
        scoreMatch(qNorm, titleNorm),
        scoreMatch(qNorm, moodNorm) * 0.88
      );

      for (const alias of aliases) {
        const aliasNorm = normalizeText(alias);
        if (qNorm === aliasNorm) {
          score = Math.max(score, 100);
        } else if (hasWholePhrase(qNorm, aliasNorm) || (qNorm.length >= 3 && hasWholePhrase(aliasNorm, qNorm))) {
          score = Math.max(score, 90);
        } else {
          score = Math.max(score, scoreMatch(qNorm, aliasNorm) * 0.92);
        }
      }
    }

    if (!best || score > best.score) {
      best = { playlist: pl, score };
    }
  }

  return best && best.score >= 54 ? best : null;
}

function findBestTrack(
  query: string,
  tracks: Track[]
): { track: Track; score: number } | null {
  const qNorm = normalizeText(query);
  if (!qNorm || qNorm.length < 2) return null;

  let best: { track: Track; score: number } | null = null;

  for (const track of tracks) {
    const titleScore = scoreMatch(qNorm, normalizeText(track.title));
    const artistScore = scoreMatch(qNorm, normalizeText(track.artist)) * 0.94;
    const albumScore = scoreMatch(qNorm, normalizeText(track.album)) * 0.72;
    const combinedScore =
      scoreMatch(qNorm, normalizeText(`${track.title} ${track.artist} ${track.genre}`)) * 0.85;

    const maxScore = Math.max(titleScore, artistScore, albumScore, combinedScore);
    if (
      !best ||
      maxScore > best.score ||
      (maxScore === best.score && track.plays > best.track.plays)
    ) {
      best = { track, score: maxScore };
    }
  }

  return best && best.score >= 58 ? best : null;
}

export function doesSearchResultMatchQuery(query: string, track: Track): boolean {
  const qNorm = normalizeText(query);
  if (!qNorm) return false;
  const stopWords = new Set(['song', 'songs', 'music', 'track', 'play', 'the', 'a', 'an', 'by', 'of']);
  const tokens = qNorm
    .split(' ')
    .filter((t) => t.length >= 2 && !stopWords.has(t));
  if (tokens.length === 0) return false;
  const hay = normalizeText(`${track.title} ${track.artist} ${track.album} ${track.genre}`);
  return tokens.some(
    (tok) =>
      hay.includes(tok) ||
      (tok.length >= 4 && hay.split(' ').some((w) => w.length >= 4 && levenshtein(tok, w) <= 1))
  );
}

export function parseGroovyIntent(
  rawTranscript: string,
  playlists: PlaylistWithStats[],
  tracks: Track[]
): GroovyIntent {
  const { command } = extractGroovyWakeCommand(rawTranscript);
  const text = command.trim();
  if (!text) return { type: 'wake-only' };

  const rawNorm = convertSpokenNumbers(normalizeText(text));
  const norm = stripPoliteFillers(rawNorm) || rawNorm;

  // Dismiss / Cancel / Never mind (never search as a song)
  if (
    /^(cancel|never\s*mind|nothing|forget it|leave it|stop listening|go to sleep|no thanks|chup|bas|rehne do|nahi|no)$/.test(
      norm
    )
  ) {
    return { type: 'dismiss', reply: 'Okay, continuing.' };
  }

  // Natural greetings & small talk (never search as a song)
  if (/^(thanks|thank you|thx|shukriya|dhanyawad|awesome|great|nice|good job|cool)$/.test(norm)) {
    return { type: 'smalltalk', reply: "You're welcome! Enjoy the music." };
  }
  if (/^(how are you|how r u|whats up|what s up|who are you|what is your name)$/.test(norm)) {
    return {
      type: 'smalltalk',
      reply: "I'm Groovy, your music assistant! Say Play followed by any song or playlist.",
    };
  }
  if (/^(hello|hi|hey|namaste|good morning|good evening|good night)$/.test(norm)) {
    return {
      type: 'smalltalk',
      reply: 'Hi there! Tell me what song or playlist you want to hear.',
    };
  }

  if (/\b(what can you do|commands|how does this work|help me)\b/.test(norm) || norm === 'help') {
    return { type: 'help' };
  }

  // What's playing
  if (
    /\b(what is playing|whats playing|what s playing|what song is this|which song|which track|who sings this|who sang this|song name|track name|current song|currently playing|playing right now)\b/.test(
      norm
    )
  ) {
    return { type: 'whats-playing' };
  }

  // Favorite / Like
  if (/\b(unlike|remove from favorites|remove from favourites|remove from my playlist|dislike)\b/.test(norm)) {
    return { type: 'favorite', like: false };
  }
  if (
    /\b(like this|love this|favorite this|favourite this|save this|add to my playlist|add to favorites|add to favourites|heart this)\b/.test(
      norm
    )
  ) {
    return { type: 'favorite', like: true };
  }

  // Hook Mode vs Full Song
  if (
    /\b(hook mode off|disable hook|turn off hook|switch off hook|full song|full track|full mode|full version|play full)\b/.test(
      norm
    )
  ) {
    return { type: 'hook-mode', enabled: false };
  }
  if (/\b(hook mode|hook on|turn on hook|enable hook|chorus mode|cut mode|drop mode)\b/.test(norm)) {
    return { type: 'hook-mode', enabled: true };
  }

  // Shuffle
  if (/\b(shuffle off|turn off shuffle|disable shuffle|stop shuffle)\b/.test(norm)) {
    return { type: 'shuffle', enabled: false };
  }
  if (/\b(shuffle on|turn on shuffle|enable shuffle|shuffle songs|shuffle playlist|shuffle)\b/.test(norm)) {
    return {
      type: 'shuffle',
      enabled: norm === 'shuffle' ? 'toggle' : true,
    };
  }

  // Repeat
  if (/\b(repeat off|turn off repeat|stop repeat|no repeat|disable repeat)\b/.test(norm)) {
    return { type: 'repeat', mode: 'off' };
  }
  if (/\b(repeat one|repeat this|loop this|loop song|repeat song)\b/.test(norm)) {
    return { type: 'repeat', mode: 'one' };
  }
  if (/\b(repeat all|repeat on|turn on repeat|loop all|loop playlist)\b/.test(norm)) {
    return { type: 'repeat', mode: 'all' };
  }

  // Mute / Unmute
  if (/\b(unmute|sound on|volume on|sound back on)\b/.test(norm)) {
    return { type: 'mute', muted: false };
  }
  if (/\b(mute|silence|turn off sound|mute audio|mute music)\b/.test(norm)) {
    return { type: 'mute', muted: true };
  }

  // Explicit Volume % (supports "volume 70", "set volume to 80 percent", "70 percent volume", "half volume")
  const volNumMatch =
    norm.match(/\b(?:volume|sound|level)\s*(?:to|at|is)?\s*(\d{1,3})\b/) ||
    norm.match(/\b(\d{1,3})\s*(?:percent|%)\s*(?:volume|sound)?\b/);
  if (volNumMatch) {
    const pct = Math.max(0, Math.min(100, Number(volNumMatch[1])));
    return { type: 'volume-set', volume01: pct / 100 };
  }
  if (/\b(half volume|volume half|fifty percent)\b/.test(norm)) {
    return { type: 'volume-set', volume01: 0.5 };
  }
  if (
    /\b(volume up|louder|increase volume|increase the volume|turn up|turn it up|raise volume|raise the volume|max volume|full volume|awaz badhao)\b/.test(
      norm
    )
  ) {
    return norm.includes('max') || norm.includes('full')
      ? { type: 'volume-set', volume01: 1 }
      : { type: 'volume-delta', delta01: 0.2 };
  }
  if (
    /\b(volume down|quieter|softer|decrease volume|decrease the volume|lower volume|lower the volume|turn down|turn it down|lower it|awaz kam)\b/.test(
      norm
    )
  ) {
    return { type: 'volume-delta', delta01: -0.2 };
  }

  // Next / Previous
  if (
    /^(next|skip|next song|next track|skip song|skip track|skip this|next one|agla gana|agla)$/.test(
      norm
    ) ||
    /\b(play next|skip this|skip to next|change song|change this song|change the song|another song|play something else|next song|next track)\b/.test(
      norm
    )
  ) {
    return { type: 'next' };
  }
  if (
    /^(previous|prev|back|last song|previous song|previous track|go back|pichla gana|pichla)$/.test(
      norm
    ) ||
    /\b(previous song|previous track|play previous|last song|go back to previous)\b/.test(norm)
  ) {
    return { type: 'previous' };
  }

  // Pause / Resume
  if (
    /^(pause|stop|pause music|stop music|pause song|stop song|pause it|stop it|stop playing|pause playing|hold on|wait|ruko|band karo)$/.test(
      norm
    ) ||
    /\b(pause the music|pause the song|stop the music|stop the song|stop playing)\b/.test(norm)
  ) {
    return { type: 'pause' };
  }
  if (
    /^(play|resume|start|start music|resume music|continue|play music|play it|unpause|resume playing|chalao|chala do)$/.test(
      norm
    ) ||
    /\b(resume the music|resume the song|continue playing)\b/.test(norm)
  ) {
    return { type: 'play-resume' };
  }

  // Navigation
  if (/\b(open|go to|show|take me to)\s+(?:the\s+)?(discover|home)\b/.test(norm)) {
    return { type: 'navigate', target: 'discover' };
  }
  if (/\b(open|go to|show|take me to)\s+(?:the\s+)?(playlists|all playlists)\b/.test(norm)) {
    return { type: 'navigate', target: 'playlists' };
  }
  if (/\b(open|go to|show|take me to)\s+(?:the\s+)?(search)\b/.test(norm)) {
    return { type: 'navigate', target: 'search' };
  }
  if (/\b(open studio|expand player|full player|show studio|open console|open player)\b/.test(norm)) {
    return { type: 'navigate', target: 'studio' };
  }
  if (/\b(minimize player|hide player|close studio|close player)\b/.test(norm)) {
    return { type: 'navigate', target: 'minimize' };
  }

  // Play / Search media queries
  const explicitPlayRequest =
    /\b(play|put on|put|listen|hear|start playing|start|switch to|change to|turn on|queue|search|find|bajao|sunao|lagao|chala do)\b/i.test(
      norm
    );

  const rawMediaQuery = norm
    .replace(
      /^(?:can you\s+|could you\s+|would you\s+|i want to\s+|i would like to\s+|i wanna\s+|let s\s+|please\s+)?(?:play|put on|put|listen to|hear|start playing|start|switch to|change to|turn on|queue|run|open|search for|search|find|bajao|sunao|lagao|chala do)\s+(?:(?:songs?|tracks?|music)\s+(?:from|of)\s+|from\s+)?(?:some\s+|the\s+|a\s+)?/i,
      ''
    )
    .replace(/\b(?:on gullygroove|in background|please)\b/gi, ' ')
    .replace(/\s+(?:on|now)$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  const mediaQuery = rawMediaQuery
    .replace(/\b(?:playlist|songs|song|music|tracks|track)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const effectiveQuery = mediaQuery || rawMediaQuery || norm;
  const playlistQuery = rawMediaQuery || norm;
  const wantsPlaylistExplicitly = /\bplaylist\b/i.test(text);

  const bestPlaylist = findBestPlaylist(playlistQuery, playlists);
  const bestTrack = findBestTrack(effectiveQuery, tracks);

  if (wantsPlaylistExplicitly && bestPlaylist) {
    return { type: 'play-playlist', playlist: bestPlaylist.playlist };
  }

  if (bestPlaylist && (!bestTrack || bestPlaylist.score >= bestTrack.score)) {
    return { type: 'play-playlist', playlist: bestPlaylist.playlist };
  }

  if (bestTrack) {
    const firstPlaylistId = bestTrack.track.playlistIds[0];
    const siblingQueue = firstPlaylistId
      ? tracks.filter((t) => t.playlistIds.includes(firstPlaylistId))
      : tracks.slice(0, 60);
    return {
      type: 'play-track',
      track: bestTrack.track,
      queue: siblingQueue.length > 0 ? siblingQueue : [bestTrack.track],
    };
  }

  // Anti-random-song guard: only search external providers if the user explicitly asked to play/find music
  const isConversationalQuestion =
    /^(?:who|what|why|how|when|where|which|can|could|would|do|did|are|is)\b/i.test(norm);

  if (explicitPlayRequest && effectiveQuery.length >= 2 && !isConversationalQuestion) {
    return { type: 'search-and-play', query: effectiveQuery };
  }

  return { type: 'unknown', raw: text };
}

export interface ServerInterpretedAction {
  action:
    | 'play_playlist'
    | 'play_query'
    | 'pause'
    | 'resume'
    | 'next'
    | 'previous'
    | 'shuffle'
    | 'repeat'
    | 'hook_mode'
    | 'mute'
    | 'volume_set'
    | 'volume_delta'
    | 'whats_playing'
    | 'favorite'
    | 'navigate'
    | 'smalltalk'
    | 'dismiss'
    | 'unknown';
  playlistId?: string;
  query?: string;
  boolValue?: boolean;
  repeatMode?: 'off' | 'all' | 'one';
  volumePercent?: number;
  volumeDeltaPercent?: number;
  navTarget?: 'discover' | 'playlists' | 'search' | 'studio' | 'minimize';
  reply: string;
}

let serverAiUnavailable = false;

export async function interpretGroovyCommandWithAI(params: {
  transcript: string;
  playlists: PlaylistWithStats[];
  currentTrack: Track | null;
}): Promise<ServerInterpretedAction | null> {
  if (serverAiUnavailable || typeof window === 'undefined') return null;
  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 5000);
    const res = await fetch('/api/groovy/interpret', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        transcript: params.transcript,
        playlists: params.playlists.map((p) => ({
          id: p.id,
          title: p.title,
          mood: p.mood,
        })),
        currentTrack: params.currentTrack
          ? { title: params.currentTrack.title, artist: params.currentTrack.artist }
          : null,
      }),
    });
    window.clearTimeout(timer);
    if (res.status === 503 || res.status === 404) {
      serverAiUnavailable = true;
      return null;
    }
    if (!res.ok) return null;
    const data = (await res.json()) as {
      available?: boolean;
      result?: ServerInterpretedAction;
    };
    return data.result || null;
  } catch {
    return null;
  }
}

export function playGroovyWakeChime(): void {
  if (typeof window === 'undefined') return;
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.type = 'sine';
    osc2.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, now); // D5
    osc2.frequency.setValueAtTime(880, now + 0.08); // A5

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.11, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);

    osc1.start(now);
    osc1.stop(now + 0.11);
    osc2.start(now + 0.08);
    osc2.stop(now + 0.25);

    window.setTimeout(() => {
      ctx.close().catch(() => {});
    }, 350);
  } catch {
    // Ignore WebAudio blocks
  }
}

const INDIAN_FEMALE_VOICE_HINTS =
  /neerja|ananya|kavya|aashi|swara|aditi|raveena|veena|lekha|heera|priya|kajal|isha|meera|tara|sangeeta|kalpana|shruti|divya|nisha|anita|vani|vidya|en-in-x-ene|en-in-x-enc|en-in-x-ena|en-in-x-ahp/i;

const NATURAL_FEMALE_VOICE_HINTS =
  /google uk english female|google us english|aria|jenny|sara|michelle|ana|neerja|ananya|kavya|aashi|swara|aditi|raveena|veena|lekha|samantha|ava|allison|sonia|libby|maisie|hazel|susan|zoe|emma|olivia|clara|natasha|hayley|catherine|fiona|kate|martha|heera|priya|kajal|isha|meera|tara|sangeeta|kalpana|shruti|divya|nisha|anita|vani|vidya|karen|moira|tessa|serena|victoria|zira|female|woman|en-in-x-ene|en-in-x-enc|en-in-x-ena|en-in-x-ahp/i;

const ROBOTIC_VOICE_HINTS = /espeak|compact|festival|mbrola|speech-dispatcher/i;

const MALE_VOICE_HINTS =
  /\bmale\b|\bman\b|\bboy\b|rishi|prabhat|madhur|neil|arjun|vikram|rohan|hemant|ravi|aarav|kunal|kabir|dev|surya|aryan|vihaan|anirudh|mohan|suresh|en-in-x-end|en-in-x-enb|daniel|alex|fred|tom|oliver|george|arthur|ryan|guy|david|mark|james|christopher|eric|andrew|brian|roger|steffan|aaron|nicky|albert|reed|rocko|eddy|grandpa|jacques|sandy|shelley|bad news|bahh|bells|boing|bubbles|cellos|deranged|good news|hysterical|jester|junior/i;

let lockedGroovyVoiceURI: string | null = null;
let hasSpokenWithBrowserVoice = false;

function pickNaturalFemaleGroovyVoice(voices: SpeechSynthesisVoice[]): {
  voice: SpeechSynthesisVoice | null;
  isLikelyFemale: boolean;
  isNeuralOrNatural: boolean;
} {
  if (!voices || voices.length === 0) {
    return { voice: null, isLikelyFemale: false, isNeuralOrNatural: false };
  }

  // Once Groovy has spoken, keep using the exact same verified female voice for all responses
  if (hasSpokenWithBrowserVoice && lockedGroovyVoiceURI) {
    const locked = voices.find((v) => v.voiceURI === lockedGroovyVoiceURI);
    if (locked) {
      const lockedName = (locked.name || '').toLowerCase();
      return {
        voice: locked,
        isLikelyFemale: true,
        isNeuralOrNatural:
          /natural|neural|online|enhanced|premium|google/i.test(lockedName) || !locked.localService,
      };
    }
  }

  let bestVoice: SpeechSynthesisVoice | null = null;
  let bestScore = -999;

  for (const voice of voices) {
    const lang = (voice.lang || '').toLowerCase();
    const name = (voice.name || '').toLowerCase();
    const isEnglish = lang.startsWith('en');
    const isIndianEnglish = lang === 'en-in' || lang.startsWith('en_in') || /\bindia\b/i.test(name);
    const isOtherMainEnglish = lang === 'en-us' || lang === 'en-gb';

    const isMale = MALE_VOICE_HINTS.test(name);
    const isIndianFemale =
      !isMale &&
      (INDIAN_FEMALE_VOICE_HINTS.test(name) ||
        (isIndianEnglish && /\b(female|woman|girl)\b/i.test(name)));
    const isFemale = !isMale && (NATURAL_FEMALE_VOICE_HINTS.test(name) || isIndianFemale);
    const isNatural = /natural|neural|online|enhanced|premium|google/i.test(name);
    const isRobotic = ROBOTIC_VOICE_HINTS.test(name);

    let score = isEnglish ? 25 : -300;
    if (isOtherMainEnglish) score += 10;

    if (isMale) {
      score -= 500;
    } else if (isIndianFemale) {
      // Top priority: explicitly verified Indian female voice
      score += 300;
    } else if (isFemale) {
      // Second priority: explicitly verified natural English female voice (never an unknown male voice)
      score += 180;
    } else if (isIndianEnglish) {
      // Unverified en-IN voice could be male on Android/Chrome; never let it beat a verified female voice
      score += 5;
    }

    if (!isMale && isNatural) {
      score += isFemale ? 55 : 15;
    }

    if (!voice.localService && !isMale) {
      score += 20;
    }

    if (isRobotic) {
      score -= 150;
    }

    if (score > bestScore) {
      bestScore = score;
      bestVoice = voice;
    }
  }

  const chosenName = (bestVoice?.name || '').toLowerCase();
  const isLikelyFemale =
    Boolean(bestVoice) &&
    (NATURAL_FEMALE_VOICE_HINTS.test(chosenName) || INDIAN_FEMALE_VOICE_HINTS.test(chosenName)) &&
    !MALE_VOICE_HINTS.test(chosenName);
  const isNeuralOrNatural =
    Boolean(bestVoice) &&
    (/natural|neural|online|enhanced|premium|google/i.test(chosenName) || !bestVoice?.localService);

  if (bestVoice && isLikelyFemale) {
    lockedGroovyVoiceURI = bestVoice.voiceURI;
  }

  return { voice: bestVoice, isLikelyFemale, isNeuralOrNatural };
}

if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  const initialVoices = window.speechSynthesis.getVoices();
  if (initialVoices.length > 0) {
    pickNaturalFemaleGroovyVoice(initialVoices);
  }
  window.speechSynthesis.addEventListener?.('voiceschanged', () => {
    const updatedVoices = window.speechSynthesis.getVoices();
    if (updatedVoices.length > 0) {
      pickNaturalFemaleGroovyVoice(updatedVoices);
    }
  });
}

let activeTtsAudio: HTMLAudioElement | null = null;
let activeTtsAbort: AbortController | null = null;
let activeSpeechToken = 0;
let serverTtsUnavailable = false;
const clientTtsUrlCache = new Map<string, string>();

export function stopGroovySpeech(): void {
  activeSpeechToken += 1;
  if (activeTtsAbort) {
    activeTtsAbort.abort();
    activeTtsAbort = null;
  }
  if (activeTtsAudio) {
    try {
      activeTtsAudio.pause();
      activeTtsAudio.src = '';
    } catch {
      // ignore
    }
    activeTtsAudio = null;
  }
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      // ignore
    }
  }
}

function getVoicesWithWait(callback: (voices: SpeechSynthesisVoice[]) => void): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    callback([]);
    return;
  }
  const immediate = window.speechSynthesis.getVoices();
  if (immediate.length > 0) {
    callback(immediate);
    return;
  }

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    window.speechSynthesis.removeEventListener?.('voiceschanged', onVoices);
    callback(window.speechSynthesis.getVoices());
  };
  const onVoices = () => {
    if (window.speechSynthesis.getVoices().length > 0) {
      finish();
    }
  };
  window.speechSynthesis.addEventListener?.('voiceschanged', onVoices);
  window.setTimeout(finish, 320);
}

function speakWithBrowserFallback(
  text: string,
  token: number,
  callbacks?: { onStart?: () => void; onEnd?: () => void }
): void {
  if (
    token !== activeSpeechToken ||
    typeof window === 'undefined' ||
    !('speechSynthesis' in window) ||
    !text.trim()
  ) {
    callbacks?.onEnd?.();
    return;
  }

  getVoicesWithWait((voices) => {
    if (token !== activeSpeechToken) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.02;
      utterance.volume = 0.95;

      const { voice, isLikelyFemale, isNeuralOrNatural } = pickNaturalFemaleGroovyVoice(voices);
      if (voice) {
        utterance.voice = voice;
        // Match the selected voice's exact lang so Chrome never overrides it with a default male voice
        utterance.lang = voice.lang || 'en-US';
        if (isLikelyFemale) {
          lockedGroovyVoiceURI = voice.voiceURI;
          hasSpokenWithBrowserVoice = true;
        }
      }
      // Normal, bright everyday female tone
      utterance.pitch = isNeuralOrNatural ? 1.0 : isLikelyFemale ? 1.02 : 1.08;

      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        callbacks?.onEnd?.();
      };

      utterance.onstart = () => {
        callbacks?.onStart?.();
      };
      utterance.onend = finish;
      utterance.onerror = finish;

      window.setTimeout(finish, Math.max(2500, text.length * 95));
      callbacks?.onStart?.();
      window.speechSynthesis.speak(utterance);
    } catch {
      callbacks?.onEnd?.();
    }
  });
}

export function speakGroovyReply(
  text: string,
  callbacks?: { onStart?: () => void; onEnd?: () => void }
): void {
  const cleanText = text.trim();
  if (typeof window === 'undefined' || !cleanText) {
    callbacks?.onEnd?.();
    return;
  }

  stopGroovySpeech();
  const token = activeSpeechToken;

  const playBlobUrl = (blobUrl: string) => {
    if (token !== activeSpeechToken) return;
    const audio = new Audio(blobUrl);
    audio.volume = 0.96;
    activeTtsAudio = audio;

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (activeTtsAudio === audio) activeTtsAudio = null;
      callbacks?.onEnd?.();
    };

    audio.onended = finish;
    audio.onerror = () => {
      if (activeTtsAudio === audio) activeTtsAudio = null;
      if (!finished) {
        finished = true;
        speakWithBrowserFallback(cleanText, token, callbacks);
      }
    };

    callbacks?.onStart?.();
    audio.play().catch(() => {
      if (activeTtsAudio === audio) activeTtsAudio = null;
      if (!finished) {
        finished = true;
        speakWithBrowserFallback(cleanText, token, callbacks);
      }
    });
  };

  if (serverTtsUnavailable) {
    speakWithBrowserFallback(cleanText, token, callbacks);
    return;
  }

  const cacheKey = cleanText.toLowerCase();
  const cachedUrl = clientTtsUrlCache.get(cacheKey);
  if (cachedUrl) {
    playBlobUrl(cachedUrl);
    return;
  }

  const controller = new AbortController();
  activeTtsAbort = controller;
  const timeout = window.setTimeout(() => controller.abort(), 7500);

  fetch('/api/groovy/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: controller.signal,
    body: JSON.stringify({ text: cleanText }),
  })
    .then(async (res) => {
      window.clearTimeout(timeout);
      if (activeTtsAbort === controller) activeTtsAbort = null;
      if (token !== activeSpeechToken) return;

      if (res.status === 503 || res.status === 404 || res.status === 501) {
        serverTtsUnavailable = true;
        speakWithBrowserFallback(cleanText, token, callbacks);
        return;
      }
      if (!res.ok) {
        speakWithBrowserFallback(cleanText, token, callbacks);
        return;
      }

      const wavBlob = await res.blob();
      if (token !== activeSpeechToken) return;
      const objectUrl = URL.createObjectURL(wavBlob);
      if (clientTtsUrlCache.size >= 40) {
        const oldest = clientTtsUrlCache.keys().next().value;
        if (oldest) {
          const oldUrl = clientTtsUrlCache.get(oldest);
          if (oldUrl) URL.revokeObjectURL(oldUrl);
          clientTtsUrlCache.delete(oldest);
        }
      }
      clientTtsUrlCache.set(cacheKey, objectUrl);
      playBlobUrl(objectUrl);
    })
    .catch(() => {
      window.clearTimeout(timeout);
      if (activeTtsAbort === controller) activeTtsAbort = null;
      if (token === activeSpeechToken) {
        speakWithBrowserFallback(cleanText, token, callbacks);
      }
    });
}
