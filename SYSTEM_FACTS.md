# SYSTEM_FACTS.md

Facts extracted **from the code in this repository** (`d:\PC\sparkserv-notifications\sparkserv-live`),
intended as a source of truth for the SPARKServ capstone manuscript. Every claim below
quotes the file it came from. Where the code does not show something, it says **"not found"**.
Nothing here was inferred from marketing copy or from the prose documents except where a
document is explicitly cited as a *cross-check* (and then the code is the authority).

## 0. Scope and caveats (read this first)

* **Authoritative source tree = the repository ROOT.** There is a second, nested copy of the
  whole project under `SPARKServ/` (its own `package.json` uses `framer-motion` and has no
  test scripts). It is a stale duplicate: `.gitignore` line 26 (`/SPARKServ/`) excludes it, and
  `SYSTEM-ARCHITECTURE.md` §"Scope" line 31–34 states it "is **not** authoritative". All facts
  below are drawn from the root tree. (Searches that show both `SPARKServ/supabase/schema.sql`
  and `supabase/schema.sql` are the two copies.)
* **Migrations are flat in `supabase/`**, not in a `supabase/migrations/` folder. There is no
  timestamped dry-run directory.
* **Database truth split:** `supabase/schema.sql` is the canonical *fresh-install* file, but it
  is **not self-contained** — it says so itself at `supabase/schema.sql:935–948`: the queue
  engine (tables + functions) lives in `supabase/migration_queue_redesign.sql` and must be
  applied after it. The queue tables `technician_queue_events`, `technician_availability`,
  `technician_time_off`, `technician_service_areas` exist **only** in that migration.

### Two code-vs-documentation discrepancies you should know before writing the manuscript

1. **The cron schedule is NOT in the repository.** `vercel.json` is exactly `{}` (verified:
   file contents = `{}`; the nested `SPARKServ/vercel.json` is also empty; there is no
   `.github/workflows` directory — `.github/` contains only `prompts/` and `skills/`). The
   route `src/app/api/cron/assignment-tick/route.ts` exists and its own comment says
   "Vercel Cron sends `Authorization: Bearer <secret>`" and `src/lib/assignment.ts:251` and
   `QUEUE-SYSTEM.md` line 224/`USER-FLOWS.md` line 410 say "every 5 minutes", but **no
   scheduled trigger (`"crons"`, interval, or workflow) is present in the code**. Do not state
   that `vercel.json` schedules the job; state that the endpoint exists and is documented as
   intended to run every 5 minutes, but the schedule config is absent from the repo.
2. **`technicians.availability` (the boolean) IS read by an eligibility function.**
   `QUEUE-SYSTEM.md` line 34–35 says "There is no `availability` boolean derived from the
   existence of a booking anywhere in this codebase" — that is about *deriving* a flag from
   bookings, and it is true. But the standalone `technicians.availability` column is read:
   `supabase/migration_queue_redesign.sql:1103–1108` and `:807–811`, and
   `supabase/migration_booking_eligibility.sql:223–227` return `'temporarily_unavailable'`
   when `technicians.availability = false`. See §3.

---

## 1. DATABASE SCHEMA

### 1.1 Enum types (9) — `supabase/schema.sql`

| Enum | Values | Source |
| --- | --- | --- |
| `user_role` | `customer`, `technician`, `admin`, `super_admin` | `schema.sql:10` |
| `request_status` | `open`, `quoted`, `booked`, `in_progress`, `completed`, `cancelled` | `schema.sql:11` |
| `booking_status` | `pending`, `in_progress`, `completed`, `cancelled`, `awaiting_payment` (**`schema.sql:12`**) **+ `awaiting_inspection`** (`schema.sql:1029`; and `awaiting_payment` re-added `schema.sql:1034`) | `schema.sql:12,1029,1034` |
| `estimate_status` | `draft`, `pending`, `revision_requested`, `accepted`, `rejected`, `superseded` | `schema.sql:17–19` |
| `ticket_status` | `open`, `in_progress`, `resolved`, `closed` | `schema.sql:673` |
| `visit_status` | `upcoming`, `in_progress`, `completed` | `schema.sql:701` |
| `payment_status` | `pending_verification`, `confirmed`, `rejected` | `schema.sql:741` |
| `ticket_type` | `product_inquiry`, `billing_inquiry`, `technical_issue`, `other` | `schema.sql:857` |
| `ticket_priority` | `low`, `medium`, `high`, `critical` | `schema.sql:858` |

Full effective `booking_status` set (used everywhere in code, e.g.
`src/app/api/bookings/[id]/route.ts:7–14` `VALID_STATUSES`):
`pending`, `in_progress`, `awaiting_inspection`, `awaiting_payment`, `completed`, `cancelled`.

**Not enums** (these are `text` + `CHECK`): `service_requests.assignment_status`
(`matching|offered|accepted|waiting`, `schema.sql:132–133`),
`technicians.operational_status` (`AVAILABLE|ON_JOB|SCHEDULED|TEMPORARILY_UNAVAILABLE|OFFLINE|SUSPENDED`,
`migration_queue_redesign.sql:159,180–184`), `technician_offer_history.status`
(`offered|accepted|rejected`, `schema.sql:1004`), `technician_queue_events.action` (18 values,
`migration_queue_redesign.sql:354–360`), `service_requests.troubleshooting_outcome`
(`resolved|unresolved|skipped`, `schema.sql:105–110`), `appliances.warranty_status`
(`yes|no|unknown`, `schema.sql:69–70`).

### 1.2 Tables

**22 tables total.** 18 are created in `supabase/schema.sql`; 4 more only in
`supabase/migration_queue_redesign.sql`. (`SYSTEM-ARCHITECTURE.md` §1 line 48 says "21 tables
(17 in schema.sql, 4 in migration_queue_redesign.sql)" — that count predates `customer_ratings`,
which step 21 folds into `schema.sql`. Code count = 18 + 4 = 22.)

Legend: **PK** primary key, **U** unique, nullable columns marked `(nullable)`, "FK → users" =
references `public.users(id)`, "FK → technicians" = references `public.technicians(id)`. Note
`technicians.id` is itself a FK to `users.id` (1:1).

#### In `supabase/schema.sql`

**`users`** (`schema.sql:24–35`, +`avatar_url` `:900`, +name/address cols `migration_profile_name_address.sql`)
- `id` uuid **PK** FK → `auth.users(id)` cascade · `name` text NOT NULL · `email` text NOT NULL **U**
- `role` `user_role` NOT NULL default `'customer'` · `is_active` boolean NOT NULL default true
- `phone`,`location` text (nullable) · `latitude`,`longitude` double precision (nullable)
- `created_at` · `avatar_url` (nullable) · (migration) `first_name`,`last_name`,`middle_initial`,`address` (nullable)

**`technicians`** (`schema.sql:40–53`; more `migration_queue_redesign.sql:160–169`)
- `id` uuid **PK** FK → `users(id)` cascade · `specializations` text[] NOT NULL default `'{}'`
- `experience_years` numeric NOT NULL default 0 · `rating` numeric NOT NULL default 0
- `availability` boolean NOT NULL default true · `is_new` boolean NOT NULL default true
- `active_job_load` integer NOT NULL default 0 · `jobs_completed` integer NOT NULL default 0
- `approved` boolean NOT NULL default false · `approved_at` timestamptz (nullable)
- `approved_by` uuid (nullable, **FK → users**) · `created_at`
- (queue migration) `operational_status` text NOT NULL default `'AVAILABLE'` (CHECK `:180–184`),
  `status_updated_at` timestamptz NOT NULL default now()
- (queue migration) `max_daily_hours` numeric NOT NULL default 8, `max_concurrent_jobs` integer
  NOT NULL default 2, `max_jobs_per_day` integer NOT NULL default 4, `default_job_minutes` integer
  NOT NULL default 120 (CHECK `:192–194`)

**`appliances`** (`schema.sql:59–76`)
- `id` uuid **PK** default `uuid_generate_v4()` · `customer_id` uuid NOT NULL **FK → users** cascade
- `name` text NOT NULL · `appliance_type` text NOT NULL
- `brand`,`model`,`model_number`,`serial_number` text (nullable) · `purchase_date` date (nullable)
- `warranty_status` text NOT NULL default `'unknown'` (CHECK `yes|no|unknown`)
- `warranty_type` text (nullable) · `warranty_expiry_date` date (nullable) · `warranty_proof_url` text (nullable)
- `notes` text (nullable) · `created_at`

**`service_requests`** (`schema.sql:93–152`)
- `id` uuid **PK** · `customer_id` uuid NOT NULL **FK → users** cascade
- `appliance_id` uuid (nullable) **FK → appliances** `on delete set null` · `appliance_type` text NOT NULL
- `issue_category` text (nullable) · `issue_id` text (nullable)
- `troubleshooting_outcome` text (nullable, CHECK `resolved|unresolved|skipped`)
- `problem_description` text NOT NULL · `photos` text[] NOT NULL default `'{}'`
- `service_type` text NOT NULL default `'repair'` · `status` `request_status` NOT NULL default `'open'`
- `chatbot_resolved` boolean NOT NULL default false · `location` text (nullable)
- `latitude`/`longitude` double precision (nullable, range + pair checks `:122–129`)
- `assigned_technician_id` uuid (nullable) **FK → users** · `assignment_status` text NOT NULL default `'matching'` (CHECK `matching|offered|accepted|waiting`)
- `offers_expires_at` timestamptz (nullable)
- `requested_window_start`/`requested_window_end` timestamptz (nullable) · `requested_duration_minutes` integer (nullable)
- `created_at`/`updated_at`

**`estimates`** (`schema.sql:165–203`)
- `id` uuid **PK** · `service_request_id` uuid NOT NULL **FK → service_requests** cascade
- `technician_id` uuid NOT NULL **FK → technicians** cascade · `estimated_cost` numeric(10,2) NOT NULL (CHECK = round(labor+parts+other,2) `:195–199`)
- `notes` text (nullable) · `status` `estimate_status` NOT NULL default `'pending'` · `scope` text (nullable)
- `labor_cost`/`parts_cost`/`other_cost` numeric(10,2) NOT NULL default 0 · `other_description` text (nullable; required if other_cost>0)
- `version` integer NOT NULL default 1 · `supersedes_id` uuid (nullable, self-FK) · `superseded_by` uuid (nullable, self-FK)
- `revision_reason` text · `revision_requested_at` timestamptz · `decision_note` text · `submitted_at` timestamptz · `decided_at` timestamptz
- `decided_by` uuid (nullable, **FK → users**) · `approved_at` timestamptz (nullable) · `created_at`
- partial **U** `uniq_live_estimate_per_request` (`:207–209`); partial **U** `uniq_approved_estimate_per_request` (`:211–213`)

**`bookings`** (`schema.sql:218–239`)
- `id` uuid **PK** · `service_request_id` uuid NOT NULL **FK → service_requests** cascade
- `estimate_id` uuid (nullable) **FK → estimates** · `customer_id` uuid NOT NULL **FK → users** cascade
- `technician_id` uuid NOT NULL **FK → technicians** cascade · `scheduled_at` timestamptz NOT NULL
- `duration_minutes` integer NOT NULL default 120 · `status` `booking_status` NOT NULL default `'pending'`
- `final_cost` numeric(10,2) (nullable) · `inspection_confirmed_at` timestamptz (nullable) · `inspection_note` text (nullable)
- `notes` text (nullable) · `created_at`/`updated_at`

**`messages`** (`schema.sql:272–280`) — `id` **PK**; `booking_id` NOT NULL **FK → bookings** cascade;
`sender_id`,`receiver_id` NOT NULL **FK → users** cascade; `content` text NOT NULL; `read` bool default false; `created_at`.

**`ratings`** (`schema.sql:285–297`) — customer→technician: `id` **PK**; `booking_id` NOT NULL **U** FK→bookings cascade;
`customer_id` NOT NULL FK→users cascade; `technician_id` NOT NULL **FK → technicians** cascade; `rating` int NOT NULL (CHECK 1..5);
`comment` text (nullable); `tags` text[] NOT NULL default `'{}'`; `created_at`.

**`service_history`** (`schema.sql:302–320`) — `id` **PK**; `booking_id` NOT NULL **U** FK→bookings cascade;
`customer_id` FK→users; `technician_id` **FK → technicians**; `appliance_type` text NOT NULL; `final_cost` numeric(10,2) (nullable);
`completed_at`; `summary` text (nullable); `warranty_days` int NOT NULL default 30 (CHECK 0..3650); `warranty_until` date (nullable).

**`support_tickets`** (`schema.sql:675–683`; +`type`/`priority` `migration_visits_payments.sql:86–88`;
+`resolution_note`/`resolved_by`/`resolved_at` `migration_support_ticket_resolution.sql`, applied) —
`id` **PK**; `user_id` NOT NULL FK→users cascade; `subject`,`message` text NOT NULL; `status` `ticket_status` NOT NULL default `'open'`;
`created_at`/`updated_at`; `type` `ticket_type` NOT NULL default `'other'`; `priority` `ticket_priority` NOT NULL default `'medium'`;
`resolution_note` text (nullable); `resolved_by` uuid FK→users (nullable); `resolved_at` timestamptz (nullable).

**`visits`** (`schema.sql:703–718`) — `id` **PK**; `booking_id` NOT NULL FK→bookings cascade; `visit_number` int NOT NULL; `title` NOT NULL;
`description` (nullable); `status` `visit_status` NOT NULL default `'upcoming'`; `scheduled_at` timestamptz (nullable);
`technician_id` NOT NULL **FK → users**; `notes` (nullable); `photo_urls` text[] default `'{}'`; `signed_by` (nullable);
`created_at`/`updated_at`; **U** `(booking_id, visit_number)`.

**`payments`** (`schema.sql:743–`; cols `migration_visits_payments.sql:54–66`, `migration_reject_payment.sql`) —
`id` **PK**; `booking_id` NOT NULL FK→bookings cascade; `customer_id` NOT NULL FK→users; `payment_method` text default `'gcash'`;
`gcash_reference` text NOT NULL; `amount` numeric(10,2) NOT NULL; `status` `payment_status` default `'pending_verification'`;
`payment_date` timestamptz default now(); `confirmed_by` (nullable, FK→users); `confirmed_at` (nullable);
`rejected_by` (nullable, FK→users); `rejected_at` (nullable); `rejection_reason` (nullable); `created_at`.

**`system_settings`** (`schema.sql:869–` / `migration_system_settings.sql:5`) — `key` text **PK**; `value` text NOT NULL default `''`;
`updated_at` default now(); `updated_by` uuid (nullable, FK→users).

**`technician_queue_state`** (`schema.sql:968–979`) — **PK `(technician_id, appliance_type)`**; `technician_id` **FK → users**;
`appliance_type` text; `last_assigned_at` timestamptz (nullable); `id` uuid (unique index); `queue_position` integer;
`is_active` bool default true; `turn_count` int default 0; `joined_at`/`updated_at`.

**`technician_offer_history`** (`schema.sql:1000–1007`) — `id` **PK**; `service_request_id` NOT NULL FK→service_requests cascade;
`technician_id` NOT NULL **FK → users**; `status` text NOT NULL (CHECK `offered|accepted|rejected`); `reason` text (nullable); `created_at`.

**`notifications`** (`schema.sql:1039–` / `migration_notifications.sql:5–14`) — `id` **PK**; `user_id` NOT NULL FK→users cascade;
`type`,`title` text NOT NULL; `body`,`link` text (nullable); `read` bool default false; `created_at`.

**`push_subscriptions`** (`schema.sql:1071–` / `migration_notifications.sql:37–44`) — `id` **PK**; `user_id` NOT NULL FK→users cascade;
`endpoint` text NOT NULL **U**; `p256dh` text NOT NULL; `auth` text NOT NULL; `created_at`.

**`customer_ratings`** (`schema.sql:2485–2494` / `migration_customer_ratings.sql:69`) — technician→customer:
`id` **PK**; `booking_id` NOT NULL **U** FK→bookings cascade; `technician_id` NOT NULL **FK → technicians** cascade;
`customer_id` NOT NULL FK→users cascade; `rating` int NOT NULL (CHECK 1..5); `tags` text[] default `'{}'`; `comment` (nullable); `created_at`.

#### Created ONLY in `supabase/migration_queue_redesign.sql`

**`technician_queue_events`** (`migration_queue_redesign.sql:330–343`) — append-only audit
- `id` uuid **PK** · `technician_id` uuid (nullable) **FK → users** `on delete set null`
- `appliance_type` text (nullable) · `repair_request_id` uuid (nullable) **FK → service_requests** `on delete set null`
- `action` text NOT NULL (18-value CHECK `:354–360`: `JOINED_QUEUE, TURN_CONSUMED, MOVED_TO_END, POSITION_CHANGED, SKIPPED_DUE_TO_SCHEDULE, SKIPPED_DUE_TO_CAPACITY, SKIPPED_DUE_TO_UNAVAILABLE, SKIPPED_DUE_TO_SERVICE_AREA, SKIPPED_DUE_TO_ACTIVE_OFFER, OFFERED, ACCEPTED, DECLINED, EXPIRED, REMOVED, REACTIVATED, STATUS_CHANGED, WAITING_FOR_TECHNICIAN, ADMIN_OVERRIDE`)
- `old_position`/`new_position` integer (nullable) · `reason` text (nullable)
- `actor_id` uuid (nullable) **FK → users** `on delete set null` · `created_at`
- **No INSERT policy** — history cannot be fabricated (`:374–386`)

**`technician_availability`** (`migration_queue_redesign.sql:396–408`) — `id` **PK**; `technician_id` NOT NULL **FK → users** cascade;
`weekday` smallint NOT NULL (CHECK 0..6); `start_time`/`end_time` time NOT NULL (CHECK end>start); `is_active` bool default true;
`created_at`/`updated_at`; **U** `(technician_id, weekday, start_time)`.

**`technician_time_off`** (`migration_queue_redesign.sql:422–430`) — `id` **PK**; `technician_id` NOT NULL **FK → users** cascade;
`starts_at`/`ends_at` timestamptz NOT NULL (CHECK ends>starts); `reason` text (nullable); `created_at`.

**`technician_service_areas`** (`migration_queue_redesign.sql:445–453`) — `id` **PK**; `technician_id` NOT NULL **FK → users** cascade;
`appliance_type` text (nullable = all types); `area` text NOT NULL; `created_at`; **U** `(technician_id, appliance_type, area)`.

### 1.3 "Do these tables exist?" (asked specifically)

| Table | Exists? | Where |
| --- | --- | --- |
| `technician_queue_events` | **YES** | `supabase/migration_queue_redesign.sql:330` |
| `technician_availability` | **YES** | `supabase/migration_queue_redesign.sql:396` |
| `technician_time_off` | **YES** | `supabase/migration_queue_redesign.sql:422` |
| `technician_service_areas` | **YES** | `supabase/migration_queue_redesign.sql:445` |
| `customer_ratings` | **YES** | `supabase/schema.sql:2485`; `supabase/migration_customer_ratings.sql:69` |

### 1.4 Migration files — count and latest

* **30 migration files** named `supabase/migration_*.sql` (counted: `dir /b supabase\migration_*.sql`
  → 30), plus **`supabase/schema.sql`** (canonical fresh install, 110,039 bytes, not a migration).
* **There is no single "latest migration" by filename** — files are feature-named, not timestamped.
  Two honest readings:
  * **Documented chain** (`DATABASE.md`): runs to **step 21 = `supabase/migration_customer_ratings.sql`**
    ("the other direction of a rating"). Step 20 = `supabase/migration_queue_offer_guards.sql`.
    Step 19 = `supabase/migration_service_warranty.sql`.
  * **Most recently modified on disk** (mtime): `supabase/migration_customer_ratings.sql`
    (04/11/2026 07:25 pm) — i.e. step 21. (`schema.sql` was also touched 04/11/2026 06:49 pm.)
* Files **not in the numbered chain** (`DATABASE.md:31`) are "pre-queue history" folded into
  `schema.sql`: `migration_appliances_tickets.sql`, `migration_appliance_centric_flow.sql`,
  `migration_notifications.sql`, `migration_profile_photos.sql`, `migration_security_hardening.sql`,
  `migration_system_settings.sql`, `migration_visits_payments.sql`, `migration_fix_technician_signup.sql`.
  `migration_technician_queue.sql` is historical/superseded ("do not apply it on top"). `DATABASE.md:113`
  records step 20 (`migration_queue_offer_guards.sql`) as **PENDING** per `npm run db:check`.

---

## 2. STATUS FLOWS (allowed transitions and who changes them)

### 2.1 `service_requests.status` (`request_status`)

| Transition | Writer (function / route) | Evidence |
| --- | --- | --- |
| (created) → `open` | `POST /api/service-requests` inserts `status: 'open'` | `src/app/api/service-requests/route.ts:35` |
| `open` → `quoted` | **on offer acceptance**, `respond_to_offer()` sets `status='quoted'` when it was `open` | `migration_queue_redesign.sql:1522–1527` |
| → `booked` | `create_booking_atomic()` marks the request `booked` | `create_booking_atomic`, `supabase/schema.sql:~1704`; `DATABASE.md:517–535` |
| `booked` → `quoted` | trigger `reopen_request_after_booking_cancel` (AFTER UPDATE on `bookings`) when the last live booking is cancelled | `ARCHITECTURE.md:361–362` |
| → `completed` | `confirm_payment()` sets `service_requests.status='completed'` (unless `cancelled`) | `migration_rls_workflow_enforcement.sql:618–621` |
| → `cancelled` | customer cancels own booking pre-work (`pending`); staff any time; request side reopens via the booking-cancel trigger | `src/app/api/bookings/[id]/route.ts:66–90` |

* **`in_progress` is NOT written for a service request** — "not found": no writer sets
  `service_requests.status='in_progress'`. Progress is tracked on `bookings.status`; the enum value
  exists but is unused by the app.
* `service_requests.status`/`assignment_status`/`assigned_technician_id` are not client-writable after
  the split RLS policies in `migration_rls_workflow_enforcement.sql`.

### 2.2 `estimates.status` (`estimate_status`)

Writers: `submit_estimate()` and `decide_estimate()` in `supabase/migration_estimate_workflow.sql`
(server-only, service_role). Route: `POST /api/estimates/[id]/decision`
(`src/app/api/estimates/[id]/decision/route.ts`).

```
draft ──submit_estimate──► pending ──decide_estimate('approve')────────► accepted
   ▲                          │  └──── decide_estimate('decline')──────► rejected
   │                          └──── decide_estimate('request_revision')► revision_requested
   └──────────── technician revises (new version) ─────────────────────┘
accepted/pending/draft/revision_requested ── new version ─► superseded
```

* `decide_estimate()` maps `approve → accepted`, `decline → rejected`,
  `request_revision → revision_requested` (`migration_estimate_workflow.sql:376–379`).
* A new version sets the older one to `superseded` (`superseded_by`); approval (`approved_at`) is
  never cleared, so an approved-then-superseded version keeps its approval record (`schema.sql:185–193`).
* A booking may reference **only** the current approved estimate (`status='accepted' and superseded_by is null`),
  enforced by trigger `require_approved_estimate_for_booking` (`schema.sql:244–266`).
* Technician RLS update allows only `draft`/`pending`; a customer never reads a `draft`
  (`migration_estimate_workflow.sql:414–442`).

### 2.3 `bookings.status` (`booking_status`)

Transition matrix = trigger `enforce_booking_update_rules` (BEFORE UPDATE on `bookings`,
`migration_rls_workflow_enforcement.sql`); the route mirrors it for friendly messages
(`src/app/api/bookings/[id]/route.ts`). Canonical flow (`migration_booking_payment_status.sql`;
`migration_rls_workflow_enforcement.sql:27–37`):

```
pending ─► in_progress ─► awaiting_inspection ─► awaiting_payment ─► completed
   │                                                    ▲ customer pays + admin verifies
   └──► cancelled  (customer only while `pending`; staff any time)
```

| From | To | Who / writer |
| --- | --- | --- |
| `pending` | `in_progress` | technician (or staff) — `PATCH /api/bookings/[id]` |
| `in_progress` | `awaiting_inspection` | technician (or staff) — same route |
| `awaiting_inspection` | `awaiting_payment` | **customer only** (written sign-off + inspection note) |
| `pending` | `cancelled` | customer (before work starts); staff any time |
| `awaiting_payment` | `completed` | **`confirm_payment()` only** (admin verifying payment); not the route |
| `completed` | anything | **refused for every role** — `enforce_booking_update_rules` raises "A completed repair is final and cannot be edited" **before** every role branch (`migration_cancel_release.sql:316–330`) |

Slot-holding statuses = `booking_status_holds_slot()` (`schema.sql:2127`): `pending`, `in_progress`,
`awaiting_inspection`, `awaiting_payment`. `completed`/`cancelled` hold none. Same four as
`ACTIVE_BOOKING_STATUSES` in `src/lib/booking-status.ts:23–28`.

### 2.4 `payments.status` (`payment_status`)

Writers: `confirm_payment()` (`migration_rls_workflow_enforcement.sql`) and `reject_payment()`
(`supabase/migration_reject_payment.sql` / `schema.sql:2280`), both server-only, both reachable from
`PATCH /api/payments/[id]` (`src/app/api/payments/[id]/route.ts`).

```
pending_verification ──confirm_payment()──► confirmed   (also closes booking/request + archive + frees slot)
pending_verification ──reject_payment()───► rejected    (touches nothing else; customer resubmits)
```

* A decision is **final**: `enforce_payment_decision_rules` trigger refuses to re-decide or re-annotate
  a non-pending payment, and refuses a rejection recorded with `confirmed_by`/`confirmed_at` set
  (`schema.sql:2220–2274`). Customer INSERT is pinned to `pending_verification`, no decision metadata.

### 2.5 `visits.status` (`visit_status`)

`upcoming → in_progress → completed`. Writers: technician-managed via `/api/visits`
(`src/app/api/visits/route.ts`) and `/api/visits/[id]/route.ts`; RLS `technician manages own visits`
(`schema.sql:733–736`). **No dedicated transition matrix / trigger for visits** — "not found" (unlike bookings).

---

## 3. FEATURES TO CONFIRM (yes/no + file path)

### 3.1 Does a cancellation notification exist? Who is notified?
**YES.** `PATCH /api/bookings/[id]` → `notifyStatusChange()`
(`src/app/api/bookings/[id]/route.ts:215–249`). Recipient is derived from the actor:
`recipientIsCustomer = actorRole !== "customer"` (`:226`), so the party who did **not** press the
button is told. Type string = `` `booking_${status}` `` (`:239`), i.e. **`booking_cancelled`**.
Copy (`:274–278`, `:290–294`): the customer is told *"Appointment cancelled … your approved
estimate and technician are unchanged, so you can book another time"*; the **technician** is told
*"Appointment cancelled … your queue turn was not consumed"* (asserted in
`scripts/tests/notifications-coverage.test.mjs:134–138`).

### 3.2 Does the technician rate the customer (`customer_ratings`)? Where in the UI?
**YES.** Route `POST /api/bookings/[id]/customer-rating`
(`src/app/api/bookings/[id]/customer-rating/route.ts`; table `customer_ratings`). Rateable statuses:
`awaiting_inspection`, `awaiting_payment`, `completed` (`:20`). One rating per visit; a 1–2★ notifies
admins only (`LOW_RATING_ALERT_MAX = 2`, type `customer_rating_low`, `:134–157`).
UI: **`src/components/CustomerRatingForm.tsx`**, rendered from
`src/components/TechnicianJobsClient.tsx:10,188–191` (technician Jobs screen). Admin sees the
aggregate in `src/app/admin/users/page.tsx` ("Tech rating", via `UserManagementClient.tsx`) and
per-visit in `src/app/admin/job-monitoring/page.tsx` (`Tech: ★`) — per
`scripts/tests/customer-rating.test.mjs:313–323`. The customer never sees the row.

### 3.3 Can a customer request an estimate revision?
**YES.** `POST /api/estimates/[id]/decision` accepts `decision: "request_revision"`
(`src/app/api/estimates/[id]/decision/route.ts:8,33–38`) → `decide_estimate(...,'request_revision')`
sets `status='revision_requested'` and records `revision_reason` + `revision_requested_at`
(`migration_estimate_workflow.sql:376–379`; test `scripts/test-queue-sql.mjs:1621–1630`). The
technician's form is notified with type `estimate_revision_requested`
(`src/app/api/estimates/[id]/decision/route.ts:114`).

### 3.4 What does `service_requests.chatbot_resolved` do?
A **legacy boolean** kept in step with the detailed troubleshooting outcome. The wizard sends
`chatbot_resolved: troubleshootingResolved` (`src/components/RequestRepairWizard.tsx:658`), and
`POST /api/service-requests` persists `chatbot_resolved: outcome ? outcome === "resolved" :
Boolean(chatbot_resolved)` (`src/app/api/service-requests/route.ts:140`) — i.e. **derived**, not
hardcoded. The authoritative field is `service_requests.troubleshooting_outcome`
(`resolved|unresolved|skipped`, `schema.sql:105–110`; `DATABASE.md:372–374`). It never completes a
repair or a booking; it is the customer's own report.

### 3.5 Is `technicians.availability` read by any queue or eligibility function?
**YES** (contrary to a plain reading of `QUEUE-SYSTEM.md:34–35`, which is about not *deriving* a flag
from bookings). The boolean is read directly:
* `supabase/migration_queue_redesign.sql:807–811` and `:1103–1108` —
  `if exists (select 1 from public.technicians t where t.id = p_technician_id and t.availability = false)
  then return 'temporarily_unavailable';`
* `supabase/migration_booking_eligibility.sql:223–227` — the same check in the qualification gate.
Written by `PATCH /api/profile` (`src/app/api/profile/route.ts:75`).

### 3.6 Is there any "suspended" state used in eligibility?
**YES.** `technicians.operational_status = 'SUSPENDED'` is one of six values
(`migration_queue_redesign.sql:159,180–184`; type `OperationalStatus` in `src/types/database.ts:50–56`).
The gates return `'suspended'`: `technician_eligibility_failure()`
(`migration_queue_redesign.sql:1069–1074`) and `technician_qualification_failure()`
(`schema.sql:1636–1641`). `create_booking_atomic()` surfaces `technician_not_eligible` with
`reason: 'suspended'`. It is derived by `refresh_technician_operational_status()`, never entered by
hand (`USER-FLOWS.md:416–417`); a suspended technician keeps their queue membership row
(`USER-FLOWS.md:423–425`).

### 3.7 What do the `appliances.warranty_*` columns do in the UI?
Four columns on `appliances`: `warranty_status` (`yes|no|unknown`), `warranty_type`, `warranty_expiry_date`,
`warranty_proof_url` (`schema.sql:69–73`). In the UI:
* `/customer/appliances` writes `warranty_status`, `warranty_type`, `warranty_expiry_date`
  (`src/app/customer/appliances/page.tsx:125–163`).
* The request wizard shows a warranty picker, an expiry date (bounded by `anyRange` in
  `src/lib/appliance-fields.ts`), and a required acknowledgment when `warranty_status === 'yes'`; it
  writes `warranty_status` + `warranty_expiry_date`
  (`src/components/RequestRepairWizard.tsx:151–152,226–239,405–406,632–633,1037–1101`).
* **`warranty_proof_url` is never read or written in `src/`** — "not found" in application code
  (present only in the schema and `migration_appliance_columns.sql`).
* This is distinct from `service_history.warranty_days`/`warranty_until` (the *workmanship* warranty
  on a completed repair, step 19), which `src/lib/warranty.ts` and `WarrantyBadge.tsx` read.

### 3.8 Is there a message feature for administrators?
**No sending (not found); read-only at most.** `messages` is booking-scoped between the booking's
customer and technician. `POST /api/messages` requires the caller to be `booking.customer_id` or
`booking.technician_id` (`src/app/api/messages/route.ts:28–34`), so an **admin cannot send**. RLS
lets an admin **read** any message (`schema.sql:631–635`) but the INSERT policy allows only a booking
participant (`schema.sql:637–646`). There is **no `/admin/messages` page** and no admin message entry
in `src/lib/navConfig.ts`. So: an admin can view threads; there is no administrator messaging feature.

---

## 4. NOTIFICATIONS

One entry point: **`notify(supabase, { userId, type, title, body?, link? })`** in
`src/lib/notifications.ts:19–35` — inserts a `notifications` row and fires a Web Push
(`sendPushToUser()`, `src/lib/push.ts`) in parallel (push failure never fails the caller).
Always called with a **service-role** client (a customer-role insert is refused by RLS).

Every call site (`grep "from \"@/lib/notifications\""` → 11 files) and the type string it sets:

| # | Event / trigger | Recipient | `type` string | Source |
| --- | --- | --- | --- | --- |
| 1 | A request is offered to a technician (`assignTechnician`) | offered technician | `job_offered` | `src/lib/assignment.ts:63–69` |
| 2 | An ignored offer lapses (`expireStaleOffers`, cron) | the lapsed technician | `offer_expired` | `src/lib/assignment.ts:263–269` |
| 3 | Technician accepts an offer | the customer | `technician_assigned` | `src/app/api/service-requests/[id]/offer-response/route.ts:81–87` |
| 4 | Technician submits an estimate (version 1) | the customer | `estimate_received` | `src/app/api/estimates/route.ts:110–118` |
| 5 | Technician submits a revised estimate | the customer | `estimate_revised` | `src/app/api/estimates/route.ts:110–118` |
| 6 | Customer approves an estimate | the technician | `estimate_approved` | `src/app/api/estimates/[id]/decision/route.ts:100–126` |
| 7 | Customer declines an estimate | the technician | `estimate_declined` | same file |
| 8 | Customer asks for a revision | the technician | `estimate_revision_requested` | same file |
| 9 | A booking is committed (`outcome === "booked"`) | **both** customer and technician | `booking_confirmed` | `src/app/api/bookings/route.ts:168–171` |
| 10 | Booking status changes (technician starts / inspection needed / customer sign-off / cancel) | the party who did NOT act | `booking_<status>` → `booking_in_progress`, `booking_awaiting_inspection`, `booking_awaiting_payment`, `booking_cancelled` | `src/app/api/bookings/[id]/route.ts:237–245` |
| 11 | A booking message is posted | the other participant | `new_message` | `src/app/api/messages/route.ts:61–71` |
| 12 | Admin verifies a payment (`confirm_payment`) | the customer | `payment_confirmed` | `src/app/api/payments/[id]/route.ts:140–148` |
| 13 | Admin rejects a payment (`reject_payment`) | the customer | `payment_rejected` | `src/app/api/payments/[id]/route.ts:225–233` |
| 14 | Customer rates the technician (after `completed`) | the technician | `rating_received` | `src/app/api/bookings/[id]/rating/route.ts:120–128` |
| 15 | Technician rates the customer, score ≤ 2 | every admin + super_admin | `customer_rating_low` | `src/app/api/bookings/[id]/customer-rating/route.ts:143–152` |
| 16 | Admin approves a technician | the technician | `technician_approved` | `src/app/api/technicians/[id]/approve/route.ts:46–54` |
| 17 | Admin declines a technician | the technician | `technician_not_approved` | same file |

Rules pinned by `scripts/tests/notifications-coverage.test.mjs`: every event imports+calls `notify()`;
the notification is sent **after** the write commits; a failed notification is swallowed
(`catch (notifyError)`); it is sent with a service-role client; the recipient is the party who did
**not** act; only a committed booking is announced; the cancellation copy states the queue turn was
not consumed.

---

## 5. ROUTES AND ROLES

### 5.1 Middleware role mapping (`src/middleware.ts`)

```ts
const ROLE_PREFIXES = {
  "/customer":   ["customer", "admin", "super_admin"],
  "/technician": ["technician", "admin", "super_admin"],
  "/admin":      ["admin", "super_admin"],
  "/superadmin": ["super_admin"],
};
```

`matcher` = `/customer/:path*`, `/technician/:path*`, `/admin/:path*`, `/superadmin/:path*`
(`src/middleware.ts:71–77`). Behaviour: not logged in → redirect `/login` (or `/choose` for
`/customer/request-repair`); wrong role → `/unauthorized`; `is_active = false` → `/unauthorized?reason=inactive`
(`:51–53`); maintenance mode on → customer/technician redirected to `/maintenance` (`:56–66`).

### 5.2 Page routes by role (from `src/app/**/page.tsx`)

**Public / auth** (no role): `/` (`page.tsx`), `(auth)/choose`, `(auth)/login`, `(auth)/register`,
`(auth)/forgot-password`, `(auth)/update-password`, `/about`, `/contact`, `/how-it-works`,
`/maintenance`, `/offline`, `/policies/customer`, `/policies/privacy`, `/policies/technician`,
`/policies/terms`, `/services`, `/services/[slug]`, `/unauthorized`.

**Customer** (`/customer/*`): `dashboard`, `account`, `account/notifications`, `appliances`,
`bookings`, `bookings/[id]`, `bookings/[id]/receipt`, `estimates`, `messages`, `messages/[bookingId]`,
`payments`, `profile`, `progress-tracking`, `repair-history`, `repairs`, `repairs/requests`,
`request-repair`, `service-request`, `service-request/[id]`, `support`.

**Technician** (`/technician/*`): `dashboard`, `estimate-requests`, `jobs`, `past-jobs`, `queue`,
`messages`, `messages/[bookingId]`, `profile`, `bookings/[id]`.

**Admin** (`/admin/*`): `dashboard`, `bookings`, `job-monitoring`, `payments`, `progress`,
`service-concerns`, `support-tickets`, `technician-queue`, `technicians`, `users`.

**Super admin** (`/superadmin/*`): `dashboard`, `activity`, `admins`, `settings`.

Sidebar nav is defined in `src/lib/navConfig.ts` (`navForRole()`); note super-admin nav links
"All Users" and "Technicians" into `/admin/*` pages.

### 5.3 API routes by role — 18 route groups, **35** `route.ts` files

(Grouped as the code guards them; the guard is `getCurrentUser()`/`requireRole(...)` in the route +
RLS. `SYSTEM-ARCHITECTURE.md` §1 and this heading now agree: 35.)

**Customer-oriented:**
- `POST/GET /api/service-requests` — customer creates/lists own
- `POST /api/service-requests/photos`, `PATCH /api/service-requests/[id]` — owner
- `POST/GET/DELETE /api/appliances`, `DELETE /api/appliances/[id]` — customer owns (`appliances/route.ts:45` "Only customers can manage appliances")
- `POST/GET /api/bookings` — POST customer-only (`bookings/route.ts:57`); GET role-scoped (customer/tech/admin see their own)
- `POST /api/bookings/[id]/rating` — customer only (`rating/route.ts:34`)
- `POST/GET /api/payments` — POST customer-only (`payments/route.ts:12`)
- `POST/GET /api/support-tickets` — any authenticated (own) / admins see all
- `GET/PATCH /api/notifications`, `POST /api/push-subscriptions`, `GET/PATCH /api/profile`, `POST /api/profile/avatar` — any authenticated (own)

**Technician-oriented:**
- `POST /api/estimates` — technician only (`estimates/route.ts:24`); `GET /api/estimates`
- `PATCH /api/service-requests/[id]/offer-response` — technician (`offer-response/route.ts:29`)
- `POST /api/bookings/[id]/customer-rating` — technician only (`customer-rating/route.ts:47`)
- `POST/GET /api/technician-availability` — technician only (`technician-availability/route.ts:23,68`)
- `POST/GET /api/visits`, `PATCH /api/visits/[id]` — technician/admin (customer may only `signed_by`, `visits/[id]/route.ts:39–47`)
- `POST /api/bookings/[id]` (`PATCH`) — technician/customer/staff (transition matrix `bookings/[id]/route.ts:59–90`)

**Admin / super-admin:**
- `PATCH /api/payments/[id]` — admin/super_admin (`payments/[id]/route.ts:48`)
- `PATCH /api/technicians/[id]/approve` — admin/super_admin (`approve/route.ts:13`)
- `PATCH /api/support-tickets/[id]` — admin/super_admin (`support-tickets/[id]/route.ts:15`)
- `PATCH /api/users/[id]/status` — admin/super_admin (`users/[id]/status/route.ts:11`)
- `PATCH /api/settings` — admin/super_admin (`settings/route.ts:24`); `GET /api/settings` any authenticated
- `POST /api/admin/queue-override` — admin/super_admin (`admin/queue-override/route.ts:23`)
- `POST /api/admin/sms-test` — admin/super_admin (`admin/sms-test/route.ts:25`)
- `POST /api/admin/technicians/repair` — admin/super_admin (`admin/technicians/repair/route.ts:42`). The
  explicit replacement for what `/admin/technicians` used to do while rendering. It creates **only
  missing** rows — a `public.users` profile for an account that signed up as a technician before the
  `on_auth_user_created` trigger existed, and the `technicians` row for an account whose persisted role
  is already `technician` — so it can never promote an existing customer. It never updates a role, and
  it skips deactivated accounts. Approval stays a separate step (`PATCH /api/technicians/[id]/approve`).

**Super-admin only:**
- `PATCH /api/users/[id]/role` — `requireRole(["super_admin"])` (`users/[id]/role/route.ts:33`). The write
  is `set_user_role()`, so the profile and the `technicians` row move together instead of drifting. The
  function also refuses the two ways a project loses its last administrator: a super administrator
  changing their **own** role away from `super_admin`, and the removal of the last **active** super
  administrator. Until `supabase/migration_set_user_role.sql` is applied the route answers
  `503 SERVICE_SETUP_REQUIRED` naming that file.

**Any authenticated / mixed:**
- `POST /api/estimates/[id]/decision` — owning customer or staff (`decision/route.ts:63–68`)
- `POST/GET /api/messages` — must be a booking participant (`messages/route.ts:28–34`)
- `GET/PATCH /api/profile`, `POST /api/profile/avatar`

**System / unauthenticated:**
- `GET /api/cron/assignment-tick` — gated by `CRON_SECRET` (`cron/assignment-tick/route.ts:22–37`)
- `DELETE /api/auth/recovery` — clears the recovery marker (`auth/recovery/route.ts:23`). It takes no
  parameters and grants nothing: deleting an authorization cannot authorize.

**Authenticated, but role-less (any signed-in account):**
- `POST /api/auth/ensure-profile` — the fallback that heals a missing `public.users` row on a database
  without the `on_auth_user_created` trigger. **It requires a session**: the caller is resolved with
  `auth.getUser()` and anything else answers `401 {"error":"Unauthorized"}`
  (`auth/ensure-profile/route.ts:9–13`). It takes **no** user id from the request, so the only row it
  can write is the caller's own — the body is not read at all. Signup metadata is consulted **only**
  when no profile exists (`:27–36`), and only `technician` is honoured there; every other value,
  `admin` included, becomes `customer`. An existing profile's role is never written, and the
  `technicians` row it may add follows the role **re-read from the database** (`:39–51`).

`/api/estimates/[id]` and `/api/support-tickets/[id]` GET/PATCH handlers exist as listed above.

---

## 6. QUEUE LOGIC

### 6.1 SQL functions (assignment / response / expiry / override) and the tables they touch

Functions live in `supabase/migration_queue_redesign.sql`, `supabase/migration_offer_lifecycle.sql`,
`supabase/migration_queue_offer_guards.sql`, and (for booking) `supabase/schema.sql` +
`migration_atomic_booking.sql` + `migration_booking_eligibility.sql`.

**Assignment**
- `assign_technician_to_request(p_request_id uuid)` — the queue walk
  (`migration_queue_redesign.sql`; re-declared `migration_offer_lifecycle.sql`, `migration_queue_offer_guards.sql`).
  **Reads** `service_requests` (row lock), `users`, `technicians`, `technician_queue_state`,
  `technician_service_areas`, `technician_availability`, `bookings`, `system_settings` (via helpers);
  **Writes** `service_requests` (`assigned_technician_id`, `assignment_status`, `offers_expires_at`),
  `technician_offer_history` (offer row), `technician_queue_events` (via `log_queue_event`).
- Helpers it calls: `technician_eligibility_failure()` (reads `users`,`technicians`,`technician_queue_state`,
  `service_requests`,`technician_service_areas`,`bookings`,`system_settings`),
  `technician_within_availability()` (reads `technician_availability`),
  `technician_schedule_conflict()` (reads `bookings`,`technician_time_off`),
  `technician_capacity_failure()` (reads `technicians`,`bookings`),
  `technician_covers_area()` (reads `technician_service_areas`),
  `queue_event_action_for_reason()`, `queue_reason_message()`, `log_queue_event()`,
  `refresh_technician_operational_status()`.
- `technician_qualification_failure(p_technician_id, p_appliance_type)` (`schema.sql:1618+`) —
  reads `users`,`technicians`,`technician_queue_state`.
- `appliance_has_qualified_technician(p_appliance_type)` (read-only, `migration_booking_eligibility.sql`).
- `technician_pending_offers()` (`migration_service_location.sql`) — reads `service_requests`.

**Response (accept / decline)**
- `respond_to_offer(p_request_id, p_technician_id, p_action, p_reason)` — one transaction
  (`migration_queue_redesign.sql:1451`; re-declared `migration_offer_lifecycle.sql`).
  **Reads** `service_requests` (FOR UPDATE); **Writes** `service_requests`
  (`assignment_status`, `status` open→quoted), `technician_offer_history` (`accepted`/`rejected`),
  `technician_queue_state` (via `consume_queue_turn` on accept — only if `queue_decline_consumes_turn`
  on decline), `technician_queue_events`.
- `consume_queue_turn(p_technician_id, p_appliance_type, p_request_id, p_reason)` — **Writes**
  `technician_queue_state` (`queue_position`→end, `turn_count`, `last_assigned_at`),
  `technician_queue_events`; uses a per-appliance-type advisory lock.

**Expiry**
- `expire_stale_offers()` — the scheduled sweep. **Reads** `service_requests`
  (`offers_expires_at <= now()` and `offered`), `technician_queue_state`; **Writes**
  `technician_offer_history` (`rejected`), `technician_queue_events` (`EXPIRED`), `service_requests`
  (re-offers via `assign_technician_to_request`).
- `lapse_offer(p_request_id, p_reason, p_new_status)` + trigger `lapse_offer_on_cancel()`
  (`migration_offer_lifecycle.sql`) — release a live offer. **Writes** `technician_offer_history`,
  `service_requests`, `technician_queue_events`. `assign_technician_to_request()` also calls the
  pre-walk release so a dead offer cannot freeze the rotation.

**Override**
- `admin_queue_override(p_appliance_type, p_technician_id, p_action, p_reason)`
  (`migration_queue_redesign.sql`) — reason mandatory, `is_admin()` re-checked. **Reads**
  `technicians`,`technician_queue_state`; **Writes** `technician_queue_state` (move/remove/reactivate)
  and `technician_queue_events` (`ADMIN_OVERRIDE`, with `actor_id`). Reached via `POST /api/admin/queue-override`.

**Membership / status / audit helpers**
- `sync_queue_membership(uuid)` & `sync_appliance_queue_memberships(text)` — **Writes**
  `technician_queue_state` (+`technician_queue_events` `JOINED_QUEUE`/`REMOVED`/`REACTIVATED`);
  `compact_queue_positions(text)` renumbers active members 1..N;
  `refresh_technician_operational_status(uuid)` / `compute_technician_status(uuid)` — **Reads**
  `bookings`,`technician_time_off`,`users`,`technicians`; **Writes** `technicians.operational_status`
  (+`technician_queue_events` `STATUS_CHANGED` on a flip);
  `log_queue_event(...)` — the single writer of `technician_queue_events`;
  `technician_queue_snapshot(text)` — read-only view model over `technician_queue_state`, `users`,
  `technicians` (+ next bookings).

Mutating queue functions are `REVOKE ALL ... FROM public, anon, authenticated` then
`GRANT EXECUTE ... TO service_role`; `admin_queue_override` is the one granted to `authenticated`
(re-checks admin inside). See `migration_queue_redesign.sql:1892–1918`.

### 6.2 Default values

| Setting | Default | Source |
| --- | --- | --- |
| Offer lifetime | **15 minutes** (`queue_offer_ttl_minutes`) | `migration_queue_redesign.sql:103`; fallback const `OFFER_TTL_MINUTES = 15`, `src/lib/assignment.ts:19` |
| Decline policy | **`queue_decline_consumes_turn = false`** | `migration_queue_redesign.sql:104`; applied `:1569` |
| Warranty days | **30** (`service_warranty_days`); `service_history.warranty_days` default 30 (CHECK 0..3650) | `migration_service_warranty.sql:35,55`; `WARRANTY_DAYS = 30`, `src/lib/warranty.ts:36` |
| Capacity — daily hours | **`max_daily_hours = 8`** | `migration_queue_redesign.sql:165` |
| Capacity — concurrent jobs | **`max_concurrent_jobs = 2`** | `migration_queue_redesign.sql:166` |
| Capacity — jobs per day | **`max_jobs_per_day = 4`** | `migration_queue_redesign.sql:167` |
| Default job duration | **`default_job_minutes = 120`** | `migration_queue_redesign.sql:169` |
| Service timezone | **`Asia/Manila`** (`queue_service_timezone`) | `migration_queue_redesign.sql:105` |
| Queue model version | **`2.0`** (`queue_model_version`) | `migration_queue_redesign.sql:106` |

All are rows in `system_settings` (operator-tunable without a deploy; read via `queue_setting*`).

---

## 7. CONFIG AND COUNTS

### 7.1 The 15 appliance types

Source: `src/lib/appliances.ts` (`APPLIANCES[]`, 15 real types + a 16th `other`) and
`src/lib/appliance-brands.ts` (`APPLIANCE_TYPES = Object.keys(APPLIANCE_ISSUES)`, which is the
15-entry canonical list used everywhere, per `scripts/tests/appliance-brands.test.mjs:60`).

| # | slug (`appliance_type`) | label |
| --- | --- | --- |
| 1 | `refrigerator` | Refrigerator |
| 2 | `aircon` | Air Conditioner |
| 3 | `washing_machine` | Washing Machine |
| 4 | `tv` | Television |
| 5 | `electric_fan` | Electric Fan |
| 6 | `microwave` | Microwave Oven |
| 7 | `rice_cooker` | Rice Cooker |
| 8 | `electric_stove` | Electric Stove |
| 9 | `induction_cooker` | Induction Cooker |
| 10 | `water_dispenser` | Water Dispenser |
| 11 | `electric_kettle` | Electric Kettle |
| 12 | `vacuum_cleaner` | Vacuum Cleaner |
| 13 | `clothes_dryer` | Clothes Dryer |
| 14 | `freezer` | Freezer |
| 15 | `water_heater` | Water Heater |

(`other` = "Other" is a 16th selectable option in `APPLIANCES`, but it is **not** in
`APPLIANCE_TYPES`/the issue catalogue.) `normalize_appliance_type()` in
`migration_queue_redesign.sql:80–98` maps human labels/synonyms to these 15 slugs.

### 7.2 Test files and test commands (`package.json`)

* **26 test files** (`scripts/tests/*.test.mjs`, counted on disk) — admin-filter-options,
  admin-list-guards, admin-payments-queue, appliance-brands, appliance-fields,
  booking-outcome-contract, customer-rating, customer-tracking, dependency-types, design-tokens,
  estimate-costs, inquiry-flow, issue-matching, job-order, messages-routing, notifications-coverage,
  password-recovery, pwa, queue-copy, request-removal, supabase-cache, technician-assignments,
  technician-profile, troubleshooting-guides, user-guard, warranty.
* **Test commands** in `package.json` `"scripts"`: `test` = `node --test "scripts/tests/*.test.mjs"`
  (runs all 26), plus per-suite: `test:queue-sql` (`node scripts/test-queue-sql.mjs` — the in-process
  PGlite SQL suite), `test:issues`, `test:estimates`, `test:auth`, `test:booking-api`, `test:admin-payments`,
  `test:cache`, `test:messages`, `test:queue-copy`, `test:admin-lists`, `test:admin-filters`, `test:warranty`,
  `test:user-guard`, `test:customer-rating`, `test:tracking`, `test:removal`, `test:inquiry-flow`,
  `test:appliance-fields`, `test:appliance-brands`, `test:job-order`, `test:technician-profile`,
  `test:notifications`, `test:pwa`, `test:design`, `test:dependency-types`, `test:technician-assignments`.
  Supporting: `verify:queue` (`scripts/verify-queue-fairness.mjs`), `db:check`
  (`scripts/check-migration-state.mjs`), `manuscript:check`, `audit:bookings`, `audit:queue-turns`,
  and `cron:tick` (`scripts/run-assignment-tick.mjs`).

### 7.3 Cron / scheduled job interval and route

* **Route:** `GET /api/cron/assignment-tick` (`src/app/api/cron/assignment-tick/route.ts`). It runs
  `expireStaleOffers()` then `rematchWaitingRequests()`, gated by `CRON_SECRET`
  (`Authorization: Bearer <secret>` or `?secret=`).
* **Interval:** the code and docs describe **every 5 minutes** (`*/5 * * * *`); `SYSTEM-ARCHITECTURE.md`
  §1/§9, `TESTING.md:920`, `USER-FLOWS.md:410`, `QUEUE-SYSTEM.md:224` all say so.
* **BUT the schedule is NOT in the repository:** `vercel.json` is `{}` (verified), the nested copy's
  `vercel.json` is empty too, and there is no `.github/workflows`. So the endpoint exists, but **no
  scheduled trigger config is present in code** — state this carefully (see §0).
* Local equivalent: `npm run cron:tick` (`scripts/run-assignment-tick.mjs`).

### 7.4 Framework / library versions (`package.json`)

| Package | Version |
| --- | --- |
| `next` | **14.2.35** |
| `react` | **^18.3.1** · `react-dom` **^18.3.1** |
| `@supabase/supabase-js` | **2.45.4** · `@supabase/ssr` **0.5.2** |
| `tailwindcss` (dev) | **^3.4.4** |
| `typescript` (dev) | **^5.5.3** |
| (others) | `leaflet` ^1.9.4, `react-leaflet` ^4.2.1, `web-push` ^3.6.7, `gsap` ^3.15.1, `motion` ^13.2.0, `lucide-react` ^0.383.0 |

---

## 8. DATA FLOW CHECK (tables read vs written, per process)

| Process | Writer (route / function) | Reads | Writes |
| --- | --- | --- | --- |
| **Repair request intake** | `POST /api/service-requests` (`src/app/api/service-requests/route.ts`); the wizard also inserts an `appliances` row (`RequestRepairWizard.tsx:622–636`) | `appliances`, `users`, `system_settings` (settings) | `service_requests` (insert, `status='open'`), `appliances` (insert when new), (photo bucket `service-request-photos`) — **then** calls `assignTechnician` |
| **Technician assignment** | `assign_technician_to_request()` (RPC; called from request intake & cron); `respond_to_offer()` on accept/decline; `expire_stale_offers()` | `service_requests`, `users`, `technicians`, `technician_queue_state`, `technician_service_areas`, `technician_availability`, `technician_time_off`, `bookings`, `technician_offer_history`, `system_settings` | `service_requests` (`assigned_technician_id`, `assignment_status`, `offers_expires_at`, `status` open→quoted), `technician_offer_history`, `technician_queue_state` (`consume_queue_turn`), `technician_queue_events` |
| **Estimate submission & approval** | `POST /api/estimates` → `submit_estimate()`; `POST /api/estimates/[id]/decision` → `decide_estimate()` | `service_requests`, `estimates` (versions), `users`/`technicians` | `estimates` (insert/version, `status` draft→pending→accepted/rejected/revision_requested/superseded, `supersedes_id`/`superseded_by`, `approved_at`, `decided_by`) |
| **Booking** | `POST /api/bookings` → `create_booking_atomic()` | `service_requests` (lock), `estimates`, `technicians`, `technician_queue_state`, `users`, `bookings`, `system_settings` | `bookings` (insert), `service_requests` (`status='booked'`), `technicians` (`active_job_load`) |
| **Repair progress** | `PATCH /api/bookings/[id]` (technician); `POST/PATCH /api/visits*` | `bookings`, `visits`, `service_requests`, `users` | `bookings` (`status` pending→in_progress→awaiting_inspection), `visits` (insert/update), `service_requests.updated_at` |
| **Inspection sign-off** | `PATCH /api/bookings/[id]` by the **customer**; `PATCH /api/visits/[id]` (`signed_by`) | `bookings`, `visits` | `bookings` (`status='awaiting_payment'`, `inspection_confirmed_at`, `inspection_note`), `visits.signed_by` |
| **Payment verification & completion** | `PATCH /api/payments/[id]` → `confirm_payment()` / `reject_payment()` (admin) | `payments`, `bookings`, `service_requests`, `technicians`, `system_settings` | confirm: `payments(status='confirmed', confirmed_by/at)`, `bookings('completed')`, `service_history` (archive + warranty stamp), `service_requests('completed')`, `technicians(active_job_load--, jobs_completed++, is_new, operational_status)`. reject: `payments(rejected_by/at, rejection_reason)` only |
| **Notifications** | `notify()` (`src/lib/notifications.ts`) called by 11 files (see §4) | — (builds content in the caller) | `notifications` (insert); `push_subscriptions` read by `sendPushToUser` (`src/lib/push.ts`); nothing else |
| **Ratings** | `POST /api/bookings/[id]/rating` (customer) and `.../customer-rating` (technician) | `bookings`, `ratings`/`customer_ratings` (dup check), `users` (admins for the low alert) | customer→tech: `ratings` (insert). tech→customer: `customer_ratings` (insert) |
| **Support tickets** | `POST/GET /api/support-tickets`, `PATCH /api/support-tickets/[id]` | `support_tickets`, `users` | `support_tickets` (insert `status='open'`; admin `PATCH` changes `status`, `updated_at`, and on a resolve **requires** `resolution_note` and stamps `resolved_by`/`resolved_at` from the session) |
| **Admin queue override** | `POST /api/admin/queue-override` → `admin_queue_override()` | `technicians`, `technician_queue_state`, `technician_queue_events` | `technician_queue_state` (position/is_active), `technician_queue_events` (`ADMIN_OVERRIDE`, with `actor_id`); then `refresh_technician_operational_status()` touches `technicians.operational_status` |

### Method notes
* Most facts above were confirmed by reading the source files directly; a handful of exact
  read/write sets inside `SECURITY DEFINER` functions (e.g. the precise lock targets of
  `create_booking_atomic`) are supported by the file headers in `migration_atomic_booking.sql`,
  `migration_booking_eligibility.sql` and `DATABASE.md:494–560` rather than by a line-by-line read
  of every statement.
* Where the code does not support a claim it is marked **"not found"** (e.g. `service_requests.status='in_progress'`
  has no writer; `appliances.warranty_proof_url` is unused by the app; there is no visits transition
  trigger; there is no admin message feature; no cron schedule exists in the repo).

*Generated by inspecting the repository at commit `9f881a6` (branch `main`). No application code was
modified; this file is the only addition.*
