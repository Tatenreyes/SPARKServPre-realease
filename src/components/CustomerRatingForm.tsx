"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Star } from "lucide-react";
import { CUSTOMER_TAGS, MAX_TAGS } from "@/lib/rating-tags";

export type ExistingCustomerRating = {
  rating: number;
  tags: string[];
  comment: string | null;
};

/** Read-only star row for the "already rated" state. */
function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`Rated ${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((step) => (
        <Star
          key={step}
          aria-hidden="true"
          className={`h-4 w-4 ${step <= value ? "fill-warn-ink text-warn-ink" : "text-line"}`}
        />
      ))}
    </span>
  );
}

/**
 * The technician's rating of the CUSTOMER — the other direction.
 *
 * WHY IT EXISTS. Every two-way marketplace prompts both sides after the trip; this
 * one only asked the customer. The missing half is the one that protects the person
 * at the door: no access, an unsafe situation, a complaint that did not match the
 * appliance. It is written to `customer_ratings`, never to `ratings`, so a
 * technician's published average cannot be built from their own opinions.
 *
 * WHAT THE TECHNICIAN IS TOLD. Nothing about who read it. The customer never sees
 * this (the table's select policy allows the technician and an administrator only),
 * and a low score notifies the administrators — stated plainly under the stars,
 * because a rating that secretly does something is the thing people rightly
 * distrust about the platforms this is modelled on.
 *
 * Uses radio-group star semantics, like `RatingForm`: reachable by keyboard and
 * announced as one choice rather than five buttons.
 */
export default function CustomerRatingForm({
  bookingId,
  customerName,
  existingRating = null,
}: {
  bookingId: string;
  /**
   * The customer's name, when the caller is allowed to know it. A technician
   * cannot read a customer's `users` row (`users` is readable by the owner and an
   * administrator only), so this is usually absent — and it is not needed: the card
   * already says which job, which appliance and which address this is about. The
   * office sees the name on the row this writes.
   */
  customerName?: string;
  existingRating?: ExistingCustomerRating | null;
}) {
  const router = useRouter();
  const [rating, setRating] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (existingRating) {
    return (
      <section className="mt-3 rounded-xl border border-line bg-canvas px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs font-semibold text-ink/70">Your rating of the customer</p>
          <Stars value={existingRating.rating} />
        </div>
        {existingRating.tags.length > 0 && (
          <p className="mt-1 text-[11px] text-muted">
            {existingRating.tags.map((tag) => tag.replace(/_/g, " ")).join(" · ")}
          </p>
        )}
        {existingRating.comment && (
          <p className="mt-1 text-xs leading-relaxed text-ink/70">{existingRating.comment}</p>
        )}
        <p className="mt-1.5 flex items-center gap-1 text-[11px] text-muted">
          <CheckCircle2 className="h-3 w-3 text-signal-ink" aria-hidden="true" />
          Only you and an administrator can see this. The customer is not told.
        </p>
      </section>
    );
  }

  if (done) {
    return (
      <section className="mt-3 rounded-xl border border-line bg-canvas px-3 py-2.5">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-ink">
          <CheckCircle2 className="h-3.5 w-3.5 text-signal-ink" aria-hidden="true" />
          Thanks — that is recorded for the office, not shown to the customer.
        </p>
      </section>
    );
  }

  function toggleTag(key: string) {
    setTags((current) =>
      current.includes(key)
        ? current.filter((entry) => entry !== key)
        : current.length >= MAX_TAGS
          ? current
          : [...current, key]
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (rating < 1) {
      setError("Choose a star rating first.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/bookings/${bookingId}/customer-rating`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, tags, comment }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(payload.error ?? "Unable to save your rating.");
        return;
      }
      setDone(true);
      router.refresh();
    } catch {
      setError("Unable to save your rating.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="mt-3 rounded-xl border border-line bg-canvas px-3 py-3">
      <p className="text-xs font-semibold text-ink">How did this visit go for you?</p>
      <p className="mt-0.5 text-[11px] text-muted">
        Your rating of {customerName ?? "the customer"} helps the office decide who to send
        next time.
      </p>

      <form onSubmit={submit} className="mt-2">
        <fieldset>
          <legend className="sr-only">Star rating</legend>
          <div className="flex items-center gap-1" role="radiogroup" aria-label="Star rating">
            {[1, 2, 3, 4, 5].map((step) => (
              <button
                key={step}
                type="button"
                role="radio"
                aria-checked={rating === step}
                aria-label={`${step} star${step === 1 ? "" : "s"}`}
                onClick={() => setRating(step)}
                className="cursor-pointer rounded-md p-0.5 transition duration-150 hover:scale-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
              >
                <Star
                  aria-hidden="true"
                  className={`h-6 w-6 ${
                    step <= rating ? "fill-warn-ink text-warn-ink" : "text-line hover:text-warn-ink/60"
                  }`}
                />
              </button>
            ))}
          </div>
        </fieldset>

        {/* Reasons only once the score says something was wrong — the rule Uber and
            Grab both apply ("a bit more feedback about why", below five stars).
            Asking "why?" after five stars is noise. */}
        {rating > 0 && rating <= 4 && (
          <div className="mt-2">
            <p className="text-[11px] font-semibold text-ink/70">What happened? (optional)</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {CUSTOMER_TAGS.map((tag) => {
                const selected = tags.includes(tag.key);
                return (
                  <button
                    key={tag.key}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggleTag(tag.key)}
                    className={`inline-flex min-h-[30px] cursor-pointer items-center rounded-full border px-2.5 text-[11px] font-medium transition duration-200 ${
                      selected
                        ? "border-brand-300 bg-brand-soft text-brand-ink"
                        : "border-line bg-surface text-ink/70 hover:border-brand-300 hover:bg-brand-soft"
                    }`}
                  >
                    {tag.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <textarea
          rows={2}
          maxLength={1000}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder="Anything the office should know about this visit (optional)"
          aria-label="Note for the office"
          className="mt-2 w-full rounded-lg border border-line bg-surface px-3 py-2 text-xs text-ink placeholder:text-ink/50 outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/20"
        />

        {error && (
          <p role="alert" className="mt-2 rounded-lg bg-alert-soft px-3 py-2 text-xs text-alert-ink">
            {error}
          </p>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={submitting || rating < 1}
            className="inline-flex min-h-[36px] cursor-pointer items-center rounded-full bg-brand-600 px-4 text-xs font-semibold text-white transition duration-200 hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Saving..." : "Save rating"}
          </button>
          <span className="text-[11px] text-muted">
            Seen by you and an administrator only. A 1–2 star rating also alerts them.
          </span>
        </div>
      </form>
    </section>
  );
}
