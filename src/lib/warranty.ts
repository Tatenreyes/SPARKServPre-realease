/**
 * The workmanship warranty a completed repair carries, as the UI reads it.
 *
 * WHY THIS EXISTS. The fact is already stored and already trustworthy:
 * `supabase/migration_service_warranty.sql` (step 19) stamps
 * `service_history.warranty_days` / `warranty_until` on every completion, through
 * a trigger, so the period survives whichever code path wrote the archive row.
 * The job order prints it and the technician's Past jobs list shows it — but the
 * ADMIN workspace, the one place where "is this still covered?" changes what the
 * shop charges, showed nothing at all. This module is the single reading of that
 * date, so a badge, a chip and a filter cannot disagree about whether a repair is
 * still covered.
 *
 * THE ONE RULE THAT MATTERS: `warranty_until` is a `date` column, not a
 * timestamp. `new Date("2026-12-04")` is parsed as UTC midnight and renders as the
 * 3rd for every user west of UTC — the same off-by-one day `src/lib/job-order.ts`
 * documents for `payment_date`. So the string is split and rebuilt as a LOCAL
 * date here, and the comparison happens at local midnight.
 *
 * Deliberately dependency-free (no React, no Supabase) so the rules are unit
 * tested under Node's type stripping in `scripts/tests/warranty.test.mjs`.
 */

export type WarrantyStatus = "active" | "expiring_soon" | "expired" | "none";

/** How close the end of cover has to be before the badge turns cautionary. */
export const WARRANTY_SOON_DAYS = 7;

/**
 * The workmanship period a completed repair carries unless the database stamped
 * its own (`service_history.warranty_days`, set from `service_warranty_days()` -
 * 30 by default). The ONE place this number is written down: the customer's
 * service history falls back to it for an archive row that carries no stamped
 * date, so the screen and the shop cannot disagree about how long cover lasts.
 */
export const WARRANTY_DAYS = 30;

export interface WarrantyState {
  status: WarrantyStatus;
  /** Days of cover left at the end of the expiry day; negative once it has passed. */
  daysLeft: number | null;
  /** Short phrase with no date in it, so it is locale-independent and testable. */
  summary: string;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * `"2026-12-04"` (or a full ISO timestamp) as a LOCAL calendar date at midnight.
 * Returns null for a missing or unparseable value: a repair archived before step
 * 19 has no warranty date, and the UI must then claim nothing rather than guess.
 */
export function parseCalendarDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value).trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);

  // Rejects a rolled-over date such as 2026-02-30, which JS would silently turn
  // into the 2nd of March.
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
}

/** Local midnight, so two dates can be compared in whole days. */
export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * The cover on one repair, as of `today`.
 *
 * A `0`-day warranty is a real answer — the shop offers no workmanship cover —
 * and reads as "No warranty recorded", the same wording the technician's Past
 * jobs list already uses, so the two screens cannot describe one repair
 * differently.
 */
export function warrantyState(
  until: string | null | undefined,
  today: Date = new Date()
): WarrantyState {
  const expiry = parseCalendarDate(until);
  if (!expiry) return { status: "none", daysLeft: null, summary: "No warranty recorded" };

  const daysLeft = Math.round(
    (expiry.getTime() - startOfDay(today).getTime()) / MS_PER_DAY
  );

  if (daysLeft < 0) {
    return {
      status: "expired",
      daysLeft,
      summary: `Expired ${plural(Math.abs(daysLeft), "day")} ago`,
    };
  }

  return {
    status: daysLeft <= WARRANTY_SOON_DAYS ? "expiring_soon" : "active",
    daysLeft,
    // "0 days left" is the last day of cover, which is still cover.
    summary: daysLeft === 0 ? "Ends today" : `${plural(daysLeft, "day")} left`,
  };
}

/**
 * Which filter chip a repair belongs under. Kept beside `warrantyState` so the
 * chip and the badge can never classify one repair differently.
 */
export function warrantyFilterKey(
  until: string | null | undefined,
  today: Date = new Date()
): "covered" | "not_covered" {
  const { status } = warrantyState(until, today);
  return status === "active" || status === "expiring_soon" ? "covered" : "not_covered";
}

/** The vocabulary and labels for the warranty facet, shared by every screen. */
export const WARRANTY_FILTER_VALUES = ["covered", "not_covered"] as const;

export const WARRANTY_FILTER_LABELS: Record<string, string> = {
  covered: "Covered",
  not_covered: "Not covered",
};
