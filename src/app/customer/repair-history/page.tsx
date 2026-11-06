import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { isBookableEstimate } from "@/lib/estimate-costs";
import { formatDate, formatPeso } from "@/lib/format";
import type { EstimateRow, ServiceHistoryRow } from "@/types/database";
import {
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Printer,
  Star,
  Wallet,
  Wrench,
} from "lucide-react";
import { WARRANTY_DAYS, parseCalendarDate, startOfDay } from "@/lib/warranty";

/** How many repairs the list shows before the "Show more" button appears. */
const PAGE_SIZE = 5;

/** `2026-11-04` or a full timestamp as a local calendar date. */

export default async function ServiceHistoryPage({
  searchParams,
}: {
  searchParams?: { appliance?: string; sort?: string; limit?: string };
}) {
  const user = await requireUser();
  const supabase = createClient();

  const { data: history } = await supabase
    .from("service_history")
    .select("*")
    .eq("customer_id", user.id)
    .order("completed_at", { ascending: false });

  const { data: ratings } = await supabase
    .from("ratings")
    .select("booking_id, rating, comment")
    .eq("customer_id", user.id);

  const ratingByBooking = new Map(
    (ratings ?? []).map((rating) => [rating.booking_id, rating])
  );

  // The estimate each finished repair was agreed at.
  //
  // `service_history` archives the BOOKING, not the quote, so the link is
  // booking → its request → the version the appointment was created from:
  // `bookings.estimate_id` names that exact version when the customer booked it
  // themselves, and an administrator-scheduled booking falls back to the request's
  // current approval. This is the half of the move that `/customer/estimates` gave up
  // when the repair completed, the quote is not lost, it changed pages.
  const historyBookingIds = (history ?? []).map((entry) => entry.booking_id);
  const { data: historyBookings } = historyBookingIds.length
    ? await supabase
        .from("bookings")
        .select("id, service_request_id, estimate_id, notes, inspection_confirmed_at")
        .in("id", historyBookingIds)
    : { data: [] };

  const historyRequestIds = [
    ...new Set((historyBookings ?? []).map((booking) => booking.service_request_id)),
  ];
  const { data: historyEstimates } = historyRequestIds.length
    ? await supabase.from("estimates").select("*").in("service_request_id", historyRequestIds)
    : { data: [] };

  const historyBookingById = new Map(
    (historyBookings ?? []).map((booking) => [booking.id, booking])
  );

  // The technician who did the work, and the appliance it was for. `service_history`
  // stores ids only, so both are read back from the rows that own them: the
  // customer's own session may read the assigned technician's user row (the booking
  // page does exactly this) and their own registered appliances.
  const historyTechnicianIds = [
    ...new Set((history ?? []).map((entry) => entry.technician_id)),
  ];
  const { data: historyTechnicians } = historyTechnicianIds.length
    ? await supabase.from("users").select("id, name").in("id", historyTechnicianIds)
    : { data: [] };

  const { data: historyRequests } = historyRequestIds.length
    ? await supabase
        .from("service_requests")
        .select("id, appliance_id")
        .in("id", historyRequestIds)
    : { data: [] };

  const historyApplianceIds = [
    ...new Set(
      (historyRequests ?? [])
        .map((request) => request.appliance_id)
        .filter((id): id is string => typeof id === "string")
    ),
  ];
  const { data: historyAppliances } = historyApplianceIds.length
    ? await supabase
        .from("appliances")
        .select("id, brand, model_number")
        .in("id", historyApplianceIds)
    : { data: [] };

  const technicianNameById = new Map(
    (historyTechnicians ?? []).map((technician) => [technician.id, technician.name])
  );
  const historyRequestById = new Map(
    (historyRequests ?? []).map((request) => [request.id, request])
  );
  const historyApplianceById = new Map(
    (historyAppliances ?? []).map((appliance) => [appliance.id, appliance])
  );

  /**
   * The approved estimate a finished repair was agreed at, or `null` when there is
   * none, a card then shows the final cost alone rather than inventing a quote.
   */
  function approvedEstimateFor(bookingId: string): EstimateRow | null {
    const booking = historyBookingById.get(bookingId);
    if (!booking) return null;

    const mine = (historyEstimates ?? []).filter(
      (estimate) => estimate.service_request_id === booking.service_request_id
    );

    return (
      mine.find((estimate) => estimate.id === booking.estimate_id) ??
      mine.find((estimate) => isBookableEstimate(estimate)) ??
      null
    );
  }

  const totalRepairs = history?.length ?? 0;
  const totalSpent = (history ?? []).reduce((sum, h) => sum + (h.final_cost ?? 0), 0);
  const avgRating =
    ratings && ratings.length > 0
      ? ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length
      : null;
  const lastService = history && history.length > 0 ? history[0].completed_at : null;

  /** The brand and model the customer registered for the repaired appliance. */
  function applianceModelFor(bookingId: string) {
    const booking = historyBookingById.get(bookingId);
    const request = booking ? historyRequestById.get(booking.service_request_id) : undefined;
    const appliance = request?.appliance_id
      ? historyApplianceById.get(request.appliance_id)
      : undefined;
    if (!appliance) return null;
    const label = [appliance.brand, appliance.model_number].filter(Boolean).join(" ");
    return label || null;
  }

  /**
   * When cover ends. The database stamps `warranty_until` on the archive row at
   * completion (30 days by default, from `service_warranty_days()`); a row written
   * before that step has no date, so the period in `WARRANTY_DAYS` is applied to
   * the completion date instead of claiming no cover.
   */
  function warrantyEndsFor(entry: ServiceHistoryRow): Date | null {
    const stamped = parseCalendarDate(entry.warranty_until);
    if (stamped) return stamped;
    const completed = parseCalendarDate(entry.completed_at);
    if (!completed) return null;
    return new Date(
      completed.getFullYear(),
      completed.getMonth(),
      completed.getDate() + WARRANTY_DAYS
    );
  }

  /** The last day of cover is still cover, so the comparison is inclusive. */
  function warrantyIsLive(entry: ServiceHistoryRow): boolean {
    const ends = warrantyEndsFor(entry);
    if (!ends) return false;
    return startOfDay(new Date()).getTime() <= ends.getTime();
  }

  // The list's own view state, all of it in the URL so the page stays a server
  // component: no client bundle for two dropdowns and a pager.
  const applianceTypes = [...new Set((history ?? []).map((entry) => entry.appliance_type))].sort();
  const activeAppliance =
    searchParams?.appliance && applianceTypes.includes(searchParams.appliance)
      ? searchParams.appliance
      : null;
  const sort = searchParams?.sort === "oldest" ? "oldest" : "newest";
  const requestedLimit = Number(searchParams?.limit);
  const limit =
    Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 100) : PAGE_SIZE;

  const filtered = (history ?? []).filter(
    (entry) => !activeAppliance || entry.appliance_type === activeAppliance
  );
  // The query already orders newest first; the reverse is the only other order.
  const ordered = sort === "oldest" ? [...filtered].reverse() : filtered;
  const visible = ordered.slice(0, limit);
  const hidden = ordered.length - visible.length;
  const moreHref = (() => {
    const params = new URLSearchParams();
    if (activeAppliance) params.set("appliance", activeAppliance);
    if (sort !== "newest") params.set("sort", sort);
    params.set("limit", String(visible.length + PAGE_SIZE));
    return `/customer/repair-history?${params.toString()}`;
  })();

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-ink">Service History</h1>
      <p className="mt-1 text-sm text-ink/70">Every repair you&apos;ve completed through SPARKServ.</p>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard icon={<Wrench className="h-4 w-4" />} label="Total repairs" value={String(totalRepairs)} />
        <SummaryCard
          icon={<Star className="h-4 w-4" />}
          label="Average rating"
          value={avgRating != null ? `${avgRating.toFixed(1)}/5` : "N/A"}
        />
        <SummaryCard
          icon={<Wallet className="h-4 w-4" />}
          label="Total spent"
          value={formatPeso(totalSpent)}
        />
        <SummaryCard
          icon={<CalendarClock className="h-4 w-4" />}
          label="Last service"
          value={lastService ? formatDate(lastService) : "N/A"}
        />
      </div>

      {/* Filter, sort and paging all ride in the URL: a GET form needs no client
          JavaScript, and a filtered view is a link somebody can share or reload. */}
      {history?.length ? (
        <form method="get" className="mt-6 flex flex-wrap items-end gap-3">
          <label className="text-xs font-semibold text-muted">
            Appliance
            <select
              name="appliance"
              defaultValue={activeAppliance ?? ""}
              className="mt-1 block min-w-[11rem] rounded-xl border border-line bg-surface px-3 py-2 text-sm font-normal text-ink transition duration-200 focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/10"
            >
              <option value="">All appliances</option>
              {applianceTypes.map((type) => (
                <option key={type} value={type}>
                  {type.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs font-semibold text-muted">
            Sort
            <select
              name="sort"
              defaultValue={sort}
              className="mt-1 block min-w-[11rem] rounded-xl border border-line bg-surface px-3 py-2 text-sm font-normal text-ink transition duration-200 focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/10"
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
            </select>
          </label>

          <button
            type="submit"
            className="inline-flex h-10 items-center justify-center rounded-xl bg-brand-600 px-4 text-xs font-semibold text-white transition duration-200 hover:bg-brand-700"
          >
            Apply
          </button>

          {(activeAppliance || sort !== "newest") && (
            <Link
              href="/customer/repair-history"
              className="text-xs font-semibold text-brand-ink underline-offset-4 hover:underline"
            >
              Reset
            </Link>
          )}
        </form>
      ) : null}

      {!history?.length ? (
        <p className="mt-8 text-sm text-ink/70">No completed repairs yet.</p>
      ) : (
        <div className="mt-8 space-y-3">
          {visible.map((h) => {
            const rating = ratingByBooking.get(h.booking_id);
            // The workmanship cover this repair carries, read by the same helper the
            // admin screens use, so one repair cannot be described two ways. A repair
            // archived before the warranty step has no date at all, which is "no
            // warranty recorded", never "expired".
            const booking = historyBookingById.get(h.booking_id);
            const estimate = approvedEstimateFor(h.booking_id);
            const notes = booking?.notes ?? null;
            const technician = technicianNameById.get(h.technician_id) ?? null;
            const model = applianceModelFor(h.booking_id);
            const requestId = booking?.service_request_id ?? null;
            const endsOn = warrantyEndsFor(h);
            const warrantyLive = warrantyIsLive(h);
            // The estimate is only named when it is NOT the final cost: two identical
            // numbers side by side is the "shown twice" this redesign removes.
            const estimateDiffers =
              estimate != null &&
              h.final_cost != null &&
              estimate.estimated_cost !== h.final_cost;
            return (
              <div key={h.id} className="rounded-card border border-line bg-surface p-4 shadow-card">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-display text-base font-semibold capitalize text-ink">
                        {h.appliance_type.replace(/_/g, " ")}
                      </h2>
                      <span className="rounded-full bg-signal-soft px-2 py-0.5 text-[11px] font-semibold text-signal-ink">
                        Completed
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      {[model, formatDate(h.completed_at), technician, requestId ? `Request ${requestId.slice(0, 8)}` : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>

                  <div className="shrink-0 text-right">
                    <p className="text-[11px] font-semibold text-muted">
                      Final cost
                      {estimateDiffers
                        ? ` · estimate was ${formatPeso(estimate?.estimated_cost)}`
                        : ""}
                    </p>
                    <p className="font-display text-lg font-bold tabular-nums text-ink">
                      {formatPeso(h.final_cost)}
                    </p>
                  </div>
                </div>

                {/* The archived `summary` is only ever "Repair completed. Customer
                    inspection: <note>", repeated on every card. The fact it carries is
                    said once here; the note itself belongs to the booking, not to a
                    sentence composed for the archive. */}
                <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-signal-ink">
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Inspection confirmed by you
                </p>

                {/* The bill's own lines live behind a disclosure: the card's job is the
                    repair, what it cost and what to do next, not four numbers nobody
                    asked for. The archived `summary` is not a technician's note (it is
                    composed from the inspection), so the note shown here is the
                    booking's own `notes`. */}
                {(estimate || notes) && (
                  <details className="mt-3 rounded-xl border border-line bg-soft/40 px-3 py-2">
                    <summary className="flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-brand-ink">
                      <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                      View details
                    </summary>
                    <ApprovedEstimateDetails estimate={estimate} />
                    {notes && (
                      <>
                        <p className="mt-2 text-[11px] font-semibold text-muted">
                          Technician notes:
                        </p>
                        <p className="mt-0.5 max-w-sm text-xs leading-relaxed text-ink/80">
                          {notes}
                        </p>
                      </>
                    )}
                  </details>
                )}

                {rating ? (
                  <div className="mt-2">
                    <span
                      className="inline-flex items-center gap-0.5"
                      aria-label={`Rated ${rating.rating} out of 5`}
                    >
                      {[1, 2, 3, 4, 5].map((step) => (
                        <Star
                          key={step}
                          aria-hidden="true"
                          className={`h-3.5 w-3.5 ${
                            step <= rating.rating
                              ? "fill-warn-ink text-warn-ink"
                              : "text-line"
                          }`}
                        />
                      ))}
                    </span>
                    {rating.comment && (
                      <p className="mt-1 text-xs text-ink/70">{rating.comment}</p>
                    )}
                  </div>
                ) : (
                  <Link
                    href={`/customer/bookings/${h.booking_id}`}
                    className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-xl border border-line px-3 text-xs font-semibold text-ink transition duration-200 hover:bg-soft"
                  >
                    <Star className="h-3.5 w-3.5" aria-hidden="true" />
                    Rate this repair
                  </Link>
                )}

                {/* The printable job order is the record of what was charged and paid; the
                    warranty action beside it is a different thing entirely, and it is only
                    offered while cover is still live. Past that date the card states it
                    rather than offering something that no longer applies. */}
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
                  <Link
                    href={`/customer/bookings/${h.booking_id}/receipt`}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-ink hover:underline"
                  >
                    <Printer className="h-3.5 w-3.5" aria-hidden="true" />
                    Job order & warranty
                  </Link>

                  {warrantyLive ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href="/customer/support?topic=warranty"
                        className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-brand-600 px-3 text-xs font-semibold text-white transition duration-200 hover:bg-brand-700"
                      >
                        Request warranty follow-up
                      </Link>
                      {endsOn && (
                        <span className="text-[11px] text-muted">
                          Covered until {formatDate(endsOn)}
                        </span>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs font-medium text-muted">
                      {endsOn ? `Warranty ended ${formatDate(endsOn)}` : "No warranty recorded"}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {hidden > 0 && (
        <div className="mt-4 flex justify-center">
          <Link
            href={moreHref}
            className="inline-flex h-10 items-center justify-center rounded-xl border border-line bg-surface px-5 text-xs font-semibold text-ink transition duration-200 hover:bg-soft"
          >
            Show more ({hidden} more)
          </Link>
        </div>
      )}
    </div>
  );
}

/**
 * The approved estimate a finished repair was agreed at, shown as a RECORD.
 *
 * This is where a completed repair's estimate lives now: it left
 * `/customer/estimates` the moment the repair finished, because a finished job has
 * nothing left to review and keeping the quote there made completed work look open.
 * Read-only by design, there is nothing to approve, decline or schedule here.
 */
function ApprovedEstimateDetails({ estimate }: { estimate: EstimateRow | null }) {
  if (!estimate) return null;

  return (
    <div className="mt-3 max-w-sm">
      <dl className="space-y-1">
        <CostLine label="Labour" value={estimate.labor_cost} />
        <CostLine label="Parts" value={estimate.parts_cost} />
        {estimate.other_cost > 0 && (
          <CostLine
            label={
              estimate.other_description
                ? `Additional: ${estimate.other_description}`
                : "Additional charges"
            }
            value={estimate.other_cost}
          />
        )}
      </dl>

      <p className="mt-2 text-[11px] text-muted">
        {estimate.approved_at
          ? `Approved ${formatDate(estimate.approved_at)}`
          : `Version ${estimate.version}`}
      </p>

      {estimate.scope && (
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted">{estimate.scope}</p>
      )}
    </div>
  );
}

function CostLine({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="min-w-0 break-words text-[11px] text-muted">{label}</dt>
      <dd className="shrink-0 text-xs font-medium tabular-nums text-ink/80">
        {formatPeso(value)}
      </dd>
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-card border border-line bg-surface p-3 shadow-card">
      <div className="flex items-center gap-1.5 text-ink/70">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <p className="mt-1.5 font-display text-lg font-semibold text-ink">{value}</p>
    </div>
  );
}
