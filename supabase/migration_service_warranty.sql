-- =========================================================
-- Step 19 — the workmanship warranty a completed repair carries
-- =========================================================
-- WHY THIS EXISTS. The job order (src/components/JobOrderDocument.tsx) is the
-- record a customer keeps, and the one line a repair business is asked about
-- months later is "is this still covered?". Without a stored date the answer is a
-- paper pile, and the document would have to print a promise the system cannot
-- check. This file stores the FACT — a per-repair warranty period — and nothing
-- more: there is no claims workflow, no evidence upload and no refund path, and
-- this file does not invent one.
--
-- WHY A TRIGGER RATHER THAN confirm_payment(). The obvious place to compute the
-- date is inside confirm_payment(), the only writer of a completed repair. A
-- BEFORE INSERT trigger on `service_history` is better: it stamps the row for
-- EVERY writer (confirm_payment today, an administrative backfill or a future
-- completion path tomorrow), it keeps the archive table's own invariant beside the
-- table, and it means this file does not re-declare the most critical function in
-- the system in order to add one column. The project's rule is that the database is
-- the boundary; the boundary here is the row.
--
-- WHAT IS SNAPSHOTTED, AND WHY BOTH COLUMNS. `warranty_days` is stored beside
-- `warranty_until` so a finished job keeps the terms it was sold under even after
-- the platform default changes — the same reasoning as an estimate version. Editing
-- `service_warranty_days` therefore affects FUTURE completions only.
--
-- Idempotent: both columns are `if not exists`, the constraint is dropped before it
-- is added, the setting insert does nothing on a second run (so an operator's chosen
-- value is never clobbered), and the trigger is dropped before it is created.

-- ---------------------------------------------------------
-- 1. The columns
-- ---------------------------------------------------------

alter table public.service_history
  add column if not exists warranty_days integer not null default 30;

-- Nullable on purpose: a repair archived before this file existed has no warranty
-- date, and the job order prints no warranty line rather than claiming one.
alter table public.service_history
  add column if not exists warranty_until date;

-- A negative period is not a warranty, and an absurd one is a data-entry mistake.
alter table public.service_history
  drop constraint if exists service_history_warranty_days_check;
alter table public.service_history
  add constraint service_history_warranty_days_check
  check (warranty_days >= 0 and warranty_days <= 3650);

-- ---------------------------------------------------------
-- 2. The platform default
-- ---------------------------------------------------------

-- 30 days of workmanship cover. `do nothing` on conflict is deliberate: re-running
-- this file must not reset a value the shop has tuned.
insert into public.system_settings (key, value) values ('service_warranty_days', '30')
on conflict (key) do nothing;

-- ---------------------------------------------------------
-- 3. Reading the setting safely
-- ---------------------------------------------------------

create or replace function public.service_warranty_days()
returns integer
language plpgsql
stable
security definer set search_path = public
as $$
declare
  v_raw text;
  v_days integer;
begin
  select s.value into v_raw from public.system_settings s where s.key = 'service_warranty_days';

  -- A missing row, an empty value and a value that is not a number all fall back to
  -- 30: a misconfigured setting must never block a completion.
  begin
    v_days := nullif(btrim(coalesce(v_raw, '')), '')::integer;
  exception when others then
    v_days := null;
  end;

  if v_days is null or v_days < 0 or v_days > 3650 then
    return 30;
  end if;
  return v_days;
end;
$$;

-- ---------------------------------------------------------
-- 4. Stamping the row
-- ---------------------------------------------------------

create or replace function public.stamp_service_warranty()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_days integer;
  v_tz text;
  v_completed_on date;
begin
  -- A writer that set the date itself wins: a backfill or an imported record must
  -- not be overwritten by the platform default.
  if new.warranty_until is not null then
    return new;
  end if;

  v_days := public.service_warranty_days();

  -- Zero days means the shop offers no workmanship warranty: the period is recorded
  -- as 0, the DATE is left null, and the document claims nothing.
  if v_days <= 0 then
    new.warranty_days := 0;
    new.warranty_until := null;
    return new;
  end if;

  -- The warranty is a CALENDAR date, so it is counted in the shop's own timezone —
  -- the same `queue_service_timezone` the queue uses to turn a preferred window into
  -- a UTC instant. Counting in UTC would expire a repair a day early for anything
  -- completed between midnight and 08:00 Manila time. A missing or malformed zone
  -- falls back to Manila rather than failing the insert, because a completion must
  -- never be blocked by a settings typo.
  select nullif(btrim(s.value), '')
    into v_tz
    from public.system_settings s
   where s.key = 'queue_service_timezone';
  v_tz := coalesce(v_tz, 'Asia/Manila');

  begin
    v_completed_on := (new.completed_at at time zone v_tz)::date;
  exception when others then
    v_completed_on := (new.completed_at at time zone 'Asia/Manila')::date;
  end;

  new.warranty_days := v_days;
  new.warranty_until := v_completed_on + v_days;

  return new;
end;
$$;

drop trigger if exists stamp_service_warranty_before_insert on public.service_history;
create trigger stamp_service_warranty_before_insert
  before insert on public.service_history
  for each row execute function public.stamp_service_warranty();

-- ---------------------------------------------------------
-- 5. Permissions
-- ---------------------------------------------------------

-- The reader is a server-side helper like every other predicate in this project:
-- revoked from the client roles and granted to service_role, which is also what
-- makes it visible to the migration-state probe (a `returns trigger` function is
-- not callable as an RPC and never appears in the OpenAPI document, so the reader is
-- the signal that this file ran).
revoke all on function public.service_warranty_days() from public, anon, authenticated;
grant execute on function public.service_warranty_days() to service_role;
