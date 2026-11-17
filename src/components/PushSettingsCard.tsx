"use client";

import { useEffect, useState } from "react";
import { BellRing, Check, Loader2, TriangleAlert } from "lucide-react";
import { enablePushNotifications } from "@/lib/enablePush";

/**
 * Browser push, on or off.
 *
 * The topbar bell can only ever turn push ON (`NotificationBell`), so a
 * technician who changed their mind had to go find the setting in their browser.
 * This card owns both directions with the same helper (`enablePushNotifications`)
 * and the same API (`POST`/`DELETE /api/push-subscriptions`), and it is honest
 * about the three states that are not "on":
 *
 *   default     — we can ask, so the button offers to
 *   denied      — the browser is blocking us and only the browser can undo that
 *   unsupported — no PushManager, or no VAPID key configured on the server
 *
 * The subscription itself is the source of truth for "on", not the permission:
 * permission can be granted while this device has nothing registered, which is
 * exactly the state a fresh browser is in.
 */
type PushState = "checking" | "off" | "on" | "denied" | "unsupported";

export default function PushSettingsCard() {
  const [state, setState] = useState<PushState>("checking");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function read() {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        if (!cancelled) setState("unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        if (!cancelled) setState("denied");
        return;
      }

      try {
        const registration = await navigator.serviceWorker.getRegistration();
        const subscription = await registration?.pushManager.getSubscription();
        if (!cancelled) setState(subscription ? "on" : "off");
      } catch {
        if (!cancelled) setState("off");
      }
    }

    read();
    return () => {
      cancelled = true;
    };
  }, []);

  async function turnOn() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await enablePushNotifications();
      setState(result === "granted" ? "on" : result === "denied" ? "denied" : "unsupported");
      if (result === "granted") {
        setMessage("Push notifications are on for this device.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    setMessage(null);
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();

      if (subscription) {
        // Delete the row FIRST: if the browser unsubscribes and the delete never
        // lands, the server would keep pushing to an endpoint nobody receives.
        await fetch("/api/push-subscriptions", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        }).catch(() => {});
        await subscription.unsubscribe();
      }

      setState("off");
      setMessage("Push notifications are off for this device.");
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
                  : "Off for this device"}
        </p>

        {state === "on" && (
          <button
            type="button"
            onClick={turnOff}
            disabled={busy}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-sm font-semibold text-ink transition-colors duration-200 hover:border-brand-600 hover:bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-60 dark:hover:border-[#81EDF4] dark:focus-visible:ring-[#81EDF4]"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Turn off
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
          This browser does not support push notifications. You will still see everything in
          the notification bell while you are signed in.
        </p>
      )}

      {message && (
        <p role="status" className="mt-2 flex items-center gap-2 text-xs font-medium text-signal-ink">
          <Check className="h-3.5 w-3.5" aria-hidden="true" />
          {message}
        </p>
      )}

    </section>
  );
}
