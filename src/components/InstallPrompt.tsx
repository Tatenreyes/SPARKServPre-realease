"use client";

import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";

/**
 * Chrome's install prompt is not a public DOM event type, so it is declared here.
 * Only the two members this component uses are described.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * Dismissal is remembered. The people who use this app are on site, often on a phone
 * they will not install to, and a banner that returns on every page is noise — the
 * opposite of the calm the rest of the interface is trying to project.
 */
const DISMISSED_KEY = "sparkserv:install-dismissed";

/**
 * Offers to install SPARKServ to the home screen, and registers the service worker.
 *
 * ## Why the registration lives here
 *
 * Until now the worker was only registered when a customer pressed "turn on push
 * notifications" (`src/lib/enablePush.ts`). That is enough for push, but not for
 * installability: Chrome's criteria expect a registered worker with a fetch handler
 * on an ordinary page load. Registering on mount means a visitor who never touches
 * notifications can still install the app.
 *
 * ## What it refuses to do
 *
 * It never prompts on its own. `beforeinstallprompt` is the browser's own signal
 * that the app is installable and the visitor is eligible, and the prompt is only
 * shown when they press the button — an unprompted install dialog is the fastest way
 * to have a banner dismissed forever. Browsers that never fire the event (iOS
 * Safari) simply see nothing, which is why `layout.tsx` still declares an
 * `apple-touch-icon`.
 */
export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(DISMISSED_KEY) === "true");
    } catch {
      // Private mode, or storage disabled: fall back to "already dismissed" rather
      // than showing a banner that cannot be remembered.
      setDismissed(true);
    }

    if ("serviceWorker" in navigator) {
      // Idempotent: `register` returns the existing registration, so this and the
      // push path cannot fight over the worker.
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }

    function onBeforeInstall(event: Event) {
      // Suppressing the default keeps the browser's own mini-infobar from competing
      // with the app's.
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    }

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstall);
  }, []);

  function dismiss() {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISSED_KEY, "true");
    } catch {
      // Nothing to do: the banner is hidden for this session either way.
    }
  }

  if (!deferred || dismissed) return null;

  return (
    <div className="fixed inset-x-3 bottom-20 z-40 flex items-center gap-3 rounded-card border border-line bg-surface p-3 shadow-card lg:bottom-4 lg:left-auto lg:right-4 lg:max-w-sm">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-ink">
        <Download className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink">Install SPARKServ</p>
        <p className="text-xs text-muted">
          Keep the app on your home screen and get notified about your repair.
        </p>
      </div>
      <button
        type="button"
        onClick={async () => {
          await deferred.prompt();
          await deferred.userChoice.catch(() => undefined);
          setDeferred(null);
        }}
        className="inline-flex h-9 shrink-0 items-center rounded-lg bg-brand-500 px-3 text-xs font-semibold text-white transition duration-200 hover:bg-brand-600"
      >
        Install
      </button>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="shrink-0 rounded-lg p-1.5 text-muted transition hover:bg-soft hover:text-ink"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
