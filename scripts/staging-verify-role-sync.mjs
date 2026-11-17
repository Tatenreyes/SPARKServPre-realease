/**
 * Staging integration test — `npm run staging:verify-role-sync`
 *
 * Runs against the DISPOSABLE `sparkserv-staging` project ONLY, and refuses to run
 * anywhere else (`scripts/staging-safety.mjs`). It is the live counterpart of
 * `scripts/test-role-sync-sql.mjs`: the PGlite harness proves the SQL, this proves the
 * deployed path — PostgREST, real JWTs, real RLS, and two requests genuinely in flight at
 * the same moment, which a single connection can never show.
 *
 * WHAT IT COVERS
 *   1. authentication — a seeded account signs in; the anon key alone cannot
 *   2. authorization  — anon / customer / admin (not super) are all refused, and nothing
 *      is written when they are
 *   3. promotion      — creates an UNAPPROVED `technicians` row
 *   4. demotion       — keeps the row and its history, revokes the approval
 *   5. concurrency    — two super administrators demoting each other at the same instant:
 *      exactly one succeeds and an active super administrator always remains
 *   6. the self-demotion guard
 *
 * SAFETY. Every account it creates is throwaway (`staging-role-sync-<stamp>-…`), it
 * refuses to change the role of anything else, and it deletes what it created in a
 * `finally`. It refuses to start unless the staging project already has a super
 * administrator of its own, so cleaning up can never lock the project out. Nothing here
 * is imported by `npm test`: the suite stays offline.
 */
import { createClient } from "@supabase/supabase-js";
import { loadStagingTarget, reportStagingRefusal } from "./staging-safety.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `\n        ${detail}`}`);
};
const section = (title) => console.log(`\n== ${title} ==`);

let target;
try {
  target = await loadStagingTarget();
} catch (error) {
  process.exit(reportStagingRefusal(error));
}

console.log(
  `staging target VERIFIED — ${target.ref} (${target.markerKey} = ${target.markerValue}), ` +
    `from ${target.file}`
);

const stamp = Date.now().toString(36);
const PREFIX = `staging-role-sync-${stamp}`;
const PASSWORD = `Stg!${stamp}Zz9`;
const created = [];

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(target.url, target.serviceKey, clientOptions);

const unwrap = (result, what) => {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data;
};

const roleOf = async (id) => unwrap(await admin.from("users").select("role").eq("id", id).single(), "roleOf").role;
const technicianRowOf = async (id) =>
  (await admin.from("technicians").select("*").eq("id", id).maybeSingle()).data;
const activeSuperAdmins = async () => {
  const { count, error } = await admin.from("users")
    .select("id", { count: "exact", head: true })
    .eq("role", "super_admin")
    .eq("is_active", true);
  if (error || count === null) {
    throw new Error(`activeSuperAdmins: ${error?.message ?? "exact count unavailable"}`);
  }
  return count;
};

/** A refusal, not a crash: the target has to be usable before anything is created. */
function refuse(message) {
  console.error(`\nREFUSED — ${message}\n`);
  process.exit(2);
}

/** Sign somebody up the way the admin API does, with a throwaway address. */
async function seed(label, role = "customer") {
  const email = `${PREFIX}-${label}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { name: label, role: role === "technician" ? "technician" : "customer" },
  });
  if (error) throw new Error(`seed ${label}: ${error.message}`);
  created.push(data.user.id);

  if (role === "admin" || role === "super_admin") {
    // The service-role JWT is what `prevent_role_change()` exempts, so this is the same
    // path the migration header documents for seeding and recovery.
    const { error: roleError } = await admin.from("users").update({ role }).eq("id", data.user.id);
    if (roleError) throw new Error(`seed ${label} -> ${role}: ${roleError.message}`);
  }
  return { id: data.user.id, email, label };
}

async function signIn(user) {
  const client = createClient(target.url, target.anonKey, clientOptions);
  const { error } = await client.auth.signInWithPassword({ email: user.email, password: PASSWORD });
  if (error) throw new Error(`sign-in ${user.label}: ${error.message}`);
  return client;
}

async function callSetRole(client, userId, role) {
  const { data, error } = await client.rpc("set_user_role", { p_user_id: userId, p_role: role });
  return { ok: !error, error, data };
}

/** A role change may only ever be attempted on an account this run created. */
function assertThrowaway(user, action) {
  if (!created.includes(user.id)) {
    throw new Error(`refusing to ${action}: ${user.id} was not created by this run`);
  }
}

const anonClient = createClient(target.url, target.anonKey, clientOptions);

try {
  /* ------------------------------------------------------------- 0. preflight --- */
  section("0. Preflight");
  const existingSupers = await activeSuperAdmins();
  if (existingSupers === 0) {
    refuse(
      "this staging project has no active super administrator of its own. Create one first " +
        "(STAGING.md §2) — otherwise deleting this run's throwaway accounts would leave the " +
        "project with nobody able to administer it."
    );
  }
  check("the staging project has its own super administrator", existingSupers >= 1, `count = ${existingSupers}`);

  // The probe id does not exist, so if the function IS present this call raises "no profile
  // for …" and writes nothing. Its only job is to tell the two failure modes apart.
  const probe = await anonClient.rpc("set_user_role", {
    p_user_id: "00000000-0000-0000-0000-000000000000",
    p_role: "customer",
  });
  const probeMessage = probe.error?.message ?? "";
  if (/Could not find the function|PGRST202/i.test(probeMessage)) {
    console.error("\nSTOP — `set_user_role` does not exist in this project yet.");
    console.error("Apply supabase/migration_set_user_role.sql, reload the PostgREST schema cache");
    console.error("(STAGING.md §2), then run this again.\n");
    process.exit(3);
  }
  check("the function exists in this project", true, "probe: " + (probeMessage || "answered"));

  /* ---------------------------------------------------------- 1. authentication --- */
  section("1. Authentication");
  const customer = await seed("customer");
  const technician = await seed("technician", "technician");
  const adminUser = await seed("admin", "admin");
  const superAdmin = await seed("actor", "super_admin");

  const customerClient = await signIn(customer);
  const { data: sessionUser } = await customerClient.auth.getUser();
  check("a seeded account can sign in and holds a real session", sessionUser?.user?.id === customer.id);
  check(
    "a technician signup still gets its technicians row (signup trigger)",
    Boolean(await technicianRowOf(technician.id))
  );

  /* --------------------------------------------------------- 2. authorization --- */
  section("2. Authorization — a non-super-administrator writes nothing");
  let result = await callSetRole(anonClient, customer.id, "technician");
  check(
    "anon: refused before any check inside (no EXECUTE)",
    !result.ok && /permission denied|not authorized|invalid|jwt/i.test(result.error?.message ?? ""),
    result.error?.message
  );

  result = await callSetRole(customerClient, customer.id, "technician");
  check(
    "customer promoting themselves: refused by the guard inside the function",
    !result.ok && /super administrator/i.test(result.error?.message ?? ""),
    result.error?.message
  );
  check("...and the role did not move", (await roleOf(customer.id)) === "customer");

  const adminClient = await signIn(adminUser);
  result = await callSetRole(adminClient, customer.id, "technician");
  check(
    "admin (not super): refused — stricter than the trigger, which allows any admin",
    !result.ok && /super administrator/i.test(result.error?.message ?? ""),
    result.error?.message
  );
  check("...and no technicians row was created", (await technicianRowOf(customer.id)) === null);

  /* -------------------------------------------------------------- 3. promotion --- */
  section("3. Promotion — an UNAPPROVED technicians row");
  const actor = await signIn(superAdmin);
  assertThrowaway(customer, "promote");
  result = await callSetRole(actor, customer.id, "technician");
  check("a super administrator promotes the customer", result.ok, result.error?.message);
  check("...the profile is a technician", (await roleOf(customer.id)) === "technician");

  const promotedRow = await technicianRowOf(customer.id);
  check("...a technicians row exists", Boolean(promotedRow));
  check("...it is UNAPPROVED", promotedRow?.approved === false, JSON.stringify(promotedRow));
  check(
    "...and the call returned the updated profile as a JSON object",
    result.data?.role === "technician",
    JSON.stringify(result.data)
  );

  /* --------------------------------------------------------------- 4. demotion --- */
  section("4. Demotion — history kept, approval revoked");
  unwrap(
    await admin.from("technicians").update({ jobs_completed: 7, experience_years: 4 }).eq("id", customer.id),
    "history"
  );

  const selfDemote = await callSetRole(actor, superAdmin.id, "customer");
  check(
    "a super administrator cannot demote THEMSELVES",
    !selfDemote.ok && /own role away from super_admin/i.test(selfDemote.error?.message ?? ""),
    selfDemote.error?.message
  );

  result = await callSetRole(actor, customer.id, "customer");
  check("a super administrator demotes the technician", result.ok, result.error?.message);

  const demotedRow = await technicianRowOf(customer.id);
  check("...the technicians row is KEPT", Boolean(demotedRow));
  check("...the approval is revoked", demotedRow?.approved === false);
  check(
    "...and the history survived",
    demotedRow?.jobs_completed === 7 && Number(demotedRow?.experience_years) === 4,
    JSON.stringify(demotedRow)
  );

  /* ----------------------------------------------------------- 5. concurrency --- */
  section("5. Two super administrators demoting each other at the same instant");
  // Each request is its own PostgREST transaction, so `Promise.all` here is two genuinely
  // concurrent transactions — the interleaving a single connection cannot produce.
  // Each round checks the observed outcome while the staging administrator remains active.
  const ROUNDS = 3;
  let roundsWithOneWinner = 0;
  let roundsWithASurvivor = 0;

  for (let round = 1; round <= ROUNDS; round += 1) {
    const first = await seed(`pair-${round}-a`, "super_admin");
    const second = await seed(`pair-${round}-b`, "super_admin");
    const clientA = await signIn(first);
    const clientB = await signIn(second);

    const [one, two] = await Promise.all([
      callSetRole(clientA, second.id, "customer"),
      callSetRole(clientB, first.id, "customer"),
    ]);

    const wins = [one, two].filter((r) => r.ok).length;

    const roles = [await roleOf(first.id), await roleOf(second.id)];
    const active = await activeSuperAdmins();
    if (wins === 1) roundsWithOneWinner += 1;
    if (active >= 1 && roles.includes("super_admin")) roundsWithASurvivor += 1;

    console.log(`  round ${round}: successes=${wins}  active super admins=${active}  roles=${roles.join(" / ")}`);
  }

  check(
    "exactly one of the two simultaneous demotions succeeded, in every round",
    roundsWithOneWinner === ROUNDS,
    `${roundsWithOneWinner}/${ROUNDS}`
  );
  check(
    "one of the two test super administrators survived every round",
    roundsWithASurvivor === ROUNDS,
    `${roundsWithASurvivor}/${ROUNDS}`
  );
} catch (error) {
  console.error("\nHARNESS ERROR:", error?.stack ?? error);
  failures += 1;
} finally {
  /* --------------------------------------------------------------- cleanup --- */
  section("Cleanup");
  let removed = 0;
  for (const id of created) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (!error) removed += 1;
  }
  console.log(`  removed ${removed}/${created.length} throwaway accounts (their profiles and rows cascade)`);
  if (removed !== created.length) failures += 1;

  const leftoverSupers = await activeSuperAdmins();
  check(
    "the staging project still has an active super administrator",
    leftoverSupers >= 1,
    `count = ${leftoverSupers}`
  );

  console.log(
    `\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`} — ` +
      `${target.ref} (sparkserv-staging), ${created.length} throwaway accounts created and removed`
  );
  process.exit(failures === 0 ? 0 : 1);
}
