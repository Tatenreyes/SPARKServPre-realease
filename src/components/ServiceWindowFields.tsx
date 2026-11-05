"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  FLEXIBLE_WINDOWS,
  windowEndTimes,
  windowHours,
  windowMinutes,
  windowLabel,
  windowStartTimes,
  type ServiceHour,
} from "@/lib/service-windows";
import {
  formatClockTime,
  meridiemOf,
  minutesOfDay,
  toClockTime,
  type ClockTime,
} from "@/lib/time-of-day";

/**
 * The preferred arrival window, as two hour + minute boxes whose AM/PM is IMPLIED.
 *
 * WHY THIS SHAPE. The control before it was a dropdown of ready-made choices, and
 * before that six selects (hour, minute, AM/PM, twice) over the whole day — which is
 * how a customer could ask for 1:00 AM, a preference no technician can ever cover
 * (eligibility needs somebody free across the entire span, so such a request sits in
 * `waiting` for ever while looking perfectly normal). Both of those let the shop's
 * day in only as a filter, and the dropdown hid the ordinary answer behind preset
 * lists.
 *
 * Here the hour list IS the shop's day: `9 AM`, `10 AM`, `11 AM`, `1 PM`, `2 PM`,
 * `3 PM`, `4 PM`. The label carries the half of the day, so there is no AM/PM select
 * to get wrong, and 9 PM or 4 AM cannot be assembled from the options at all — they
 * are not offered, refused or hidden. The badge beside the boxes simply states the
 * AM/PM the chosen hour implies.
 *
 * The other half of the design is the END pool. It is bounded by the chosen start
 * AND by the block that start sits in (`windowEndTimes`), so a start of 10:30 AM
 * offers ends up to 11:00 AM and no further: a window across the lunch break is
 * never offerable, where it used to be offerable and then dropped in silence by the
 * form and again by the API. The end box stays disabled until a start exists, so
 * there is no half-filled pair and no inverted one.
 *
 * Both pools are module-level constants or memoised, never rebuilt per render, so a
 * keystroke elsewhere in the form cannot reshape them.
 */

/** The times that may START a window, computed once: 9:00–10:55 AM, 1:00–3:55 PM. */
const START_TIMES = windowStartTimes();
/** The hour choices for those times, each labelled with its own AM/PM. */
const START_HOURS = windowHours(START_TIMES);

const SELECT =
  "min-h-[44px] cursor-pointer rounded-xl border border-line bg-surface px-3 py-2 text-base text-ink transition duration-200 hover:border-brand-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 sm:text-sm disabled:cursor-not-allowed disabled:opacity-60";

export interface ServiceWindowFieldsProps {
  /** `"HH:MM"` on the 24-hour clock, or "" for "no preference yet". */
  start: string;
  end: string;
  onStartChange: (value: string) => void;
  onEndChange: (value: string) => void;
  /** True until the customer has picked a date: nothing here can be chosen yet. */
  disabled: boolean;
}

export default function ServiceWindowFields({
  start,
  end,
  onStartChange,
  onEndChange,
  disabled,
}: ServiceWindowFieldsProps) {
  /**
   * The end pool follows the start. `windowEndTimes("")` is empty, which is why the
   * end box has nothing to offer until a start exists.
   */
  const endTimes = useMemo(() => windowEndTimes(start), [start]);
  const endHours = useMemo(() => windowHours(endTimes), [endTimes]);

  return (
    <div className="min-w-0">
      <div className="grid gap-3 sm:grid-cols-2">
        <TimeBox
          id="preferred-window-start"
          label="Earliest arrival"
          value={start}
          times={START_TIMES}
          hours={START_HOURS}
          disabled={disabled}
          onChange={(value) => {
            onStartChange(value);
            // The chosen end may no longer follow the new start, or may now sit in the
            // other block. Cleared here rather than left for the API to drop, so the
            // form never holds a pair that means nothing.
            const stillLegal = windowEndTimes(value).some(
              (time) => toClockTime(time.hour, time.minute) === end
            );
            if (end && !stillLegal) onEndChange("");
          }}
        />
        <TimeBox
          id="preferred-window-end"
          label="Latest arrival"
          value={end}
          times={endTimes}
          hours={endHours}
          disabled={disabled || !start}
          onChange={onEndChange}
        />
      </div>

      {/* Said out loud rather than left as two silent boxes. */}
      {!disabled && !start && (
        <p className="mt-2 text-xs text-muted">
          Leave both boxes empty for any time that day. The latest arrival unlocks once
          the earliest is chosen.
        </p>
      )}
      {!disabled && start && !end && (
        <p className="mt-2 text-xs text-muted">
          Now pick the latest arrival, after {formatClockTime(start)}.
        </p>
      )}
      {start && end && (
        <p className="mt-2 text-xs font-medium text-ink/70">
          You have asked for {windowLabel(start, end)} (PH time).
        </p>
      )}

      {/* One tap for the two answers most customers want, and the way back to "no
          preference". These are the day's own blocks (`FLEXIBLE_WINDOWS`), not a list
          typed here, so moving the lunch break moves the chips. */}
      <div role="group" aria-label="Quick fill" className="mt-3 flex flex-wrap gap-2">
        <QuickFill
          selected={!start && !end}
          disabled={disabled}
          onClick={() => {
            onStartChange("");
            onEndChange("");
          }}
        >
          Any time
        </QuickFill>
        {FLEXIBLE_WINDOWS.map((window) => (
          <QuickFill
            key={window.key}
            selected={start === window.start && end === window.end}
            disabled={disabled}
            onClick={() => {
              onStartChange(window.start);
              onEndChange(window.end);
            }}
          >
            {window.key === "morning" ? "Morning" : "Afternoon"} ·{" "}
            {windowLabel(window.start, window.end)}
          </QuickFill>
        ))}
      </div>
    </div>
  );
}

/**
 * One arrival boundary: an hour box, a minute box, and the AM/PM the hour implies.
 *
 * A partial pick (an hour with no minute) is held in local state and never reported:
 * `onChange` only ever receives a whole time that exists in the pool, so the form
 * cannot hold half a window for the API to drop.
 */
function TimeBox({
  id,
  label,
  value,
  onChange,
  times,
  hours,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  times: ClockTime[];
  hours: ServiceHour[];
  disabled: boolean;
}) {
  const parsed = minutesOfDay(value);

  // `-1` means "not chosen yet": a 24-hour clock never shows -1, and hour 0 is real
  // (midnight), so it cannot double as the empty value.
  const [hour, setHour] = useState(parsed === null ? -1 : Math.floor(parsed / 60));
  const [minute, setMinute] = useState(parsed === null ? -1 : parsed % 60);

  /**
   * Re-read the value when the caller changes it underneath us: the quick-fill chips
   * write both boxes at once, and the end is cleared when the start moves past it.
   */
  useEffect(() => {
    const next = minutesOfDay(value);
    setHour(next === null ? -1 : Math.floor(next / 60));
    setMinute(next === null ? -1 : next % 60);
  }, [value]);

  const allowed = useMemo(
    () => new Set(times.map((time) => toClockTime(time.hour, time.minute))),
    [times]
  );
  const minuteChoices = windowMinutes(times, hour < 0 ? null : hour);
  const meridiem = hour < 0 ? "" : meridiemOf(hour);

  function commit(nextHour: number, nextMinute: number) {
    setHour(nextHour);
    setMinute(nextMinute);
    if (nextHour < 0 || nextMinute < 0) {
      onChange("");
      return;
    }
    const candidate = toClockTime(nextHour, nextMinute);
    onChange(allowed.has(candidate) ? candidate : "");
  }

  function changeHour(nextHour: number) {
    if (nextHour < 0) {
      commit(-1, -1);
      return;
    }
    // Clamp the minute into what the new hour allows, so a chosen 10:55 cannot survive
    // a switch to an hour whose grid is narrower.
    const minutes = windowMinutes(times, nextHour);
    const nextMinute = minutes.includes(minute) ? minute : minutes[0] ?? -1;
    commit(nextHour, nextMinute);
  }

  return (
    <div className="min-w-0">
      <span id={`${id}-label`} className="mb-1.5 block text-xs font-medium text-ink/70">
        {label}
      </span>
      <div
        role="group"
        aria-labelledby={`${id}-label`}
        className="flex flex-wrap items-center gap-2"
      >
        <select
          id={`${id}-hour`}
          aria-label={`${label} hour`}
          value={hour < 0 ? "" : hour}
          onChange={(event) => changeHour(Number(event.target.value))}
          disabled={disabled}
          className={`${SELECT} flex-1 basis-[5.5rem]`}
        >
          <option value="">Hour</option>
          {hours.map((option) => (
            <option key={option.hour} value={option.hour}>
              {option.label}
            </option>
          ))}
        </select>

        <select
          id={`${id}-minute`}
          aria-label={`${label} minutes`}
          value={minute < 0 ? "" : minute}
          onChange={(event) => commit(hour, Number(event.target.value))}
          disabled={disabled || minuteChoices.length === 0}
          className={`${SELECT} basis-[4.75rem]`}
        >
          <option value="">Min</option>
          {minuteChoices.map((option) => (
            <option key={option} value={option}>
              {String(option).padStart(2, "0")}
            </option>
          ))}
        </select>

        {/* The half of the day, stated rather than chosen. `aria-hidden` because the
            hour option already reads "9 AM", so a screen reader would otherwise hear
            the same thing twice. */}
        <span
          aria-hidden="true"
          className={`inline-flex min-h-[44px] min-w-[3.5rem] items-center justify-center rounded-xl border border-line bg-soft px-2 text-xs font-semibold ${
            meridiem ? "text-ink/80" : "text-muted"
          }`}
        >
          {meridiem || "AM/PM"}
        </span>
      </div>
    </div>
  );
}

/** One-tap fill: a block of the day, or "no preference". */
function QuickFill({
  selected,
  disabled,
  onClick,
  children,
}: {
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex min-h-[40px] cursor-pointer items-center rounded-full border px-3.5 text-xs font-medium transition duration-200 disabled:cursor-not-allowed disabled:opacity-60 ${
        selected
          ? "border-brand-300 bg-brand-soft text-brand-ink"
          : "border-line bg-surface text-ink/80 hover:border-brand-300 hover:bg-brand-soft"
      }`}
    >
      {children}
    </button>
  );
}
