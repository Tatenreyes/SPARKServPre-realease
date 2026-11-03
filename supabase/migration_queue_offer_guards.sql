-- =========================================================
-- SPARKServ — Step 20: a turn is never spent on a request that has an owner
-- =========================================================
--
-- Two changes, both about the same question an administrator asked after a real
-- incident: "AMPOL AMPARATA received two bookings even though he is at number 3
-- in the queue." The audit trail showed the engine was right — he was OFFERED
-- from position 1 both times, and accepting is what moved him to the back
-- (`MOVED_TO_END pos 1 -> 3`), which is the number he then read — but the
-- incident also exposed a real hole next to it: the same technician accepted
-- `7d095e43` (a September request) at 13:40, which consumed his turn and moved
-- him to the back of the rotation, and produced no booking at all. A turn spent
-- on nothing is a fairness bug, not a wording bug.
--
-- 1. technician_queue_snapshot() gains ONE column, `last_assigned_at`, so the
--    screen can say *why* a position reads the way it does ("your last job was
--    accepted on 31 Oct, accepting moves you to the back") instead of printing a
--    bare `#3` that reads like "three people ahead of me, so why did I get the
--    work?". The column already exists on `technician_queue_state`; the snapshot
--    simply never exposed it. The return type changes, so the function is dropped
--    first — Postgres cannot replace a function with a different OUT signature.
--    Ordering, the role guard, the "active offers only for yourself or an admin"
--    rules and the position semantics are untouched.
--
-- 2. assign_technician_to_request() gains ONE guard, marked "ADDED HERE":
--    a request that already has an owner is not looking for one. `quoted` keeps
--    its technician — a declined estimate asks that technician for a revision
--    (`decide_estimate`), and a cancelled booking reopens the request with the
--    same technician (the Batch 1 flow) — so walking it can only spend somebody's
--    turn on a request that cannot become a booking, and it duplicates the offer
--    history. The guard sits next to the existing closed-request guard, before
--    any technician is considered, and answers `unchanged` (never an error),
--    exactly like `request_closed` does.
--
-- Nothing else about the engine changes: the lock order, the skip rules, the
-- claim, the waiting fallback and the audit events are the tested engine
-- (migration_queue_redesign.sql + migration_offer_lifecycle.sql).
--
-- Prerequisites: schema.sql, migration_queue_redesign.sql (step 4) and
-- migration_offer_lifecycle.sql (step 14) — this file replaces functions both of
-- them create.

-- ---------- 1. The queue view says whose turn was last consumed ----------
-- Dropped first: the OUT signature gains a column, and `create or replace` cannot
-- change it. The privileges are re-granted at the end of this file.
drop function if exists public.technician_queue_snapshot(text);

-- p_appliance_type = null returns every queue the caller belongs to
-- ("All my queues"); admins may ask for any queue and see active offers too.
create or replace function public.technician_queue_snapshot(p_appliance_type text default null)
returns table (
  appliance_type text,
  queue_position integer,
  technician_id uuid,
  technician_name text,
  operational_status text,
  is_self boolean,
  is_member_active boolean,
  is_next_in_queue boolean,
  queue_status text,
  next_booking_at timestamptz,
  current_job_until timestamptz,
  active_offer_request_id uuid,
  offers_expires_at timestamptz,
  -- ADDED HERE (step 20): when this technician's turn was last consumed for this
  -- appliance type. It is what makes a position readable: after accepting, a
  -- technician is moved to the end, so the number alone looks like a contradiction.
  last_assigned_at timestamptz
)
language plpgsql
stable
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role public.user_role := public.current_role();
  v_type text := public.normalize_appliance_type(p_appliance_type);
begin
  -- `v_role is null` matters: without it, a caller with no JWT at all (e.g. a
  -- bare service-role/PostgREST call) evaluates `null not in (...)` as NULL and
  -- slips past the guard. Refuse anything that is not an authenticated
  -- technician or administrator.
  if v_role is null or v_role::text not in ('technician', 'admin', 'super_admin') then
    -- Customers never see the technician queue — only their own request status.
    raise exception 'technician_queue_snapshot: only technicians and administrators can view the queue';
  end if;

  return query
  select
    qs.appliance_type,
    qs.queue_position,
    t.id,
    u.name,
    public.compute_technician_status(t.id) as operational_status,
    (t.id = v_uid) as is_self,
    qs.is_active,
    (
      qs.is_active
      and qs.queue_position = (
        select min(x.queue_position)
        from public.technician_queue_state x
        where x.appliance_type = qs.appliance_type and x.is_active
      )
    ) as is_next_in_queue,
    case
      when not qs.is_active then 'TEMPORARILY_REMOVED'
      when qs.queue_position = (
        select min(x.queue_position)
        from public.technician_queue_state x
        where x.appliance_type = qs.appliance_type and x.is_active
      ) then 'NEXT_TURN'
      else 'IN_ROTATION'
    end as queue_status,
    (
      select min(b.scheduled_at)
      from public.bookings b
      where b.technician_id = t.id
        and b.status::text in ('pending', 'in_progress', 'awaiting_inspection')
        and b.scheduled_at >= now()
    ) as next_booking_at,
    (
      select max(
        b.scheduled_at + make_interval(mins => greatest(coalesce(b.duration_minutes, 120), 1))
      )
      from public.bookings b
      where b.technician_id = t.id and b.status::text = 'in_progress'
    ) as current_job_until,
    case
      when t.id = v_uid or public.is_admin() then (
        select r.id from public.service_requests r
        where r.assigned_technician_id = t.id and r.assignment_status = 'offered'
        limit 1
      )
      else null
    end as active_offer_request_id,
    case
      when t.id = v_uid or public.is_admin() then (
        select r.offers_expires_at from public.service_requests r
        where r.assigned_technician_id = t.id and r.assignment_status = 'offered'
        limit 1
      )
      else null
    end as offers_expires_at,
    -- ADDED HERE (step 20).
    qs.last_assigned_at
  from public.technician_queue_state qs
  join public.technicians t on t.id = qs.technician_id
  join public.users u on u.id = t.id
  where (v_type is null or qs.appliance_type = v_type)
    and t.approved
    and u.is_active
    and (
      public.is_admin()
      -- A technician sees the queues they are a member of. Written as an
      -- explicit EXISTS with a NULL guard so a caller without a JWT cannot
      -- match anything (SQL NULL in a boolean predicate is not false).
      or (
        v_uid is not null
        and exists (
          select 1
          from public.technician_queue_state my
          where my.technician_id = v_uid
            and my.appliance_type = qs.appliance_type
        )
      )
    )
  order by qs.appliance_type asc,
           qs.is_active desc,
           coalesce(qs.queue_position, 2147483647) asc,
           qs.last_assigned_at asc nulls first,
           u.name asc;
end;
$$;


-- ---------- 2. The walk: never offer a request that already has an owner ----------
-- Copied from migration_offer_lifecycle.sql with ONE addition, marked "ADDED
-- HERE". Everything else — the lock, the skip rules, the claim, the waiting
-- fallback, the audit events — is the tested engine unchanged.
create or replace function public.assign_technician_to_request(p_request_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $assign$
declare
  r public.service_requests%rowtype;
  v_type text;
  v_start timestamptz;
  v_end timestamptz;
  v_ttl integer;
  v_reason text;
  v_conflict boolean;
  v_claimed public.service_requests%rowtype;
  v_skipped text[] := '{}';
  v_stale record;
  cand record;
begin
  select * into r from public.service_requests where id = p_request_id for update;

  if r.id is null then
    raise exception 'assign_technician_to_request: request % not found', p_request_id;
  end if;

  -- Someone already offered/accepted it (concurrent call) — do not interfere.
  if r.assignment_status not in ('matching', 'waiting') then
    return jsonb_build_object(
      'outcome', 'unchanged',
      'request_id', r.id,
      'assignment_status', r.assignment_status,
      'assigned_technician_id', r.assigned_technician_id,
      'offers_expires_at', r.offers_expires_at
    );
  end if;

  -- ADDED HERE (1/3): a withdrawn or finished request must never be offered
  -- again. Without this, a cancelled request whose offer had been released went
  -- back into the rotation and a technician could take a job that can never be
  -- estimated, booked or repaired.
  if r.status in ('cancelled', 'completed') then
    return jsonb_build_object(
      'outcome', 'unchanged',
      'request_id', r.id,
      'assignment_status', r.assignment_status,
      'assigned_technician_id', r.assigned_technician_id,
      'reason', 'request_closed'
    );
  end if;

  -- ADDED HERE (2/3, step 20): a request that already has an owner is not looking
  -- for one. `quoted` keeps its technician — a declined estimate asks THAT
  -- technician for a revision, and a cancelled booking reopens the request with
  -- the same technician — so a walk here cannot lead to a booking. It can only
  -- consume a turn (the technician who accepts is moved to the end of the
  -- rotation by `consume_queue_turn`), duplicate the offer history, and notify
  -- somebody about a job that is not available. Observed on the live project:
  -- `7d095e43` (created 12 Sep) was walked and accepted on 3 Nov, spending a turn
  -- and producing nothing.
  --
  -- This is a refusal, not an error: it answers `unchanged` exactly like the
  -- closed-request guard above, so the scheduled sweep and the create-request
  -- path both treat it as "nothing to do here".
  if r.status = 'quoted' and r.assigned_technician_id is not null then
    return jsonb_build_object(
      'outcome', 'unchanged',
      'request_id', r.id,
      'assignment_status', r.assignment_status,
      'assigned_technician_id', r.assigned_technician_id,
      'reason', 'already_assigned'
    );
  end if;

  -- ADDED HERE (3/3): release offers whose TTL has already passed, so a technician
  -- who ignored an offer cannot freeze the rotation when the scheduled sweep has
  -- not run. Their requests become 'waiting' — the state the sweep re-matches —
  -- and nothing is re-offered from inside this walk, which is what keeps this
  -- from recursing into itself. The current request is excluded: a caller may be
  -- re-walking it right after its own offer lapsed.
  for v_stale in
    select s.id
    from public.service_requests s
    where s.assignment_status = 'offered'
      and s.offers_expires_at is not null
      and s.offers_expires_at <= now()
      and s.id <> r.id
    order by s.created_at
  loop
    perform public.lapse_offer(v_stale.id, 'Offer expired without a response', 'waiting');
  end loop;

  v_type := public.normalize_appliance_type(r.appliance_type);


  v_start := r.requested_window_start;
  v_end := coalesce(
    r.requested_window_end,
    case when r.requested_window_start is not null
         then r.requested_window_start + make_interval(mins => coalesce(r.requested_duration_minutes, 120))
    end
  );
  v_ttl := greatest(1, public.queue_setting_int('queue_offer_ttl_minutes', 15));

  perform public.sync_appliance_queue_memberships(v_type);

  for cand in
    select qs.technician_id, qs.queue_position
    from public.technician_queue_state qs
    join public.technicians t on t.id = qs.technician_id
    join public.users u on u.id = t.id
    where qs.appliance_type = v_type
      and qs.is_active
      and t.approved
      and u.is_active
      and not exists (
        select 1 from public.technician_offer_history h
        where h.service_request_id = r.id and h.technician_id = qs.technician_id
      )
    order by coalesce(qs.queue_position, 2147483647) asc,
             qs.last_assigned_at asc nulls first,
             u.name asc
  loop
    v_reason := public.technician_eligibility_failure(
      cand.technician_id, v_type, r.location, v_start, v_end, r.id
    );

    if v_reason is not null then
      v_skipped := v_skipped || (cand.technician_id::text || '=' || v_reason);

      perform public.log_queue_event(
        cand.technician_id, v_type, r.id,
        public.queue_event_action_for_reason(v_reason),
        cand.queue_position, cand.queue_position,
        public.queue_reason_message(v_reason), null
      );

      continue; -- position untouched: a skip is not an exit
    end if;

    -- Claim the request for this technician. The partial unique index
    -- uniq_active_offer_per_technician raises unique_violation when they are
    -- already holding a live offer for a different request; the flag keeps that
    -- decision outside the exception handler.
    v_conflict := false;
    v_claimed := null;

    begin
      update public.service_requests
         set assigned_technician_id = cand.technician_id,
             assignment_status = 'offered',
             offers_expires_at = now() + make_interval(mins => v_ttl),
             updated_at = now()
       where id = r.id
         and assignment_status in ('matching', 'waiting')
      returning * into v_claimed;
    exception when unique_violation then
      v_conflict := true;
    end;

    if v_conflict then
      v_skipped := v_skipped || (cand.technician_id::text || '=holding_offer');

      perform public.log_queue_event(
        cand.technician_id, v_type, r.id, 'SKIPPED_DUE_TO_ACTIVE_OFFER',
        cand.queue_position, cand.queue_position,
        public.queue_reason_message('holding_offer'), null
      );

      continue;
    end if;

    if v_claimed.id is null then
      -- Lost the race: another caller moved this request on.
      return jsonb_build_object(
        'outcome', 'unchanged',
        'request_id', r.id,
        'assignment_status', r.assignment_status
      );
    end if;

    insert into public.technician_offer_history (service_request_id, technician_id, status)
    values (r.id, cand.technician_id, 'offered');

    perform public.log_queue_event(
      cand.technician_id, v_type, r.id, 'OFFERED',
      cand.queue_position, cand.queue_position,
      'Offer sent; expires at ' || to_char(v_claimed.offers_expires_at, 'YYYY-MM-DD HH24:MI'),
      null
    );

    perform public.refresh_technician_operational_status(cand.technician_id);

    return jsonb_build_object(
      'outcome', 'offered',
      'request_id', r.id,
      'assigned_technician_id', cand.technician_id,
      'assignment_status', 'offered',
      'offers_expires_at', v_claimed.offers_expires_at,
      'queue_position', cand.queue_position,
      'skipped', to_jsonb(v_skipped)
    );
  end loop;

  -- Nobody in the queue could take it right now. The request WAITS; it is not
  -- rejected, and nobody lost their place.
  update public.service_requests
     set assigned_technician_id = null,
         assignment_status = 'waiting',
         offers_expires_at = null,
         updated_at = now()
   where id = r.id
     and assignment_status in ('matching', 'waiting');

  perform public.log_queue_event(
    null, v_type, r.id, 'WAITING_FOR_TECHNICIAN', null, null,
    case when array_length(v_skipped, 1) is null
         then 'No eligible technician in this queue'
         else 'Every eligible technician was skipped: ' || array_to_string(v_skipped, ', ')
    end,
    null
  );

  return jsonb_build_object(
    'outcome', 'waiting',
    'request_id', r.id,
    'assignment_status', 'waiting',
    'assigned_technician_id', null,
    'skipped', to_jsonb(v_skipped)
  );

end;
$assign$;


-- ---------- 3. Privileges ----------
-- The snapshot IS meant to be called by a signed-in technician (its internal role
-- guard rejects customers) and by the service role for the admin screens; the walk
-- is server-only. Re-granted here because `drop function` removed them with the
-- old signature.
revoke all on function public.technician_queue_snapshot(text) from public, anon;
grant execute on function public.technician_queue_snapshot(text) to authenticated, service_role;

revoke all on function public.assign_technician_to_request(uuid) from public, anon, authenticated;
grant execute on function public.assign_technician_to_request(uuid) to service_role;

-- ---------- 4. A probeable marker ----------
-- `npm run db:check` probes objects that exist ONLY because of this file. Both
-- functions above exist since step 4 / step 14, so their presence cannot prove
-- this file ran; a settings row can, and step 4 already uses this pattern
-- (`queue_model_version`). Until it is present, db:check reports this step as
-- pending — which is the honest answer for a project that has not applied it.
insert into public.system_settings (key, value) values ('queue_offer_guards_version', '20')
on conflict (key) do update set value = excluded.value, updated_at = now();



