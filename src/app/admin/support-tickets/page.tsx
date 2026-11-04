import { redirect } from "next/navigation";

/**
 * The old address for what the product now calls **Service concerns**.
 *
 * The page moved to `/admin/service-concerns`; this redirect keeps bookmarks, the
 * super-admin quick actions and anything a customer was sent by email working.
 * Same pattern as `/admin/bookings`, which redirects into the merged job list.
 */
export default function AdminSupportTicketsPage() {
  redirect("/admin/service-concerns");
}
