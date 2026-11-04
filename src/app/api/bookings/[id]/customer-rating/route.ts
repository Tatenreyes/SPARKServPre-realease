import { NextResponse, type NextRequest } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { getCurrentUser, AuthError } from "@/lib/auth";
import { notify } from "@/lib/notifications";
import { sanitizeTags } from "@/lib/rating-tags";

const MAX_COMMENT_LENGTH = 1000;

/** A score at or below this tells the administrators. */
const LOW_RATING_ALERT_MAX = 2;

/**
 * The statuses from which the visit is OVER and the technician may rate the
 * customer. Deliberately not `completed`: completion waits on the customer's GCash
 * reference and an administrator's verification, which can take days, and a rating
 * written a week later is a rating of nothing. Uber and Grab both ask at the end of
 * the trip, which for a repair is when the technician packs up — `awaiting_inspection`
 * and beyond.
 */
const RATEABLE_STATUSES = ["awaiting_inspection", "awaiting_payment", "completed"];

/**
 * POST /api/bookings/:id/customer-rating — the technician rates the CUSTOMER.
 *
 * The other direction of `POST /api/bookings/:id/rating`, and the half every
 * two-way marketplace has and this one did not: who was there, was the access
 * safe, did the reported fault match. It writes to `customer_ratings` (step 21)
 * rather than to `ratings`, so the technician's PUBLIC average can never be
 * computed from their own opinions of customers — see the migration's header.
 *
 * WHAT IS ENFORCED HERE, because RLS cannot express it: the caller is a technician,
 * the booking is theirs, the visit is over, and one rating per visit.
 *
 * WHO LEARNS WHAT. The customer is never told, and never sees the row (the table's
 * select policy allows the technician and an administrator only) — that is Uber's
 * anonymity rule, in both directions. Administrators are told when the score is
 * low, because a technician who keeps meeting a problem customer is information the
 * shop needs before it dispatches somebody else.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user) throw new AuthError("Not authenticated", 401);
    if (user.role !== "technician") {
      throw new AuthError("Only the assigned technician can rate this visit", 403);
    }

    const body = await request.json().catch(() => ({}));
    const rating = Number(body.rating);
    const comment = typeof body.comment === "string" ? body.comment.trim() : "";
    const tags = sanitizeTags("technician_rates_customer", body.tags);

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return NextResponse.json(
        { error: "Choose a rating from 1 to 5 stars." },
        { status: 400 }
      );
    }
    if (comment.length > MAX_COMMENT_LENGTH) {
      return NextResponse.json(
        { error: `Keep your note under ${MAX_COMMENT_LENGTH} characters.` },
        { status: 400 }
      );
    }

    const supabase = createClient();

    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select("id, customer_id, technician_id, status")
      .eq("id", params.id)
      .single();

    if (bookingError || !booking) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }

    // `technicians.id` IS the user id (1:1 with `users`), so this is the ownership
    // test the insert policy also makes — checked here so the answer is a 403 rather
    // than a policy violation.
    if (booking.technician_id !== user.id) {
      throw new AuthError("You can only rate a visit you attended", 403);
    }

    if (!RATEABLE_STATUSES.includes(booking.status)) {
      return NextResponse.json(
        { error: "You can rate the customer once the visit is over." },
        { status: 409 }
      );
    }

    const { data: existing } = await supabase
      .from("customer_ratings")
      .select("id")
      .eq("booking_id", params.id)
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        { error: "You have already rated this visit.", code: "already_rated" },
        { status: 409 }
      );
    }

    const { data, error } = await supabase
      .from("customer_ratings")
      .insert({
        booking_id: booking.id,
        technician_id: user.id,
        customer_id: booking.customer_id,
        rating,
        tags,
        comment: comment || null,
      })
      .select()
      .single();

    if (error) {
      // Unique violation: a concurrent submit already created the row.
      if ((error as { code?: string }).code === "23505") {
        return NextResponse.json(
          { error: "You have already rated this visit.", code: "already_rated" },
          { status: 409 }
        );
      }
      throw error;
    }

    // A low score is the one case an administrator has to hear about now: the next
    // visit may be somebody else's, and the reasons are what make it actionable.
    if (rating <= LOW_RATING_ALERT_MAX) {
      try {
        const serviceRole = createServiceRoleClient();
        const { data: admins } = await serviceRole
          .from("users")
          .select("id")
          .in("role", ["admin", "super_admin"]);

        for (const admin of admins ?? []) {
          await notify(serviceRole, {
            userId: admin.id,
            type: "customer_rating_low",
            title: `A technician rated a customer ${rating} star${rating === 1 ? "" : "s"}`,
            body: tags.length
              ? `Reasons given: ${tags.map((tag) => tag.replace(/_/g, " ")).join(", ")}.`
              : "Open the job to see which visit this was.",
            link: "/admin/job-monitoring",
          });
        }
      } catch (notifyError) {
        // A notification that fails must never undo a rating that saved.
        console.error("Low customer-rating notification failed", notifyError);
      }
    }

    return NextResponse.json({ data }, { status: 201 });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: "Unable to save your rating" }, { status: 500 });
  }
}
