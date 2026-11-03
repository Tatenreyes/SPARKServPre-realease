/**
 * Regression tests: no server-side Supabase read may come out of Next.js's Data Cache.
 *
 *   npm run test:cache
 *
 * WHY THIS EXISTS. `/admin/payments` showed a payment list frozen at 30 Oct 23:14,
 * while the database held a payment submitted on 3 Nov and had confirmed an older one
 * at 23:14:36 — seven seconds after the response the page kept rendering. The cause
 * was not the route being prerendered (that was already fixed with
 * `dynamic = "force-dynamic"`); it was Next.js's Data Cache:
 *
 *   * `next/dist/server/lib/patch-fetch.js` stores a GET response unless the fetch's
 *     own revalidate is 0 (`cache: "no-store"`, `fetchCache = "force-no-store"` or
 *     `unstable_noStore()`);
 *   * that storage uses `revalidate: false` — `CACHE_ONE_YEAR`, 31 536 000 seconds;
 *   * `force-dynamic` never sets revalidate to 0, so it does NOT opt a fetch out.
 *
 * The proof is on disk: `.next/cache/fetch-cache/<hash>` held
 * `content-location: /payments?order=created_at.desc&select=*` with
 * `revalidate: 31536000`, dated `Fri, 30 Oct 2026 23:14:29 GMT`.
 *
 * The same rule silently affected every other URL: the admin user list, booking lists,
 * `visits`, and the `users` role lookup behind `getCurrentUser()` — a cached role is a
 * stale authorization decision. So the opt-out is asserted where it is written, in the
 * three places a Supabase client is created for the server plus the two segments that
 * must stay live.
 *
 * WHAT IS NOT COVERED HERE: that Next.js honours `no-store` (it is its documented
 * behaviour, and `patch-fetch.js` reads `_cache === "no-store"` directly), and the
 * rendered page — there is no component runner in this repository (TESTING.md §5).
 * The end-to-end check is the one that found the bug: load `/admin/payments`, confirm
 * the newest payment is listed, then change a row in the database and reload.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ROOT = new URL("../../", import.meta.url);
const source = (path) => readFileSync(new URL(path, ROOT), "utf8");

const SERVER = "src/lib/supabase/server.ts";
const MIDDLEWARE = "src/lib/supabase/middleware.ts";
const ADMIN_LAYOUT = "src/app/admin/layout.tsx";
const PAYMENTS_PAGE = "src/app/admin/payments/page.tsx";

const server = source(SERVER);
const middleware = source(MIDDLEWARE);

/** `global: { fetch: <fn> }` — the Supabase option that replaces the fetch. */
const GLOBAL_FETCH = /global:\s*\{[^}]*fetch:/;
/** The same pattern, global, for counting occurrences. */
const GLOBAL_FETCH_ALL = /global:\s*\{[^}]*fetch:/g;

test("the server Supabase clients issue every read with cache: no-store", () => {
  // The shared helper is what both clients use, so the opt-out cannot be applied
  // to one and forgotten for the other.
  assert.match(
    server,
    /const noStoreFetch[\s\S]{0,120}cache:\s*"no-store"/,
    `${SERVER} must define a fetch that sets \`cache: "no-store"\`, the only value ` +
      `that stops Next.js storing the response in its Data Cache`
  );

  const uses = [...server.matchAll(/global:\s*\{\s*fetch:\s*noStoreFetch\s*\}/g)].length;
  assert.equal(
    uses,
    2,
    "both createClient() and createServiceRoleClient() must pass the no-store fetch; " +
      "the service-role client is the one that froze /admin/payments"
  );
});

test("the middleware client opts out too, because it decides authorization", () => {
  assert.match(
    middleware,
    GLOBAL_FETCH,
    `${MIDDLEWARE} must pass \`global.fetch\`; its role lookup is what decides whether ` +
      `a request is allowed through`
  );
  assert.match(
    middleware,
    /cache:\s*"no-store"/,
    "the middleware fetch must ask for `no-store`, or a cached role survives a change"
  );
});

test("the admin workspace and the payments queue force no-store fetches", () => {
  const layout = source(ADMIN_LAYOUT);
  const page = source(PAYMENTS_PAGE);

  for (const [file, text] of [
    [ADMIN_LAYOUT, layout],
    [PAYMENTS_PAGE, page],
  ]) {
    assert.match(
      text,
      /^export const fetchCache = "force-no-store";$/m,
      `${file} must export \`fetchCache = "force-no-store"\`; \`dynamic = "force-dynamic"\` ` +
        `alone leaves the Data Cache in place`
    );
  }
});

test("the payments page keeps its dynamic declaration, above the component", () => {
  const page = source(PAYMENTS_PAGE);
  const component = page.indexOf("export default async function AdminPaymentsPage");
  const dynamicExport = page.search(/^export const dynamic = "force-dynamic";$/m);
  const fetchCacheExport = page.search(/^export const fetchCache = "force-no-store";$/m);

  assert.ok(component !== -1, `${PAYMENTS_PAGE} must still default-export the page`);
  assert.ok(dynamicExport !== -1 && dynamicExport < component, "dynamic must sit above it");
  assert.ok(fetchCacheExport !== -1 && fetchCacheExport < component, "fetchCache must too");
});

test("no server Supabase client is created without the opt-out", () => {
  // A third client created later, or a `global:` block that sets headers but not
  // fetch, would silently reintroduce the year-long cache for that path.
  const clientFactories = [...server.matchAll(/createServerClient<Database>\(/g)].length;
  const globalBlocks = [...server.matchAll(GLOBAL_FETCH_ALL)].length;

  assert.equal(
    clientFactories,
    globalBlocks,
    `${SERVER} creates ${clientFactories} server clients but only ${globalBlocks} of them ` +
      `replace \`fetch\` — the rest would read from the Data Cache`
  );
});
