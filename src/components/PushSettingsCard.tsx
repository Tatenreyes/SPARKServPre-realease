"use client";

import { useEffect, useState } from "react";
import { BellRing, Check, Loader2, TriangleAlert } from "lucide-react";
import { disablePushNotifications, enablePushNotifications, getPushNotificationState } from "@/lib/enablePush";

type PushState = Awaited<ReturnType<typeof getPushNotificationState>> | "checking" | "unknown" | "cleanup";

export default function PushSettingsCard() {
  const [state, setState] = useState<PushState>("checking");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkAttempt, setCheckAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getPushNotificationState().then((status) => {
      if (!cancelled) setState(status);
    }).catch(() => {
      if (!cancelled) setState("unknown");
    });
    return () => { cancelled = true; };
  }, [checkAttempt]);

  async function turnOn() {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const result = await enablePushNotifications();
      if (result === "granted") {
        setState("on");
        setMessage("Push notifications are on for this device.");
      } else {
        setState(result === "default" ? "off" : result);
      }
    } catch {
      setError("Could not turn on push notifications. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const result = await disablePushNotifications();
      if (result === "removed") {
        setState("off");
        setMessage("Push notifications are off for this device.");
      } else {
        setState("cleanup");
        setError("SPARKServ stopped sending push notifications. Try again to finish removing the browser subscription.");
      }
    } catch {
      setError("Could not turn off push notifications. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-card border border-line bg-surface p-4 shadow-[0_1px_2px_rgba(16,38,74,0.04)] sm:p-5">
      <h2 className="font-display text-[15px] font-semibold text-ink">Push notifications</h2>
      <p className="mt-0.5 text-xs leading-relaxed text-muted">
        New job offers, schedule changes and messages, sent to this browser even when
        SPARKServ is closed. Applies to this device only.
      </p>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-soft px-3.5 py-3">
        <p className="flex items-center gap-2 text-sm font-semibold text-ink">
          <BellRing className="h-4 w-4 text-muted" aria-hidden="true" />
          {state === "on"
            ? "On for this device"
            : state === "checking"
              ? "Checking this device..."
              : state === "denied"
                ? "Blocked in your browser"
                : state === "unsupported"
                  ? "Not available in this browser"
                  : state === "unknown"
                    ? "Could not check this device"
                    : state === "cleanup"
                      ? "Browser cleanup incomplete"
                      : "Off for this device"}
        </p>

        {(state === "on" || state === "cleanup") && (
          <button
            type="button"
            onClick={turnOff}
            disabled={busy}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-sm font-semibold text-ink transition-colors duration-200 hover:border-brand-600 hover:bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-60 dark:hover:border-[#81EDF4] dark:focus-visible:ring-[#81EDF4]"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {state === "cleanup" ? "Retry removal" : "Turn off"}
          </button>
        )}

        {state === "unknown" && (
          <button
            type="button"
            onClick={() => { setState("checking"); setCheckAttempt((count) => count + 1); }}
            className="inline-flex min-h-11 items-center rounded-xl border border-line bg-surface px-4 text-sm font-semibold text-ink hover:bg-brand-soft"
          >
            Check again
          </button>
        )}

        {state === "off" && (
          <button
            type="button"
            onClick={turnOn}
            disabled={busy}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white transition-colors duration-200 hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-60 dark:focus-visible:ring-[#81EDF4]"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Turn on
          </button>
        )}
      </div>

      {state === "denied" && (
        <p className="mt-2 flex items-start gap-2 text-xs leading-relaxed text-warn-ink">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Your browser is blocking notifications for SPARKServ. Allow them in the
          browser&apos;s site settings for this page, then come back here.
        </p>
      )}

      {state === "unsupported" && (
        <p className="mt-2 text-xs leading-relaxed text-muted">
          Push notifications are unavailable on this device. You will still see everything in
          the notification bell while you are signed in.
        </p>
      )}

      {error && <p role="alert" className="mt-2 text-xs font-medium text-alert-ink">{error}</p>}

      {message && (
        <p role="status" className="mt-2 flex items-center gap-2 text-xs font-medium text-signal-ink">
          <Check className="h-3.5 w-3.5" aria-hidden="true" />
          {message}
        </p>
      )}

    </section>
  );
}
