-- ============================================================================
-- HISTORICAL — FOLDED INTO schema.sql. NOT PART OF THE UPGRADE PATH.
--
-- `schema.sql` is the canonical install, and it already contains everything below in
-- its CORRECTED form. `DATABASE.md` §"Migration files" classifies this file as pre-queue
-- history that is "applied on the live project already, and folded into schema.sql for
-- fresh installs. Not part of the upgrade path." A database created from an earlier
-- `schema.sql` is brought forward with the ordered chain in `DATABASE.md` §"Apply order",
-- which does not include this file.
--
-- It is kept for the record, and it is SAFE TO RE-RUN: the function below carries the
-- corrected body, matching `schema.sql` exactly. That matters, because this file used to
-- carry the older body — the one reading the singular `request.jwt.claim.role` setting,
-- which no longer holds the caller's role. With that body the service-role bypass never
-- fired, so re-applying this file on a current database would have replaced the working
-- trigger with a broken one and silently refused EVERY role change made by the service
-- role, including the super-admin endpoint `PATCH /api/users/[id]/role`.
--
-- Prevent self-service role escalation. Role changes go through the super-admin API,
-- which uses the service role after `requireRole()`.
-- ============================================================================

create or replace function public.prevent_role_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  -- `request.jwt.claims` is a JSON object in current Supabase; the older
  -- singular `request.jwt.claim.role` setting no longer holds the caller's
  -- role, which meant the service-role bypass silently never fired.
  if new.role is distinct from old.role
    and coalesce(
          current_setting('request.jwt.claims', true)::jsonb ->> 'role',
          current_setting('request.jwt.claim.role', true),
          ''
        ) <> 'service_role'
    and not public.is_admin() then
    raise exception 'Only an administrator can change user roles';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_user_role on public.users;
create trigger protect_user_role
  before update on public.users
  for each row execute procedure public.prevent_role_change();

drop policy if exists "users can update their own profile" on public.users;
create policy "users can update their own profile"
  on public.users for update
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

drop trigger if exists protect_user_role on public.users;
create trigger protect_user_role
  before update on public.users
  for each row execute procedure public.prevent_role_change();

drop policy if exists "users can update their own profile" on public.users;
create policy "users can update their own profile"
  on public.users for update
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());