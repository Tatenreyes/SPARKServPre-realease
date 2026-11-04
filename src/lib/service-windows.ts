// Relative and with the extension, not `@/lib/time-of-day`: Node's type stripping
// does not resolve tsconfig path aliases, and the tests import THIS module for real
// (`scripts/tests/appliance-fields.test.mjs`). The same reason
// `appliance-brands.ts`, `issue-matching.ts` and `job-order.ts` import that way.
import { type ClockTime, formatClockTime, minutesOfDay, toClockTime } from "./time-of-day.ts";

/**
 * WHEN THE SHOP ACTUALLY WORKS, and every window a customer may ask for.
 *
 * WHY THIS EXISTS. The preferred-time control was six dropdowns (hour, minute,
 * AM/PM, twice) over a five-minute grid of the whole day, so a customer could ask
 * for 1:00–2:00 AM. That is not a preference the shop can honour, and it is worse
 * than useless: `technician_within_availability()` has to find somebody free across
 * the entire span, so such a request sits in `waiting` for ever while looking
 * perfectly normal on screen. Meanwhile the honest answer — "we're in your area
 * between 9 and 11" — took three selects to express.
 *
 * So the day is stated once, here, and every legal window is GENERATED from it:
 *
 *   * open 09:00–16:00, closed 11:00–13:00 (the Philippine lunch break, which is
 *     why the day is two blocks and not one);
 *   * flexible choices ("any time that day", the whole morning, the whole
 *     afternoon) for the common case;
 *   * half-hour slots for a specific one;
 *   * and a named time at five-minute precision for "9:20", which is why the
 *     clock times below exist at all.
 *
 * THE ONE INVARIANT, enforced by `isServiceRange()` in the form AND in the API: a
 * window must sit inside the open hours and must not cross the break. A span that
 * crosses lunch is not a preference the queue can ever satisfy, so it is refused
 * with a sentence a person can act on rather than stored and forgotten.
 *
 * Deliberately dependency-free beyond `time-of-day.ts` (no React, no Supabase) so
 * the tests run the real rules under Node's type stripping.
 */

/** The shop's day, in the service timezone (Asia/Manila by default). */
export const SERVICE_HOURS = {
  opens: "09:00",
  closes: "16:00",
  /** Closed for lunch. A window may not cross it. */
  break: { start: "11:00", end: "13:00" },
} as const;

/** Choices that say "sometime in this block" rather than naming a slot. */
export const FLEXIBLE_WINDOWS = [
  { key: "morning", start: "09:00", end: "11:00" },
  { key: "afternoon", start: "13:00", end: "16:00" },
] as const;

/** How wide a generated slot is, and how far apart slots start. */
export const WINDOW_MINUTES = 30;
export const WINDOW_STEP_MINUTES = 30;

/** Granularity of a time the customer names themselves ("9:20"). */
export const CLOCK_STEP_MINUTES = 5;

/** The key the form uses for "a different time…", i.e. the two pickers. */
export const CUSTOM_WINDOW_KEY = "custom";

/**
 * How long the APPOINTMENT occupies the technician, independent of the window.
 * A 30-minute arrival window does not mean a 30-minute repair, and a 3-hour
 * "any time in the afternoon" window must not ring-fence three hours of a
 * technician's day — that is capacity the shop still needs for the next job.
 */
export const REQUEST_DURATION_MINUTES = 120;

/** One selectable window. `key` is stable and is what the form holds. */
export interface ServiceWindow {
  key: string;
  start: string;
  end: string;
}

const OPEN = minutesOfDay(SERVICE_HOURS.opens);
const CLOSE = minutesOfDay(SERVICE_HOURS.closes);
const BREAK_START = minutesOfDay(SERVICE_HOURS.break.start);
const BREAK_END = minutesOfDay(SERVICE_HOURS.break.end);

/**
 * True when the shop's hours are readable. A typo in the constants then yields NO
 * options rather than a plausible-looking wrong day.
 */
function hoursKnown(): boolean {
  return OPEN !== null && CLOSE !== null && BREAK_START !== null && BREAK_END !== null;
}

/** Does `[from, to)` intersect the lunch break? */
function crossesBreak(from: number, to: number): boolean {
  if (BREAK_START === null || BREAK_END === null) return true;
  return from < BREAK_END && to > BREAK_START;
}

/**
 * Every half-hour slot the shop can promise, in clock order. Generated from
 * `SERVICE_HOURS`, so widening the day (or changing the step) reshapes the whole
 * list without touching the form or the API.
 */
export function serviceWindows(): ServiceWindow[] {
  if (!hoursKnown()) return [];
  const windows: ServiceWindow[] = [];

  for (
    let start = OPEN as number;
    start + WINDOW_MINUTES <= (CLOSE as number);
    start += WINDOW_STEP_MINUTES
  ) {
    const end = start + WINDOW_MINUTES;
    if (crossesBreak(start, end)) continue;
    const from = toClockTime(Math.floor(start / 60), start % 60);
    const to = toClockTime(Math.floor(end / 60), end % 60);
    windows.push({ key: `${from}-${to}`, start: from, end: to });
  }

  return windows;
}

/**
 * Every clock time a customer may name: the open hours at five-minute steps, with
 * the lunch break left out. `16:00` is included because it is a legal END (a
 * 15:30–16:00 window); it can never be a legal start, which `isServiceRange`
 * refuses anyway.
 */
export function serviceClockTimes(step: number = CLOCK_STEP_MINUTES): ClockTime[] {
  if (!hoursKnown()) return [];
  const times: ClockTime[] = [];

  for (let minute = OPEN as number; minute <= (CLOSE as number); minute += step) {
    if (crossesBreak(minute, minute)) continue;
    times.push({ hour: Math.floor(minute / 60), minute: minute % 60 });
  }

  return times;
}

/**
 * The whole rule, in one place, used by the form and by the API.
 *
 * A window is legal when it ends after it starts, sits inside the open hours, and
 * does not cross the lunch break. The break is not pedantry: eligibility asks
 * whether a technician is free across the WHOLE span, so a window spanning lunch
 * can never be offered to anybody.
 */
export function isServiceRange(
  start: string | null | undefined,
  end: string | null | undefined
): boolean {
  if (!hoursKnown()) return false;

  const from = minutesOfDay(start);
  const to = minutesOfDay(end);
  if (from === null || to === null) return false;
  if (to <= from) return false;
  if (from < (OPEN as number) || to > (CLOSE as number)) return false;
  if (crossesBreak(from, to)) return false;

  return true;
}

/** "9:20 AM – 10:20 AM", how a window reads back to the customer. */
export function windowLabel(
  start: string | null | undefined,
  end: string | null | undefined
): string {
  const from = formatClockTime(start);
  const to = formatClockTime(end);
  return from && to ? `${from} – ${to}` : "";
}

/**
 * The window a form choice means, or null for "any time that day".
 *
 * The single place that turns a key into a pair, so the form's state, its summary
 * line and the request body cannot disagree about what was chosen.
 */
export function resolveWindow(
  choice: string,
  customStart = "",
  customEnd = ""
): { start: string; end: string } | null {
  if (!choice) return null;

  if (choice === CUSTOM_WINDOW_KEY) {
    return isServiceRange(customStart, customEnd)
      ? { start: customStart, end: customEnd }
      : null;
  }

  const flexible = FLEXIBLE_WINDOWS.find((window) => window.key === choice);
  if (flexible) return { start: flexible.start, end: flexible.end };

  const slot = serviceWindows().find((window) => window.key === choice);
  return slot ? { start: slot.start, end: slot.end } : null;
}

