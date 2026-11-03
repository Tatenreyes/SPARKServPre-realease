import DashboardShell from "@/components/DashboardShell";

/**
 * Every admin screen reads live operational data, the payments queue, bookings,
 * technician approvals, the user list, and each one fetches it with the
 * service-role client, which reads no cookies. Without this, Next.js has no dynamic
 * signal in those pages and PRERENDERS them at build time, so the admin workspace
 * serves a snapshot frozen at deploy: a customer's submitted payment never appears,
 * and there is nothing to Confirm.
 *
 * `force-dynamic` is set here, on the segment, rather than per page, so a new admin
 * screen cannot reintroduce the bug by forgetting it.
 *
 * IT IS NOT ENOUGH ON ITS OWN, and that is why `fetchCache` is set here too.
 * `force-dynamic` decides how the ROUTE is rendered; it does not stop Next.js
 * from storing a Supabase GET in the Data Cache. That storage uses
 * `revalidate: false` (one year), and every later render of the same URL is
 * served that first body — which is exactly how a payment submitted on 3 Nov was
 * missing from this workspace while an older one, confirmed at 23:14:36, still
 * read "Pending Verification" from a body fetched seven seconds earlier.
 * `fetchCache = "force-no-store"` sets the fetch's own revalidate to 0, which is
 * the one signal that bypasses the cache. The clients in
 * `src/lib/supabase/server.ts` opt out individually as well, so a route handler
 * (which has no segment config) is covered by the same rule.
 */
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/** The admin workspace. Nav comes from `src/lib/navConfig.ts`. */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardShell role="admin">{children}</DashboardShell>
  );
}

