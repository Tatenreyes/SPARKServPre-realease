/**
 * Regression guard for the profile-initialisation fallback — PR #1,
 * `security/auth-hardening`.
 *
 *   npm run test:ensure-profile-guard
 *
 * WHY THIS EXISTS. `POST /api/auth/ensure-profile` used to be an unauthenticated,
 * service-role endpoint that took the account it acted on from the request body:
 *
 *   const { userId } = await request.json();                          // caller's choice
 *   const { data: authUser } = await supabase.auth.admin.getUserById(userId);
 *   await supabase.from("users").insert({ id: authUser.user.id, role, ... });
 *   await supabase.from("users")
 *     .update({ role: "technician" })                                 // promotion
 *     .eq("id", authUser.user.id).eq("role", "customer");
 *
 * Nothing else guarded it: `src/middleware.ts`'s matcher covers `/customer`,
 * `/technician`, `/admin` and `/superadmin` only, so **every** `/api/**` handler is
 * responsible for its own authentication. Anyone holding the publishable key could
 * therefore create a profile for any auth user they could name (including one whose
 * trigger row was missing), read back that the profile existed, and promote a
 * `customer` to `technician` using signup metadata the account holder controls.
 *
 * The route now authenticates with `auth.getUser()`, never reads the body, and never
 * writes a role to an existing profile. What was wrong is the SHAPE of the code —
 * where the identity comes from, where the `401` sits relative to the service-role
 * client, and whether a role is ever written — so that is what is pinned here. The
 * route is asserted as source rather than executed: it needs the Next request scope
 * (cookies) and a live Supabase project, which TESTING.md §5 covers by hand;
 * `scripts/tests/user-guard.test.mjs` sets the same precedent for its own regression.
 *
 * The live behaviour of these same four properties (12/12 checks: `401` without a
 * session, an id in the body changing nothing, a customer whose metadata says
 * `technician` staying a customer, and both registration paths still working) was
 * verified against the project in `.env.local` through a production `next start`, with
 * a real cookie jar minted by `@supabase/ssr`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ROOT = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");

const ROUTE = "src/app/api/auth/ensure-profile/route.ts";
const FORM = "src/components/AuthForm.tsx";

const route = read(ROUTE);
const form = read(FORM);

/** Where a pattern first appears, so two statements can be ordered against each other. */
function at(source, pattern, what) {
  const index = source.search(pattern);
  assert.notEqual(index, -1, `expected ${what ?? pattern} to appear`);
  return index;
}

test("the endpoint authenticates the session, and refuses before anything privileged runs", () => {
  // The identity comes from the auth server, not from the request.
  assert.match(
    route,
    /sessionClient\.auth\.getUser\(\)/,
    "the caller must be resolved with auth.getUser(), which validates the token server-side"
  );

  assert.match(
    route,
    /if \(userError \|\| !user \|\| !user\.email\)/,
    "a missing, invalid or email-less session must be refused"
  );
  assert.match(
    route,
    /NextResponse\.json\(\{ error: "Unauthorized" \}, \{ status: 401 \}\)/,
    "and refused with 401 — not 200, 400 or 404"
  );

  assert.ok(
    at(route, /status: 401/, "the 401") <
      at(route, /createServiceRoleClient\(\)/, "the service-role client"),
    "the refusal must precede the service-role client, so an unauthenticated request cannot reach RLS-bypassing code"
  );
});

test("no user id is ever taken from the request", () => {
  // Every way the old handler let the caller choose whose row it wrote. The body is
  // still accepted (the form sends none) — it is simply never parsed.
  assert.doesNotMatch(route, /request\.json\(\)/, "the request body must not be read");
  assert.doesNotMatch(route, /userId/, "a caller-supplied id must not appear in the route at all");
  assert.doesNotMatch(
    route,
    /auth\.admin\.getUserById/,
    "the service role must never resolve an account named by the caller"
  );
  assert.doesNotMatch(
    route,
    /request\.nextUrl|searchParams/,
    "nor may a query string choose the account"
  );

  // Both reads are keyed on the session user and nothing else. (Counted rather than
  // matched as a chain, so reordering the builder never breaks the guard.)
  const keyedOnSession = route.match(/\.eq\("id", user\.id\)/g) ?? [];
  assert.ok(
    keyedOnSession.length >= 2,
    `the profile lookup and the role re-read must both be keyed on the session user (found ${keyedOnSession.length})`
  );
  assert.match(route, /id: user\.id, name, email: user\.email, role/, "as is the row that is written");
  assert.match(route, /\.upsert\(\{ id: user\.id \}, \{ onConflict: "id"/, "as is the technicians row");
});

test("an existing profile can never have its role changed", () => {
  assert.doesNotMatch(route, /\.update\(/, "the route must never update a row");
  assert.doesNotMatch(
    route,
    /existingProfile\.role/,
    "the removed promotion branch compared the role already in the database"
  );
  assert.match(
    route,
    /if \(!existingProfile\) \{/,
    "the only write is reachable when the profile is missing"
  );
  assert.match(
    route,
    /ignoreDuplicates: true/,
    "and it is insert-if-absent, so a profile that appears concurrently is never overwritten"
  );

  // The read-back exists so the technicians row follows the DATABASE, not the metadata.
  assert.match(
    route,
    /if \(profile\.role === "technician"\)/,
    "the technicians row must be decided by the role re-read from public.users"
  );
});

test("a signup may only ever claim customer or technician", () => {
  // Signup metadata is client-controlled, so it is a two-value whitelist and not a
  // passthrough: everything that is not "technician" becomes "customer".
  assert.match(
    route,
    /user\.user_metadata\?\.role === "technician" \? "technician" : "customer"/,
    'metadata must decide between exactly two roles — anything else, "admin" included, is a customer'
  );
  assert.doesNotMatch(
    route,
    /"(admin|super_admin)"/,
    "the fallback must not mention the staff roles at all, so it cannot grant one"
  );
});

test("the database trigger and the fallback agree on the two claimable roles", () => {
  // Two layers mint a first profile — `handle_new_user()` on a normal signup and this
  // route when that trigger is missing. If they ever disagree, one of them is a way in.
  const schema = read("supabase/schema.sql");
  assert.match(
    schema,
    /when new\.raw_user_meta_data->>'role' in \('customer', 'technician'\)/,
    "handle_new_user() must whitelist the same two roles"
  );
  assert.match(
    route,
    /user\.user_metadata\?\.role === "technician" \? "technician" : "customer"/,
    "and the fallback must mirror that whitelist"
  );
});

test("the client sends no user id, and posts no body for the route to trust", () => {
  assert.doesNotMatch(
    form,
    /userId/,
    "the form must not name the account: the session cookie is the only identification"
  );
  assert.match(
    form,
    /fetch\("\/api\/auth\/ensure-profile", \{\s*\n\s*method: "POST",\s*\n\s*\}\)/,
    "the call must carry the session cookie and nothing else"
  );
});

test("the API surface stays outside the middleware matcher, so each route guards itself", () => {
  const middleware = read("src/middleware.ts");
  const declared = middleware.match(/matcher: \[([\s\S]*?)\]/);
  assert.ok(declared, "src/middleware.ts must declare a matcher");
  assert.doesNotMatch(
    declared[1],
    /"\/api/,
    "the matcher covers pages only — an /api handler that forgets its own guard is open to anyone with the publishable key"
  );
});
