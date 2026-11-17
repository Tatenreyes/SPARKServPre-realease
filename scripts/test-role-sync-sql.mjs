/**
 * SPARKServ role-sync integration test — `npm run test:role-sync`
 *
 * Loads the real schema, the queue engine and the PREPARED
 * `supabase/migration_set_user_role.sql` into an in-process Postgres (PGlite, WASM),
 * then drives `set_user_role()` the way the application will: as a super administrator,
 * as an ordinary signed-in customer, as an anonymous caller and as the service role.
 *
 * Why this exists: the properties that matter here cannot be read off the file. That the
 * promotion creates an UNAPPROVED `technicians` row, that the queue engine agrees it
 * cannot be assigned yet, that demotion keeps the row and its history while revoking the
 * approval, and that the two lockout guards refuse the calls they must and allow the
 * ones they must not — every one of those is a statement about behaviour under real
 * triggers, and reading `create or replace function` is not evidence of it.
 *
 * The migration is NOT applied to the live project, and the live project has no
 * disposable database, so this harness is the isolated environment: it is repeatable,
 * offline and cannot touch `D:\PC\sparkserv-notifications`' project at all.
 *
 * Caveat: PGlite is Postgres compiled to WASM with `auth.uid()` and the
 * anon/authenticated/service_role roles stubbed (see `scripts/sql-harness.sql`). A green
 * run means the SQL and its guards are sound — not that the live database has the
 * function yet. `npm run db:check` reports whether it has been applied.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";

const repo = process.argv[2] ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(repo, p), "utf8");

const db = new PGlite({ extensions: { uuid_ossp } });

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `\n        ${detail}`}`);
}

async function exec(label, sql) {
  try {
    await db.exec(sql);
    console.log(`  loaded ${label}`);
  } catch (err) {
    console.log(`  FAILED loading ${label}: ${err.message}`);
    throw err;
  }
}

async function query(sql, params) {
  return (await db.query(sql, params)).rows;
}

async function scalar(sql, params) {
  const rows = await query(sql, params);
  return rows[0] ? Object.values(rows[0])[0] : null;
}

/**
 * Become a caller the way PostgREST presents one: the JWT claims GUC, then `set role`.
 * Both spellings of the claims are set because the harness's `auth.uid()` stub reads the
 * legacy singular setting while `prevent_role_change()` reads the plural JSON — which is
 * exactly what a real project has.
 */
async function asCaller({ userId = null, jwtRole }, fn) {
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: userId ?? "", role: jwtRole }),
  ]);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId ?? ""]);
  await db.query("select set_config('request.jwt.claim.role', $1, false)", [jwtRole]);
  await db.exec(`set role ${jwtRole};`);
  try {
    return await fn();
  } finally {
    await db.exec("reset role;");
    await db.query("select set_config('request.jwt.claims', '', false)");
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
    await db.query("select set_config('request.jwt.claim.role', '', false)");
  }
}

/** Call the guarded function and report the outcome instead of throwing. */
async function callSetRole(as, targetId, role) {
  try {
    const result = await asCaller(as, () =>
      query("select public.set_user_role($1, $2) as profile", [targetId, role])
    );
    const payload = result[0]?.profile ?? null;
    return { ok: true, payload, role: payload?.role ?? null };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

/**
 * The project owner in the SQL Editor: no JWT at all. `prevent_role_change()` refuses that
 * too, so the documented recovery path sets the one claim it exempts — the same thing the
 * migration header tells an operator to do.
 */
async function asOwnerWithServiceClaim(sql, params) {
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ role: "service_role" }),
  ]);
  try {
    return await query(sql, params);
  } finally {
    await db.query("select set_config('request.jwt.claims', '', false)");
  }
}

const roleOf = (id) => scalar("select role from public.users where id = $1", [id]);
const activeOf = (id) => scalar("select is_active from public.users where id = $1", [id]);
const technicianRow = (id) =>
  scalar("select row_to_json(t) from public.technicians t where t.id = $1", [id]);
const queueRow = (id) =>
  scalar("select row_to_json(q) from public.technician_queue_state q where q.technician_id = $1", [id]);

console.log("== 1. Loading the schema, the queue engine and the prepared migration ==");
await exec("scripts/sql-harness.sql (Supabase stubs)", read("scripts/sql-harness.sql"));
await exec("supabase/schema.sql", read("supabase/schema.sql"));
// The queue engine, because the `technicians` row this migration creates is kept in step
// with queue membership by ITS triggers — so "unapproved means not assignable yet" is a
// statement about real machinery, not about a table that merely exists.
await exec("supabase/migration_sync_live_schema.sql", read("supabase/migration_sync_live_schema.sql"));
await exec("supabase/migration_flow_hardening.sql", read("supabase/migration_flow_hardening.sql"));
await exec("supabase/migration_queue_redesign.sql", read("supabase/migration_queue_redesign.sql"));

const underTest = read("supabase/migration_set_user_role.sql");
await exec("supabase/migration_set_user_role.sql (the file under test)", underTest);
await exec("supabase/migration_set_user_role.sql (2nd run — must be safe to re-run)", underTest);

// Supabase grants table privileges and relies on RLS to decide the ROWS; a bare Postgres
// grants nothing. Only the privileges production always has are added here.
await exec(
  "Supabase-style privilege stub",
  `
  grant usage on schema public to anon, authenticated, service_role;
  grant select, update on public.users to authenticated;
  grant select on public.technicians to authenticated;
  grant all on public.users, public.technicians to service_role;
`
);

/* --------------------------------------------------------------- fixtures ----- */
console.log("\n== 2. Fixtures ==");
/** Sign somebody up the way Supabase does: the auth trigger writes their profile. */
async function signUp(name, role) {
  const rows = await query(
    "insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id",
    [`${name.toLowerCase()}@example.com`, JSON.stringify({ name, role })]
  );
  return rows[0].id;
}

const superA = await signUp("SuperA", "customer");
const superB = await signUp("SuperB", "customer");
const anAdmin = await signUp("Admin", "customer");
const aCustomer = await signUp("Customer", "customer");
const aTechnician = await signUp("Technician", "technician");

// Two super administrators and one admin, seeded through the service-role path — which is
// also the documented recovery route, so it is exercised rather than assumed.
for (const [id, role] of [[superA, "super_admin"], [superB, "super_admin"], [anAdmin, "admin"]]) {
  await asOwnerWithServiceClaim("update public.users set role = $2 where id = $1", [id, role]);
}
console.log(`  superA=${superA} superB=${superB} admin=${anAdmin}`);
console.log(`  customer=${aCustomer} technician=${aTechnician}`);

/* -------------------------------------------- execution privileges / search_path -- */
console.log("\n== 3. SECURITY DEFINER, execution privileges and search_path (#7) ==");
const proconfig = await scalar("select array_to_string(proconfig, ',') from pg_proc where proname = 'set_user_role'");

check(
  "the function is SECURITY DEFINER",
  (await scalar("select prosecdef from pg_proc where proname = 'set_user_role'")) === true
);
check(
  "search_path is pinned, and names pg_temp LAST",
  /^search_path=public,\s*pg_temp$/.test((proconfig ?? "").trim()),
  `proconfig = ${proconfig}`
);
check(
  "anon holds no EXECUTE on it",
  (await scalar("select has_function_privilege('anon', 'public.set_user_role(uuid, public.user_role)', 'EXECUTE')")) === false
);
check(
  "authenticated holds EXECUTE — the role check refuses them, not the grant",
  (await scalar("select has_function_privilege('authenticated', 'public.set_user_role(uuid, public.user_role)', 'EXECUTE')")) === true
);
check(
  "service_role holds EXECUTE",
  (await scalar("select has_function_privilege('service_role', 'public.set_user_role(uuid, public.user_role)', 'EXECUTE')")) === true
);
check(
  "the declared result is jsonb — an object over the wire, not a composite row PostgREST may shape differently",
  (await scalar(
    `select pg_catalog.format_type(p.prorettype, null)
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where p.proname = 'set_user_role' and n.nspname = 'public'`
  )) === "jsonb"
);

const anonAttempt = await callSetRole({ userId: null, jwtRole: "anon" }, aCustomer, "technician");
check(
  "an anonymous call is refused at the grant, before any check inside runs",
  anonAttempt.ok === false && /permission denied/i.test(anonAttempt.message ?? ""),
  anonAttempt.message
);

/* ---------------------------------------- ordinary signed-in callers, #2 ----- */
console.log("\n== 4. An ordinary signed-in caller cannot make the write happen (#2) ==");
const customerSelf = await callSetRole({ userId: aCustomer, jwtRole: "authenticated" }, aCustomer, "technician");
check(
  "a customer promoting themselves is refused",
  customerSelf.ok === false && /Only a super administrator/.test(customerSelf.message ?? ""),
  customerSelf.message
);
check("...their role did not move", (await roleOf(aCustomer)) === "customer");
check("...and no technicians row was created for them", (await technicianRow(aCustomer)) === null);

const customerOther = await callSetRole({ userId: aCustomer, jwtRole: "authenticated" }, aTechnician, "customer");
check(
  "a customer demoting a technician is refused",
  customerOther.ok === false && /Only a super administrator/.test(customerOther.message ?? ""),
  customerOther.message
);
check("...the technician's role did not move", (await roleOf(aTechnician)) === "technician");

const adminAttempt = await callSetRole({ userId: anAdmin, jwtRole: "authenticated" }, aCustomer, "technician");
check(
  "an admin (not super) is refused too — stricter than the trigger, which allows any admin",
  adminAttempt.ok === false && /Only a super administrator/.test(adminAttempt.message ?? ""),
  adminAttempt.message
);

// The function is not the only guard: the schema's own trigger refuses a direct write.
let directRefusal = "";
try {
  await asCaller({ userId: aCustomer, jwtRole: "authenticated" }, () =>
    query("update public.users set role = 'technician' where id = $1", [aCustomer])
  );
} catch (err) {
  directRefusal = err.message;
}
check(
  "a direct self-promotion that skips the function is refused by prevent_role_change()",
  /Only an administrator can change user roles/.test(directRefusal),
  directRefusal || "the update succeeded"
);
check("...and the role still did not move", (await roleOf(aCustomer)) === "customer");

/** `row_to_json` may arrive parsed or as text, depending on the client. */
const row = (value) => (value == null ? null : typeof value === "string" ? JSON.parse(value) : value);

/* ------------------------------------------------ promotion and demotion (#5) -- */
console.log("\n== 5. Promotion creates an UNAPPROVED record; demotion keeps the history (#5) ==");
const promoted = await callSetRole({ userId: superA, jwtRole: "authenticated" }, aCustomer, "technician");
check("a super administrator promotes a customer to technician", promoted.ok === true, promoted.message);
check(
  "...and the call returns the updated profile as a JSON object",
  promoted.payload?.role === "technician" && typeof promoted.payload === "object",
  JSON.stringify(promoted.payload)
);
check("...the profile is a technician", (await roleOf(aCustomer)) === "technician");

const ghost = await callSetRole(
  { userId: superA, jwtRole: "authenticated" },
  "00000000-0000-0000-0000-000000000000",
  "technician"
);
check(
  "an unknown user id is refused rather than silently ignored",
  ghost.ok === false && /no profile for/.test(ghost.message ?? ""),
  ghost.message
);

const afterPromotion = row(await technicianRow(aCustomer));
check("...a technicians row was created", afterPromotion !== null);
check("...and it is UNAPPROVED", afterPromotion?.approved === false, JSON.stringify(afterPromotion));
check(
  "...with no approval metadata",
  afterPromotion?.approved_by === null && afterPromotion?.approved_at === null
);
check("...and no queue membership yet (no specializations declared)", (await queueRow(aCustomer)) === null);

// The technician declares a specialization while still unapproved. The queue engine must
// create the membership INACTIVE — that is what makes an unapproved row harmless.
await query("update public.technicians set specializations = '{refrigerator}' where id = $1", [aCustomer]);
const inactiveMembership = row(await queueRow(aCustomer));
check(
  "a specialization declared before approval creates an INACTIVE queue row",
  inactiveMembership?.is_active === false,
  JSON.stringify(inactiveMembership)
);

// The administrator approves: exactly what `PATCH /api/technicians/[id]/approve` writes.
await query(
  "update public.technicians set approved = true, approved_at = now(), approved_by = $2 where id = $1",
  [aCustomer, superA]
);
const activeMembership = row(await queueRow(aCustomer));
check("approval puts them IN the rotation", activeMembership?.is_active === true, JSON.stringify(activeMembership));

// Give the record history worth preserving, then demote.
await query(
  "update public.technicians set jobs_completed = 7, experience_years = 4, rating = 4.5 where id = $1",
  [aCustomer]
);

const demoted = await callSetRole({ userId: superA, jwtRole: "authenticated" }, aCustomer, "customer");
check("a super administrator demotes the technician", demoted.ok === true, demoted.message);
check("...the profile is a customer again", (await roleOf(aCustomer)) === "customer");

const afterDemotion = row(await technicianRow(aCustomer));
check("...the technicians row is KEPT (bookings reference it)", afterDemotion !== null);
check("...its approval is revoked", afterDemotion?.approved === false);
check(
  "...the approval metadata is cleared",
  afterDemotion?.approved_by === null && afterDemotion?.approved_at === null
);
check(
  "...and its history is untouched",
  afterDemotion?.jobs_completed === 7 && Number(afterDemotion?.experience_years) === 4
);
check(
  "...and the queue row was DEACTIVATED, not deleted",
  row(await queueRow(aCustomer))?.is_active === false
);

const repromoted = await callSetRole({ userId: superA, jwtRole: "authenticated" }, aCustomer, "technician");
check("re-promotion succeeds", repromoted.ok === true, repromoted.message);
check(
  "...and leaves the existing row unapproved (on conflict do nothing)",
  row(await technicianRow(aCustomer))?.approved === false
);

/* ------------------------------------------- super-administrator lockout (#1) -- */
console.log("\n== 6. Super-administrator lockout guards (#1) ==");
const selfDemote = await callSetRole({ userId: superA, jwtRole: "authenticated" }, superA, "admin");
check(
  "a super administrator cannot demote THEMSELVES",
  selfDemote.ok === false && /cannot change their own role away from super_admin/.test(selfDemote.message ?? ""),
  selfDemote.message
);
check("...and their role did not move", (await roleOf(superA)) === "super_admin");

const otherDemotes = await callSetRole({ userId: superB, jwtRole: "authenticated" }, superA, "admin");
check(
  "another super administrator CAN demote them — the decision leaves the account",
  otherDemotes.ok === true,
  otherDemotes.message
);
check("...and the role moved", (await roleOf(superA)) === "admin");

// Rebuild the state: exactly one active super administrator.
await asOwnerWithServiceClaim("update public.users set role = 'super_admin' where id = $1", [superA]);
await asOwnerWithServiceClaim("update public.users set role = 'admin' where id = $1", [superB]);
const activeSupers = () => scalar("select count(*) from public.users where role = 'super_admin' and is_active");
check("fixture: superA is the last active super administrator", (await activeSupers()) === 1);

const lastOne = await callSetRole({ jwtRole: "service_role" }, superA, "customer");
check(
  "even the SERVICE ROLE cannot demote the last active super administrator",
  lastOne.ok === false && /last active super administrator/.test(lastOne.message ?? ""),
  lastOne.message
);
check("...and their role did not move", (await roleOf(superA)) === "super_admin");

const superC = await signUp("SuperC", "customer");
await asOwnerWithServiceClaim("update public.users set role = 'super_admin' where id = $1", [superC]);
await asOwnerWithServiceClaim("update public.users set is_active = false where id = $1", [superC]);
check("fixture: the only OTHER super administrator is deactivated", (await activeSupers()) === 1);

const deactivatedReplacement = await callSetRole({ jwtRole: "service_role" }, superA, "customer");
check(
  "a DEACTIVATED super administrator is not a replacement — still refused",
  deactivatedReplacement.ok === false && /last active super administrator/.test(deactivatedReplacement.message ?? ""),
  deactivatedReplacement.message
);

await asOwnerWithServiceClaim("update public.users set is_active = true where id = $1", [superC]);
const withReplacement = await callSetRole({ jwtRole: "service_role" }, superA, "customer");
check("with an ACTIVE replacement the same call is allowed", withReplacement.ok === true, withReplacement.message);
check("...and the role moved", (await roleOf(superA)) === "customer");

/* ------------------------------------------------------------ recovery path --- */
console.log("\n== 7. The documented recovery path ==");
// The state the guard exists to prevent, reached deliberately: nobody can administer the
// project. The escape hatch is the project owner in the SQL Editor with the one claim the
// trigger exempts — asserted here so the instruction in the migration header is not
// folklore.
await asOwnerWithServiceClaim("update public.users set role = 'admin', is_active = false where id = $1", [superC]);
check("fixture: the project is locked out (no active super administrator)", (await activeSupers()) === 0);

await asOwnerWithServiceClaim("update public.users set role = 'super_admin', is_active = true where id = $1", [superB]);
check("the SQL-Editor escape hatch restores an active super administrator", (await activeSupers()) === 1);

/* ----------------------------------------------------------------- locking ---- */
console.log("\n== 8. The locking strategy is a mechanism, not documentation (#1) ==");
// ONE connection cannot demonstrate blocking — PGlite is a single session — so the
// interleaving itself is out of reach here. What IS checkable is the mechanism the
// interleaving depends on: `pg_advisory_xact_lock` is held until the transaction ends, so
// inside one transaction the lock is visible in `pg_locks`. With no lock taken, two
// demotions may each see the other as a valid replacement — the lockout this guard exists
// to prevent.
const lockActor = await signUp("SuperD", "customer");
await asOwnerWithServiceClaim("update public.users set role = 'super_admin' where id = $1", [lockActor]);
const lockTarget = await signUp("LockTarget", "customer");

// The pair this key produces, learned by taking the same lock directly.
await db.exec("begin;");
await query("select pg_advisory_xact_lock(hashtext('sparkserv-user-role'))");
const expectedKey = await query(
  "select classid::text || ':' || objid::text as pair from pg_locks where locktype = 'advisory'"
);
await db.exec("rollback;");

await db.exec("begin;");
await callSetRole({ userId: lockActor, jwtRole: "authenticated" }, lockTarget, "technician");
const heldLocks = await query(
  "select classid::text || ':' || objid::text as pair from pg_locks where locktype = 'advisory'"
);
await db.exec("rollback;");

check(
  "a role change holds exactly one advisory lock while it runs",
  heldLocks.length === 1,
  `advisory locks held = ${JSON.stringify(heldLocks)}`
);
check(
  "...and it is the shared key, not a per-user one (a per-user key would not serialize two administrators)",
  JSON.stringify(heldLocks) === JSON.stringify(expectedKey),
  `held = ${JSON.stringify(heldLocks)}, expected = ${JSON.stringify(expectedKey)}`
);
check("the probe rolled back cleanly", (await roleOf(lockTarget)) === "customer");

console.log(
  `\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`} — role-sync SQL in an ` +
    `in-process Postgres. The migration is NOT applied to the live project.`
);
process.exit(failures === 0 ? 0 : 1);
