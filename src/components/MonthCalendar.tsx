"use client";

import { useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  daysInMonth,
  futureRange,
  parseIsoDate,
  selectableDayRange,
  toIsoDate,
  type DateRange,
} from "@/lib/appliance-fields";

/**
 * A month grid that drives — and follows — the Month / Day / Year dropdowns.
 *
 * It is a SECOND VIEW of the same value `DateSelect` owns, never a second source
 * of truth: a day is clicked, `onSelect` hands the ISO date back to the wizard and
 * the dropdowns re-read it; a dropdown changes, `onViewChange` moves the grid to
 * that month. They cannot disagree because neither stores the date — the wizard's
 * `preferredDate` does.
 *
 * It shares the date picker's own rules instead of restating them: the range is
 * `futureRange()` and the selectable span inside a month is `selectableDayRange()`
 * from `appliance-fields.ts`, so a day this calendar offers is always a day the
 * dropdowns would accept (today through a year ahead; nothing in the past).
 *
 * "Today" is the calendar date in `Asia/Manila`, NOT the browser's zone: a device
 * set to another timezone must still show the shop's day, or the highlight and the
 * disabled span would be off by one.
 */

const MANILA = "Asia/Manila";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** Sunday-first, matching `Date#getDay()`. Decorative; the buttons carry names. */
const WEEKDAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];

/** "Monday, January 18, 2027" — the full spoken form of a day. */
const LONG_DATE = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
});

/**
 * The calendar date right now in the service timezone, as a local `Date` at
 * midnight — the shape `futureRange()` and `selectableDayRange()` compare against.
 *
 * `en-CA` yields `YYYY-MM-DD`, the same shape `toIsoDate()` produces, so the parts
 * can be read straight off it without a date library.
 */
export function manilaToday(now: Date = new Date()): Date {
  const [year, month, day] = new Intl.DateTimeFormat("en-CA", {
    timeZone: MANILA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(now)
    .split("-")
    .map(Number);
  return new Date(year, month - 1, day);
}

const BUTTON =
  "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line bg-surface text-ink transition duration-200 hover:border-brand-300 hover:bg-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-50";

const CELL =
  "inline-flex min-h-[44px] w-full items-center justify-center rounded-lg text-sm transition duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500";

export interface MonthCalendarProps {
  /** The chosen date as ISO `YYYY-MM-DD`, or "" for none — the value the dropdowns hold. */
  value: string;
  /** The month on show. Owned by the parent so a dropdown change can move it. */
  view: { year: number; month: number };
  /** Called when the customer pages or when the view should follow the dropdowns. */
  onViewChange: (view: { year: number; month: number }) => void;
  /** Called with a full ISO date when a day is clicked. */
  onSelect: (value: string) => void;
}

export default function MonthCalendar({
  value,
  view,
  onViewChange,
  onSelect,
}: MonthCalendarProps) {
  const { year, month } = view;

  // Read once per mount: a range that shifted under the customer mid-form would be
  // worse than one a few hours stale (the same reasoning as `DateSelect`).
  const today = useMemo(() => manilaToday(), []);
  const range: DateRange = useMemo(() => futureRange(today), [today]);

  const parsed = parseIsoDate(value);
  const selectedDay =
    parsed && parsed.getFullYear() === year && parsed.getMonth() + 1 === month
      ? parsed.getDate()
      : 0;
  const todayDay =
    today.getFullYear() === year && today.getMonth() + 1 === month
      ? today.getDate()
      : 0;

  const firstWeekday = new Date(year, month - 1, 1).getDay();
  const total = daysInMonth(year, month);
  const bounds = selectableDayRange(year, month, range);

  // The first and last month worth showing, so the arrows stop at the ends of the
  // range instead of paging forever through months every day of which is disabled.
  const firstIndex = range.min.getFullYear() * 12 + range.min.getMonth();
  const lastIndex = range.max.getFullYear() * 12 + range.max.getMonth();
  const viewIndex = year * 12 + (month - 1);

  function shift(delta: number) {
    const next = viewIndex + delta;
    onViewChange({ year: Math.floor(next / 12), month: (next % 12) + 1 });
  }

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let day = 1; day <= total; day++) cells.push(day);

  return (
    <div className="rounded-card border border-line bg-surface p-3 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          aria-label="Previous month"
          disabled={viewIndex <= firstIndex}
          onClick={() => shift(-1)}
          className={BUTTON}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>

        <p aria-live="off" className="text-sm font-semibold text-ink">
          {MONTHS[month - 1]} {year}
        </p>

        <button
          type="button"
          aria-label="Next month"
          disabled={viewIndex >= lastIndex}
          onClick={() => shift(1)}
          className={BUTTON}
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="mt-2 grid grid-cols-7 gap-1 text-center">
        {WEEKDAY_LETTERS.map((letter, index) => (
          <span
            key={`${letter}-${index}`}
            aria-hidden="true"
            className="text-[11px] font-medium uppercase text-muted"
          >
            {letter}
          </span>
        ))}

        {cells.map((day, index) => {
          if (day === null) {
            return <span key={`blank-${index}`} aria-hidden="true" />;
          }

          const selectable = bounds ? day >= bounds[0] && day <= bounds[1] : false;
          const isSelected = selectedDay === day;
          const isToday = todayDay === day;

          return (
            <button
              key={day}
              type="button"
              aria-label={LONG_DATE.format(new Date(year, month - 1, day))}
              aria-pressed={isSelected}
              aria-current={isSelected ? "date" : undefined}
              disabled={!selectable}
              onClick={() => onSelect(toIsoDate(year, month, day))}
              className={`${CELL} ${
                isSelected
                  ? "bg-accent-600 font-semibold text-white"
                  : selectable
                    ? isToday
                      ? "font-semibold text-accent-ink ring-1 ring-accent-600 hover:bg-accent-soft"
                      : "text-ink hover:bg-soft"
                    : "cursor-not-allowed text-muted opacity-60"
              }`}
            >
              {day}
            </button>
          );
        })}
      </div>

      {/* What the colours mean, so the grid is not a code to be puzzled out. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="h-3 w-3 rounded-full ring-1 ring-accent-600"
          />
          Today
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="h-3 w-3 rounded-full bg-accent-600" />
          Selected
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="h-3 w-3 rounded-full bg-soft ring-1 ring-line"
          />
          Unavailable
        </span>
      </div>

      <p className="mt-2 text-sm font-medium text-ink">
        {parsed ? LONG_DATE.format(parsed) : "No date selected."}
      </p>
    </div>
  );
}
