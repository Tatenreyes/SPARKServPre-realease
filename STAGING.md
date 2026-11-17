# SPARKServ — Staging

A second Supabase project (`sparkserv-staging`) where a change can be applied and *exercised*
before it reaches the live project. It is disposable: the scripts here create accounts, move
roles and demote super administrators, and they are allowed to.

> **The one rule.** Every staging script goes through `scripts/staging-safety.mjs` first, and
> that gate refuses unless the target is **not** production **and** its database carries the
> marker row (§2). A mistyped environment file or a copied `.env.local` therefore stops at the
> gate instead of corrupting real accounts. `npm run staging:safety` reports what the gate
> decides, without writing anything.

---

## 1. Configure the target (once)

1. **Create the project** in Supabase, named `sparkserv-staging`. Any region works; a region
   different from production further isolates it.
2. **Make the environment file**:
   ```bash
   cp .env.staging.example .env.staging     # then fill it in from Settings → API
   ```
   `.env.staging` is git-ignored (`.gitignore`), exactly like `.env.local`. The template
   `.env.staging.example` holds placeholders only and is committed on purpose.
3. **Check the gate**: `npm run staging:safety`. It prints the project ref and the marker it
   read, or refuses with the reason. Nothing else in this document works until it passes. It
   also refuses a file that is **still a copy of the template** — or whose URL or keys are
   still placeholders — naming the values to fill in, so an unfilled file is never mistaken
   for a database that did not answer.
4. **Create the staging super administrator**: register one account through the staging app (or
   the dashboard), then set its `users.role` to `super_admin` with the service-role key — the
   same seeding step `README.md` §"Creating your first admin / super admin" describes. The
   staging scripts **refuse to run while the project has no active super administrator of its
   own**, so deleting their throwaway accounts can never leave the project with nobody able to
   administer it.

## 2. Build the schema (once) — the apply order

`schema.sql` is the canonical install; everything after it is applied **in this order**, by
hand in the staging SQL Editor. This is the order `scripts/check-migration-state.mjs` keeps —
the repo's own "every file that changes the live schema, in the order it must be applied"
registry, which exists precisely because a file missing from it stays invisible until a
feature fails in the browser. The pre-queue history (`migration_appliances_tickets.sql`,
`migration_appliance_centric_flow.sql`, `migration_fix_technician_signup.sql`,
`migration_notifications.sql`, `migration_profile_photos.sql`,
`migration_security_hardening.sql`, `migration_system_settings.sql`,
`migration_visits_payments.sql`) is **not** in the list — `schema.sql` already contains it
(`DATABASE.md` §"Migration files") — and `migration_technician_queue.sql` is superseded and
must never be applied on top.

| # | File | On a **fresh** staging database |
| --- | --- | --- |
| 1 | `migration_sync_live_schema.sql` | Required — the appliance-centric columns. Its legacy-column block is guarded and no-ops. |
| 2 | `migration_flow_hardening.sql` | Required — offer expiry. |
| 3 | `migration_queue_redesign.sql` | Required — the queue engine; `schema.sql` says so itself. |
| 4 | `migration_profile_name_address.sql` | **Required, and easy to miss**: `schema.sql` does *not* have `users.first_name`/`last_name`/`middle_initial`/`address`, which `/api/profile` writes. Idempotent (`add column if not exists`). |
| 5 | `migration_service_location.sql` | Required. |
| 6 | `migration_troubleshooting.sql` | Required. |
| 7 | `migration_offer_lifecycle.sql` | Required. |
| 8 | `migration_estimate_status.sql` | Required — the enum values must come first. |
| 9 | `migration_estimate_workflow.sql` | Required. |
| 10 | `migration_legacy_columns.sql` | **Skip on a fresh database.** It retires `service_requests.issue_description`, which a fresh `schema.sql` never creates — running it fails with `42703`. It exists for upgraded projects. |
| 11 | `migration_service_request_photos_bucket.sql` | Safe (explicitly idempotent). |
| 12 | `migration_appliance_columns.sql` | Safe — `schema.sql` already has both columns. |
| 13 | `migration_booking_payment_status.sql` | Required — the `awaiting_payment` enum value. |
| 14 | `migration_rls_workflow_enforcement.sql` | Required — must follow 13. |
| 15 | `migration_atomic_booking.sql` | Required. |
| 16 | `migration_reject_payment.sql` | Required. |
| 17 | `migration_booking_eligibility.sql` | Required. |
| 18 | `migration_cancel_release.sql` | Required. |
| 19 | `migration_service_warranty.sql` | Required. |
| 20 | `migration_queue_offer_guards.sql` | Required. |
| 21 | `migration_customer_ratings.sql` | Required. |
| 22 | `migration_support_ticket_resolution.sql` | **Skip on a fresh database.** The current `schema.sql` already defines the three resolution columns and their index. Apply this migration only when upgrading a database that lacks those objects. |
| 23 | `migration_set_user_role.sql` | **The change under test** — the transactional role change. |

**Then, in the staging SQL Editor:**

```sql
-- The marker the gate reads. Without it every staging script refuses to run.
insert into public.system_settings (key, value)
values ('staging_environment', 'sparkserv-staging')
on conflict (key) do update set value = excluded.value;

-- PostgREST caches the schema; without this, set_user_role stays absent from the API even
-- though the function exists (DATABASE.md §"After applying migrations").
notify pgrst, 'reload schema';
```

**Verify it; do not assume it.** `check-migration-state.mjs` reads `.env.local` by default, so
point it at staging with environment overrides (`process.env` wins over that file):

```powershell
$env:NEXT_PUBLIC_SUPABASE_URL = (Select-String -Path .env.staging -Pattern '^NEXT_PUBLIC_SUPABASE_URL=(.*)$').Matches.Groups[1].Value
$env:SUPABASE_SERVICE_ROLE_KEY = (Select-String -Path .env.staging -Pattern '^SUPABASE_SERVICE_ROLE_KEY=(.*)$').Matches.Groups[1].Value
npm run db:check
```

The checker reports which object checks pass and lists steps it cannot confirm through PostgREST.
For a fresh install, verify step 8 with `select unnest(enum_range(null::estimate_status));`
(expect `draft`, `revision_requested`, and `superseded`) and verify the `service-request-photos`
bucket from step 11 in the staging Storage dashboard. Step 10 is skipped on a fresh database.

## 3. Run the staging tests

| Command | What it does |
| --- | --- |
| `npm run staging:safety` | Verifies the target and prints it. Writes nothing; the only request is the marker read. |
| `npm run test:staging-safety` | The gate's own tests (offline; part of `npm test`). Mostly pure-function checks plus a temp file per loader case, so no staging project is needed. |
| `npm run staging:verify-role-sync` | The live counterpart of `npm run test:role-sync`: authentication, authorization, technician promotion and demotion, and **two super administrators demoting each other at the same instant**. It creates throwaway accounts (`staging-role-sync-<stamp>-…`), refuses to change the role of anything else, and deletes what it created. |

Exit codes for `staging:verify-role-sync`: **0** all checks passed · **1** a check failed ·
**2** refused — not a verified staging target, nothing was touched · **3** `set_user_role` is
not applied in that project yet.

The offline suites stay offline, and must pass before either of the above means anything:
`npm test` (431 tests, including the gate's own — `npm run test:staging-safety`),
`npm run test:role-sync` (the SQL in an in-process
Postgres) and `npm run test:queue-sql`.

## 4. What staging must never hold

* **Production credentials.** `.env.staging` and `.env.local` are separate files with separate
  keys. The staging project has its own service-role key; the production one is never copied
  into it.
* **A marker it has not earned.** The `staging_environment` row is the database's own statement
  that it is disposable. Adding that row to production to make a script run would defeat the
  only guard that can tell the two apart.
* **Real customer data.** A staging project is for fixtures: the accounts these scripts create
  and delete, plus whatever hand-made data a manual pass needs.
