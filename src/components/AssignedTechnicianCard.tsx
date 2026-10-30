import { BadgeCheck, Star, Wrench } from "lucide-react";
import {
  formatRating,
  initials,
  specializationSummary,
  type TechnicianProfile,
} from "@/lib/technician-profile";

/**
 * Who is coming — the ONE technician the fairness queue assigned to this request.
 *
 * ## This is not the deleted ranking card
 *
 * `src/components/TechnicianCard.tsx` was deleted when the ranking model was
 * removed (`QUEUE-SYSTEM.md` §"forbidden behaviour", `PROGRESS.md`): it showed a
 * rank badge and a "match score" figure and let a customer **pick** the technician
 * it ranked for them. None of that exists here, and the name is deliberately
 * different so nobody grepping for the removed component finds this one:
 *
 *   * there is no rank, no score and no ordering — there is one assigned
 *     technician, chosen by the rotation, and the card cannot compare or select;
 *   * nothing on it is a customer decision, so it has no `onSelect`;
 *   * the rating it shows is evidence about a person already assigned, never a
 *     criterion for choosing between people.
 *
 * ## What it shows, and what it deliberately does not
 *
 * The assignment card used to print a name and nothing else — the one moment a
 * customer decides whether to trust the visit. This shows the photo (or initials),
 * the verification badge the queue itself applies, the average of real ratings,
 * how many repairs the technician has completed, and their appliance list.
 *
 * The photo is a **background image, not `next/image`**: storage URLs come from the
 * Supabase host, which is not in `next.config`'s image allow-list, so `next/image`
 * would refuse them. Every avatar in this app is drawn this way (see
 * `ProfileForm`).
 *
 * There are **no contact details** — they are not in `TechnicianProfile` at all —
 * and the footnote says so, so a customer knows the booking thread is the way to
 * reach their technician and the conversation stays on the record.
 */
export default function AssignedTechnicianCard({
  technician,
  className = "",
}: {
  technician: TechnicianProfile;
  className?: string;
}) {
  const rating = formatRating(technician.rating, technician.ratingCount);
  const { shown, extra } = specializationSummary(technician.specializations);

  const facts: string[] = [];
  if (technician.jobsCompleted != null && technician.jobsCompleted > 0) {
    facts.push(
      `${technician.jobsCompleted} job${technician.jobsCompleted === 1 ? "" : "s"} completed`
    );
  }
  if (technician.experienceYears != null && technician.experienceYears > 0) {
    facts.push(
      `${technician.experienceYears} year${technician.experienceYears === 1 ? "" : "s"} experience`
    );
  }

  return (
    <div className={`flex flex-wrap items-start gap-4 ${className}`}>
      <span
        aria-hidden="true"
        className="h-14 w-14 shrink-0 overflow-hidden rounded-full bg-brand-soft text-base font-bold text-brand-ink ring-2 ring-surface"
      >
        {technician.avatarUrl ? (
          <span
            className="block h-full w-full bg-cover bg-center"
            style={{ backgroundImage: `url(${technician.avatarUrl})` }}
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center">
            {initials(technician.name)}
          </span>
        )}
      </span>

      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2">
          <span className="font-display text-base font-semibold text-ink">{technician.name}</span>
          {technician.verified && (
            <span className="inline-flex items-center gap-1 rounded-full border border-signal-500/30 bg-signal-soft px-2 py-0.5 text-[11px] font-semibold text-signal-ink">
              <BadgeCheck className="h-3 w-3" aria-hidden="true" />
              Verified
            </span>
          )}
        </p>

        {(rating || facts.length > 0) && (
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            {rating && (
              <span className="inline-flex items-center gap-1 font-semibold text-warn-ink">
                <Star className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                {rating}
                <span className="font-normal text-muted">
                  ({technician.ratingCount} review{technician.ratingCount === 1 ? "" : "s"})
                </span>
              </span>
            )}
            {facts.map((fact) => (
              <span key={fact}>{fact}</span>
            ))}
          </p>
        )}

        {shown.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {shown.map((item) => (
              <li
                key={item}
                className="rounded-full bg-soft px-2.5 py-1 text-[11px] font-medium text-muted"
              >
                {item}
              </li>
            ))}
            {extra > 0 && (
              <li className="rounded-full bg-soft px-2.5 py-1 text-[11px] font-medium text-muted">
                +{extra} more
              </li>
            )}
          </ul>
        )}

        <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted/90">
          <Wrench className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
          Contact stays in your booking thread, so the conversation is on the record.
        </p>
      </div>
    </div>
  );
}
