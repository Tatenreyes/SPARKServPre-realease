import { createServiceRoleClient } from "@/lib/supabase/server";
import { directionsUrlForRequest } from "@/lib/geo";
import StatusBadge from "@/components/StatusBadge";
import WarrantyBadge from "@/components/WarrantyBadge";
import { FilterDropdownLinks } from "@/components/FilterDropdown";
import { ACTIVE_BOOKING_STATUSES, isActiveBookingStatus } from "@/lib/booking-status";
import { requireRows, optionalRows } from "@/lib/query-rows";
import {
  buildFacets,
  resolveActive,
  rowMatches,
  type FacetSpec,
} from "@/lib/filter-options";
import {
  WARRANTY_FILTER_LABELS,
  WARRANTY_FILTER_VALUES,
  warrantyFilterKey,
} from "@/lib/warranty";
import { Navigation } from "lucide-react";
import type { CustomerRatingRow } from "@/types/database";

/** Display names for `bookings.status`. The bar sorts them A→Z; this is only naming. */
const BOOKING_STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  in_progress: "In progress",
  awaiting_inspection: "Awaiting inspection",
  awaiting_payment: "Awaiting payment",
  completed: "Completed",
  cancelled: "Cancelled",
};

export default async function AdminJobMonitoringPage({
  searchParams,
}: {
  searchParams?: Record<string, string | undefined>;
}) {
  const supabase = createServiceRoleClient();

  // Every read below is guarded by `requireRows()`: a failed SELECT raises
  // instead of rendering as "No bookings yet.", see src/lib/query-rows.ts.
  const bookingsResult = await supabase
    .from("bookings")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);
  const bookings = requireRows("bookings", bookingsResult.data, bookingsResult.error);

  const requestIds = Array.from(new Set(bookings.map((b) => b.service_request_id)));
  const requestsResult = requestIds.length
    ? await supabase.from("service_requests").select("*").in("id", requestIds)
    : null;
  const requests = requestsResult
    ? requireRows("service requests", requestsResult.data, requestsResult.error)
    : [];
  const requestMap = new Map(requests.map((r) => [r.id, r]));

  const userIds = Array.from(
    new Set(bookings.flatMap((b) => [b.customer_id, b.technician_id]))
  );
  const usersResult = userIds.length
    ? await supabase.from("users").select("id, name").in("id", userIds)
    : null;
  const users = usersResult
    ? requireRows("customer names", usersResult.data, usersResult.error)
    : [];
  const userMap = new Map(users.map((u) => [u.id, u.name]));

  const bookingIds = bookings.map((b) => b.id);
  const ratingsResult = bookingIds.length
    ? await supabase.from("ratings").select("booking_id, rating").in("booking_id", bookingIds)
    : null;
  const ratings = ratingsResult
    ? requireRows("ratings", ratingsResult.data, ratingsResult.error)
    : [];
  const ratingMap = new Map(ratings.map((r) => [r.booking_id, r.rating]));

  // The workmanship warranty of any of these repairs that is already archived
  // (step 19, `supabase/migration_service_warranty.sql`). A repair with no row has
  // no cover to show, which is a real answer rather than a failure — so the
  // absence renders as "No warranty recorded" and never as an error.
  const historyResult = bookingIds.length
    ? await supabase
        .from("service_history")
        .select("booking_id, warranty_until")
        .in("booking_id", bookingIds)
    : null;
  const history = historyResult
    ? requireRows("service history", historyResult.data, historyResult.error)
    : [];
  const warrantyByBooking = new Map(history.map((row) => [row.booking_id, row.warranty_until]));

  // The other direction (step 21): what the technician said about the customer.
  // Admin-only in the database, so an administrator is the only person who ever
  // reads a per-visit row here — the customer sees an aggregate, and the technician
  // sees their own.
  const customerRatingsResult = bookingIds.length
    ? await supabase
        .from("customer_ratings")
        .select("booking_id, rating, tags, comment")
        .in("booking_id", bookingIds)
    : null;
  const customerRatings = customerRatingsResult
    ? optionalRows(
        "customer ratings",
        customerRatingsResult.data,
        customerRatingsResult.error
      )
    : [];
  const customerRatingByBooking = new Map(
    (customerRatings as CustomerRatingRow[]).map((row) => [row.booking_id, row] as const)
  );

  /**
   * Three facets. "Active" is a BUCKET over the shared status list, so the chip and
   * the "Active Jobs" tile above it cannot disagree; "Covered" answers the question
   * this page could never answer before — is this repair still inside a warranty we
   * already gave, which means the next visit is ours to pay for.
   */
  const facets: FacetSpec<(typeof bookings)[number]>[] = [
    {
      key: "status",
      label: "Status",
      values: Object.keys(BOOKING_STATUS_LABELS),
      labels: BOOKING_STATUS_LABELS,
      buckets: [{ key: "active", label: "Active", values: [...ACTIVE_BOOKING_STATUSES] }],
      get: (booking) => booking.status,
    },
    {
      key: "appliance",
      label: "Appliance",
      // Derived from the requests on this page, so a type that exists is always
      // offered and a type that does not is not invented.
      values: Array.from(new Set(requests.map((request) => request.appliance_type))),
      get: (booking) => requestMap.get(booking.service_request_id)?.appliance_type ?? "",
    },
    {
      key: "warranty",
      label: "Warranty",
      values: WARRANTY_FILTER_VALUES,
      labels: WARRANTY_FILTER_LABELS,
      get: (booking) => warrantyFilterKey(warrantyByBooking.get(booking.id) ?? null),
    },
  ];

  // A hand-edited `?status=zzz` reads as "All" rather than as an empty table.
  const selected = resolveActive(facets, {
    status: searchParams?.status,
    appliance: searchParams?.appliance,
    warranty: searchParams?.warranty,
  });

  const groups = buildFacets(facets, bookings, selected);

  const visible = bookings.filter((booking) => rowMatches(facets, booking, selected));
  const narrowed = Object.values(selected).some((keys) => keys && keys.length > 0);

  // One definition of "active" for the whole workspace, so this tile and
  // /admin/progress cannot disagree (src/lib/booking-status.ts).
  const activeCount = bookings.filter((b) => isActiveBookingStatus(b.status)).length;
  const completedCount = bookings.filter((b) => b.status === "completed").length;
  const avgRating = ratings.length
    ? (ratings.reduce((s, r) => s + r.rating, 0) / ratings.length).toFixed(1)
    : "N/A";

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-ink">Job monitoring &amp; QA</h1>
      <p className="mt-1 text-sm text-ink/70">Real-time tracking and quality assurance for all repair jobs.</p>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Active Jobs" value={activeCount} />
        <StatCard label="Completed" value={completedCount} />
        <StatCard label="Avg. Customer Rating" value={avgRating === "N/A" ? avgRating : `${avgRating}/5`} />
      </div>

      <div className="mt-6 rounded-card border border-line bg-surface px-3 py-2.5 shadow-card">
        <FilterDropdownLinks
          groups={groups}
          selected={selected}
          basePath="/admin/job-monitoring"
        />
      </div>

      <div className="mt-4 overflow-x-auto rounded-card border border-line bg-surface shadow-card">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-canvas text-xs uppercase tracking-wide text-ink/70">
            <tr>
              <th className="px-4 py-3 font-medium">Job ID</th>
              <th className="px-4 py-3 font-medium">Customer</th>
              <th className="px-4 py-3 font-medium">Appliance</th>
              <th className="px-4 py-3 font-medium">Technician</th>
              <th className="px-4 py-3 font-medium">Final cost</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Warranty</th>
              <th className="px-4 py-3 font-medium">Location</th>
              <th className="px-4 py-3 font-medium">Rating</th>
            </tr>
          </thead>
          <tbody>
            {!visible.length ? (
              <tr>
                <td colSpan={9} className="px-4 py-6 text-center text-sm text-ink/70">
                  {bookings.length && narrowed
                    ? "No jobs match these filters."
                    : "No bookings yet."}
                </td>
              </tr>
            ) : (
              visible.map((b) => {
                const r = requestMap.get(b.service_request_id);
                const rating = ratingMap.get(b.id);
                const directionsUrl = r
                  ? directionsUrlForRequest({
                      latitude: r.latitude,
                      longitude: r.longitude,
                      location: r.location,
                    })
                  : null;
                return (
                  <tr key={b.id} className="border-b border-ink/5 last:border-0">
                    <td className="px-4 py-3 font-mono text-xs text-ink/70">
                      {b.id.slice(0, 8)}
                    </td>
                    <td className="px-4 py-3 text-ink/70">{userMap.get(b.customer_id) ?? "N/A"}</td>
                    <td className="px-4 py-3 capitalize text-ink/70">
                      {r?.appliance_type.replace("_", " ") ?? "N/A"}
                    </td>
                    <td className="px-4 py-3 text-ink/70">{userMap.get(b.technician_id) ?? "N/A"}</td>
                    <td className="px-4 py-3 text-ink/70">
                      {b.final_cost != null ? `₱${b.final_cost.toFixed(2)}` : "N/A"}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={b.status} />
                    </td>
                    {/* The warranty starts when the repair is completed, so a live
                        job has nothing to claim yet — saying "no warranty
                        recorded" there would read as a fault rather than as work
                        still in progress. */}
                    <td className="px-4 py-3">
                      {isActiveBookingStatus(b.status) ? (
                        <span className="text-xs text-muted">Not yet completed</span>
                      ) : (
                        <WarrantyBadge until={warrantyByBooking.get(b.id) ?? null} size="sm" />
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-ink/70">
                      <span className="block max-w-[16rem] break-words">{r?.location ?? "N/A"}</span>
                      {r?.latitude != null && r?.longitude != null && (
                        <span className="mt-0.5 block font-mono text-[11px] text-ink/70">
                          {r.latitude.toFixed(6)}, {r.longitude.toFixed(6)}
                        </span>
                      )}
                      {/* Administrators already see every request; this link
                          spares them copying coordinates by hand. */}
                      {directionsUrl && (
                        <a
                          href={directionsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-brand-ink hover:underline"
                        >
                          <Navigation className="h-3 w-3" aria-hidden="true" /> Directions
                        </a>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-ink/70">
                      {rating != null ? `★ ${rating}/5` : "N/A"}
                      {/* The technician's own rating of the customer, under the
                          customer's rating of the technician: one visit, both
                          directions, side by side. Admin-only, and the only place a
                          per-visit row is ever rendered. */}
                      {(() => {
                        const reverse = customerRatingByBooking.get(b.id);
                        if (!reverse) return null;
                        return (
                          <span className="mt-0.5 block text-muted">
                            Tech: ★ {reverse.rating}/5
                            {reverse.tags.length > 0
                              ? ` · ${reverse.tags.map((tag) => tag.replace(/_/g, " ")).join(", ")}`
                              : ""}
                          </span>
                        );
                      })()}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-card border border-line bg-surface p-3 shadow-card">
      <p className="font-display text-lg font-semibold text-ink">{value}</p>
      <p className="mt-0.5 text-xs text-ink/70">{label}</p>
    </div>
  );
}
