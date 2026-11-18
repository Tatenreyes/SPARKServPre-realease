import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireRole, AuthError } from "@/lib/auth";
import type { TicketStatus } from "@/types/database";

const VALID_STATUSES: TicketStatus[] = ["open", "in_progress", "resolved", "closed"];

/**
 * A resolution note is a sentence or two, not an essay. Capped so a paste of a
 * whole transcript cannot land in the column the admin queue renders inline.
 */
const MAX_RESOLUTION_NOTE = 2000;

/**
 * PATCH /api/support-tickets/:id, admin moves a service concern through its
 * statuses **and records how it was resolved**.
 *
 * "Resolved" used to be settable with nothing behind it — no note, no author, no
 * timestamp — so the queue could show a closed concern that nobody could explain.
 * Resolving now REQUIRES a note, enforced here rather than only in the form,
 * because the form is a convenience and this is the rule.
 *
 * `resolved_by` and `resolved_at` are stamped from the authenticated admin's own
 * session, never read from the body: a client cannot claim that somebody else
 * resolved a concern, and cannot backdate one.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const admin = await requireRole(["admin", "super_admin"]);

    const body = await request.json().catch(() => ({}));
    const { status } = body;

    if (!VALID_STATUSES.includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    const resolutionNote =
      typeof body.resolution_note === "string" ? body.resolution_note.trim() : "";

    if (status === "resolved" && !resolutionNote) {
      return NextResponse.json(
        { error: "Add a short note describing how this concern was resolved." },
        { status: 400 }
      );
    }

    if (resolutionNote.length > MAX_RESOLUTION_NOTE) {
      return NextResponse.json(
        { error: `Keep the resolution note under ${MAX_RESOLUTION_NOTE} characters.` },
        { status: 400 }
      );
    }

    const update: {
      status: TicketStatus;
      updated_at: string;
      resolution_note?: string;
      resolved_by?: string;
      resolved_at?: string;
    } = { status, updated_at: new Date().toISOString() };

    // Re-resolving a reopened concern replaces the note: the columns describe the
    // resolution that is current, and the earlier one is in the admin's own
    // conversation with the customer.
    if (resolutionNote) {
      update.resolution_note = resolutionNote;
      update.resolved_by = admin.id;
      update.resolved_at = new Date().toISOString();
    }

    const supabase = createClient();
    const { data, error } = await supabase
      .from("support_tickets")
      .update(update)
      .eq("id", params.id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ data });
  } catch (err) {
    return handleError(err);
  }
}

/** Postgres/PostgREST codes that mean "this object is not in the database yet". */
const MISSING_SCHEMA_OBJECT = new Set([
  "42703", // undefined_column
  "42P01", // undefined_table
  "PGRST204", // PostgREST: column not found in the schema cache
  "PGRST205", // PostgREST: table not found in the schema cache
]);

/**
 * The database's own wording, in development only — the same courtesy
 * `POST /api/service-requests` extends there. PostgREST errors are plain objects,
 * not `Error` instances, so `message` is read directly; `String(err)` would report
 * the useless "[object Object]" for exactly the errors this explains.
 */
function databaseDetail(err: unknown) {
  if (process.env.NODE_ENV === "production") return null;
  return {
    code: (err as { code?: string })?.code ?? null,
    message:
      err instanceof Error
        ? err.message
        : ((err as { message?: string })?.message ?? String(err)),
    details: (err as { details?: string })?.details ?? null,
    hint: (err as { hint?: string })?.hint ?? null,
  };
}

/**
 * A deployment can be ahead of its database: the resolution columns are added by
 * `supabase/migration_support_ticket_resolution.sql`, which is applied by hand in the
 * SQL Editor. Until it is, the write fails with 42703 / PGRST204 and this route used to
 * answer a bare "Internal server error" — which tells the administrator nothing about
 * which file to run. So that one class of failure is named, with the 503 and the
 * `SERVICE_SETUP_REQUIRED` code the repair-request route already uses for a schema gap.
 *
 * Everything else stays a 500, because an unlabelled failure is still a failure.
 */
function handleError(err: unknown) {
  if (err instanceof AuthError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error(err);

  if (MISSING_SCHEMA_OBJECT.has((err as { code?: string })?.code ?? "")) {
    const detail = databaseDetail(err);
    return NextResponse.json(
      {
        error:
          "This database is missing the service-concern resolution columns. Apply supabase/migration_support_ticket_resolution.sql, then save the note again.",
        code: "SERVICE_SETUP_REQUIRED",
        ...(detail
          ? {
              detail: {
                ...detail,
                next_step: "npm run db:check lists the migrations this project is missing",
              },
            }
          : {}),
      },
      { status: 503 }
    );
  }

  return NextResponse.json(
    { error: "Internal server error", detail: databaseDetail(err) },
    { status: 500 }
  );
}
