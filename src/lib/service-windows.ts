// Relative and with the extension, not `@/lib/time-of-day`: Node's type stripping
// does not resolve tsconfig path aliases, and the tests import THIS module for real
// (`scripts/tests/appliance-fields.test.mjs`). The same reason
// `appliance-brands.ts`, `issue-matching.ts` and `job-order.ts` import that way.
import {
  type ClockTime,
  formatClockTime,
  hour12Of,
  meridiemOf,
  minutesOfDay,
  toClockTime,
} from "./time-of-day.ts";

/**
 * WHEN THE SHOP ACTUALLY WORKS, and every window a customer may ask for.
 *
 * WHY THIS EXISTS. This control has been redesigned twice around the same mistake.
 * It began as six dropdowns (hour, minute, AM/PM, twice) over a five-minute grid of
 * the whole day, so a customer could ask for 1:00–2:00 AM. That is not a preference
 * the shop can honour, and it is worse than useless: eligibility has to find a
 * technician free across the entire span, so such a request sits in `waiting` for
 * ever while looking perfectly normal on screen. It then became one dropdown of
 * ready-made choices, which removed the illegal times but buried the ordinary
 * answer ("we're in your area between 9 and 11") behind preset lists nobody reads.
 * Either way the shop's day was only ever something the control filtered against.
 *
 * So the day is stated once, here, and every option the customer can see is
 * GENERATED from it:
 *
 *   * open 09:00–16:00, closed 11:00–13:00 (the Philippine lunch break, which is
 *     why the day is two blocks and not one);
 *   * hour choices that carry their own half of the day (`9 AM`, `1 PM`), so 9 PM
 *     and 4 AM cannot be assembled rather than being refused;
 *   * minutes as the five-minute steps that exist inside the chosen hour;
 *   * an end pool bounded by the chosen start AND by the block that start sits in,
 *     so a window across lunch is never offered;
 *   * and the flexible blocks kept as one-tap fills ("Morning", "Afternoon").
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

/**
 * The day's two blocks: what the one-tap fills mean, and the span a window may not
 * cross. `blockContaining()` reads them, so moving the lunch break moves the blocks
 * AND the options every picker offers.
 */
export const FLEXIBLE_WINDOWS = [
  { key: "morning", start: "09:00", end: "11:00" },
  { key: "afternoon", start: "13:00", end: "16:00" },
] as const;

/** Granularity of a time the customer names themselves ("9:20"). */
export const CLOCK_STEP_MINUTES = 5;

/**
 * How long the APPOINTMENT occupies the technician, independent of the window.
 * A 30-minute arrival window does not mean a 30-minute repair, and a 3-hour
 * "any time in the afternoon" window must not ring-fence three hours of a
 * technician's day — that is capacity the shop still needs for the next job.
 */
export const REQUEST_DURATION_MINUTES = 120;

/**
 * One hour the customer may pick, carrying the half of the day the hour itself
 * implies.
 *
 * The `label` (`9 AM`, `1 PM`) is the point of the redesign: there is no separate
 * AM/PM control to get wrong, so 9 PM and 4 AM are not offered, refused or hidden,
 * they cannot be assembled from these options at all.
 */
export interface ServiceHour {
  /** 0-23, what the form and the request body hold. */
  hour: number;
  /** 1-12, for the label. */
  hour12: number;
  meridiem: "AM" | "PM";
  /** `"9 AM"`. */
  label: string;
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
 * The block of the day a minute falls in, or null when it falls in neither (during
 * the lunch break, before opening, after closing).
 *
 * `FLEXIBLE_WINDOWS` IS the day's two blocks, so this reads them instead of
 * restating 11:00 and 13:00: moving the break moves the blocks, and every option
 * the pickers offer moves with them.
 */
function blockContaining(minute: number): (typeof FLEXIBLE_WINDOWS)[number] | null {
  return (
    FLEXIBLE_WINDOWS.find((window) => {
      const start = minutesOfDay(window.start);
      const end = minutesOfDay(window.end);
      return start !== null && end !== null && minute >= start && minute <= end;
    }) ?? null
  );
}

/**
 * The hour choices a pool of times contains, in clock order, each labelled with its
 * own AM/PM. `serviceClockTimes()` yields 9, 10, 11 AM then 1, 2, 3, 4 PM, so the
 * label is what makes the half of the day unambiguous on screen.
 */
export function windowHours(times: ClockTime[]): ServiceHour[] {
  const seen = new Set<number>();
  const hours: ServiceHour[] = [];

  for (const time of times) {
    if (seen.has(time.hour)) continue;
    seen.add(time.hour);
    const hour12 = hour12Of(time.hour);
    const meridiem = meridiemOf(time.hour);
    hours.push({ hour: time.hour, hour12, meridiem, label: `${hour12} ${meridiem}` });
  }

  return hours.sort((a, b) => a.hour - b.hour);
}

/**
 * The minutes a pool offers, ascending: those of one hour when `hour` is given, and
 * every minute the pool contains when it is not.
 *
 * The minute box is filled from here, so it can only hold a minute that exists for
 * the chosen hour (10:55 is real, 10:57 is not on the grid at all).
 */
export function windowMinutes(times: ClockTime[], hour: number | null = null): number[] {
  const minutes = times
    .filter((time) => hour === null || time.hour === hour)
    .map((time) => time.minute);
  return [...new Set(minutes)].sort((a, b) => a - b);
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
 * Every time that may START a window: the ones with at least one legal end after
 * them, inside their own block.
 *
 * This is why 11:00 AM and 4:00 PM are not start options: 11:00 AM would run into
 * the lunch break and 4:00 PM is closing time, so `isServiceRange()` refuses both.
 * Derived rather than hand-listed, so the start list can never offer a time the API
 * would drop in silence.
 */
export function windowStartTimes(times: ClockTime[] = serviceClockTimes()): ClockTime[] {
  return times.filter(
    (time) => windowEndTimes(toClockTime(time.hour, time.minute), times).length > 0
  );
}

/**
 * Every time that may END a window starting at `start`: strictly later, and never
 * past the end of the block `start` sits in.
 *
 * The block bound is the second half of the redesign. A 10:30 AM start offers ends
 * up to 11:00 AM and no further, so a window across the lunch break
 * (10:30 AM – 1:30 PM) is never offered, where it used to be offerable and then
 * dropped in silence by the form and again by the API.
 */
export function windowEndTimes(
  start: string | null | undefined,
  times: ClockTime[] = serviceClockTimes()
): ClockTime[] {
  const from = minutesOfDay(start);
  if (from === null) return [];

  const block = blockContaining(from);
  const blockEnd = block ? minutesOfDay(block.end) : null;
  if (blockEnd === null) return [];

  return times.filter((time) => {
    const at = time.hour * 60 + time.minute;
    return at > from && at <= blockEnd;
  });
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
 * The window a pair of picks means, or null for "any time that day".
 *
 * The single place the form's two boxes become a window, so the form's state, its
 * summary line and the request body cannot disagree about what was chosen. Both
 * halves are required, and the pair must satisfy `isServiceRange()`, so half a
 * window, an inverted one and one across lunch all resolve to nothing rather than to
 * something the API would drop.
 */
export function resolveWindowPair(
  start: string | null | undefined,
  end: string | null | undefined
): { start: string; end: string } | null {
  if (!start || !end) return null;
  return isServiceRange(start, end) ? { start, end } : null;
}

