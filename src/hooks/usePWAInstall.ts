import { useCallback, useEffect, useState } from 'react';

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

let sharedDeferredPrompt: BeforeInstallPromptEvent | null = null;
let sharedInstalled = false;
let listenersBound = false;
const subscribers = new Set<() => void>();

function notifySubscribers() {
  subscribers.forEach((cb) => cb());
}

function checkStandaloneMode(): boolean {
  if (typeof window === 'undefined') return false;
  const mediaStandalone = window.matchMedia?.('(display-mode: standalone)').matches ?? false;
  const iosStandalone =
    (window.navigator as unknown as { standalone?: boolean }).standalone === true;
  return mediaStandalone || iosStandalone;
}

function bindGlobalListeners() {
  if (listenersBound || typeof window === 'undefined') return;
  listenersBound = true;
  sharedInstalled = checkStandaloneMode();

  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault();
    sharedDeferredPrompt = e as BeforeInstallPromptEvent;
    notifySubscribers();
  });

  window.addEventListener('appinstalled', () => {
    sharedInstalled = true;
    sharedDeferredPrompt = null;
    notifySubscribers();
  });

  const mql = window.matchMedia?.('(display-mode: standalone)');
  if (mql?.addEventListener) {
    mql.addEventListener('change', (ev) => {
      if (ev.matches) {
        sharedInstalled = true;
        sharedDeferredPrompt = null;
        notifySubscribers();
      }
    });
  }
}

if (typeof window !== 'undefined') {
  bindGlobalListeners();
}

export function detectDevicePlatform() {
  if (typeof window === 'undefined') {
    return { isIOS: false, isAndroid: false, isSafariIOS: false };
  }
  const ua = window.navigator.userAgent.toLowerCase();
  const platform = (window.navigator.platform || '').toLowerCase();
  const maxTouchPoints = window.navigator.maxTouchPoints || 0;

  const isIOS =
    /iphone|ipad|ipod/.test(ua) ||
    (platform === 'macintel' && maxTouchPoints > 1);
  const isAndroid = !isIOS && /android/.test(ua);
  const isSafariIOS =
    isIOS && /safari/.test(ua) && !/crios|fxios|opios|edgios/.test(ua);

  return { isIOS, isAndroid, isSafariIOS };
}

export function usePWAInstall() {
  const [, setTick] = useState(0);
  const [{ isIOS, isAndroid, isSafariIOS }] = useState(() =>
    detectDevicePlatform()
  );

  useEffect(() => {
    bindGlobalListeners();
    const forceUpdate = () => setTick((t) => t + 1);
    subscribers.add(forceUpdate);
    if (checkStandaloneMode() && !sharedInstalled) {
      sharedInstalled = true;
      forceUpdate();
    }
    return () => {
      subscribers.delete(forceUpdate);
    };
  }, []);

  const install = useCallback(async (): Promise<
    'accepted' | 'dismissed' | 'unavailable'
  > => {
    if (!sharedDeferredPrompt) {
      return 'unavailable';
    }
    const promptEvent = sharedDeferredPrompt;
    await promptEvent.prompt();
    const { outcome } = await promptEvent.userChoice;
    if (outcome === 'accepted') {
      sharedInstalled = true;
      sharedDeferredPrompt = null;
      notifySubscribers();
      return 'accepted';
    }
    return 'dismissed';
  }, []);

  return {
    isInstallable: Boolean(sharedDeferredPrompt),
    isInstalled: sharedInstalled,
    isIOS,
    isAndroid,
    isSafariIOS,
    install,
  };
}
