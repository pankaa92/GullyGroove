import type { AudioProfile, MusicalScale } from '../types/music';

const SCALE_RATIOS: Record<MusicalScale, number[]> = {
  // Yaman (Lydian feel — romantic & soulful Bollywood)
  yaman: [1, 9 / 8, 5 / 4, 45 / 32, 3 / 2, 27 / 16, 15 / 8, 2],
  // Bhairavi (Phrygian feel — Sufi, nostalgic highway, evening ghazal)
  bhairavi: [1, 16 / 15, 6 / 5, 4 / 3, 3 / 2, 8 / 5, 9 / 5, 2],
  // Major Pentatonic (Punjabi folk, joyful pop)
  pentatonic: [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3, 2],
  // Natural Minor (Workout, intense bass)
  minor: [1, 9 / 8, 6 / 5, 4 / 3, 3 / 2, 8 / 5, 9 / 5, 2],
  // Major (Evergreen / Acoustic traveling)
  major: [1, 9 / 8, 5 / 4, 4 / 3, 3 / 2, 5 / 3, 15 / 8, 2],
  // Dorian (Modern Indipop / Global synth-pop)
  dorian: [1, 9 / 8, 6 / 5, 4 / 3, 3 / 2, 5 / 3, 9 / 5, 2],
};

// Deterministic pseudo-random generator seeded by trackId
function createRng(seedStr: string): () => number {
  let hash = 2166136261;
  for (let i = 0; i < seedStr.length; i++) {
    hash ^= seedStr.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return () => {
    hash += 0x6d2b79f5;
    let t = Math.imul(hash ^ (hash >>> 15), 1 | hash);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const wavCache = new Map<string, Buffer>();

export function generateTrackWav(
  trackId: string,
  durationSec: number,
  profile: AudioProfile
): Buffer {
  const clampedDuration = Math.max(30, Math.min(durationSec, 420));
  const cacheKey = `${trackId}:${clampedDuration}:${profile.bpm}:${profile.groove}`;
  const cached = wavCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const sampleRate = 22050;
  const totalSamples = Math.floor(sampleRate * clampedDuration);
  const numChannels = 1;
  const bitsPerSample = 16;
  const dataSize = totalSamples * numChannels * (bitsPerSample / 8);
  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF / WAVE Header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * numChannels * (bitsPerSample / 8), 28);
  buffer.writeUInt16LE(numChannels * (bitsPerSample / 8), 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  const scale = SCALE_RATIOS[profile.scale] || SCALE_RATIOS.yaman;
  const rng = createRng(trackId);
  const beatDur = 60 / profile.bpm;
  const stepDur = beatDur / 2; // 8th-note grid

  // Compose distinct Verse, Chorus, and Bridge motifs for full-song progression
  const motifLength = 16;
  const verseMotif: number[] = [];
  const chorusMotif: number[] = [];
  const bridgeMotif: number[] = [];

  let cursorA = 0;
  let cursorB = Math.min(2, scale.length - 1);
  let cursorC = Math.min(3, scale.length - 1);

  for (let i = 0; i < motifLength; i++) {
    cursorA = Math.max(0, Math.min(scale.length - 1, cursorA + (Math.floor(rng() * 3) - 1)));
    cursorB = Math.max(1, Math.min(scale.length - 1, cursorB + (Math.floor(rng() * 5) - 2)));
    cursorC = Math.max(0, Math.min(scale.length - 1, cursorC + (Math.floor(rng() * 3) - 1)));
    verseMotif.push(cursorA);
    chorusMotif.push(cursorB);
    bridgeMotif.push(cursorC);
  }

  // Verse & Chorus chord progressions
  const verseChords = [0, 3, 2, 4].map(
    (idx) => profile.rootHz * scale[idx % scale.length] * 0.5
  );
  const chorusChords = [0, 4, 5 % scale.length, 3].map(
    (idx) => profile.rootHz * scale[idx % scale.length] * 0.5
  );

  const isDhol = profile.groove === 'punjabi-dhol';
  const isWorkout = profile.groove === 'workout-edm';
  const isLofi = profile.groove === 'lofi-ambient' || profile.groove === 'sufi-chill';
  const isRetro = profile.groove === 'retro-vinyl' || profile.groove === 'highway-folk';

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    const progress = t / clampedDuration; // 0..1 across full song

    // Full-song structural arrangement:
    // 0.00-0.08 Intro | 0.08-0.28 Verse 1 | 0.28-0.46 Chorus 1
    // 0.46-0.60 Instrumental Bridge | 0.60-0.76 Verse 2
    // 0.76-0.94 Final Chorus | 0.94-1.00 Outro
    const isIntro = progress < 0.08;
    const isChorus = (progress >= 0.28 && progress < 0.46) || (progress >= 0.76 && progress < 0.94);
    const isBridge = progress >= 0.46 && progress < 0.60;
    const isOutro = progress >= 0.94;

    const stepIndex = Math.floor(t / stepDur);
    const stepTime = t - stepIndex * stepDur;
    const stepPhase = stepTime / stepDur;

    const barIndex = Math.floor(stepIndex / 8);
    const activeChords = isChorus ? chorusChords : verseChords;
    const chordHz = activeChords[barIndex % activeChords.length];

    // 1. Warm Chord Pad / Tanpura Drone
    const padEnv = (isChorus ? 0.28 : 0.21) + 0.05 * Math.sin(2 * Math.PI * 0.22 * t);
    const pad =
      (Math.sin(2 * Math.PI * chordHz * t) +
        0.55 * Math.sin(2 * Math.PI * chordHz * 1.5 * t) +
        (isChorus ? 0.42 : 0.28) * Math.sin(2 * Math.PI * chordHz * 2 * t)) *
      padEnv *
      0.32;

    // 2. Melodic Lead (switches motif & octave lift per song section)
    const activeMotif = isChorus ? chorusMotif : isBridge ? bridgeMotif : verseMotif;
    const noteDegree = activeMotif[stepIndex % motifLength];
    const octaveMult = isLofi ? (isChorus ? 1.5 : 1) : isChorus ? 2 : 1.5;
    const leadHz = profile.rootHz * scale[noteDegree] * octaveMult;
    const vibrato = isLofi || isRetro || isBridge ? Math.sin(2 * Math.PI * 5.2 * t) * 2.2 : 0;
    const noteAttack = Math.min(1, stepTime / 0.02);
    const noteDecay = Math.exp(-stepTime * (isDhol ? 8.2 : isLofi ? 3.0 : 4.6));
    const harmonic = isDhol
      ? Math.sin(2 * Math.PI * (leadHz * 2) * t) * 0.42
      : Math.sin(2 * Math.PI * (leadHz * 1.5) * t) * (isChorus ? 0.28 : 0.16);

    // Sparse rest pattern in intro/outro for breathing room
    const leadGate = isIntro && stepIndex % 4 === 3 ? 0.2 : isOutro ? 0.65 : 1;
    const lead =
      (Math.sin(2 * Math.PI * (leadHz + vibrato) * t) + harmonic) *
      noteAttack *
      noteDecay *
      0.36 *
      leadGate;

    // 3. Groove Bassline (drops out gently during intro & outro)
    const bassHit = stepIndex % 2 === 0;
    const bassEnv = bassHit ? Math.exp(-stepTime * (isWorkout ? 7 : 5)) : 0.18;
    const bassPresence = isIntro ? 0.25 : isBridge ? 0.55 : isOutro ? 0.35 : 1;
    const bass =
      Math.sin(2 * Math.PI * chordHz * 0.5 * t) *
      bassEnv *
      (isLofi ? 0.24 : 0.44) *
      bassPresence;

    // 4. Percussion Layer (builds after Intro, peaks in Chorus, strips back in Bridge)
    let perc = 0;
    const beatInBar = stepIndex % 8;
    const percPresence = isIntro || isOutro ? 0.25 : isBridge ? 0.45 : isChorus ? 1.15 : 0.9;

    if (!isLofi) {
      const isKick = isDhol
        ? beatInBar === 0 || beatInBar === 3 || beatInBar === 4 || beatInBar === 6
        : beatInBar === 0 || beatInBar === 4;
      if (isKick && stepTime < 0.14) {
        const kickFreq = 115 * Math.exp(-stepTime * 28) + 42;
        perc +=
          Math.sin(2 * Math.PI * kickFreq * stepTime) *
          Math.exp(-stepTime * 18) *
          0.55 *
          percPresence;
      }
      if ((beatInBar === 2 || beatInBar === 6) && stepTime < 0.09) {
        const tablaTone = Math.sin(2 * Math.PI * 240 * stepTime) * 0.25;
        const crispNoise = ((Math.sin(i * 12.9898) * 43758.5453) % 1) * 0.2;
        perc += (tablaTone + crispNoise) * Math.exp(-stepTime * 28) * percPresence;
      }
    } else if (stepPhase < 0.08) {
      const brush = ((Math.sin(i * 78.233) * 43758.5453) % 1) * Math.exp(-stepTime * 45);
      perc += brush * 0.14 * percPresence;
    }

    // Smooth fade-in and musical outro fade-out
    const fadeIn = Math.min(1, t / 0.6);
    const fadeOut = Math.min(1, (clampedDuration - t) / 3.5);
    const sectionLift = isChorus ? 1.06 : isBridge ? 0.88 : 1.0;
    const masterGain =
      fadeIn * fadeOut * sectionLift * (0.68 + profile.intensity * 0.2);

    let sample = (pad + lead + bass + perc) * masterGain;
    sample = Math.tanh(sample);

    const int16 = Math.max(-32767, Math.min(32767, Math.round(sample * 32767)));
    buffer.writeInt16LE(int16, 44 + i * 2);
  }

  // Keep bounded cache of full-length tracks
  if (wavCache.size >= 10) {
    const firstKey = wavCache.keys().next().value;
    if (firstKey) wavCache.delete(firstKey);
  }
  wavCache.set(cacheKey, buffer);
  return buffer;
}
