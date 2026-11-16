import { CheckCircle2, Upload, X } from 'lucide-react';
import { useState } from 'react';
import type { LicenseType, NewAuthorisedTrackInput, PlaylistWithStats } from '../types/music';

interface AddTrackModalProps {
  open: boolean;
  playlists: PlaylistWithStats[];
  onClose: () => void;
  onCreated: (input: NewAuthorisedTrackInput) => Promise<void>;
}

export function AddTrackModal({
  open,
  playlists,
  onClose,
  onCreated,
}: AddTrackModalProps) {
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [album, setAlbum] = useState('');
  const [genre, setGenre] = useState('Indipop');
  const [language, setLanguage] = useState('Hindi');
  const [licenseType, setLicenseType] = useState<LicenseType>('Royalty-Free Studio');
  const [playlistId, setPlaylistId] = useState(playlists[0]?.id || 'top-50-hindi');
  const [streamUrl, setStreamUrl] = useState('/api/audio/stream/gg-01.wav');
  const [durationSec, setDurationSec] = useState(218);
  const [attribution, setAttribution] = useState('');
  const [attested, setAttested] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleLocalFilePick = (file: File | undefined) => {
    if (!file) return;
    const objectUrl = URL.createObjectURL(file);
    setStreamUrl(objectUrl);
    if (!title.trim()) {
      setTitle(file.name.replace(/\.[^/.]+$/, ''));
    }
    if (!artist.trim()) {
      setArtist('Independent Artist');
    }

    const probe = new Audio();
    probe.preload = 'metadata';
    probe.src = objectUrl;
    probe.onloadedmetadata = () => {
      if (Number.isFinite(probe.duration) && probe.duration > 1) {
        setDurationSec(Math.round(probe.duration));
      }
    };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!title.trim() || !artist.trim() || !streamUrl.trim()) {
      setError('Please enter a track title, artist name, and valid audio source.');
      return;
    }
    if (!attested) {
      setError('Please confirm that you hold streaming rights or a valid open license.');
      return;
    }

    setSubmitting(true);
    try {
      await onCreated({
        title: title.trim(),
        artist: artist.trim(),
        album: album.trim() || 'Independent Release',
        genre,
        language,
        durationSec: Math.max(10, Number(durationSec) || 218),
        licenseType,
        streamUrl: streamUrl.trim(),
        playlistId,
        attribution: attribution.trim(),
      });
      setTitle('');
      setArtist('');
      setAlbum('');
      setDurationSec(218);
      setAttribution('');
      setAttested(false);
      onClose();
    } catch (err) {
      setError((err as Error).message || 'Could not register track.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-track-modal-title"
    >
      <div className="w-full max-w-lg rounded-2xl bg-[#12121A] border border-white/10 shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.08]">
          <div>
            <h2 id="add-track-modal-title" className="font-display text-lg font-bold text-white">
              Add Authorised Audio Track
            </h2>
            <p className="text-xs text-slate-400">
              Register royalty-free, Creative Commons, or original local audio files.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-white/5"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto">
          {error ? (
            <div className="p-3 rounded-lg bg-red-950/40 border border-red-500/40 text-xs text-red-200">
              {error}
            </div>
          ) : null}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="vault-title" className="block text-xs font-medium text-slate-300 mb-1">
                Track Title
              </label>
              <input
                id="vault-title"
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Mumbai Monsoon Lo-Fi"
                className="w-full h-10 rounded-lg bg-[#09090D] border border-white/10 px-3 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-500"
              />
            </div>

            <div>
              <label htmlFor="vault-artist" className="block text-xs font-medium text-slate-300 mb-1">
                Artist / Collective
              </label>
              <input
                id="vault-artist"
                type="text"
                required
                value={artist}
                onChange={(e) => setArtist(e.target.value)}
                placeholder="e.g. Kabir & Collective"
                className="w-full h-10 rounded-lg bg-[#09090D] border border-white/10 px-3 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label htmlFor="vault-album" className="block text-xs font-medium text-slate-300 mb-1">
                Album
              </label>
              <input
                id="vault-album"
                type="text"
                value={album}
                onChange={(e) => setAlbum(e.target.value)}
                placeholder="Single / EP"
                className="w-full h-10 rounded-lg bg-[#09090D] border border-white/10 px-3 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-500"
              />
            </div>

            <div>
              <label htmlFor="vault-genre" className="block text-xs font-medium text-slate-300 mb-1">
                Genre
              </label>
              <select
                id="vault-genre"
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                className="w-full h-10 rounded-lg bg-[#09090D] border border-white/10 px-2.5 text-xs text-white focus:outline-none focus:border-violet-500"
              >
                <option value="Indipop">Indipop</option>
                <option value="90s Hindi Classic">90s Hindi Classic</option>
                <option value="DJ Mashup">DJ Mashup</option>
                <option value="Love Mashup">Love Mashup</option>
                <option value="Bollywood Romantic">Bollywood Romantic</option>
                <option value="Punjabi Bhangra">Punjabi Bhangra</option>
                <option value="Haryanvi Folk & DJ">Haryanvi Folk & DJ</option>
                <option value="Bhojpuri Beats">Bhojpuri Beats</option>
                <option value="Sufi Fusion">Sufi Fusion</option>
                <option value="Lo-Fi Chill">Lo-Fi Chill</option>
                <option value="Desi Hip-Hop">Desi Hip-Hop</option>
                <option value="International Pop">International Pop</option>
              </select>
            </div>

            <div>
              <label htmlFor="vault-language" className="block text-xs font-medium text-slate-300 mb-1">
                Language
              </label>
              <select
                id="vault-language"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="w-full h-10 rounded-lg bg-[#09090D] border border-white/10 px-2.5 text-xs text-white focus:outline-none focus:border-violet-500"
              >
                <option value="Hindi">Hindi</option>
                <option value="Punjabi">Punjabi</option>
                <option value="Haryanvi">Haryanvi</option>
                <option value="Bhojpuri">Bhojpuri</option>
                <option value="Urdu-Hindi">Urdu-Hindi</option>
                <option value="Instrumental">Instrumental</option>
                <option value="English">English</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="vault-license" className="block text-xs font-medium text-slate-300 mb-1">
                License Classification
              </label>
              <select
                id="vault-license"
                value={licenseType}
                onChange={(e) => setLicenseType(e.target.value as LicenseType)}
                className="w-full h-10 rounded-lg bg-[#09090D] border border-white/10 px-2.5 text-xs text-white focus:outline-none focus:border-violet-500"
              >
                <option value="Royalty-Free Studio">Royalty-Free Studio</option>
                <option value="Creative Commons (CC-BY)">Creative Commons (CC-BY)</option>
                <option value="Public Domain">Public Domain</option>
              </select>
            </div>

            <div>
              <label htmlFor="vault-playlist" className="block text-xs font-medium text-slate-300 mb-1">
                Target Playlist
              </label>
              <select
                id="vault-playlist"
                value={playlistId}
                onChange={(e) => setPlaylistId(e.target.value)}
                className="w-full h-10 rounded-lg bg-[#09090D] border border-white/10 px-2.5 text-xs text-white focus:outline-none focus:border-violet-500"
              >
                {playlists.map((pl) => (
                  <option key={pl.id} value={pl.id}>
                    {pl.title}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <label htmlFor="vault-stream-url" className="block text-xs font-medium text-slate-300">
              Authorised Audio URL or Local File
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                id="vault-stream-url"
                type="text"
                value={streamUrl}
                onChange={(e) => setStreamUrl(e.target.value)}
                placeholder="https://... or /api/audio/stream/gg-01.wav"
                className="flex-1 h-10 rounded-lg bg-[#09090D] border border-white/10 px-3 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-500"
              />
              <label className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/[0.04] px-3.5 text-xs font-medium text-slate-200 hover:bg-white/[0.08] shrink-0">
                <Upload className="w-3.5 h-3.5 text-violet-400" />
                Pick Audio File
                <input
                  type="file"
                  accept="audio/*"
                  className="sr-only"
                  onChange={(e) => handleLocalFilePick(e.target.files?.[0])}
                />
              </label>
            </div>
            <p className="text-[11px] text-slate-500">
              Default points to GullyGroove Studio’s royalty-free master stream, or upload any local audio file for instant playback.
            </p>
          </div>

          <div>
            <label htmlFor="vault-attribution" className="block text-xs font-medium text-slate-300 mb-1">
              Rights Attribution (Optional)
            </label>
            <input
              id="vault-attribution"
              type="text"
              value={attribution}
              onChange={(e) => setAttribution(e.target.value)}
              placeholder="e.g. Licensed under CC-BY 4.0 by Artist Name"
              className="w-full h-10 rounded-lg bg-[#09090D] border border-white/10 px-3 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-500"
            />
          </div>

          <label className="flex items-start gap-2.5 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={attested}
              onChange={(e) => setAttested(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-white/20 bg-[#09090D] text-violet-500 focus:ring-violet-500"
            />
            <span className="text-xs text-slate-300 leading-relaxed">
              I confirm this track is public domain, Creative Commons, royalty-free, or original audio that I am authorised to stream without DRM circumvention.
            </span>
          </label>

          <div className="flex items-center justify-end gap-3 pt-2 border-t border-white/[0.08]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-white rounded-lg border border-white/10 hover:bg-white/5"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white rounded-lg bg-gradient-to-r from-violet-600 to-blue-500 hover:opacity-95 disabled:opacity-50"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              {submitting ? 'Registering...' : 'Add to Media Vault'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
