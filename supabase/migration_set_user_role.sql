-- ============================================================================
-- Transactional role change — one authority for "this account is a technician".
--
-- WHY THIS EXISTS. `PATCH /api/users/[id]/role` (super-administrator only) wrote
-- `public.users.role` and nothing else, while the `technicians` row is written by two
-- other paths: `handle_new_user()` at signup, and the administrator's explicit repair
-- (`POST /api/admin/technicians/repair`). Promoting a customer therefore left the pair
-- disagreeing — the account did not appear on `/admin/technicians`, so nobody could
-- approve it, and the only thing that closed the gap was an administrator remembering
-- to press "Repair records". Two rows that must agree, written by unrelated code paths,
-- is exactly how they drift.
--
-- `set_user_role()` writes both in ONE transaction, so they cannot disagree.
--
-- AUTHORIZATION — two locks, in the order the rest of this schema uses:
--   1. the route calls `requireRole(["super_admin"])` first (unchanged); and
--   2. this function re-checks the caller INSIDE — super administrator, or the service
--      role, which is how migration and repair tooling acts. Anything else raises.
-- It is revoked from `anon` and granted to `authenticated` + `service_role`, matching
-- `admin_queue_override` (`migration_queue_redesign.sql:1917`), the one other
-- role-checked RPC a signed-in caller invokes with its own JWT.
--
-- It NEVER reads `user_metadata`: a role is granted by a super-administrator or not at
-- all. And it never deletes a `technicians` row — `technicians.id` is the FK target of
-- `bookings.technician_id`, so the row carries the job history. Demotion revokes the
-- approval instead (the same thing the "Revoke approval" control does), which is what
-- removes the account from eligibility without destroying its record.
--
-- LOCKOUT PROTECTION. A role control is one dropdown wide, so two refusals stand in
-- front of a mistake that could not be undone from inside the application:
--   1. a super administrator cannot change their OWN role away from `super_admin` —
--      another super administrator has to do it, so the decision always leaves the
--      account it affects; and
--   2. the last ACTIVE super administrator cannot be demoted by anyone, the service
--      role included. A deactivated super administrator cannot sign in, so removing
--      the last one is unrecoverable from the UI. Promote a replacement first.
-- Because refusal 2 is a statement about the SET of super administrators rather than one
-- row, every role change is serialized on one shared advisory lock (see the body): the
-- second of two simultaneous demotions waits, counts the first's committed result and is
-- refused, instead of both of them counting the other as a replacement.
-- The escape hatch, if a project is ever locked out anyway, is the project owner in the
-- SQL Editor — but note the trigger refuses a plain update there too (no JWT claims, so
-- `is_admin()` is false). Set the claim the trigger exempts first:
--   select set_config('request.jwt.claims', '{"role":"service_role"}', false);
--   update public.users set role = 'super_admin' where id = '<uuid>';
--
-- EXECUTION AND SEARCH PATH. `security definer` with `search_path = public, pg_temp`:
-- the schema is pinned so a caller cannot shadow anything this function calls, and
-- `pg_temp` is named LAST so a temporary object a caller created can never be resolved
-- before the real one. Every object reference is schema-qualified for the same reason.
-- Execute is revoked from `public` and `anon` and granted to `authenticated` +
-- `service_role`, so an anonymous caller cannot reach it at all.
--
-- Safe to re-run: it replaces one function and re-states its permissions, and writes no
-- data of its own.
-- ============================================================================

create or replace function public.set_user_role(p_user_id uuid, p_role public.user_role)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_is_service_role boolean;
  v_actor uuid;
  v_current public.users;
  v_other_active_super_admins integer;
  v_profile public.users;
begin
  -- The same test `prevent_role_change()` uses: the service role keeps working, and a
  -- signed-in caller is judged by the role stored in the database rather than by
  -- anything the request carried.
  v_is_service_role :=
    coalesce(
      current_setting('request.jwt.claims', true)::jsonb ->> 'role',
      current_setting('request.jwt.claim.role', true),
      ''
    ) = 'service_role';

  v_actor := auth.uid();

  if not v_is_service_role
    and public.current_role() is distinct from 'super_admin'::public.user_role then
    raise exception 'Only a super administrator can change user roles';
  end if;

  if p_user_id is null then
    raise exception 'set_user_role: a user id is required';
  end if;

  -- Serialize EVERY role change for the rest of this transaction.
  --
  -- The guard below is a statement about the SET of super administrators, not about one
  -- row, so the lock is deliberately shared by all role changes: a per-user key
  -- (`'user_role:' || p_user_id`) would NOT serialize two different administrators
  -- demoting each other, which is the race that could leave the project with none. The
  -- second caller now waits here, then counts the FIRST caller's committed result and is
  -- refused by the guard — instead of the two of them deadlocking further down.
  --
  -- `hashtext` of a namespaced key is the same pattern `trg_booking_no_overlap`
  -- (`booking_technician:`) and the queue engine (`sparkserv-queue:`) already use, and
  -- `pg_advisory_xact_lock` is re-entrant within a transaction and released on commit or
  -- rollback, so a caller that goes on to raise holds it for no longer than the call.
  perform pg_advisory_xact_lock(hashtext('sparkserv-user-role'));

  select * into v_current from public.users where id = p_user_id;
  if v_current.id is null then
    raise exception 'set_user_role: no profile for %', p_user_id;
  end if;

  -- LOCKOUT GUARD 1 — nobody demotes themselves out of the driver's seat. The role
  -- control is one dropdown wide, and the account that could undo the mistake would be
  -- the one that had just lost the ability. Another super administrator can still
  -- demote them, which is the point: the decision leaves the account it affects.
  -- (A service-role caller has no `auth.uid()`, so no "self" to guard; guard 2 below
  -- still protects the project.)
  if not v_is_service_role
    and v_actor = p_user_id
    and v_current.role = 'super_admin'::public.user_role
    and p_role <> 'super_admin'::public.user_role then
    raise exception 'A super administrator cannot change their own role away from super_admin; ask another super administrator';
  end if;

  -- LOCKOUT GUARD 2 — the project must never lose its last ACTIVE super administrator,
  -- whoever is calling. A deactivated super administrator cannot sign in, so losing the
  -- last one is unrecoverable from the application; refusing a change is a far smaller
  -- cost than a project nobody can administer. Promote a replacement first.
  if v_current.role = 'super_admin'::public.user_role
    and v_current.is_active
    and p_role <> 'super_admin'::public.user_role then
    -- Lock the peers before counting them. The advisory lock above already serializes
    -- role changes against each other; this one covers the OTHER writers that can change
    -- the answer — an administrator deactivating a super administrator through
    -- `PATCH /api/users/[id]/status` while this call is deciding. (`for update` cannot be
    -- combined with an aggregate, hence the separate lock.)
    perform 1
      from public.users
     where role = 'super_admin'::public.user_role
       and is_active
       and id <> p_user_id
       for update;

    select count(*) into v_other_active_super_admins
      from public.users
     where role = 'super_admin'::public.user_role
       and is_active
       and id <> p_user_id;

    if v_other_active_super_admins = 0 then
      raise exception 'Refusing to remove the last active super administrator: promote a replacement first';
    end if;
  end if;

  -- The UPDATE fires `protect_user_role` (`prevent_role_change()`), the invariant this
  -- schema already relies on: it refuses anyone who is neither an administrator nor the
  -- service role, so a caller that somehow reached this line without a role would still
  -- be stopped there.
  update public.users
     set role = p_role
   where id = p_user_id
  returning * into v_profile;

  if p_role = 'technician' then
    -- UNAPPROVED on purpose: creating the row is not approving the person. Approval
    -- stays the separate, deliberate decision at `PATCH /api/technicians/[id]/approve`.
    insert into public.technicians (id) values (p_user_id)
    on conflict (id) do nothing;
  else
    update public.technicians
       set approved = false, approved_at = null, approved_by = null
     where id = p_user_id
       and approved;
  end if;

  -- `jsonb`, not the row type, on purpose: it is what every other RPC in this schema
  -- returns (`admin_queue_override`), and PostgREST's JSON shape for a single composite
  -- return is the one part of this function that cannot be settled without a live call —
  -- an object here removes the question entirely.
  return to_jsonb(v_profile);
end;
$$;

revoke all on function public.set_user_role(uuid, public.user_role) from public, anon;
grant execute on function public.set_user_role(uuid, public.user_role) to authenticated, service_role;
