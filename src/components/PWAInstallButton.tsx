import {
  Check,
  CheckCircle2,
  Compass,
  Copy,
  Download,
  MoreVertical,
  PlusSquare,
  Share,
  Smartphone,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { BrandLogo } from './BrandLogo';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  variant?: 'header' | 'hero' | 'ios-card';
}

export function PWAInstallButton({ variant = 'header' }: PWAInstallButtonProps) {
  const { isInstallable, isInstalled, isIOS, isAndroid, isSafariIOS, install } =
    usePWAInstall();
  const [guideModal, setGuideModal] = useState<'ios' | 'android' | null>(null);
  const [iosBannerDismissed, setIosBannerDismissed] = useState(false);

  const [copiedUrl, setCopiedUrl] = useState(false);

  // Already running in standalone installed mode — suppress all install UI
  if (isInstalled) {
    return null;
  }

  const handleInstallClick = async () => {
    if (isIOS) {
      setGuideModal('ios');
      return;
    }
    if (isInstallable) {
      const outcome = await install();
      if (outcome === 'unavailable') {
        setGuideModal('android');
      }
      return;
    }
    // Fallback helper for Android Chrome / Desktop when native prompt isn't available (e.g. inside iframe preview)
    setGuideModal('android');
  };

  if (variant === 'ios-card') {
    if (!isIOS || iosBannerDismissed) {
      return null;
    }

    return (
      <>
        <div className="relative overflow-hidden rounded-2xl border border-violet-500/25 bg-gradient-to-r from-[#131122] via-[#10101A] to-[#0E172A] px-4 py-3.5 sm:px-5 sm:py-4 shadow-lg shadow-violet-950/30">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/15 border border-violet-500/30">
                <Smartphone className="h-5 w-5 text-violet-300" />
              </div>
              <div className="min-w-0">
                <h3 className="font-display text-sm font-bold text-white">
                  Install GullyGroove on iPhone
                </h3>
                <p className="text-xs text-slate-300 mt-0.5">
                  Add to your Home Screen for full-screen standalone playback.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIosBannerDismissed(true)}
              aria-label="Dismiss iPhone install guide"
              className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white transition-colors shrink-0"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="flex items-center gap-2 rounded-xl bg-white/[0.04] border border-white/[0.07] px-2.5 py-2">
              <Compass className="h-4 w-4 text-blue-400 shrink-0" />
              <span className="text-[11px] font-medium text-slate-200 leading-tight">
                1. Open Safari
              </span>
            </div>
            <div className="flex items-center gap-2 rounded-xl bg-white/[0.04] border border-white/[0.07] px-2.5 py-2">
              <Share className="h-4 w-4 text-violet-400 shrink-0" />
              <span className="text-[11px] font-medium text-slate-200 leading-tight">
                2. Tap Share
              </span>
            </div>
            <div className="flex items-center gap-2 rounded-xl bg-white/[0.04] border border-white/[0.07] px-2.5 py-2">
              <PlusSquare className="h-4 w-4 text-blue-300 shrink-0" />
              <span className="text-[11px] font-medium text-slate-200 leading-tight">
                3. Add to Home Screen
              </span>
            </div>
            <div className="flex items-center gap-2 rounded-xl bg-white/[0.04] border border-white/[0.07] px-2.5 py-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
              <span className="text-[11px] font-medium text-slate-200 leading-tight">
                4. Tap Add
              </span>
            </div>
          </div>
        </div>
        <InstallGuideModal
          mode={guideModal}
          isSafariIOS={isSafariIOS}
          isAndroid={isAndroid}
          copiedUrl={copiedUrl}
          onCopyUrl={() => {
            navigator.clipboard?.writeText(window.location.origin).then(() => {
              setCopiedUrl(true);
              setTimeout(() => setCopiedUrl(false), 2000);
            }).catch(() => {});
          }}
          onClose={() => setGuideModal(null)}
        />
      </>
    );
  }

  const hideOnDesktopClass = isIOS || isAndroid ? '' : 'lg:hidden';

  // On homepage Hero: show prominent Install App button on mobile/tablet/iOS/Android (hidden on desktop)
  if (variant === 'hero') {
    return (
      <>
        <button
          type="button"
          onClick={handleInstallClick}
          className={`${hideOnDesktopClass} inline-flex h-11 items-center justify-center gap-2 px-5 rounded-xl bg-gradient-to-r from-violet-600/30 to-blue-500/30 hover:from-violet-600/45 hover:to-blue-500/45 border border-violet-400/45 text-sm font-semibold text-white shadow-md shadow-violet-950/40 transition-all whitespace-nowrap shrink-0`}
        >
          <Download className="w-4 h-4 text-blue-300" />
          <span>Install App</span>
        </button>

        <InstallGuideModal
          mode={guideModal}
          isSafariIOS={isSafariIOS}
          isAndroid={isAndroid}
          copiedUrl={copiedUrl}
          onCopyUrl={() => {
            navigator.clipboard?.writeText(window.location.origin).then(() => {
              setCopiedUrl(true);
              setTimeout(() => setCopiedUrl(false), 2000);
            }).catch(() => {});
          }}
          onClose={() => setGuideModal(null)}
        />
      </>
    );
  }

  // Header button variant (Mobile & Tablet top bar; hidden on desktop)
  return (
    <>
      <button
        type="button"
        onClick={handleInstallClick}
        aria-label="Install App"
        className={`${hideOnDesktopClass} inline-flex h-9 items-center gap-1.5 px-2.5 sm:px-3.5 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] border border-violet-400/35 text-xs font-semibold text-slate-100 transition-all whitespace-nowrap shrink-0`}
      >
        <Download className="w-3.5 h-3.5 text-violet-300" />
        <span>Install App</span>
      </button>

      <InstallGuideModal
        mode={guideModal}
        isSafariIOS={isSafariIOS}
        isAndroid={isAndroid}
        copiedUrl={copiedUrl}
        onCopyUrl={() => {
          navigator.clipboard?.writeText(window.location.origin).then(() => {
            setCopiedUrl(true);
            setTimeout(() => setCopiedUrl(false), 2000);
          }).catch(() => {});
        }}
        onClose={() => setGuideModal(null)}
      />
    </>
  );
}

interface InstallGuideModalProps {
  mode: 'ios' | 'android' | null;
  isSafariIOS: boolean;
  isAndroid: boolean;
  copiedUrl: boolean;
  onCopyUrl: () => void;
  onClose: () => void;
}

function InstallGuideModal({
  mode,
  isSafariIOS,
  isAndroid,
  copiedUrl,
  onCopyUrl,
  onClose,
}: InstallGuideModalProps) {
  if (!mode) return null;
  const isInIframe = typeof window !== 'undefined' && window.self !== window.top;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={
        mode === 'ios'
          ? 'Install GullyGroove on iPhone'
          : 'Install GullyGroove App'
      }
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-[#101018] border border-violet-500/30 p-5 sm:p-6 shadow-2xl shadow-violet-950/60"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <BrandLogo size="sm" />
            <div>
              <h3 className="font-display text-base sm:text-lg font-bold text-white">
                {mode === 'ios'
                  ? 'Install GullyGroove on iPhone'
                  : 'Install GullyGroove App'}
              </h3>
              <p className="text-xs text-slate-400">
                {mode === 'ios'
                  ? 'Add to your iPhone Home Screen in 4 quick taps'
                  : 'Launch full-screen directly from your home screen'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close installation guide"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {mode === 'ios' ? (
          <div className="mt-5 space-y-2.5">
            {!isSafariIOS ? (
              <div className="rounded-xl bg-violet-500/10 border border-violet-500/30 px-3.5 py-2.5 text-xs text-violet-200">
                For iPhone home screen installation, make sure you open this page in{' '}
                <strong className="text-white">Safari</strong>.
              </div>
            ) : null}

            <div className="flex items-center gap-3 rounded-xl bg-white/[0.04] border border-white/[0.08] p-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-500/15 border border-blue-500/30">
                <Compass className="h-4 w-4 text-blue-300" />
              </div>
              <div>
                <p className="text-xs font-semibold text-white">
                  1. Open Safari
                </p>
                <p className="text-[11px] text-slate-400">
                  Open GullyGroove in Apple Safari on your iPhone or iPad.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 rounded-xl bg-white/[0.04] border border-white/[0.08] p-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-500/15 border border-violet-500/30">
                <Share className="h-4 w-4 text-violet-300" />
              </div>
              <div>
                <p className="text-xs font-semibold text-white">
                  2. Tap Share
                </p>
                <p className="text-[11px] text-slate-400">
                  Tap the Share icon (square with upward arrow) in Safari’s toolbar.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 rounded-xl bg-white/[0.04] border border-white/[0.08] p-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-500/15 border border-blue-500/30">
                <PlusSquare className="h-4 w-4 text-blue-300" />
              </div>
              <div>
                <p className="text-xs font-semibold text-white">
                  3. Select “Add to Home Screen”
                </p>
                <p className="text-[11px] text-slate-400">
                  Scroll down the share sheet and tap Add to Home Screen.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 rounded-xl bg-white/[0.04] border border-white/[0.08] p-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 border border-emerald-500/30">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              </div>
              <div>
                <p className="text-xs font-semibold text-white">
                  4. Tap Add
                </p>
                <p className="text-[11px] text-slate-400">
                  Confirm in the top-right to open GullyGroove like a native app.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-5 space-y-2.5">
            {isInIframe ? (
              <div className="rounded-xl bg-violet-500/10 border border-violet-500/30 px-3.5 py-2.5 text-xs text-violet-200">
                Browser install prompts only appear when opened directly in a full browser tab (not inside a preview frame).
              </div>
            ) : null}

            <div className="flex items-center gap-3 rounded-xl bg-white/[0.04] border border-white/[0.08] p-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-500/15 border border-violet-500/30">
                <MoreVertical className="h-4 w-4 text-violet-300" />
              </div>
              <div>
                <p className="text-xs font-semibold text-white">
                  {isAndroid
                    ? '1. Open Chrome Menu (⋮)'
                    : '1. Open in Chrome or Safari'}
                </p>
                <p className="text-[11px] text-slate-400">
                  {isAndroid
                    ? 'Tap the three-dot menu in the top-right corner of Google Chrome.'
                    : 'On Android open in Chrome; on desktop click the Install icon in Chrome’s address bar.'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 rounded-xl bg-white/[0.04] border border-white/[0.08] p-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-500/15 border border-blue-500/30">
                <Download className="h-4 w-4 text-blue-300" />
              </div>
              <div>
                <p className="text-xs font-semibold text-white">
                  2. Tap “Install app” or “Add to Home screen”
                </p>
                <p className="text-[11px] text-slate-400">
                  Confirm installation to launch GullyGroove in standalone mode.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onCopyUrl}
              className="w-full flex items-center justify-center gap-2 h-9 rounded-xl bg-white/[0.07] hover:bg-white/[0.12] border border-white/10 text-xs font-medium text-slate-200 transition-colors"
            >
              {copiedUrl ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span>App Link Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-violet-300" />
                  <span>Copy App Link to Open on Phone</span>
                </>
              )}
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={onClose}
          className="mt-5 w-full h-10 rounded-xl bg-gradient-to-r from-violet-600 to-blue-500 text-xs font-semibold text-white hover:opacity-95 transition-opacity"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
