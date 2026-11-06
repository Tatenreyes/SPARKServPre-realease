/**
 * Display formatting, in one place.
 *
 * `formatPeso` hands off to `formatMoney` (`@/lib/estimate-costs`) instead of
 * re-implementing it: that function is already the app's peso format (peso sign,
 * en-PH grouping, always two decimals) and is pinned by
 * `scripts/tests/estimate-costs.test.mjs`. A second implementation here could
 * print 300 for the same amount another screen prints as 300.00.
 */
import { formatMoney } from "./estimate-costs";

/** The app's one money format, e.g. 3,500.00 with the peso sign. */
export function formatPeso(amount: number | null | undefined): string {
  return formatMoney(amount);
}

/**
 * The app's one calendar-date format: "Nov 4, 2026".
 *
 * `en-US` with a short month is deliberate - it cannot be confused with the
 * numeric table formats, and it is stable in both themes. A bare `date` column
 * (`YYYY-MM-DD`) must be passed through `parseCalendarDate` first, because
 * `new Date("2026-12-04")` is UTC midnight and renders a day early west of UTC.
 */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "an unknown date";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "an unknown date";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
