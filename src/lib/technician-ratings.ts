import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { RATING_WINDOW, habitualLowRaters, recentRatings } from "@/lib/rating-summary";

/**
 * The ratings a CUSTOMER is allowed to see averaged on a technician's card.
 *
 * WHY THIS IS ONE FUNCTION. Three surfaces publish a technician's rating — the
 * request intake route (`POST /api/service-requests`), the customer's booking page
 * and the customer's request page — and they used to each run their own
 * `select("rating").eq("technician_id", …)`. That was fine while the number was a
 * plain lifetime average; it is not fine now that the published number has to obey
 * two rules (a rolling window, and Uber's protection from a habitually-low rater),
 * because a rule applied in three places is a rule that will be missing from the
 * fourth. The maths itself lives in `src/lib/rating-summary.ts`; this is only the
 * fetch, so the callers stay one line.
 *
 * DEGRADES BEFORE THE MIGRATION IS APPLIED. `ratings.tags` arrives with
 * `migration_customer_ratings.sql` (step 21). Until that is applied, selecting the
 * column fails — so the fallback re-reads without it and the average still works
 * instead of the card silently showing "no reviews" for every technician.
 */
export interface PublicRatingRow {
  rating: number;
  tags: string[];
  created_at: string | null;
}

export async function loadPublicTechnicianRatings(
  supabase: SupabaseClient<Database>,
  technicianId: string
): Promise<PublicRatingRow[]> {
  // A window's worth, plus room for the rows protection will drop.
  const limit = RATING_WINDOW * 3;

  const withTags = await supabase
    .from("ratings")
    .select("customer_id, rating, tags, created_at")
    .eq("technician_id", technicianId)
    .order("created_at", { ascending: false })
    .limit(limit);

  const rows = withTags.error
    ? (
        await supabase
          .from("ratings")
          .select("customer_id, rating, created_at")
          .eq("technician_id", technicianId)
          .order("created_at", { ascending: false })
          .limit(limit)
      ).data
    : withTags.data;

  const ratings = (rows ?? []) as unknown as {
    customer_id: string;
    rating: number;
    tags?: string[] | null;
    created_at: string | null;
  }[];
  if (!ratings.length) return [];

  // One extra read for the raters' own histories, which is what makes "habitually
  // low" answerable at all. Batched: one query, not one per customer.
  const raterIds = Array.from(new Set(ratings.map((row) => row.customer_id)));
  const { data: history } = await supabase
    .from("ratings")
    .select("customer_id, rating")
    .in("customer_id", raterIds);

  const excluded = habitualLowRaters(
    (history ?? []).map((row) => ({ rater_id: row.customer_id, rating: row.rating }))
  );

  return recentRatings(
    ratings
      .filter((row) => !excluded.has(row.customer_id))
      .map((row) => ({
        rating: row.rating,
        tags: row.tags ?? [],
        created_at: row.created_at,
      })),
    RATING_WINDOW
  );
}
