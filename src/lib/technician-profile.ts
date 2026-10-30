/**
 * What a customer is allowed to know about the technician coming to their home.
 *
 * ## Why this module exists
 *
 * The assignment card used to reveal a name and nothing else, which is the one
 * moment a customer decides whether to trust the visit. Every commercial service
 * in this market shows a photo and a verification badge before the technician
 * arrives; a name alone makes SPARKServ look less accountable than a Facebook
 * referral — and the whole argument of this project is accountability.
 *
 * ## What is published, and what is deliberately not
 *
 * The shape below IS the disclosure list. There is no phone number, no email, no
 * address and no customer data in it, so no caller can accidentally widen it —
 * and `scripts/tests/technician-profile.test.mjs` asserts that the module never
 * reads a contact column. A customer reaches their technician through the booking
 * thread, which keeps the conversation on the record.
 *
 * Two rules that are easy to get wrong and are pinned by tests:
 *
 *   * **The average is computed from real `ratings` rows.** `technicians.rating`
 *     is a cached column with no trigger maintaining it (the booking page already
 *     notes this), so trusting it would show a permanent zero to every customer.
 *   * **A technician with no reviews has no rating**, never `0.0`. Zero is a
 *     score; no reviews is not a score.
 *
 * `verified` is `technicians.approved` — the same flag the queue uses to let
 * somebody take work at all, so the badge cannot claim more than the engine does.
 *
 * Pure: no React, no Supabase, no server-only imports, so the test suite runs the
 * real rules with no build step.
 */

/** The published profile. Every field here is shown to a customer. */
export interface TechnicianProfile {
  id: string;
  name: string;
  avatarUrl: string | null;
  /** `technicians.approved` — the same gate the queue applies. */
  verified: boolean;
  /** Average of real ratings, or null when there are none. */
  rating: number | null;
  ratingCount: number;
  jobsCompleted: number | null;
  experienceYears: number | null;
  specializations: string[];
}

/** The rows a profile is built from. Nothing is inferred beyond these. */
export interface TechnicianProfileInput {
  user: { id: string; name: string | null; avatar_url?: string | null } | null;
  technician?: {
    approved?: boolean | null;
    jobs_completed?: number | null;
    experience_years?: number | null;
    specializations?: string[] | null;
  } | null;
  ratings?: { rating: number }[] | null;
}

/**
 * The average of the ratings actually on record, and how many there are.
 *
 * Ignores anything that is not a finite number, so a null or a corrupt row cannot
 * drag the average to zero.
 */
export function averageRating(ratings: { rating: number }[] | null | undefined): {
  average: number | null;
  count: number;
} {
  const values = (ratings ?? []).map((row) => row.rating).filter((value) => Number.isFinite(value));
  if (values.length === 0) return { average: null, count: 0 };
  const sum = values.reduce((total, value) => total + value, 0);
  // One decimal place: "4.8", not "4.833333333333333".
  return { average: Math.round((sum / values.length) * 10) / 10, count: values.length };
}

/**
 * The rating as the card prints it, or null when there is nothing honest to say.
 *
 * Returns the number only — the star and the review count are laid out by the
 * component, which is why this is a string rather than JSX.
 */
export function formatRating(average: number | null, count: number): string | null {
  if (average == null || count <= 0) return null;
  return average.toFixed(1);
}

/**
 * The specialisations to print, and how many are held back.
 *
 * Trimmed, de-duplicated and ordered as given (the technician's own list), because
 * four chips is what fits one row on a phone; the remainder becomes "+2 more"
 * rather than a wrapping wall of tags.
 */
export function specializationSummary(
  specializations: string[] | null | undefined,
  max = 4
): { shown: string[]; extra: number } {
  const cleaned: string[] = [];
  for (const raw of specializations ?? []) {
    const value = (raw ?? "").trim();
    if (!value || cleaned.includes(value)) continue;
    cleaned.push(value);
  }
  return { shown: cleaned.slice(0, max), extra: Math.max(0, cleaned.length - max) };
}

/**
 * Initials for the avatar fallback.
 *
 * A photo is optional, so the circle must never be empty: two initials when the
 * name has two words ("Juan Dela Cruz" → "JD"), one when it has one, and a plain
 * "T" when there is no name at all — generic and honest beats a blank disc.
 */
export function initials(name: string | null | undefined): string {
  const words = (name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "T";
  const letters = words.slice(0, 2).map((word) => word[0] ?? "");
  return letters.join("").toUpperCase();
}

/**
 * Build the published profile, or null when there is no technician to publish.
 *
 * `technician` and `ratings` are optional because the assignment can be disclosed
 * before either is readable (RLS, a slow replica): the card then shows the name and
 * the photo and omits the rest, rather than inventing zeros.
 */
export function buildTechnicianProfile(input: TechnicianProfileInput): TechnicianProfile | null {
  const user = input.user;
  if (!user?.id) return null;

  const technician = input.technician ?? null;
  const { average, count } = averageRating(input.ratings);

  return {
    id: user.id,
    name: (user.name ?? "").trim() || "your technician",
    avatarUrl: (user.avatar_url ?? "").trim() || null,
    verified: technician?.approved === true,
    rating: average,
    ratingCount: count,
    jobsCompleted:
      typeof technician?.jobs_completed === "number" ? technician.jobs_completed : null,
    experienceYears:
      typeof technician?.experience_years === "number" ? technician.experience_years : null,
    // The full list is carried; how many fit on one row is the card's decision
    // (`specializationSummary`), so the data is not pre-truncated here.
    specializations: (technician?.specializations ?? [])
      .map((value) => (value ?? "").trim())
      .filter(Boolean),
  };
}
