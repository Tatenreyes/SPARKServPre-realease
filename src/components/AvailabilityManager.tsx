"use client";

import BarangaySelect from "@/components/BarangaySelect";

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, Clock, MapPin, Plus, Trash2 } from "lucide-react";
import TimeSelect from "@/components/TimeSelect";
import { zonedToUtc } from "@/lib/service-time";
import { formatClockTime, isAfter } from "@/lib/time-of-day";
import type {
  TechnicianAvailabilityRow,
  TechnicianServiceAreaRow,
  TechnicianTimeOffRow,
} from "@/types/database";

/**
 * AvailabilityManager, a technician's own scheduling inputs.
 *
 * These are the three tables the queue reads when it asks "can this technician
 * actually work the window the customer asked for?":
 *
 *   technician_availability   weekly working-hours windows
 *   technician_time_off       concrete absences (a day, an afternoon, a week)
 *   technician_service_areas  which areas they cover
 *
 * The single most important thing this screen does is state the empty case
 * clearly. The SQL treats "no windows configured" and "no areas configured" as
 * NO RESTRICTION, not as "unavailable", so an empty list means "you are
 * offered everything", which is the opposite of what a blank schedule usually
 * implies. Saying so on screen is the difference between a technician
 * understanding their setup and quietly believing they are switched off.
 *
 * Times are entered in the SERVICE timezone (`queue_service_timezone`,
 * Asia/Manila), not the browser's, and `zonedToUtc()` converts them, the same
 * helper the request wizard uses, so a technician's "09:00" and a customer's
 * "09:00" mean the same instant.
 */

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * The compact field style of this screen's rows.
 *
 * The window pickers match the weekday select beside them rather than the taller control
 * used in the customer form: this is a dense scheduling row, and one control standing a
 * head above its neighbours reads as a mistake.
 */
const FIELD_COMPACT = "rounded-lg border border-line px-3 py-1.5 text-sm text-ink";

function prettyDateTime(iso: string, timeZone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(d);
}

export default function AvailabilityManager({ serviceTimeZone }: { serviceTimeZone: string }) {
  const [windows, setWindows] = useState<TechnicianAvailabilityRow[]>([]);
  const [timeOff, setTimeOff] = useState<TechnicianTimeOffRow[]>([]);
  const [areas, setAreas] = useState<TechnicianServiceAreaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Window form
  const [weekday, setWeekday] = useState("1");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");

  // Time off form
  const [offStart, setOffStart] = useState("");
  const [offEnd, setOffEnd] = useState("");
  const [offReason, setOffReason] = useState("");

  // Service area form
  const [area, setArea] = useState("");
  const [areaAppliance, setAreaAppliance] = useState("");

  const load = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    try {
      const res = await fetch("/api/technician-availability");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not load your availability");
      setWindows(json.data.windows ?? []);
      setTimeOff(json.data.time_off ?? []);
      setAreas(json.data.service_areas ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your availability");
    } finally {
      if (showSpinner) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(true);
  }, [load]);

  async function act(payload: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/technician-availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "That change was not saved");
      // Refresh WITHOUT the spinner: re-entering the loading state would rip
      // the form out from under the technician mid-edit on every add.
      await load(false);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "That change was not saved");
      return false;
    } finally {
      setBusy(false);
    }
  }


  async function addWindow() {
    if (endTime <= startTime) {
      setError("The window must end after it starts.");
      return;
    }
    const saved = await act({
      action: "add_window",
      weekday: Number(weekday),
      start_time: startTime,
      end_time: endTime,
    });
    if (saved) setNotice(`Added ${WEEKDAYS[Number(weekday)]} ${formatClockTime(startTime)} ${formatClockTime(endTime)}.`);
  }

  async function addTimeOff() {
    // `datetime-local` gives wall-clock text with no zone. Interpret it in the
    // service timezone so "Monday 9am" means 9am where the work happens, not
    // 9am wherever this browser happens to be sitting.
    const [sd, st] = offStart.split("T");
    const [ed, et] = offEnd.split("T");
    if (!sd || !st || !ed || !et) {
      setError("Pick both a start and an end for the time off.");
      return;
    }
    const startUtc = zonedToUtc(sd, st, serviceTimeZone);
    const endUtc = zonedToUtc(ed, et, serviceTimeZone);
    if (!startUtc || !endUtc || endUtc <= startUtc) {
      setError("The time off must end after it starts.");
      return;
    }

    const saved = await act({
      action: "add_time_off",
      starts_at: startUtc.toISOString(),
      ends_at: endUtc.toISOString(),
      reason: offReason,
    });
    if (saved) {
      setNotice(`Time off added for ${prettyDateTime(startUtc.toISOString(), serviceTimeZone)}.`);
      setOffStart("");
      setOffEnd("");
      setOffReason("");
    }
  }

  async function addArea() {
    if (!area.trim()) {
      setError("Enter an area name.");
      return;
    }
    const saved = await act({
      action: "add_area",
      area: area.trim(),
      appliance_type: areaAppliance.trim() || undefined,
    });
    if (saved) {
      setNotice(`Now covering ${area.trim()}.`);
      setArea("");
      setAreaAppliance("");
    }
  }

  async function remove(kind: "window" | "time_off" | "area", id: string) {
    const action =
      kind === "window" ? "remove_window" : kind === "time_off" ? "remove_time_off" : "remove_area";
    await act({ action, id });
  }

  if (loading) {
    return (
      <div className="rounded-card border border-line bg-surface p-4 shadow-card">
        <p className="text-sm text-ink/70">Loading your availability…</p>
      </div>
    );
  }

  const hasWorkingHours = windows.some((window) => window.is_active);
  const timeLabel = serviceTimeZone === "Asia/Manila" ? "Philippine time" : serviceTimeZone;

  return (
    <div className="space-y-6">
      {error && (
        <p className="rounded-card border border-alert-500/30 bg-alert-soft p-3 text-sm text-alert-ink">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-card border border-signal-500/30 bg-signal-soft p-3 text-sm text-signal-ink">
          {notice}
        </p>
      )}

      <section className="rounded-card border border-line bg-surface p-4 shadow-card">
        <header className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-ink/70" />
          <h2 className="font-display text-lg font-semibold text-ink">Weekly working hours</h2>
        </header>
        <p className="mt-1 text-xs text-ink/70">
          All times are shown in {timeLabel}.
          {hasWorkingHours
            ? " If the requested time falls outside your hours, you keep your queue position."
            : " No working hours are set. Your weekly schedule does not restrict offers."}
        </p>

        <ul className="mt-3 divide-y divide-line">
          {WEEKDAYS.map((day, index) => {
            const dayWindows = windows.filter((window) => window.weekday === index);
            const dayHasHours = dayWindows.some((window) => window.is_active);
            return (
              <li key={day} className="grid gap-1 py-2 text-sm sm:grid-cols-[8rem_1fr]">
                <p className="pt-1 font-semibold text-ink">{day}</p>
                <div className="min-w-0">
                  {!dayHasHours && (
                    <p className="py-1 text-muted">{hasWorkingHours ? "Unavailable" : "No hours set"}</p>
                  )}
                  {dayWindows.map((window) => (
                    <div key={window.id} className="flex items-center justify-between gap-3">
                      <span className="text-ink/70">
                        {formatClockTime(window.start_time)} to {formatClockTime(window.end_time)}
                        {!window.is_active && " (inactive)"}
                      </span>
                      <button
                        type="button"
                        onClick={() => remove("window", window.id)}
                        disabled={busy}
                        aria-label={`Remove ${day} ${formatClockTime(window.start_time)} to ${formatClockTime(window.end_time)}`}
                        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink/70 hover:bg-alert-soft hover:text-alert-ink disabled:opacity-40"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>

        <div className="mt-3 flex flex-wrap items-end gap-2">
          <select
            value={weekday}
            onChange={(e) => setWeekday(e.target.value)}
            aria-label="Weekday"
            className="rounded-lg border border-line px-3 py-1.5 text-sm"
          >
            {WEEKDAYS.map((day, index) => (
              <option key={day} value={index}>
                {day}
              </option>
            ))}
          </select>
          {/* Two pickers rather than native time inputs, and the end only offers times that
              follow the start, `addWindow()` refuses a window that ends before it starts,
              and the API answers 400 for anything that is not HH:MM. */}
          <TimeSelect
            id="window-start"
            label="Window start"
            value={startTime}
            onChange={(value) => {
              setStartTime(value);
              if (endTime && !isAfter(value, endTime)) setEndTime("");
            }}
            step={15}
            variant="single"
            className={FIELD_COMPACT}
          />
          <TimeSelect
            id="window-end"
            label="Window end"
            value={endTime}
            onChange={setEndTime}
            after={startTime}
            step={15}
            variant="single"
            className={FIELD_COMPACT}
          />
          <button
            onClick={addWindow}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-full bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            Add window
          </button>
        </div>
      </section>

      <section className="rounded-card border border-line bg-surface p-4 shadow-card">
        <header className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-ink/70" />
          <h2 className="font-display text-lg font-semibold text-ink">Time off</h2>
        </header>
        <p className="mt-1 text-xs text-ink/70">
          Add a date and time when you cannot take repairs in Cagayan de Oro. For example,
          block Friday from 1:00 PM to 5:00 PM if you will be away. Requests during that time
          can go to another technician. Use {timeLabel}.
        </p>

        {timeOff.length === 0 ? (
          <p className="mt-3 text-sm text-ink/70">No upcoming time off.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {timeOff.map((t) => (
              <li key={t.id} className="flex items-center justify-between py-2 text-sm">
                <span className="text-ink">
                  <span className="font-medium">
                    {prettyDateTime(t.starts_at, serviceTimeZone)}
                  </span>{" "}
                  <span className="text-ink/70">→ {prettyDateTime(t.ends_at, serviceTimeZone)}</span>
                  {t.reason && <span className="text-ink/70"> · {t.reason}</span>}
                </span>
                <button
                  onClick={() => remove("time_off", t.id)}
                  disabled={busy}
                  aria-label="Remove time off"
                  className="rounded-full p-1.5 text-ink/70 hover:bg-alert-soft hover:text-alert-ink disabled:opacity-40"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-xs text-ink/70">
            From
            <input
              type="datetime-local"
              value={offStart}
              onChange={(e) => setOffStart(e.target.value)}
              className="mt-1 block rounded-lg border border-line px-3 py-1.5 text-sm text-ink"
            />
          </label>
          <label className="text-xs text-ink/70">
            To
            <input
              type="datetime-local"
              value={offEnd}
              onChange={(e) => setOffEnd(e.target.value)}
              className="mt-1 block rounded-lg border border-line px-3 py-1.5 text-sm text-ink"
            />
          </label>
          <input
            value={offReason}
            onChange={(e) => setOffReason(e.target.value)}
            placeholder="Reason (optional)"
            className="rounded-lg border border-line px-3 py-1.5 text-sm"
          />
          <button
            onClick={addTimeOff}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-full bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            Add time off
          </button>
        </div>
      </section>

      <section className="rounded-card border border-line bg-surface p-4 shadow-card">
        <header className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-ink/70" />
          <h2 className="font-display text-lg font-semibold text-ink">Service areas</h2>
        </header>
        <p className="mt-1 text-xs text-ink/70">
          Add the barangays in Cagayan de Oro where you can take repair jobs. For example,
          choose Carmen to receive requests in that area. Leave the appliance type blank
          to use that area for every appliance you service.
        </p>

        {areas.length === 0 ? (
          <p className="mt-3 text-sm text-ink/70">
            No barangays selected. Your offers are not limited by barangay.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {areas.map((a) => (
              <li key={a.id} className="flex items-center justify-between py-2 text-sm">
                <span className="text-ink">
                  <span className="font-medium">{a.area}</span>
                  <span className="text-ink/70">
                    {a.appliance_type ? ` · ${a.appliance_type.replace(/_/g, " ")} only` : " · all appliance types"}
                  </span>
                </span>
                <button
                  onClick={() => remove("area", a.id)}
                  disabled={busy}
                  aria-label={`Remove ${a.area}`}
                  className="rounded-full p-1.5 text-ink/70 hover:bg-alert-soft hover:text-alert-ink disabled:opacity-40"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 flex flex-wrap items-end gap-2">
          <BarangaySelect id="technician-service-barangay" value={area} onChange={setArea} disabled={busy} />
          <input
            value={areaAppliance}
            onChange={(e) => setAreaAppliance(e.target.value)}
            aria-label="Appliance type (optional)"
            placeholder="Appliance type, e.g. Electric Stove"
            className="rounded-lg border border-line px-3 py-1.5 text-sm"
          />
          <button
            onClick={addArea}
            disabled={busy || !area}
            className="inline-flex items-center gap-1.5 rounded-full bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            Add barangay
          </button>
        </div>
      </section>
    </div>
  );
}

