import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { fileURLToPath } from 'url';
import { generateTrackWav } from './src/server/audioSynth';
import { catalogService } from './src/server/providers/catalogService';
import type { NewAuthorisedTrackInput } from './src/types/music';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
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
    res.json({
      playlists,
      tracks,
      facets,
      providers,
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

    const created = catalogService.addAuthorisedTrack({
      title: body.title,
      artist: body.artist,
      album: body.album || 'Authorised Release',
      genre: body.genre || 'Indipop',
      language: body.language || 'Hindi',
      durationSec: Number(body.durationSec) || 218,
      licenseType: body.licenseType || 'Royalty-Free Studio',
      streamUrl: body.streamUrl,
      coverUrl: body.coverUrl,
      playlistId: body.playlistId,
      attribution: body.attribution,
    });

    res.status(201).json({
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
      server: { middlewareMode: true },
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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`GullyGroove server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
