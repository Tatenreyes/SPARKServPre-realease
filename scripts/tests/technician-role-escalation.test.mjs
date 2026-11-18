/**
 * Regression guard for the technician role-escalation vulnerability.
 *
 *   npm run test:role-escalation
 *
 * WHY THIS EXISTS. `/admin/technicians` used to promote people while it rendered:
 *
 *   const authUsers = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
 *   const technicianAuthUsers = authUsers.users.filter(
 *     (u) => u.user_metadata?.role === "technician" && u.email          // caller-writable
 *   );
 *   for (const authUser of technicianAuthUsers) {
 *     else if (profile.role === "customer") {
 *       await supabase.from("users").update({ role: "technician" })     // the promotion
 *         .eq("id", authUser.id);
 *     }
 *   }
 *
 * `user_metadata` belongs to the account holder — Supabase's own `auth.updateUser()`
 * writes it from the browser — so any customer could set `role: "technician"` on their
 * own account. The database refuses the self-promotion that would normally follow
 * (`prevent_role_change()`, the `protect_user_role` trigger), but that trigger exempts
 * the service role, and this page wrote with the service role. The result: a customer
 * became a technician the next time an administrator merely LOADED a page — no decision
 * taken, no actor recorded, and a `technicians` row created as a side effect.
 *
 * Verified live before the fix, against the project's own database: the account holder
 * could rewrite their `user_metadata.role` (HTTP 200), promoting themselves with their
 * own token was refused (HTTP 400, `P0001`), and the service-role write this page made
 * succeeded (HTTP 200).
 *
 * The fix has three parts, and each is pinned here:
 *
 *   1. the page reads only — rendering it cannot write a row;
 *   2. the repair it used to perform is an explicit, administrator-only request
 *      (`POST /api/admin/technicians/repair`) that creates MISSING rows only, so it
 *      cannot promote an existing account whatever its metadata says;
 *   3. `user_metadata.role` is read in exactly two places, both insert-only, so a
 *      metadata flip grants nothing on its own.
 *
 * These are source-contract assertions for the same reason as
 * `scripts/tests/user-guard.test.mjs`: there is no server or React runner here
 * (TESTING.md §5), and the defect was in the shape of the code — which actor decides,
 * when, and with which credential.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";

const ROOT = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");
const exists = (path) => existsSync(new URL(path, ROOT));

/** Comments are stripped before scanning write calls, as `design-tokens.test.mjs` does. */
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|\s)\/\/.*$/gm, "$1");

/** Every file under a directory, at any depth, whose name the predicate accepts. */
function walk(dir, matches, found = []) {
  for (const entry of readdirSync(new URL(`${dir}/`, ROOT))) {
    const path = `${dir}/${entry}`;
    if (statSync(new URL(path, ROOT)).isDirectory()) walk(path, matches, found);
    else if (matches(entry)) found.push(path);
  }
  return found;
}

/** Where a pattern first appears, so two statements can be ordered against each other. */
function at(source, pattern, what) {
  const index = source.search(pattern);
  assert.notEqual(index, -1, `expected ${what ?? pattern} to appear`);
  return index;
}

/** The write calls that must never appear in a component that only renders. */
const WRITE_CALLS = /\.(insert|update|upsert|delete)\(/;

const PAGE = "src/app/admin/technicians/page.tsx";
const REPAIR = "src/app/api/admin/technicians/repair/route.ts";
const CONTROL = "src/components/RepairTechnicianRecordsButton.tsx";
const APPROVE = "src/app/api/technicians/[id]/approve/route.ts";
const ROLE_API = "src/app/api/users/[id]/role/route.ts";
const ROLE_MIGRATION = "supabase/migration_set_user_role.sql";
const ENSURE = "src/app/api/auth/ensure-profile/route.ts";
const MIGRATION = "supabase/migration_security_hardening.sql";

test("the technicians page never writes a row while rendering", () => {
  const page = stripComments(read(PAGE));

  assert.doesNotMatch(page, WRITE_CALLS, "a GET must not insert, update, upsert or delete");
  assert.doesNotMatch(
    page,
    /user_metadata/,
    "the page must not decide anything from metadata the account holder can write"
  );
  assert.doesNotMatch(
    page,
    /role:\s*"technician"/,
    "and it must not name the technician role at all — it reads rows, it does not mint them"
  );
});

test("no admin screen writes while rendering", () => {
  // The page below used to break this rule, which is why it is asserted for the whole
  // directory rather than for that page alone: an admin screen that wants to mutate must
  // do it from a route, the way every other mutation in this codebase does.
  const offenders = walk("src/app/admin", (name) => name === "page.tsx").filter((path) =>
    WRITE_CALLS.test(stripComments(read(path)))
  );
  assert.deepEqual(
    offenders,
    [],
    `these admin pages mutate the database while rendering: ${offenders.join(", ")}`
  );
});

test("the repair endpoint is administrator-only and reports its own failures", () => {
  assert.ok(exists(REPAIR), `${REPAIR} is missing`);
  const route = read(REPAIR);

  assert.match(
    route,
    /await requireRole\(\["admin", "super_admin"\]\)/,
    "only an administrator may run a repair that writes other people's rows"
  );
  assert.match(
    route,
    /if \(err instanceof AuthError\)/,
    "and an unauthenticated call must be refused, not answered with a 500"
  );
  assert.match(route, /status: 500/, "while a genuine failure still says so");
});

test("the repair endpoint cannot promote an existing account", () => {
  const route = read(REPAIR);

  assert.doesNotMatch(route, /\.update\(/, "it must never update a row");
  assert.match(
    route,
    /if \(profile\) continue;/,
    "an account that already has a profile is left exactly as it is — the guard this vulnerability needed"
  );
  assert.match(
    route,
    /ignoreDuplicates: true/,
    "and every write is insert-if-absent, so it can never overwrite a concurrent one"
  );
  assert.match(
    route,
    /authUser\.user_metadata\?\.role === "technician" \? "technician" : "customer"/,
    "the metadata is a two-value whitelist, exactly as the signup trigger reads it"
  );
  assert.doesNotMatch(
    route,
    /role:\s*"(admin|super_admin)"/,
    "and it must never write a staff role, whatever the metadata claims"
  );
});

test("user_metadata.role is read in exactly two places, and both are insert-only", () => {
  // The vulnerability was an authorization decision taken from a field the user owns.
  // Nothing may read it except the two insert-only healing paths: the signup fallback
  // (your own row) and the administrator's repair (a missing row). Adding a third is a
  // deliberate act, and this test is where it has to be justified.
  const readers = walk("src", (name) => /\.tsx?$/.test(name))
    .filter((path) => /user_metadata\?\.role/.test(read(path)))
    .sort();

  assert.deepEqual(
    readers,
    [ENSURE, REPAIR].sort(),
    `metadata-driven code paths: ${readers.join(", ")}`
  );

  for (const path of readers) {
    assert.doesNotMatch(
      read(path),
      /\.update\(/,
      `${path} reads a user-writable field and must therefore be insert-only`
    );
  }
});

test("approval stays the administrator's explicit step, and is not a role change", () => {
  const approve = read(APPROVE);

  assert.match(
    approve,
    /await requireRole\(\["admin", "super_admin"\]\)/,
    "approval is administrator-only"
  );
  assert.match(approve, /approved: approve/, "and it sets the approval flag");
  assert.doesNotMatch(
    approve,
    /from\("users"\)/,
    "approval must never write public.users — a role change is a different, harder decision"
  );
});

test("changing someone's role remains a super-admin action", () => {
  assert.match(
    read(ROLE_API),
    /await requireRole\(\["super_admin"\]\)/,
    "the role API is the deliberate promotion path, and it is the super admin's alone"
  );
});

test("the repair control is wired to the endpoint, and the page shows it", () => {
  const control = read(CONTROL);

  assert.match(
    control,
    /fetch\("\/api\/admin\/technicians\/repair", \{ method: "POST" \}\)/,
    "the repair must be a request the administrator makes, never a render side effect"
  );
  assert.match(read(PAGE), /<RepairTechnicianRecordsButton \/>/, "and the page must offer it");
});

test("the historical migration cannot be re-applied destructively, and the docs agree", () => {
  const migration = read(MIGRATION);

  // The corrected reader, so re-running the file cannot silently disable the
  // service-role bypass that every deliberate role change depends on.
  assert.match(
    migration,
    /current_setting\('request\.jwt\.claims', true\)::jsonb ->> 'role'/,
    "the function must read the JSON claims object, as schema.sql does"
  );
  assert.match(migration, /NOT PART OF THE UPGRADE PATH/, "and the file must say what it is");

  // The historical copy and the live definition may never drift apart.
  const triggerBody = (source) => {
    const match = source.match(
      /if new\.role is distinct from old\.role[\s\S]*?raise exception 'Only an administrator can change user roles';/
    );
    return match ? match[0].replace(/\s+/g, " ").trim() : null;
  };
  assert.equal(
    triggerBody(migration),
    triggerBody(read("supabase/schema.sql")),
    "prevent_role_change() must be identical in schema.sql and in the historical migration"
  );

  // And the instructions must agree: DATABASE.md is the authority, README points to it.
  assert.match(
    read("DATABASE.md"),
    /migration_security_hardening\.sql[\s\S]{0,600}Pre-queue history/,
    "DATABASE.md must still classify the file as pre-queue history"
  );
  assert.doesNotMatch(
    read("README.md"),
    /^\s*\d+\.\s*migration_security_hardening\.sql/m,
    "README must not list it as a numbered apply step — that is what made re-applying it plausible"
  );
  assert.match(
    read("README.md"),
    /DATABASE\.md[\s\S]{0,40}Apply order[\s\S]{0,120}authoritative/,
    "and README must name DATABASE.md as the authoritative chain"
  );
});

test("a role change writes the profile and the technicians row through one function", () => {
  const route = read(ROLE_API);

  assert.match(
    route,
    /\.rpc\("set_user_role", \{/,
    "the role change must go through the transactional function"
  );
  assert.doesNotMatch(
    route,
    /from\("users"\)/,
    "and must not write public.users itself — that is the pair drifting apart again"
  );
  assert.match(
    route,
    /const supabase = createClient\(\)/,
    "called with the caller's own client, which is the only one that carries an identity"
  );
  assert.doesNotMatch(
    route,
    /createServiceRoleClient/,
    "the service-role client has no auth.uid(), so the function's own super_admin check could not run"
  );
});

test("the role function keeps the pair in step, and cannot be used to escalate", () => {
  assert.ok(exists(ROLE_MIGRATION), `${ROLE_MIGRATION} is missing`);
  const sql = read(ROLE_MIGRATION);

  assert.match(sql, /security definer/, "it writes rows the caller's own policies would refuse");
  assert.match(
    sql,
    /is distinct from 'super_admin'::public\.user_role/,
    "only a super administrator may call it"
  );
  assert.match(
    sql,
    /current_setting\('request\.jwt\.claims', true\)::jsonb/,
    "with the service-role escape hatch spelled exactly as the trigger spells it"
  );
  assert.match(
    sql,
    /insert into public\.technicians \(id\) values \(p_user_id\)\s*\n\s*on conflict \(id\) do nothing/,
    "promotion creates the missing row — unapproved, because creating is not approving"
  );
  assert.match(
    sql,
    /set approved = false, approved_at = null, approved_by = null/,
    "and demotion revokes the approval instead of destroying the history"
  );
  assert.doesNotMatch(sql, /delete from public\.technicians/, "a technicians row is never deleted");

  // The header comment says the words "user_metadata"; the CODE must not read it.
  const code = sql.replace(/^\s*--.*$/gm, " ");
  assert.doesNotMatch(code, /user_metadata/, "it must not read a field the account holder can write");
  assert.match(
    sql,
    /revoke all on function public\.set_user_role\(uuid, public\.user_role\) from public, anon;/,
    "anonymous callers are refused at the grant level"
  );
  assert.match(
    sql,
    /grant execute on function public\.set_user_role\(uuid, public\.user_role\) to authenticated, service_role;/,
    "the same grant `admin_queue_override` uses — role-checked inside, not open"
  );
});

test("a deployment ahead of its database names the file to run", () => {
  const route = read(ROLE_API);

  assert.match(route, /SERVICE_SETUP_REQUIRED/, "the established code for a schema gap");
  assert.match(route, /migration_set_user_role\.sql/, "with the file named in the message");
  assert.match(route, /status: 503/, "as a 503, never a bare 500 that names nothing");
});

test("the new migration is documented as prepared, not as applied", () => {
  const dbDoc = read("DATABASE.md");

  assert.match(
    dbDoc,
    /migration_set_user_role\.sql`?\s*\|\s*\*\*Prepared/,
    "the migration inventory must carry a row saying what state it is in"
  );
  assert.match(
    dbDoc,
    /Prepared — NOT applied/,
    "and say it in words, so nobody assumes the function is live"
  );
});

test("the role function refuses both ways a project loses its last administrator", () => {
  const sql = read(ROLE_MIGRATION);

  assert.match(
    sql,
    /A super administrator cannot change their own role away from super_admin/,
    "guard 1: nobody demotes themselves out of the driver's seat"
  );
  assert.match(
    sql,
    /Refusing to remove the last active super administrator/,
    "guard 2: the last ACTIVE super administrator cannot be removed by anyone"
  );
  assert.match(
    sql,
    /and v_current\.is_active\s*\n\s*and p_role <> 'super_admin'::public\.user_role then/,
    "guard 2 keys on the target actually being an active super administrator"
  );
  assert.match(
    sql,
    /where role = 'super_admin'::public\.user_role\s*\n\s*and is_active\s*\n\s*and id <> p_user_id/,
    "and counts the OTHER active ones — a deactivated replacement is not a replacement"
  );
  assert.match(
    sql,
    /and id <> p_user_id\s*\n\s*for update;/,
    "the peers are locked before they are counted, so two simultaneous demotions cannot both see the other as a replacement"
  );
  assert.ok(
    at(sql, /Refusing to remove the last active super administrator/, "the last-admin guard") <
      at(sql, /^  update public\.users$/m, "the role write"),
    "both guards must precede the write, so a refused call cannot have changed anything"
  );
});

test("the role function's search_path and grants are the pinned, closed ones", () => {
  const raw = read(ROLE_MIGRATION);
  const code = raw.replace(/^\s*--.*$/gm, " ");

  assert.match(raw, /set search_path = public, pg_temp/, "pg_temp is named LAST, not left to the implicit order");
  assert.match(
    raw,
    /revoke all on function public\.set_user_role\(uuid, public\.user_role\) from public, anon;/,
    "an anonymous caller cannot reach it"
  );
  assert.match(
    raw,
    /grant execute on function public\.set_user_role\(uuid, public\.user_role\) to authenticated, service_role;/,
    "and only those two roles can — the function refuses non-super-admins one layer in"
  );
  assert.match(code, /from public\.users/, "the profile read is schema-qualified");
  assert.match(code, /update public\.users/, "as is the role write");
  assert.match(code, /insert into public\.technicians/, "and the technicians row");
  assert.doesNotMatch(
    code,
    /(from|update|into|join)\s+(users|technicians)\b/i,
    "no unqualified table reference, so a caller's temp object can never shadow one"
  );
});

test("the deployment preflight reports the prepared step as pending", () => {
  const checker = read("scripts/check-migration-state.mjs");

  assert.match(
    checker,
    /file: "supabase\/migration_set_user_role\.sql"/,
    "db:check must know the file, or applying it is invisible to the gate"
  );
  assert.match(checker, /functions: \["set_user_role"\]/, "probed by the function it creates");
});

test("the migration has an isolated-Postgres test, wired into the scripts", () => {
  assert.ok(exists("scripts/test-role-sync-sql.mjs"), "the PGlite harness is missing");

  const harness = read("scripts/test-role-sync-sql.mjs");
  assert.match(harness, /migration_set_user_role\.sql/, "it must load the file under test");
  assert.match(harness, /queue_redesign/, "and the queue engine, whose triggers keep membership in step");
  assert.match(
    harness,
    /a super administrator cannot demote THEMSELVES/,
    "including the lockout scenarios, not only the happy path"
  );
  assert.match(
    read("package.json"),
    /"test:role-sync": "node scripts\/test-role-sync-sql\.mjs"/,
    "and npm must expose it"
  );
});

test("the role control reports the API's refusal instead of pretending the change happened", () => {
  const control = read("src/components/RoleControl.tsx");

  assert.match(control, /if \(!response\.ok\)/, "the response status must be checked");
  assert.match(control, /await response\.json\(\)/, "and the body read for the API's own words");
  assert.match(
    control,
    /await response\.json\(\)\.catch\(\(\) => null\)/,
    "a non-JSON body (a proxy error page, an empty 500) must not decide what is shown"
  );
  assert.match(
    control,
    /setRole\(currentRole\)/,
    "a refused change must snap the selection back to the role the database still has"
  );
  assert.match(control, /role="alert"/, "and the message must be announced, not merely coloured");
  assert.match(
    control,
    /SERVICE_SETUP_REQUIRED/,
    "the 503 is the one status that needs an instruction rather than a sentence"
  );
  assert.match(control, /migration_set_user_role\.sql/, "and it must name the file to run");
  assert.match(
    control,
    /HTTP \$\{response\.status\}/,
    "any other status still says which one it was, so a 400/403 is not a silent no-op"
  );
});

test("the API passes the database's own refusals through as a 400", () => {
  const route = read(ROLE_API);

  assert.match(
    route,
    /code === "P0001"/,
    "a `raise exception` from the function is a decision, not an internal failure"
  );
  assert.match(
    route,
    /\{ error: \(err as \{ message: string \}\)\.message \}, \{ status: 400 \}/,
    "and its message — the whole point of the guard — reaches the administrator as a 400"
  );
  assert.match(route, /SERVICE_SETUP_REQUIRED/, "while a missing function still names the migration");
  assert.match(route, /status: 503/, "as a 503");
});

test("the role function serializes role changes on one shared key, and returns jsonb", () => {
  const sql = read(ROLE_MIGRATION);

  assert.match(
    sql,
    /perform pg_advisory_xact_lock\(hashtext\('sparkserv-user-role'\)\);/,
    "the repo's namespaced-key pattern, taken once per role change"
  );
  assert.ok(
    at(sql, /pg_advisory_xact_lock\(hashtext\('sparkserv-user-role'\)\)/, "the serialization lock") <
      at(sql, /^  select \* into v_current from public\.users/m, "the profile read"),
    "the lock must be taken before the row is read, or two demotions can both count the other as a replacement"
  );
  assert.match(sql, /returns jsonb/, "jsonb is the return shape the other RPCs here use");
  assert.match(sql, /return to_jsonb\(v_profile\);/, "and the profile is returned through it");
});
