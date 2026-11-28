import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { Readable } from 'stream';
import { fileURLToPath } from 'url';
import { generateTrackWav } from './src/server/audioSynth';
import {
  getGeminiClient,
  interpretGroovyWithGemini,
  synthesizeGroovySpeechWav,
} from './src/server/geminiClient';
import {
  catalogService,
  PRIVATE_PLAYLIST_ID,
} from './src/server/providers/catalogService';
import type { NewAuthorisedTrackInput } from './src/types/music';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const httpServer = http.createServer(app);
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '2mb' }));

  // Health Check
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'gullygroove-api' });
  });

  // Catalog Overview: Playlists, Featured Tracks, Filter Facets, Providers
  app.get('/api/catalog/overview', (_req, res) => {
    const playlists = catalogService.getPlaylists();
    const tracks = catalogService.filterLocalTracks({});
    const facets = catalogService.getFilterFacets();
    const providers = catalogService.getProviderStatuses();
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      version: catalogService.getCatalogVersion(),
      playlists,
      tracks,
      facets,
      providers,
    });
  });

  // Live Cross-User Shared Catalog Sync (SSE)
  app.get('/api/catalog/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const sendEvent = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    sendEvent('connected', { version: catalogService.getCatalogVersion() });

    const unsubscribe = catalogService.onCatalogChange((payload) => {
      sendEvent('catalog-updated', payload);
    });

    const heartbeat = setInterval(() => {
      res.write(': keepalive\n\n');
    }, 25000);

    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  // Single Playlist + Tracks
  app.get('/api/playlists/:id', (req, res) => {
    const { playlist, tracks } = catalogService.getPlaylistById(req.params.id);
    if (!playlist) {
      res.status(404).json({ error: 'Playlist not found' });
      return;
    }
    res.json({ playlist, tracks });
  });

  // Search & Advanced Filtering across Local Catalogue + Modular Discovery Providers
  app.get('/api/tracks', async (req, res) => {
    const query = typeof req.query.query === 'string' ? req.query.query : '';
    const artist = typeof req.query.artist === 'string' ? req.query.artist : '';
    const album = typeof req.query.album === 'string' ? req.query.album : '';
    const genre = typeof req.query.genre === 'string' ? req.query.genre : '';
    const language = typeof req.query.language === 'string' ? req.query.language : '';
    const providerId = typeof req.query.providerId === 'string' ? req.query.providerId : '';
    const includeExternal = req.query.includeExternal === 'true';

    const localTracks = catalogService.filterLocalTracks({
      query,
      artist,
      album,
      genre,
      language,
      providerId,
    });

    let externalTracks: typeof localTracks = [];
    if (includeExternal && query.trim().length >= 2) {
      externalTracks = await catalogService.searchExternalProviders(query);
      if (providerId && providerId !== 'all') {
        externalTracks = externalTracks.filter((t) => t.providerId === providerId);
      }
      if (artist && artist !== 'all') {
        externalTracks = externalTracks.filter((t) =>
          t.artist.toLowerCase().includes(artist.toLowerCase())
        );
      }
      if (genre && genre !== 'all') {
        externalTracks = externalTracks.filter((t) =>
          t.genre.toLowerCase().includes(genre.toLowerCase())
        );
      }
    }

    res.json({
      localTracks,
      externalTracks,
      facets: catalogService.getFilterFacets(),
    });
  });

  // Modular Music Provider Statuses & Policies
  app.get('/api/providers', (_req, res) => {
    res.json({ providers: catalogService.getProviderStatuses() });
  });

  // Groovy Smart Voice Intent Interpretation (Gemini 4 Hydrogen)
  app.post('/api/groovy/interpret', async (req, res) => {
    const body = req.body as {
      transcript?: string;
      playlists?: Array<{ id: string; title: string; mood: string }>;
      currentTrack?: { title: string; artist: string } | null;
    };
    const transcript = typeof body.transcript === 'string' ? body.transcript.trim() : '';
    if (!transcript) {
      res.status(400).json({ error: 'Transcript is required.' });
      return;
    }

    if (!getGeminiClient()) {
      res.status(503).json({ available: false, error: 'GEMINI_API_KEY not configured.' });
      return;
    }

    try {
      const playlists =
        Array.isArray(body.playlists) && body.playlists.length > 0
          ? body.playlists
          : catalogService.getPlaylists().map((p) => ({
              id: p.id,
              title: p.title,
              mood: p.mood,
            }));
      const result = await interpretGroovyWithGemini({
        transcript,
        playlists,
        currentTrack: body.currentTrack || null,
      });
      if (!result) {
        res.status(502).json({ error: 'Empty interpretation from Gemini.' });
        return;
      }
      res.json({ available: true, result });
    } catch (err: unknown) {
      const status =
        typeof (err as { status?: number })?.status === 'number'
          ? (err as { status: number }).status
          : 500;
      const message =
        err instanceof Error ? err.message : 'Failed to interpret voice command.';
      res.status(status).json({ error: message });
    }
  });

  // Groovy Natural Female Neural TTS (Gemini 3.8 Flash Lite TTS -> WAV)
  app.post('/api/groovy/tts', async (req, res) => {
    const body = req.body as { text?: string };
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) {
      res.status(400).json({ error: 'Text is required.' });
      return;
    }

    if (!getGeminiClient()) {
      res.status(503).json({ available: false, error: 'GEMINI_API_KEY not configured.' });
      return;
    }

    try {
      const wavBuffer = await synthesizeGroovySpeechWav(text);
      if (!wavBuffer) {
        res.status(502).json({ error: 'Unable to synthesize speech audio.' });
        return;
      }
      res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('Content-Length', wavBuffer.length);
      res.setHeader('Cache-Control', 'no-store');
      res.send(wavBuffer);
    } catch (err: unknown) {
      const status =
        typeof (err as { status?: number })?.status === 'number'
          ? (err as { status: number }).status
          : 500;
      const message =
        err instanceof Error ? err.message : 'Failed to synthesize voice reply.';
      res.status(status).json({ error: message });
    }
  });

  // Register a new authorised royalty-free / CC / Public Domain track in the Media Vault
  app.post('/api/vault/tracks', (req, res) => {
    const body = req.body as Partial<NewAuthorisedTrackInput>;
    if (!body.title?.trim() || !body.artist?.trim() || !body.streamUrl?.trim()) {
      res.status(400).json({
        error: 'Title, artist, and an authorised stream URL (or sample audio path) are required.',
      });
      return;
    }

    try {
      const urlCheck = body.streamUrl.trim();
      const isRelativeApi = urlCheck.startsWith('/api/') || urlCheck.startsWith('blob:');
      if (!isRelativeApi) {
        const parsed = new URL(urlCheck);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
          res.status(400).json({ error: 'Stream URL must use http:// or https://' });
          return;
        }
      }
    } catch {
      res.status(400).json({ error: 'Invalid stream URL format.' });
      return;
    }

    const parsedDuration = Number(body.durationSec);
    if (Number.isFinite(parsedDuration) && parsedDuration > 0 && parsedDuration <= 30) {
      res.status(400).json({ error: 'Only songs longer than 30 seconds can be added to the catalog.' });
      return;
    }

    if (body.playlistId === PRIVATE_PLAYLIST_ID) {
      res.status(400).json({
        error: 'My Playlist is private to the owner and cannot be published to the shared catalog.',
      });
      return;
    }

    const created = catalogService.addAuthorisedTrack({
      title: body.title,
      artist: body.artist,
      album: body.album || 'Authorised Release',
      genre: body.genre || 'Indipop',
      language: body.language || 'Hindi',
      durationSec: Number.isFinite(parsedDuration) && parsedDuration > 30 ? parsedDuration : 218,
      licenseType: body.licenseType || 'Royalty-Free Studio',
      streamUrl: body.streamUrl,
      coverUrl: body.coverUrl,
      playlistId: body.playlistId,
      attribution: body.attribution,
    });

    res.status(201).json({
      version: catalogService.getCatalogVersion(),
      track: created,
      playlists: catalogService.getPlaylists(),
      facets: catalogService.getFilterFacets(),
    });
  });

  app.delete('/api/vault/tracks/:id', (req, res) => {
    const removed = catalogService.removeVaultTrack(req.params.id);
    if (!removed) {
      res.status(404).json({ error: 'Vault track not found or cannot be deleted.' });
      return;
    }
    res.json({
      ok: true,
      playlists: catalogService.getPlaylists(),
      facets: catalogService.getFilterFacets(),
    });
  });

  app.post('/api/playlists/:id/tracks', (req, res) => {
    if (req.params.id === PRIVATE_PLAYLIST_ID) {
      res.status(403).json({
        error: 'My Playlist is private to its owner and is stored locally on your device.',
      });
      return;
    }
    const { trackId, track } = req.body as { trackId?: string; track?: unknown };
    if (!trackId) {
      res.status(400).json({ error: 'trackId is required' });
      return;
    }
    const updated = catalogService.assignTrackToPlaylist(
      trackId,
      req.params.id,
      track as Parameters<typeof catalogService.assignTrackToPlaylist>[2]
    );
    if (!updated) {
      res.status(404).json({ error: 'Track or playlist not found' });
      return;
    }
    res.json({
      version: catalogService.getCatalogVersion(),
      track: updated,
      playlists: catalogService.getPlaylists(),
      facets: catalogService.getFilterFacets(),
    });
  });

  app.post('/api/tracks/:id/play', (req, res) => {
    catalogService.incrementPlays(req.params.id);
    res.json({ ok: true });
  });

  const songRequests: Array<{
    id: string;
    songName: string;
    feedback: string;
    targetEmail: string;
    createdAt: string;
  }> = [];

  // Tune Request & Feedback submission endpoint (records request and sends via Resend if configured)
  app.post('/api/song-requests', async (req, res) => {
    const body = req.body as { songName?: string; feedback?: string };
    const songName =
      typeof body.songName === 'string' ? body.songName.trim().slice(0, 200) : '';
    const feedback =
      typeof body.feedback === 'string' ? body.feedback.trim().slice(0, 2000) : '';

    if (!songName && !feedback) {
      res
        .status(400)
        .json({ error: 'Please enter a song name or share your feedback/comment.' });
      return;
    }

    const record = {
      id: `req-${Date.now()}`,
      songName,
      feedback,
      targetEmail: 'iampank3@gmail.com',
      createdAt: new Date().toISOString(),
    };
    songRequests.unshift(record);
    if (songRequests.length > 200) {
      songRequests.length = 200;
    }

    const resendKey = process.env.RESEND_API_KEY?.trim();
    if (resendKey) {
      try {
        const emailRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${resendKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: process.env.RESEND_FROM || 'GullyGroove <onboarding@resend.dev>',
            to: ['iampank3@gmail.com'],
            subject: songName
              ? `GullyGroove Tune Request: ${songName}`
              : 'GullyGroove Tune Request & Feedback',
            text: `New Tune Request / Feedback submitted on GullyGroove:\n\nSong Name: ${
              songName || '(Not specified)'
            }\nFeedback / Comment: ${feedback || '(None)'}\nSubmitted At: ${record.createdAt}`,
          }),
        });
        if (emailRes.ok) {
          res.status(201).json({
            ok: true,
            id: record.id,
            deliveredVia: 'server-email',
          });
          return;
        }
      } catch {
        // Fall through to client FormSubmit relay
      }
    }

    res.status(201).json({
      ok: true,
      id: record.id,
      deliveredVia: 'server-recorded',
    });
  });

  // Audius Open Streaming Proxy Endpoint (forwards byte-ranges cleanly to HTML5 audio)
  app.get('/api/audius/stream/:audiusId', async (req, res) => {
    const audiusId = req.params.audiusId.replace(/[^a-zA-Z0-9_-]/g, '');
    if (!audiusId) {
      res.status(400).json({ error: 'Invalid track ID' });
      return;
    }

    const upstreamUrl = `https://api.audius.co/v1/tracks/${encodeURIComponent(
      audiusId
    )}/stream?app_name=GullyGroove`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    req.on('close', () => controller.abort());

    try {
      const headers: Record<string, string> = {};
      if (req.headers.range) {
        headers.Range = req.headers.range;
      }

      const upstream = await fetch(upstreamUrl, {
        headers,
        signal: controller.signal,
      });

      if (!upstream.ok || !upstream.body) {
        res.status(upstream.status || 502).json({ error: 'Upstream stream unavailable' });
        return;
      }

      res.status(upstream.status);
      const forwardHeaders = [
        'content-length',
        'content-range',
        'accept-ranges',
      ];
      const upstreamType = upstream.headers.get('content-type');
      res.setHeader(
        'content-type',
        !upstreamType || upstreamType.includes('octet-stream') ? 'audio/mpeg' : upstreamType
      );
      for (const h of forwardHeaders) {
        const val = upstream.headers.get(h);
        if (val) res.setHeader(h, val);
      }
      if (!upstream.headers.get('accept-ranges')) {
        res.setHeader('Accept-Ranges', 'bytes');
      }
      res.setHeader('Cache-Control', 'public, max-age=1800');

      const nodeStream = Readable.fromWeb(
        upstream.body as Parameters<typeof Readable.fromWeb>[0]
      );
      nodeStream.on('error', () => {
        if (!res.headersSent) res.status(502).end();
        else res.end();
      });
      nodeStream.pipe(res);
    } catch {
      if (!res.headersSent) {
        res.status(502).json({ error: 'Unable to reach audio stream' });
      }
    } finally {
      clearTimeout(timeout);
    }
  });

  // Procedural Royalty-Free Studio Audio Stream Endpoint (with HTTP Byte-Range support)
  app.get('/api/audio/stream/:filename', (req, res) => {
    const trackId = req.params.filename.replace(/\.wav$/i, '');
    const track = catalogService.getTrackById(trackId);

    const profile = track?.audioProfile || {
      bpm: 105,
      rootHz: 261.63,
      scale: 'yaman',
      groove: 'bollywood-romantic',
      intensity: 0.75,
    };
    const durationSec = track?.durationSec || 218;
    const wavBuffer = generateTrackWav(trackId, durationSec, profile);

    const totalLength = wavBuffer.length;
    const range = req.headers.range;

    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=3600');

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = Number.parseInt(parts[0], 10) || 0;
      const end = parts[1] ? Number.parseInt(parts[1], 10) : totalLength - 1;
      const clampedStart = Math.max(0, Math.min(start, totalLength - 1));
      const clampedEnd = Math.max(clampedStart, Math.min(end, totalLength - 1));
      const chunkSize = clampedEnd - clampedStart + 1;

      res.status(206);
      res.setHeader('Content-Range', `bytes ${clampedStart}-${clampedEnd}/${totalLength}`);
      res.setHeader('Content-Length', chunkSize);
      res.send(wavBuffer.subarray(clampedStart, clampedEnd + 1));
      return;
    }

    res.setHeader('Content-Length', totalLength);
    res.send(wavBuffer);
  });

  // Vite dev middleware or static production build
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
        ws: { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build not found.');
      }
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`GullyGroove server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
