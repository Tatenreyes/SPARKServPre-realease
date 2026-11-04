import { createServiceRoleClient } from "@/lib/supabase/server";
import UserManagementClient from "@/components/UserManagementClient";
import { ACTIVE_BOOKING_STATUSES } from "@/lib/booking-status";
import { requireRows, optionalRows } from "@/lib/query-rows";
import { habitualLowRaters, summariseRatings } from "@/lib/rating-summary";

export default async function AdminUsersPage() {
  const supabase = createServiceRoleClient();

  // Both reads go through `requireRows()`, which raises on a query error instead
  // of returning `[]`: a failed SELECT must never render as "No users found.",
  // see src/lib/query-rows.ts.
  const usersResult = await supabase
    .from("users")
    .select("*")
    .order("created_at", { ascending: false });
  const users = requireRows("users", usersResult.data, usersResult.error);

  // Who is working right now. "Active account" and "on a job" are different
  // questions, and the second is the one an admin dispatching work asks. It is
  // read from the live bookings with the shared definition of active
  // (`ACTIVE_BOOKING_STATUSES`), never a local list of statuses.
  const busyResult = await supabase
    .from("bookings")
    .select("customer_id, technician_id")
    .in("status", ACTIVE_BOOKING_STATUSES);
  const busyBookings = requireRows("live bookings", busyResult.data, busyResult.error);
  const busyUserIds: string[] = Array.from(
    new Set(
      busyBookings
        .flatMap((booking) => [booking.customer_id, booking.technician_id])
        .filter((id): id is string => Boolean(id))
    )
  );

  // What technicians said about these customers (step 21), aggregated. The office
  // needs "this customer is difficult" BEFORE dispatching somebody, not a log of
  // visits — and the protection is symmetric with the technician's own average: a
  // technician who scores everybody one star is not allowed to sink a customer.
  const customerIds = users.map((user) => user.id);
  const ratingsResult = customerIds.length
    ? await supabase
        .from("customer_ratings")
        .select("customer_id, technician_id, rating")
        .in("customer_id", customerIds)
    : null;
  const ratings = ratingsResult
    ? optionalRows("customer ratings", ratingsResult.data, ratingsResult.error)
    : [];

  const raterIds = Array.from(new Set(ratings.map((row) => row.technician_id)));
  const raterHistoryResult = raterIds.length
    ? await supabase
        .from("customer_ratings")
        .select("technician_id, rating")
        .in("technician_id", raterIds)
    : null;
  const raterHistory = raterHistoryResult
    ? optionalRows("rater history", raterHistoryResult.data, raterHistoryResult.error)
    : [];

  const flaggedRaters = habitualLowRaters(
    raterHistory.map((row) => ({ rater_id: row.technician_id, rating: row.rating }))
  );

  const customerRatings: Record<string, { average: number | null; count: number }> = {};
  for (const id of customerIds) {
    const rows = ratings.filter(
      (row) => row.customer_id === id && !flaggedRaters.has(row.technician_id)
    );
    const summary = summariseRatings(rows.map((row) => ({ rating: row.rating })));
    customerRatings[id] = { average: summary.average, count: summary.count };
  }

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-ink">User management</h1>
      <p className="mt-1 text-sm text-ink/70">Manage accounts and control access roles.</p>
      <UserManagementClient
        initialUsers={users}
        busyUserIds={busyUserIds}
        customerRatings={customerRatings}
      />
    </div>
  );
}
