/**
 * The REASON behind a score, in both directions.
 *
 * WHY THIS EXISTS. A bare 3 stars tells a technician that something was wrong and
 * nothing about what. Every two-way marketplace solved this the same way: Uber
 * asks for "a bit more feedback about why that rating was chosen" below five
 * stars, and Grab made the same change in 2019 — "clearer feedback on trips rated
 * 4 stars or less". Tags are that reason, and they are also what keeps a rating
 * ANONYMOUS: a technician can be told "two customers said the area was left
 * untidy" without ever being shown a sentence about one visit.
 *
 * THE TWO RULES THIS MODULE OWNS.
 *
 *   1. **Compliments are public; friction is platform-only.** `positiveTags()` is
 *      the only subset that may be rendered to the counterpart (the technician's
 *      public card, the customer's own dashboard). Everything else goes to the
 *      administrator. Uber draws the line in exactly the same place: riders pick
 *      "compliments" for a driver, and the complaints are collected by Uber.
 *   2. **An unknown key is dropped, never rendered.** A tag list is written by a
 *      browser, so `sanitizeTags()` keeps the keys this catalogue knows, in
 *      catalogue order, de-duplicated and capped — the same treatment every other
 *      user-supplied list in this codebase gets.
 *
 * Deliberately dependency-free (no React, no Supabase, no `@/` runtime import) so
 * the rules run in the pages and under Node's type stripping in the tests.
 */

export type RatingDirection = "customer_rates_technician" | "technician_rates_customer";

export interface RatingTag {
  key: string;
  label: string;
  /**
   * A compliment (may be published to the counterpart) or friction (admin-only).
   * Not a judgement about severity: "arrived late" is friction and "could not get
   * access" is friction, and both are still useful to whoever reads them.
   */
  positive: boolean;
}

/** What a customer may say about the visit. */
export const TECHNICIAN_TAGS: RatingTag[] = [
  { key: "on_time", label: "Arrived on time", positive: true },
  { key: "tidy", label: "Left the area tidy", positive: true },
  { key: "explained", label: "Explained the fault clearly", positive: true },
  { key: "polite", label: "Polite and professional", positive: true },
  { key: "fixed_first_visit", label: "Fixed it on the first visit", positive: true },
  { key: "late", label: "Arrived late", positive: false },
  { key: "left_a_mess", label: "Left a mess behind", positive: false },
  { key: "unclear", label: "Did not explain the work", positive: false },
  { key: "needed_second_visit", label: "Needed a second visit", positive: false },
  { key: "cost", label: "Cost was higher than expected", positive: false },
];

/**
 * What a technician may say about the visit. Anchored on the things that are
 * genuinely the customer's to control — being there, access, describing the fault
 * — never on whether they were "nice".
 */
export const CUSTOMER_TAGS: RatingTag[] = [
  { key: "ready_on_time", label: "Was ready on time", positive: true },
  { key: "clear_problem", label: "Described the problem clearly", positive: true },
  { key: "respectful", label: "Polite and respectful", positive: true },
  { key: "safe_access", label: "Safe and easy access", positive: true },
  { key: "no_access", label: "Could not get access", positive: false },
  { key: "unsafe", label: "Felt unsafe during the visit", positive: false },
  { key: "unclear_complaint", label: "The reported fault did not match", positive: false },
  { key: "hard_to_reach", label: "Hard to reach to arrange the visit", positive: false },
];

/** The most tags one rating may carry. A wall of tags is not a reason, it is noise. */
export const MAX_TAGS = 4;

export function tagsFor(direction: RatingDirection): RatingTag[] {
  return direction === "customer_rates_technician" ? TECHNICIAN_TAGS : CUSTOMER_TAGS;
}

export function tagByKey(direction: RatingDirection, key: string): RatingTag | null {
  return tagsFor(direction).find((tag) => tag.key === key) ?? null;
}

/** A tag's label, falling back to a humanised key for a row written by hand. */
export function labelForTag(direction: RatingDirection, key: string): string {
  const known = tagByKey(direction, key);
  if (known) return known.label;
  const spaced = key.replace(/_/g, " ").trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : key;
}

/**
 * The keys this catalogue knows, in catalogue order, de-duplicated and capped.
 * Anything else is dropped: the list arrives from a browser, and an unknown key
 * must never reach a screen (or the database) just because it was posted.
 */
export function sanitizeTags(direction: RatingDirection, keys: unknown): string[] {
  if (!Array.isArray(keys)) return [];
  const wanted = new Set(keys.filter((key): key is string => typeof key === "string"));
  return tagsFor(direction)
    .filter((tag) => wanted.has(tag.key))
    .slice(0, MAX_TAGS)
    .map((tag) => tag.key);
}

/** The only tags that may be rendered to the other party. */
export function positiveTags(direction: RatingDirection): RatingTag[] {
  return tagsFor(direction).filter((tag) => tag.positive);
}

/**
 * How often each tag was used, across every rating in hand — never tied to one
 * visit or one person. This is the shape an owner is allowed to see, and it is
 * what preserves anonymity while still answering "what should I do differently?".
 * Sorted by count, then by catalogue order so a tie is stable.
 */
export function tagCounts(
  rows: { tags?: string[] | null }[] | null | undefined,
  direction: RatingDirection
): { key: string; label: string; count: number; positive: boolean }[] {
  const catalogue = tagsFor(direction);
  const counts = new Map<string, number>();

  for (const row of rows ?? []) {
    for (const key of row.tags ?? []) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  return catalogue
    .map((tag, index) => ({ ...tag, count: counts.get(tag.key) ?? 0, index }))
    .filter((tag) => tag.count > 0)
    .sort((a, b) => b.count - a.count || a.index - b.index)
    .map(({ key, label, count, positive }) => ({ key, label, count, positive }));
}

/** The tags a counterpart may see, aggregated: compliments only, never friction. */
export function positiveTagCounts(
  rows: { tags?: string[] | null }[] | null | undefined,
  direction: RatingDirection
): { key: string; label: string; count: number }[] {
  return tagCounts(rows, direction)
    .filter((tag) => tag.positive)
    .map(({ key, label, count }) => ({ key, label, count }));
}

