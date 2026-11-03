import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/types/database";

/**
 * EVERY server-side Supabase read is issued with `cache: "no-store"`.
 *
 * WHY THIS EXISTS. Next.js patches the global `fetch` and, unless the request
 * itself opts out, stores a GET response in its Data Cache. In Next 14 that
 * storage happens with `revalidate: false`, i.e. `CACHE_ONE_YEAR` (31 536 000
 * seconds), and every later render of the same URL is served that first body.
 *
 * `export const dynamic = "force-dynamic"` does NOT opt a fetch out of it: the
 * cache is skipped only when the fetch's own revalidate is 0 (an explicit
 * `cache: "no-store"`, `fetchCache = "force-no-store"` or `unstable_noStore()`),
 * which force-dynamic never sets.
 *
 * The symptom that found this: `/admin/payments` renders only through
 * `createServiceRoleClient()`, which reads no cookies, so its very first
 * `GET /payments?select=*&order=created_at.desc` was cached on 30 Oct and
 * replayed for a year. A customer's later payment was in the database and never
 * in the page, and a payment confirmed at 23:14:36 still read "Pending
 * Verification" because the cached copy was fetched seven seconds earlier.
 * Anything else read the same way — the user list, a booking list, and the
 * `users` role lookup behind `getCurrentUser()` — froze the same way, so a role
 * change could be ignored by an API guard.
 *
 * A live app must never answer from a snapshot, so the opt-out lives here, once,
 * instead of being remembered per page.
 */
const noStoreFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, cache: "no-store" });

/**
 * Supabase client for Server Components, Server Actions, and Route Handlers.
 * Call this fresh inside each request, cookies() is request-scoped.
 */
export function createClient() {
  const cookieStore = cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { fetch: noStoreFetch },
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value, ...options });
          } catch {
            // Called from a Server Component with no request context, safe to ignore
            // because middleware refreshes the session on every navigation anyway.
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value: "", ...options });
          } catch {
            // same as above
          }
        },
      },
    }
  );
}

/**
 * Service-role client, bypasses Row Level Security entirely.
 * ONLY use inside trusted server-side code (API routes) for actions that
 * legitimately need to cross role boundaries, e.g. an admin approving a
 * technician, or the recommendation engine reading across all technicians.
 * NEVER import this into a Client Component.
 */
export function createServiceRoleClient() {
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      // See `noStoreFetch` above: this client reads no cookies, so a cached
      // response is the only thing that can make its data stale.
      global: { fetch: noStoreFetch },
      cookies: {
        get() {
          return undefined;
        },
        set() {},
        remove() {},
      },
    }
  );
}
