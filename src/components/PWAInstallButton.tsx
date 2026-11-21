import { useState } from 'react';
import { CheckCircle2, Download, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  variant?: 'compact' | 'settings';
}

export function PWAInstallButton({ variant = 'compact' }: PWAInstallButtonProps) {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) {
    if (variant === 'settings') {
      return (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2.5 text-xs text-emerald-200">
          <span className="inline-flex items-center gap-2 font-medium">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            Installed as Standalone PWA
          </span>
        </div>
      );
    }
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => void install()}
        aria-label="Install Personal AI Studio app"
        className={
          variant === 'settings'
            ? 'w-full min-h-[42px] px-3.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-[#052317] text-xs font-semibold inline-flex items-center justify-center gap-2 transition-colors'
            : 'min-h-[38px] px-2.5 rounded-lg border border-emerald-500/35 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap transition-colors'
        }
      >
        <Download className="w-3.5 h-3.5" />
        <span>Install App</span>
      </button>
    );
  }

  if (isIOS || variant === 'settings') {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowGuide(true)}
          className={
            variant === 'settings'
              ? 'w-full min-h-[40px] px-3.5 rounded-xl border border-white/[0.1] bg-white/[0.04] hover:bg-white/[0.08] text-zinc-200 text-xs font-medium inline-flex items-center justify-center gap-2 transition-colors'
              : 'min-h-[38px] px-2.5 rounded-lg border border-white/[0.1] text-zinc-300 hover:bg-white/[0.06] text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap'
          }
        >
          <Smartphone className="w-3.5 h-3.5 text-emerald-400" />
          <span>{isIOS ? 'Install on iOS' : 'Install on Android / Browser'}</span>
        </button>

        {showGuide && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Install Personal AI Studio"
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
          >
            <div
              aria-hidden="true"
              onClick={() => setShowGuide(false)}
              className="fixed inset-0 bg-black/70 backdrop-blur-sm"
            />
            <div className="relative z-10 w-full max-w-sm rounded-2xl border border-white/[0.12] bg-[#10141A] p-5 shadow-2xl space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-zinc-100">Install Personal AI Studio</h3>
                <button
                  type="button"
                  onClick={() => setShowGuide(false)}
                  aria-label="Close install instructions"
                  className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-100"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              {isIOS ? (
                <ol className="text-xs text-zinc-300 space-y-2 leading-relaxed list-decimal list-inside">
                  <li>Tap the <strong>Share</strong> button in Safari.</li>
                  <li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>
                  <li>Launch Personal AI Studio from your home screen.</li>
                </ol>
              ) : (
                <ol className="text-xs text-zinc-300 space-y-2 leading-relaxed list-decimal list-inside">
                  <li>Open the browser menu (three dots in Chrome on Android).</li>
                  <li>Tap <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li>
                  <li>Local projects, conversations, and settings stay saved offline in IndexedDB.</li>
                </ol>
              )}
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="w-full min-h-[40px] rounded-xl bg-emerald-500 hover:bg-emerald-400 text-[#052317] text-xs font-semibold"
              >
                Got it
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
}
