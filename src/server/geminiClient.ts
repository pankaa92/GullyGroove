import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

let cachedClient: GoogleGenAI | null = null;
let cachedApiKey = '';

export function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim() || '';
  if (!apiKey) return null;
  if (!cachedClient || cachedApiKey !== apiKey) {
    cachedClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
    cachedApiKey = apiKey;
  }
  return cachedClient;
}

export interface InterpretedGroovyAction {
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

export async function interpretGroovyWithGemini(input: {
  transcript: string;
  playlists: Array<{ id: string; title: string; mood: string }>;
  currentTrack?: { title: string; artist: string } | null;
}): Promise<InterpretedGroovyAction | null> {
  const ai = getGeminiClient();
  if (!ai) return null;

  const playlistList = input.playlists
    .map((p) => `- id: "${p.id}", title: "${p.title}", mood: "${p.mood}"`)
    .join('\n');

  const nowPlayingText = input.currentTrack
    ? `${input.currentTrack.title} by ${input.currentTrack.artist}`
    : 'Nothing currently playing';

  const systemInstruction = `You are Groovy, a smart, warm female voice assistant inside the GullyGroove music streaming app.
Interpret the user's spoken command accurately—even with Indian-English speech-to-text quirks or Hinglish phrases—and map it to one structured player action.
Common Indian-English voice-to-text quirks to normalize mentally:
- "arjit", "arijeet", "are jeet", "arey jeet", "hare jeet", "arijit sing" -> artist "Arijit Singh"
- "bangla", "bangali", "bengoli" -> "Bengali"
- "shaadi", "sadi" -> "Shadi"
- "bhakthi" -> "Bhakti"
- "do baje" -> "2 AM"
- Hinglish verbs like "chalao", "bajao", "sunao", "lagao", "play karo" mean play; "ruko" / "band karo" mean pause; "agla gana" means next; "awaz kam/badhao" means volume down/up.

CRITICAL distinction:
- If the user asks for a specific singer or artist (e.g., "play arijit songs", "arijit singh ke gane chalao", "play kishore kumar", "play ali zafar", "play diljit"), ALWAYS return action "play_query" with that clean artist name (e.g. query: "Arijit Singh"), NOT "play_playlist" ("2am-playlist")!
- If the user asks for a language/style collection without a playlist name (e.g., "play bengali songs"), return action "play_query" with query: "Bengali" unless a playlist directly represents it (like "hindi", "south", "bhojpuri", "korean").
- Only return "play_playlist" when they ask for a mood, occasion, or named playlist (e.g. "2 AM playlist", "late night", "wedding sangeet", "gym workout", "90s classics", "bhakti", "bus driver", "party dj").
- Never turn conversational chatter, questions, greetings, or unclear noise into play_query unless the user actually wants to play or search for music.
Keep "reply" to 1 short, natural, friendly spoken sentence (under 10 words when possible) without emojis or markdown.

Available playlists:
${playlistList}

Current track: ${nowPlayingText}`;

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: `User said: "${input.transcript}"`,
    config: {
      systemInstruction,
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          action: {
            type: Type.STRING,
            enum: [
              'play_playlist',
              'play_query',
              'pause',
              'resume',
              'next',
              'previous',
              'shuffle',
              'repeat',
              'hook_mode',
              'mute',
              'volume_set',
              'volume_delta',
              'whats_playing',
              'favorite',
              'navigate',
              'smalltalk',
              'dismiss',
              'unknown',
            ],
          },
          playlistId: {
            type: Type.STRING,
            description: 'Exact id from the playlist list when action is play_playlist.',
          },
          query: {
            type: Type.STRING,
            description: 'Clean song or artist query when action is play_query.',
          },
          boolValue: {
            type: Type.BOOLEAN,
            description:
              'Boolean flag for shuffle, hook_mode, mute, or favorite (true=like, false=unlike).',
          },
          repeatMode: {
            type: Type.STRING,
            enum: ['off', 'all', 'one'],
          },
          volumePercent: {
            type: Type.INTEGER,
            description: '0-100 when action is volume_set.',
          },
          volumeDeltaPercent: {
            type: Type.INTEGER,
            description: 'Positive or negative step (e.g. 20 or -20) when action is volume_delta.',
          },
          navTarget: {
            type: Type.STRING,
            enum: ['discover', 'playlists', 'search', 'studio', 'minimize'],
          },
          reply: {
            type: Type.STRING,
            description: 'Short, warm spoken confirmation sentence.',
          },
        },
        required: ['action', 'reply'],
      },
    },
  });

  const text = (response.text ?? '').trim();
  if (!text) return null;
  return JSON.parse(text) as InterpretedGroovyAction;
}

const ttsCache = new Map<string, Buffer>();
const MAX_TTS_CACHE_ITEMS = 60;

export async function synthesizeGroovySpeechWav(text: string): Promise<Buffer | null> {
  const ai = getGeminiClient();
  if (!ai) return null;

  const cleanText = text.trim().slice(0, 260);
  if (!cleanText) return null;

  const cacheKey = `in-normal-kore:${cleanText.toLowerCase()}`;
  const cached = ttsCache.get(cacheKey);
  if (cached) {
    // Refresh LRU order
    ttsCache.delete(cacheKey);
    ttsCache.set(cacheKey, cached);
    return cached;
  }

  const response = await ai.models.generateContent({
    model: 'gemini-3.8-flash-lite-tts',
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: cleanText,
            speechMetadata: {
              style:
                'Clear, natural, cheerful young Indian female assistant voice, upbeat and friendly everyday conversational tone',
            },
          },
        ],
      },
    ],
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: 'Kore' },
        },
      },
    },
  });

  const base64Audio =
    response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!base64Audio) return null;

  const wavBuffer = Buffer.from(base64Audio, 'base64');
  if (ttsCache.size >= MAX_TTS_CACHE_ITEMS) {
    const oldestKey = ttsCache.keys().next().value;
    if (oldestKey) ttsCache.delete(oldestKey);
  }
  ttsCache.set(cacheKey, wavBuffer);
  return wavBuffer;
}
