import { CheckCircle2, Mail, MessageSquare, Send, X } from 'lucide-react';
import { useState } from 'react';
import {
  submitSongRequest,
  type SongRequestResult,
} from '../services/clientCatalog';

interface RequestSongModalProps {
  open: boolean;
  onClose: () => void;
}

export function RequestSongModal({ open, onClose }: RequestSongModalProps) {
  const [songName, setSongName] = useState('');
  const [feedback, setFeedback] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SongRequestResult | null>(null);
  const [submittedDetails, setSubmittedDetails] = useState<{
    songName: string;
    feedback: string;
  } | null>(null);

  if (!open) return null;

  const handleReset = () => {
    setSongName('');
    setFeedback('');
    setError(null);
    setResult(null);
    setSubmittedDetails(null);
  };

  const handleClose = () => {
    handleReset();
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedName = songName.trim();
    const trimmedFeedback = feedback.trim();

    if (!trimmedName && !trimmedFeedback) {
      setError('Please enter a song name or share your feedback/comment.');
      return;
    }

    setSubmitting(true);
    try {
      const response = await submitSongRequest({
        songName: trimmedName,
        feedback: trimmedFeedback,
      });
      setSubmittedDetails({ songName: trimmedName, feedback: trimmedFeedback });
      setResult(response);
    } catch (err) {
      setError((err as Error).message || 'Could not send your tune request. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="request-song-modal-title"
    >
      <div className="w-full max-w-md rounded-2xl bg-[#12121B] border border-violet-500/25 shadow-2xl shadow-violet-950/50 overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.08]">
          <div>
            <h2
              id="request-song-modal-title"
              className="font-display text-lg font-bold text-white"
            >
              Tune Request
            </h2>
            <p className="text-xs text-slate-400">
              Send a song request, feedback, or comment to our team
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close request song dialog"
            className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-white/5"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {result && submittedDetails ? (
          <div className="p-5 space-y-4">
            <div className="flex items-start gap-3 rounded-xl bg-violet-500/10 border border-violet-500/25 p-3.5">
              <CheckCircle2 className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
              <div className="space-y-1 text-xs">
                <p className="font-semibold text-white">
                  {result.status === 'sent'
                    ? 'Tune Request Sent'
                    : result.status === 'activation-required'
                      ? 'Tune Request Submitted'
                      : 'Ready to Send via Email'}
                </p>
                <p className="text-slate-300 leading-relaxed">{result.message}</p>
              </div>
            </div>

            <div className="rounded-xl bg-[#09090D] border border-white/[0.08] p-3.5 space-y-1.5 text-xs">
              {submittedDetails.songName ? (
                <div>
                  <span className="text-slate-500">Song: </span>
                  <span className="font-medium text-white">{submittedDetails.songName}</span>
                </div>
              ) : null}
              {submittedDetails.feedback ? (
                <div>
                  <span className="text-slate-500">Feedback / Comment: </span>
                  <span className="text-slate-200 whitespace-pre-wrap break-words">
                    {submittedDetails.feedback}
                  </span>
                </div>
              ) : null}
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2.5 pt-2 border-t border-white/[0.08]">
              <a
                href={result.mailtoUrl}
                className="inline-flex h-10 items-center justify-center gap-2 px-4 rounded-xl bg-white/[0.07] hover:bg-white/[0.12] border border-white/10 text-xs font-medium text-white transition-colors"
              >
                <Mail className="w-3.5 h-3.5 text-blue-400" />
                Open in Email App
              </a>
              <button
                type="button"
                onClick={handleReset}
                className="inline-flex h-10 items-center justify-center px-4 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 text-xs font-medium text-slate-200"
              >
                Request Another
              </button>
              <button
                type="button"
                onClick={handleClose}
                className="inline-flex h-10 items-center justify-center px-5 rounded-xl bg-gradient-to-r from-violet-600 to-blue-500 text-xs font-semibold text-white hover:opacity-95"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            {error ? (
              <div className="p-3 rounded-lg bg-red-950/40 border border-red-500/40 text-xs text-red-200">
                {error}
              </div>
            ) : null}

            <div>
              <label
                htmlFor="request-song-name"
                className="block text-xs font-medium text-slate-300 mb-1.5"
              >
                Song Name
              </label>
              <input
                id="request-song-name"
                type="text"
                value={songName}
                onChange={(e) => setSongName(e.target.value)}
                placeholder="e.g. Tum Hi Ho - Arijit Singh"
                className="w-full h-11 rounded-xl bg-[#09090D] border border-white/10 px-3.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-500"
              />
            </div>

            <div>
              <label
                htmlFor="request-feedback-comment"
                className="block text-xs font-medium text-slate-300 mb-1.5"
              >
                Feedback or Comment
              </label>
              <div className="relative">
                <MessageSquare className="w-4 h-4 text-violet-400 absolute left-3.5 top-3.5 pointer-events-none" />
                <textarea
                  id="request-feedback-comment"
                  rows={4}
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  placeholder="Share artist details, playlist suggestion, or feedback..."
                  className="w-full rounded-xl bg-[#09090D] border border-white/10 pl-10 pr-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-500 resize-y min-h-[104px]"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-white/[0.08]">
              <button
                type="button"
                onClick={handleClose}
                className="h-10 px-4 text-xs font-medium text-slate-300 hover:text-white rounded-xl border border-white/10 hover:bg-white/5"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex h-10 items-center justify-center gap-2 px-5 text-xs font-semibold text-white rounded-xl bg-gradient-to-r from-violet-600 to-blue-500 hover:opacity-95 disabled:opacity-50"
              >
                <Send className="w-3.5 h-3.5" />
                {submitting ? 'Sending...' : 'Send Request'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
