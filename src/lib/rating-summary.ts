/**
 * How a set of ratings becomes a number, in BOTH directions.
 *
 * WHY THIS EXISTS. `averageRating()` in `src/lib/technician-profile.ts` averages
 * every row it is handed, which was the right answer while there was one direction
 * and one screen. Two-way ratings and a published average need three rules it does
 * not carry, and all three come from how the platforms that have run this at scale
 * for a decade actually do it:
 *
 *   1. **A ROLLING WINDOW.** Uber: "Your rating is an average of the last 500
 *      ratings you've received." A lifetime average cannot be repaired — one bad
 *      first month follows a technician forever, which is the "not correctable
 *      with improved behaviour" failure the gig-economy critique names. Here the
 *      window is the last 20, which is what a shop of this size will reach.
 *   2. **PROTECTION FROM A HABITUALLY LOW RATER.** Uber removes ratings "from
 *      riders who frequently give drivers low ratings", because a score that is
 *      low every time is a statement about the rater. `habitualLowRaters()` is
 *      that judgement, made from the rater's OWN history across everybody.
 *   3. **NEVER AN INVENTED ZERO.** No ratings is not a score of zero — the rule
 *      `formatRating()` already enforces, restated here for the new direction.
 *
 * NOTHING HERE RANKS ANYBODY. It returns a number and a count for a screen; the
 * queue never reads it, and `recommendation.ts` stays unused.
 *
 * Deliberately dependency-free (no React, no Supabase, no `@/` runtime import) so
 * the rules run in the pages and under Node's type stripping in the tests.
 */

/** Ratings newer than this many are ignored. Uber uses 500; this shop needs 20. */
export const RATING_WINDOW = 20;

/** Fewer than this many ratings given, and a rater is not judged at all. */
export const HABITUAL_MINIMUM_RATINGS = 3;

/** A score at or below this counts as low when judging a rater. */
export const HABITUAL_LOW_MAX = 2;

/** This share of a rater's ratings being low is what makes them "habitually low". */
export const HABITUAL_LOW_SHARE = 0.7;

/** A rating row, as every caller here can supply it. */
export interface RatingLike {
  rating: number | null;
  created_at?: string | null;
}

export interface RatingSummary {
  /** One decimal, or null when there is nothing to average. Never 0 for "none". */
  average: number | null;
  /** Ratings inside the window that were counted. */
  count: number;
  /** Every rating handed in, including the ones protection dropped. */
  total: number;
  /** How many were dropped as a habitually-low rater's. */
  excluded: number;
}

/** A real score: an integer 1..5. Anything else is a corrupt row, not a zero. */
function usable(rating: number | null | undefined): rating is number {
  return typeof rating === "number" && Number.isInteger(rating) && rating >= 1 && rating <= 5;
}

/**
 * The newest `window` usable ratings, newest first. Rows without a date keep the
 * order they arrived in (a caller that does not select `created_at` still gets a
 * window rather than everything).
 */
export function recentRatings<T extends RatingLike>(
  rows: readonly T[] | null | undefined,
  window: number = RATING_WINDOW
): T[] {
  const usableRows = (rows ?? []).filter((row) => usable(row.rating));
  if (usableRows.length <= window) return [...usableRows];

  const dated = usableRows.every((row) => Boolean(row.created_at));
  if (!dated) return usableRows.slice(0, window);

  return [...usableRows]
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, window);
}

/**
 * Who rates everything badly, judged on their own record across all technicians.
 *
 * "Frequently gives low ratings" is not one bad day: it is a pattern, so a rater
 * needs `minimumRatings` on record before this looks at them at all, and then
 * `lowShare` of those must be low. A single furious 1★ from somebody who has
 * otherwise been fair changes nothing — which is the point.
 */
export function habitualLowRaters(
  rows: readonly { rater_id: string; rating: number | null }[] | null | undefined,
  options: {
    minimumRatings?: number;
    lowMax?: number;
    lowShare?: number;
  } = {}
): Set<string> {
  const minimum = options.minimumRatings ?? HABITUAL_MINIMUM_RATINGS;
  const lowMax = options.lowMax ?? HABITUAL_LOW_MAX;
  const share = options.lowShare ?? HABITUAL_LOW_SHARE;

  const byRater = new Map<string, { given: number; low: number }>();
  for (const row of rows ?? []) {
    if (!row.rater_id || !usable(row.rating)) continue;
    const entry = byRater.get(row.rater_id) ?? { given: 0, low: 0 };
    entry.given += 1;
    if (row.rating <= lowMax) entry.low += 1;
    byRater.set(row.rater_id, entry);
  }

  const flagged = new Set<string>();
  for (const [rater, { given, low }] of byRater) {
    if (given >= minimum && low / given >= share) flagged.add(rater);
  }
  return flagged;
}

/**
 * The number a screen shows, with the window applied and protection honoured.
 *
 * `excludeRaters` is the set `habitualLowRaters()` produced for the rows in hand;
 * passing it in keeps this function pure and lets a test state the protection
 * explicitly instead of building a rater's whole history.
 */
export function summariseRatings(
  rows: readonly (RatingLike & { rater_id?: string | null })[] | null | undefined,
  options: { window?: number; excludeRaters?: Iterable<string> } = {}
): RatingSummary {
  const all = rows ?? [];
  const excludedIds = new Set(options.excludeRaters ?? []);
  const kept = all.filter((row) => !row.rater_id || !excludedIds.has(row.rater_id));
  const windowed = recentRatings(kept, options.window ?? RATING_WINDOW);

  if (!windowed.length) {
    return {
      average: null,
      count: 0,
      total: all.length,
      excluded: all.length - kept.length,
    };
  }

  const total = windowed.reduce((sum, row) => sum + (row.rating as number), 0);
  return {
    // One decimal place, the same rule `averageRating()` uses, so a card can never
    // print 4.833333333333333.
    average: Math.round((total / windowed.length) * 10) / 10,
    count: windowed.length,
    total: all.length,
    excluded: all.length - kept.length,
  };
}

/** `"4.9"`, or null when there is nothing to show — never `"0.0"`. */
export function formatSummary(summary: RatingSummary): string | null {
  if (summary.average == null || summary.count <= 0) return null;
  return summary.average.toFixed(1);
}

