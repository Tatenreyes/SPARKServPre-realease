#!/usr/bin/env node
/**
 * SPARKServ queue-turn audit  —  `npm run audit:queue-turns`
 * =========================================================
 * Answers one question against the REAL Supabase project in `.env.local`:
 * "was any technician's queue turn spent on a request that could not become a job?"
 *
 * Why this exists. Accepting a request consumes that technician's turn and moves them
 * to the END of that appliance's rotation (`consume_queue_turn`), and that happens at
 * ACCEPTANCE, before an estimate exists. So a request that is accepted and then goes
 * nowhere costs somebody their place in the rotation. That is exactly what happened on
 * 3 Nov: `7d095e43` (created 12 Sep, `quoted`, already owned by a technician) was walked
 * again and accepted at 13:40, which moved that technician from #3 to #4 and produced no
 * estimate and no booking.
 *
 * Step 20 (`supabase/migration_queue_offer_guards.sql`) stops the walk from offering a
 * request that already has an owner, which is how that request was reachable at all. It
 * cannot undo the turns already spent, and it is not a general guarantee — a request can
 * still be accepted and then abandoned by a technician who never quotes it. This script
 * names both populations so a human decides what to do about them.
 *
 * READ-ONLY, BY CONSTRUCTION. Every statement is a `select` through the service-role
 * client. Nothing is inserted, updated or deleted, and no state-changing function is
 * called. GCash references, tokens and passwords are never printed.
 *
 * Exit code 0 when nothing is found, 1 when there is something to look at.
 *
 * Usage: node scripts/audit-queue-turns.mjs [--days=30]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv() {
  const file = path.join(repoRoot, ".env.local");
  const env = { ...process.env };
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const value = match[2].trim().replace(/^["']|["']$/g, "");
    if (!env[match[1]]) env[match[1]] = value;
  }
  return env;
}

const env = loadEnv();
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n" +
      "Copy .env.example to .env.local and fill them in."
  );
  process.exit(2);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const daysArg = process.argv.find((arg) => arg.startsWith("--days="));
const days = Math.max(1, Number(daysArg ? daysArg.slice("--days=".length) : 30) || 30);
const since = new Date(Date.now() - days * 86_400_000).toISOString();

console.log("SPARKServ — read-only queue-turn audit");
console.log("Project:", SUPABASE_URL);
console.log(`Window : the last ${days} day(s), from ${since}`);
console.log("");

/** technician id -> display name, resolved once. */
async function nameMap(ids) {
  if (!ids.length) return new Map();
  const { data } = await admin.from("users").select("id, name").in("id", ids);
  return new Map((data ?? []).map((u) => [u.id, u.name]));
}

function short(value) {
  return value ? String(value).slice(0, 8) : "—";
}

// ---- 1. Every turn consumed in the window, and whether it led anywhere ----------
const turns = await admin
  .from("technician_queue_events")
  .select("id, technician_id, appliance_type, repair_request_id, created_at, reason")
  .eq("action", "TURN_CONSUMED")
  .gte("created_at", since)
  .order("created_at", { ascending: false });

if (turns.error) {
  console.error("Could not read technician_queue_events:", turns.error.message);
  process.exit(2);
}

const turnRows = turns.data ?? [];
const requestIds = [...new Set(turnRows.map((t) => t.repair_request_id).filter(Boolean))];

const requests = requestIds.length
  ? (await admin
      .from("service_requests")
      .select("id, status, assignment_status")
      .in("id", requestIds)).data ?? []
  : [];
const requestById = new Map(requests.map((r) => [r.id, r]));

const estimates = requestIds.length
  ? (await admin
      .from("estimates")
      .select("service_request_id, status")
      .in("service_request_id", requestIds)).data ?? []
  : [];
const estimateCount = new Map();
for (const estimate of estimates) {
  estimateCount.set(
    estimate.service_request_id,
    (estimateCount.get(estimate.service_request_id) ?? 0) + 1
  );
}

const bookings = requestIds.length
  ? (await admin
      .from("bookings")
      .select("service_request_id, status")
      .in("service_request_id", requestIds)).data ?? []
  : [];
const bookingCount = new Map();
for (const booking of bookings) {
  bookingCount.set(
    booking.service_request_id,
    (bookingCount.get(booking.service_request_id) ?? 0) + 1
  );
}

const techNames = await nameMap([...new Set(turnRows.map((t) => t.technician_id))]);

console.log(`-- 1. turns consumed in the window: ${turnRows.length}`);
const spentWithoutProgress = [];
for (const turn of turnRows) {
  const request = requestById.get(turn.repair_request_id);
  const estimatesOnRequest = estimateCount.get(turn.repair_request_id) ?? 0;
  const bookingsOnRequest = bookingCount.get(turn.repair_request_id) ?? 0;
  const progressed = estimatesOnRequest > 0 || bookingsOnRequest > 0;

  console.log(
    `   ${turn.created_at.slice(0, 19)}  ${String(
      techNames.get(turn.technician_id) ?? turn.technician_id
    ).padEnd(22)} ${String(turn.appliance_type).padEnd(16)} req=${short(turn.repair_request_id)}` +
      ` request=${request ? `${request.status}/${request.assignment_status}` : "MISSING"}` +
      ` estimates=${estimatesOnRequest} bookings=${bookingsOnRequest}`
  );

  if (!progressed) spentWithoutProgress.push({ turn, request });
}
console.log("");

// ---- 2. The finding: turns spent on a request that never moved ------------------
console.log("-- 2. turns spent on a request with no estimate and no booking");
if (!spentWithoutProgress.length) {
  console.log("   (none)");
} else {
  console.log(
    "   Each of these cost a technician their place in the rotation and has produced\n" +
      "   nothing yet. A request can still be quoted later, so this is a list to review,\n" +
      "   not a list to repair by hand: check the request with its technician, and if it is\n" +
      "   dead, remove it through the normal UI so the rotation stops carrying it."
  );
  for (const { turn, request } of spentWithoutProgress) {
    console.log(
      `   - ${turn.created_at.slice(0, 19)}  ${
        techNames.get(turn.technician_id) ?? turn.technician_id
      }  ${turn.appliance_type}  request=${short(turn.repair_request_id)}` +
        `  state=${request ? `${request.status}/${request.assignment_status}` : "MISSING"}`
    );
  }
}
console.log("");

// ---- 3. What step 20 now refuses: an owner sitting in a walkable state ----------
console.log("-- 3. requests with an owner that a walk would still have reached (step 20)");
console.log(
  "   These are requests left in `matching`/`waiting` while an assigned technician is\n" +
    "   already attached. Before step 20 the walk offered them again, which is how a turn\n" +
    "   was spent on one; now it answers `already_assigned` and changes nothing. They are\n" +
    "   reported so the state itself can be cleared."
);
const walkableOwned = await admin
  .from("service_requests")
  .select("id, status, assignment_status, assigned_technician_id, appliance_type, updated_at")
  .not("assigned_technician_id", "is", null)
  .in("assignment_status", ["matching", "waiting"]);

if (walkableOwned.error) {
  console.error("   could not read service_requests:", walkableOwned.error.message);
} else {
  const rows = walkableOwned.data ?? [];
  if (!rows.length) console.log("   (none)");
  for (const row of rows) {
    console.log(
      `   - req=${short(row.id)}  ${row.appliance_type}  ${row.status}/${row.assignment_status}` +
        `  technician=${short(row.assigned_technician_id)}  updated=${String(row.updated_at).slice(0, 19)}`
    );
  }
}
console.log("");

const findings = spentWithoutProgress.length;
console.log("-".repeat(62));
console.log(
  findings
    ? `${findings} turn(s) were spent without any progress — review the list above.`
    : "No turn was spent without progress in this window."
);
process.exit(findings ? 1 : 0);

