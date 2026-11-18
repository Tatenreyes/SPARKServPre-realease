-- =========================================================
-- SPARKServ — migration: how a service concern was resolved
-- Run this in Supabase SQL Editor AFTER the original schema.sql.
-- Safe to run once; adds three nullable columns and changes no rows.
-- =========================================================

-- A service concern could be moved to 'resolved' and NOTHING anywhere said how.
-- The status dropdown was the entire record, so "resolved" meant "an
-- administrator pressed a button": useless to the next person who opens the row,
-- and useless to the customer who raised it. These three columns are the answer —
-- the note the administrator is required to write, plus who wrote it and when.
--
-- resolved_by is the ADMINISTRATOR's user id. It is stamped by the API from the
-- authenticated session and never accepted from a request body, the same rule the
-- queue's audit trail follows for its actor column. Enforcing "you must write a
-- reason" server-side is what makes the column trustworthy; the UI asking for it
-- is only a convenience.
--
-- Row-level security needs no new policy: the existing "user manages own tickets"
-- policy already governs every column of a row (the customer may read the note,
-- which is the point, since it answers their question). The API route is the gate
-- that requires an admin role, exactly as it already is for `status`.

alter table public.support_tickets
  add column resolution_note text,
  add column resolved_by uuid references public.users(id),
  add column resolved_at timestamptz;

-- The admin queue scans resolved concerns to answer "what did we actually do
-- about these", newest first. The partial index keeps that scan off the path that
-- lists open work, which is the query that runs on every page load.
create index idx_support_tickets_resolved_at
  on public.support_tickets(resolved_at desc)
  where resolution_note is not null;
