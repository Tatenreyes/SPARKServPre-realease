"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";

/**
 * The live time on the shop's clock, shown beside the service date picker.
 *
 * DISPLAY ONLY. It holds no form state and touches no validation or payload — it
 * reads the wall clock and prints it, nothing else.
 *
 * WHY IT APPEARS ONLY AFTER MOUNT. The page is server-rendered, and a clock that
 * read `new Date()` during render would print one instant in the server's HTML and
 * a different one on the client, which React reports as a hydration mismatch. It
 * starts as `null` (a stable placeholder on the server and on the first client
 * render) and only fills in from an effect, once the browser owns the page.
 *
 * `Asia/Manila` is the service timezone (see `service-windows.ts`), stated
 * explicitly so a customer whose device is in another zone still reads the time a
 * technician works by. `aria-live="off"` because the value ticks every second and
 * a live region would announce the clock sixty times a minute.
 */
const TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Manila",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  hour12: true,
});

const DATE = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Manila",
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
});

export default function PhilippineClock({ serverNow }: { serverNow?: number }) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    /**
     * Anchor to the server's clock when it is known, so a device whose own clock is
     * set wrong — a VM that never synced, a phone set by hand — still reads the
     * shop's real time. `offset` is how far the device clock is from the server's;
     * when the two agree it is ~0 and nothing changes.
     */
    const offset = typeof serverNow === "number" ? serverNow - Date.now() : 0;
    const tick = () => setNow(new Date(Date.now() + offset));

    // One immediate tick, then once a second. The interval is cleared on unmount so
    // a section the customer collapses or navigates away from stops re-rendering.
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [serverNow]);

  return (
    <div className="flex items-center gap-3 rounded-card border border-line bg-surface p-4 shadow-card">
      <span
        aria-hidden="true"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-ink"
      >
        <Clock className="h-5 w-5" />
      </span>

      <div className="min-w-0 flex-1">
        <p
          aria-live="off"
          className="font-display text-2xl font-semibold tabular-nums text-ink"
        >
          {now ? TIME.format(now) : "--:--:-- --"}
        </p>
        <p className="mt-0.5 text-xs text-muted">
          {now ? DATE.format(now) : "\u00A0"}
        </p>
      </div>

      <span className="shrink-0 self-start text-xs font-semibold uppercase tracking-wide text-muted">
        Philippine time
      </span>
    </div>
  );
}
