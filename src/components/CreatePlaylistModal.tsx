import { Globe, Loader2, Lock, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import type { AppTheme } from './SettingsModal';

interface CreatePlaylistModalProps {
  open: boolean;
  theme: AppTheme;
  onCreate: (input: {
    title: string;
    description: string;
    visibility: 'private' | 'shared';
    allowContributions: boolean;
  }) => Promise<void>;
  onClose: () => void;
}

export function CreatePlaylistModal({
  open,
  theme,
  onCreate,
  onClose,
}: CreatePlaylistModalProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'private' | 'shared'>('private');
  const [allowContributions, setAllowContributions] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!open || typeof document === 'undefined') return null;

  const isLight = theme === 'light';

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) {
      setErrorMsg('Please enter a playlist title.');
      return;
    }
    setSubmitting(true);
    setErrorMsg(null);
    try {
      await onCreate({
        title: trimmed,
        description: description.trim(),
        visibility,
        allowContributions,
      });
      setTitle('');
      setDescription('');
      setVisibility('private');
      setAllowContributions(true);
      onClose();
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Unable to create playlist right now.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/65 backdrop-blur-sm p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Create Playlist"
      onClick={onClose}
    >
      <div
        className={`w-full max-w-md rounded-2xl border shadow-2xl overflow-hidden ${
          isLight
            ? 'bg-white border-violet-200 text-slate-900'
            : 'bg-[#101018] border-violet-500/30 text-slate-100'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={`flex items-center justify-between gap-3 px-5 py-4 border-b ${
            isLight ? 'border-violet-100' : 'border-white/[0.08]'
          }`}
        >
          <div>
            <h2 className="font-display text-lg font-bold">Create Playlist</h2>
            <p className={`text-xs mt-0.5 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
              Personal playlists stay private by default
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close create playlist dialog"
            className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 hover:bg-white/10 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {errorMsg ? (
            <div className="rounded-xl bg-rose-500/15 border border-rose-500/30 px-3 py-2 text-xs text-rose-300">
              {errorMsg}
            </div>
          ) : null}

          <div className="space-y-1.5">
            <label className="text-xs font-semibold block">Playlist Title</label>
            <input
              type="text"
              maxLength={120}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Late Night Monsoon Drive"
              className={`w-full h-10 px-3 rounded-xl border text-xs focus:outline-none focus:border-violet-400 ${
                isLight
                  ? 'bg-slate-50 border-slate-200 text-slate-900'
                  : 'bg-[#161622] border-white/10 text-white'
              }`}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold block">Description (Optional)</label>
            <textarea
              rows={2}
              maxLength={400}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the mood or vibe..."
              className={`w-full p-3 rounded-xl border text-xs resize-none focus:outline-none focus:border-violet-400 ${
                isLight
                  ? 'bg-slate-50 border-slate-200 text-slate-900'
                  : 'bg-[#161622] border-white/10 text-white'
              }`}
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold block">Visibility</label>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setVisibility('private')}
                className={`flex items-start gap-2.5 rounded-xl border p-3 text-left transition-all ${
                  visibility === 'private'
                    ? 'border-amber-400/70 bg-amber-500/10'
                    : isLight
                      ? 'border-slate-200 bg-slate-50'
                      : 'border-white/[0.08] bg-white/[0.03]'
                }`}
              >
                <Lock className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold">Private (Default)</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    Only your account can view &amp; edit
                  </p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setVisibility('shared')}
                className={`flex items-start gap-2.5 rounded-xl border p-3 text-left transition-all ${
                  visibility === 'shared'
                    ? 'border-emerald-400/70 bg-emerald-500/10'
                    : isLight
                      ? 'border-slate-200 bg-slate-50'
                      : 'border-white/[0.08] bg-white/[0.03]'
                }`}
              >
                <Globe className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold">Shared</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    Visible to all GullyGroove users
                  </p>
                </div>
              </button>
            </div>
          </div>

          {visibility === 'shared' ? (
            <label
              className={`flex items-center justify-between gap-3 rounded-xl border p-3 cursor-pointer ${
                isLight
                  ? 'bg-slate-50 border-slate-200'
                  : 'bg-white/[0.03] border-white/[0.08]'
              }`}
            >
              <div>
                <p className="text-xs font-semibold">Allow Community Contributions</p>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  Signed-in listeners can add songs &amp; appear as contributors
                </p>
              </div>
              <input
                type="checkbox"
                checked={allowContributions}
                onChange={(e) => setAllowContributions(e.target.checked)}
                className="accent-violet-500 h-4 w-4"
              />
            </label>
          ) : null}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 h-10 rounded-xl text-xs font-medium text-slate-400 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex h-10 items-center justify-center gap-2 px-5 rounded-xl bg-gradient-to-r from-violet-600 to-blue-500 text-xs font-semibold text-white disabled:opacity-60"
            >
              {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              {submitting ? 'Creating...' : 'Create Playlist'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
