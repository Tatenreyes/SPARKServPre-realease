-- =========================================================
-- SPARKServ — Step 21: the other direction of a rating
-- =========================================================
--
-- WHY THIS EXISTS. A rating travels one way only today: the customer scores the
-- technician after a completed repair (`ratings`), and the technician has no way
-- to say how the visit went for them. That is half of what every two-way
-- marketplace does — Uber and Grab both prompt BOTH sides after the trip
-- ("riders and drivers can rate each other from 1 to 5 stars", Uber Help) — and
-- the missing half is the one that protects the person standing at the door: no
-- access to the appliance, an unsafe situation, a complaint that did not match
-- what was actually wrong.
--
-- WHY A NEW TABLE RATHER THAN A DIRECTION COLUMN ON `ratings`.
-- `ratings.booking_id` is UNIQUE and its insert policy pins
-- `customer_id = auth.uid()`, so a technician cannot write there at all. The
-- obvious repair — add `rater_role` and relax the unique key to
-- `(booking_id, rater_role)` — would silently change the meaning of every
-- existing read. The technician's PUBLIC average (`buildTechnicianProfile()` in
-- src/lib/technician-profile.ts, the assignment card, the job order) would start
-- averaging in the technician's own opinion of their customers, and the number
-- would drift upward with nobody able to see why. Direction-by-table makes that
-- impossible rather than unlikely: `ratings` is what CUSTOMERS said,
-- `customer_ratings` is what TECHNICIANS said, and no query can mix them.
--
-- WHAT IS ANONYMOUS. Following Uber's own rule for its ratings — "Displayed as an
-- average… Anonymous. Neither riders nor drivers see individual ratings tied to a
-- particular trip or person" — a `customer_ratings` row is readable by the
-- technician who wrote it and by an administrator, and by NOBODY else, in
-- particular not by the customer it describes. A customer sees an aggregate
-- (`src/lib/rating-summary.ts`), never a sentence about a particular visit.
--
-- `ratings` gains `tags`: the REASON a score was given, as catalogue keys
-- (`src/lib/rating-tags.ts`). Additive with a default, so the unique key, the
-- existing insert policy and every existing read are untouched, and a rating
-- written before this file simply carries no tags.
--
-- WHAT THIS FILE DOES NOT DO. It creates no consequence: no queue function reads
-- either table (the queue is a strict rotation, and `scripts/tests/` asserts the
-- ranking model stayed deleted), nothing is suspended automatically, and a low
-- score becomes a flag a human reads. Uber's "1 star and you are never matched
-- again" rule is deliberately NOT here — it belongs in the assignment engine as
-- its own step, with its own audit sweep.
--
-- Idempotent: the column is `if not exists`, the table is `if not exists`, every
-- policy is dropped before it is created, and the marker insert is an upsert.

-- ---------------------------------------------------------
-- 1. The reason behind a score, on the existing table
-- ---------------------------------------------------------

-- A list of catalogue keys ("on_time", "left_a_mess"). Defaulted and additive, so
-- no existing row, constraint or policy changes meaning.
alter table public.ratings add column if not exists tags text[] not null default '{}';

-- ---------------------------------------------------------
-- 2. The technician's rating of the customer
-- ---------------------------------------------------------
-- ONE STATEMENT PER LINE, deliberately: this file gets pasted into the Supabase SQL
-- editor by hand, and a statement broken across lines is a statement that can lose
-- its first line in the paste — which is exactly how `syntax error at or near
-- "public" / LINE 1: public.ratings` happens.
--
-- The columns: `technician_id` is `technicians.id` (which IS the user id, 1:1 with
-- `users`), matching `ratings.technician_id` and `bookings.technician_id`, so
-- `technician_id = auth.uid()` is a correct ownership test in the policy below.
-- `booking_id` is UNIQUE like `ratings`: a second submission is a 23505 and the route
-- answers "you have already rated this visit".
create table if not exists public.customer_ratings (id uuid primary key default uuid_generate_v4(), booking_id uuid not null unique references public.bookings(id) on delete cascade, technician_id uuid not null references public.technicians(id) on delete cascade, customer_id uuid not null references public.users(id) on delete cascade, rating integer not null check (rating between 1 and 5), tags text[] not null default '{}', comment text, created_at timestamptz not null default now());

create index if not exists idx_customer_ratings_technician on public.customer_ratings(technician_id);

create index if not exists idx_customer_ratings_customer on public.customer_ratings(customer_id);

alter table public.customer_ratings enable row level security;

-- ---------------------------------------------------------
-- 3. Who may write one, and who may read it
-- ---------------------------------------------------------
-- The technician writes their own. The route adds the checks RLS cannot express
-- (the booking is theirs, the visit is over, one per booking); this is the row rule
-- that makes the row theirs.
drop policy if exists "technician rates own visit" on public.customer_ratings;

create policy "technician rates own visit" on public.customer_ratings for insert with check (technician_id = auth.uid());

-- Read: the technician who wrote it, and an administrator. NOT the customer — that
-- is the anonymity rule, enforced in the database rather than by a screen that could
-- later forget it. (Contrast `ratings`, whose select policy ends in `or true` because
-- a technician's average is published.)
drop policy if exists "technician and admin read customer ratings" on public.customer_ratings;

create policy "technician and admin read customer ratings" on public.customer_ratings for select using (technician_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------
-- 4. A probeable marker
-- ---------------------------------------------------------
-- `npm run db:check` probes objects that exist ONLY because of this file: the
-- `customer_ratings` table and `ratings.tags` are both real and visible through
-- PostgREST, so the preflight can see them. This row records that the file ran to
-- completion, the same pattern step 4 (`queue_model_version`) and step 20
-- (`queue_offer_guards_version`) use.
insert into public.system_settings (key, value) values ('customer_ratings_version', '21') on conflict (key) do update set value = excluded.value, updated_at = now();


