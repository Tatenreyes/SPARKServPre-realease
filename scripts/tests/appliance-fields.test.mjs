/**
 * Unit tests for the request form's field layer: the appliance identifiers, the dates
 * (purchase, requested service, warranty) and the preferred time window.
 *
 *   npm run test:appliance-fields
 *
 * These run the REAL modules (`src/lib/appliance-fields.ts`, `src/lib/time-of-day.ts`) —
 * Node 24 strips the TypeScript types, so there is no build step and no duplicated copy of
 * the rules to drift. The screens and both pickers are also read as text, because the
 * limits have to be WIRED INTO the fields, not merely defined.
 *
 * What is NOT covered here: the rendered controls themselves (see TESTING.md for the
 * manual pass) and anything that needs the live database.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  COUNTER_VISIBLE_WITHIN,
  MAX_MODEL_NUMBER_LENGTH,
  MAX_SERIAL_NUMBER_LENGTH,
  MAX_WARRANTY_YEARS,
  MIN_PURCHASE_YEAR,
  anyRange,
  cleanCode,
  daysInMonth,
  formatIsoDate,
  futureRange,
  monthPosition,
  parseIsoDate,
  pastRange,
  sanitiseCodeInput,
  selectableDayRange,
  showsCounter,
  startOfToday,
  toIsoDate,
  yearsInRange,
} from "../../src/lib/appliance-fields.ts";
import {
  formatClockTime,
  hour12Of,
  hour24Of,
  isAfter,
  meridiemOf,
  minutesOfDay,
  optionsFor,
  timeOptions,
  toClockTime,
} from "../../src/lib/time-of-day.ts";
import {
  CLOCK_STEP_MINUTES,
  FLEXIBLE_WINDOWS,
  REQUEST_DURATION_MINUTES,
  SERVICE_HOURS,
  isServiceRange,
  resolveWindowPair,
  serviceClockTimes,
  windowEndTimes,
  windowHours,
  windowLabel,
  windowMinutes,
  windowStartTimes,
} from "../../src/lib/service-windows.ts";

const ROOT = new URL("../../", import.meta.url);
const WIZARD = "src/components/RequestRepairWizard.tsx";
const PAGE = "src/app/customer/appliances/page.tsx";
const DATE_SELECT = "src/components/DateSelect.tsx";
const TIME_SELECT = "src/components/TimeSelect.tsx";
const WINDOW_FIELDS = "src/components/ServiceWindowFields.tsx";
const AVAILABILITY = "src/components/AvailabilityManager.tsx";
const SERVICE_TIME = "src/lib/service-time.ts";
const wizard = readFileSync(new URL(WIZARD, ROOT), "utf8");
const page = readFileSync(new URL(PAGE, ROOT), "utf8");
const dateSelect = readFileSync(new URL(DATE_SELECT, ROOT), "utf8");
const timeSelect = readFileSync(new URL(TIME_SELECT, ROOT), "utf8");
const windowFields = readFileSync(new URL(WINDOW_FIELDS, ROOT), "utf8");
const availability = readFileSync(new URL(AVAILABILITY, ROOT), "utf8");

// -------------------------------------------------- 1. the caps

test("both identifiers are capped, and the caps are sane", () => {
  // Long enough for the longest real values (model numbers run 15-25 characters,
  // serials less), short enough that a pasted document cannot be stored.
  assert.equal(MAX_MODEL_NUMBER_LENGTH, 50);
  assert.equal(MAX_SERIAL_NUMBER_LENGTH, 50);
  assert.ok(MAX_MODEL_NUMBER_LENGTH > 25 && MAX_MODEL_NUMBER_LENGTH <= 64);
});

test("cleanCode trims, collapses whitespace, and caps", () => {
  assert.equal(cleanCode("  RT32K5530S8  ", 40), "RT32K5530S8");
  // A paste from a PDF arrives with newlines and tabs in it.
  assert.equal(cleanCode("RT32\nK5530\tS8", 40), "RT32 K5530 S8");
  assert.equal(cleanCode("x".repeat(120), 40).length, 40);
  assert.equal(cleanCode("   \n\t ", 40), "", "whitespace only is not a value");
  assert.equal(cleanCode("", 40), "");
  assert.equal(cleanCode("A1 B2", 3), "A1", "the cap applies after normalising");
});

test("an identifier may only hold letters, digits and a label separator", () => {
  // Real labels: "WF45R6100AP/A2" and "RT-32K". A strictly alphanumeric filter
  // would reject both, so the slash and hyphen survive.
  assert.equal(sanitiseCodeInput("WF45R6100AP/A2", 50), "WF45R6100AP/A2");
  assert.equal(sanitiseCodeInput("RT-32K", 50), "RT-32K");
  assert.equal(sanitiseCodeInput("A1;B2#C3", 50), "A1B2C3", "punctuation is dropped as it is typed");
  assert.equal(sanitiseCodeInput("RT32 K5530S8", 50), "RT32 K5530S8", "the space is part of the label");
  assert.equal(sanitiseCodeInput("sn. 123/2024, unit", 50), "sn 123/2024 unit");
  assert.equal(sanitiseCodeInput("x".repeat(80), 50).length, 50, "and it still caps");
});

test("the field and the payload agree on what an identifier is", () => {
  // If they disagreed, what the customer sees is not what gets stored.
  for (const value of ["WF45R6100AP/A2", "RT-32K", "RT32 K5530S8"]) {
    assert.equal(sanitiseCodeInput(value, 50), value);
    assert.equal(cleanCode(value, 50), value);
  }
  assert.equal(cleanCode("  A1;B2  ", 50), "A1B2");
  assert.equal(cleanCode("RT32  K5530", 50), "RT32 K5530", "runs of spaces collapse");
});

test("the counter appears only when the field is nearly full", () => {
  const short = "A".repeat(MAX_MODEL_NUMBER_LENGTH - COUNTER_VISIBLE_WITHIN - 1);
  const edge = "A".repeat(MAX_MODEL_NUMBER_LENGTH - COUNTER_VISIBLE_WITHIN);
  const full = "A".repeat(MAX_MODEL_NUMBER_LENGTH);

  assert.equal(showsCounter(short, MAX_MODEL_NUMBER_LENGTH), false);
  assert.equal(showsCounter(edge, MAX_MODEL_NUMBER_LENGTH), true);
  assert.equal(showsCounter(full, MAX_MODEL_NUMBER_LENGTH), true);
  assert.equal(showsCounter("", MAX_MODEL_NUMBER_LENGTH), false);
});

// -------------------------------------------------- 2. the date arithmetic

test("daysInMonth knows the short months and the leap years", () => {
  assert.equal(daysInMonth(2024, 2), 29, "2024 is a leap year");
  assert.equal(daysInMonth(2023, 2), 28);
  assert.equal(daysInMonth(2000, 2), 29, "divisible by 400");
  assert.equal(daysInMonth(1900, 2), 28, "divisible by 100 but not 400");
  assert.equal(daysInMonth(2024, 4), 30);
  assert.equal(daysInMonth(2024, 12), 31);
  assert.equal(daysInMonth(2024, 1), 31);
});

test("toIsoDate pads, so the value always fits the column", () => {
  assert.equal(toIsoDate(2019, 3, 2), "2019-03-02");
  assert.equal(toIsoDate(2024, 12, 31), "2024-12-31");
  assert.equal(toIsoDate(1970, 1, 1), "1970-01-01");
});

test("parseIsoDate reads a calendar date locally, never as UTC", () => {
  // `new Date("2019-03-12")` is UTC midnight: west of UTC that renders as 11 March.
  // The components must survive the round trip in any timezone.
  const date = parseIsoDate("2019-03-12");
  assert.ok(date, "a plain ISO date parses");
  assert.equal(date.getFullYear(), 2019);
  assert.equal(date.getMonth(), 2, "March is 0-based");
  assert.equal(date.getDate(), 12, "and never the 11th");

  assert.equal(toIsoDate(2019, 3, 12), "2019-03-12", "round trip");
});

test("parseIsoDate refuses anything that is not a real calendar date", () => {
  assert.equal(parseIsoDate("2023-02-30"), null, "30 February must not roll into March");
  assert.equal(parseIsoDate("2023-13-01"), null);
  assert.equal(parseIsoDate("2019-3-12"), null, "unpadded is not the stored shape");
  assert.equal(parseIsoDate("12/03/2019"), null);
  assert.equal(parseIsoDate("2019-03-12T00:00:00Z"), null);
  assert.equal(parseIsoDate(""), null);
  assert.equal(parseIsoDate(null), null);
  assert.equal(parseIsoDate(undefined), null);
});

test("formatIsoDate shows the date the customer picked", () => {
  const shown = formatIsoDate("2019-03-12");
  assert.match(shown, /12/);
  assert.match(shown, /Mar/);
  assert.match(shown, /2019/);
  assert.equal(formatIsoDate(""), "");
  assert.equal(formatIsoDate(null), "");
  assert.equal(formatIsoDate("rubbish"), "");
});

test("a purchase date can never be in the future", () => {
  const range = pastRange(new Date(2024, 1, 20)); // 20 February 2024

  assert.deepEqual(selectableDayRange(2024, 2, range), [1, 20], "the current month stops at today");
  assert.deepEqual(selectableDayRange(2024, 1, range), [1, 31], "an earlier month is whole");
  assert.deepEqual(selectableDayRange(2023, 2, range), [1, 28], "a past February is not clamped");
  assert.equal(
    selectableDayRange(2024, 3, range),
    null,
    "a month that has not started offers no days at all"
  );
  assert.equal(selectableDayRange(2025, 1, range), null, "nor does a year that has not started");
  assert.equal(selectableDayRange(1969, 6, range), null, "and the floor holds too");
  assert.equal(selectableDayRange(1970, 1, range)[0], 1, "the first allowed day is 1 January 1970");

  assert.equal(monthPosition(2024, 3, range), "after");
  assert.equal(monthPosition(2024, 2, range), "inside");
  assert.equal(monthPosition(2024, 1, range), "inside");
  assert.equal(monthPosition(1969, 12, range), "before");
});

test("a service date can never be in the past", () => {
  // The same rule, on the other side of today — one clamp serves both fields.
  const range = futureRange(new Date(2024, 1, 20)); // 20 February 2024

  assert.deepEqual(selectableDayRange(2024, 2, range), [20, 29], "this month starts at today");
  assert.deepEqual(selectableDayRange(2024, 3, range), [1, 31], "next month is whole");
  assert.equal(selectableDayRange(2024, 1, range), null, "last month is gone");
  assert.deepEqual(
    selectableDayRange(2025, 2, range),
    [1, 20],
    "and the far end stops exactly a year out"
  );
  assert.equal(selectableDayRange(2025, 3, range), null, "past the horizon is out of range");

  assert.equal(monthPosition(2024, 1, range), "before");
  assert.equal(monthPosition(2024, 2, range), "inside");
  assert.equal(monthPosition(2025, 2, range), "inside");
  assert.equal(monthPosition(2025, 3, range), "after");
});

test("the year list spans the range, and keeps a stored oddity visible", () => {
  const today = new Date(2024, 1, 20);
  const past = yearsInRange(pastRange(today));

  assert.equal(past[0], 2024, "newest first");
  assert.equal(past[past.length - 1], MIN_PURCHASE_YEAR);
  assert.equal(past.includes(2025), false, "an appliance cannot be bought next year");
  assert.deepEqual([...past].sort((a, b) => b - a), past, "strictly descending");

  // A stored value outside the range still has to be visible, or editing that row
  // would silently rewrite its date.
  assert.equal(yearsInRange(pastRange(today), 2030)[0], 2030);

  const future = yearsInRange(futureRange(today));
  assert.deepEqual(future, [2025, 2024], "the service horizon crosses one year boundary");
});

test("a warranty expiry may be either side of today", () => {
  // The one date field that is not bounded by today: a warranty may already have run
  // out, which is exactly why the customer is being asked for it.
  const range = anyRange(new Date(2024, 1, 20));

  assert.equal(MAX_WARRANTY_YEARS, 10);
  assert.deepEqual(selectableDayRange(2024, 2, range), [1, 29], "today is not a boundary here");
  assert.deepEqual(selectableDayRange(2023, 2, range), [1, 28], "an expired warranty is fine");
  assert.deepEqual(selectableDayRange(2034, 2, range), [1, 20], "the ceiling is ten years, exactly");
  assert.equal(selectableDayRange(2034, 3, range), null, "and ten years out is not");
});

test("today is always a legal date for both fields", () => {
  // The boundary the two ranges meet at: today is the last purchase date and the first
  // service date, so neither field may exclude it.
  const today = startOfToday();
  const year = today.getFullYear();
  const month = today.getMonth() + 1;
  const day = today.getDate();

  const past = selectableDayRange(year, month, pastRange(today));
  assert.ok(past[0] <= day && past[1] >= day, "today is selectable as a purchase date");
  const future = selectableDayRange(year, month, futureRange(today));
  assert.ok(future[0] <= day && future[1] >= day, "today is selectable as a service date");
});

// -------------------------------------------------- 3. the caps are wired in

test("both screens cap the identifiers in the field", () => {
  for (const [name, source] of [
    [WIZARD, wizard],
    [PAGE, page],
  ]) {
    assert.match(
      source,
      /maxLength=\{MAX_MODEL_NUMBER_LENGTH\}/,
      `${name} must cap the model number`
    );
    assert.match(
      source,
      /maxLength=\{MAX_SERIAL_NUMBER_LENGTH\}/,
      `${name} must cap the serial number`
    );
    assert.match(
      source,
      /<FieldCounter value=\{.*\} max=\{MAX_\w+_LENGTH\} \/>/,
      `${name} must explain the cap rather than stop typing silently`
    );
    assert.match(
      source,
      /sanitiseCodeInput\(e\.target\.value, MAX_(MODEL|SERIAL)_NUMBER_LENGTH\)/,
      `${name} must drop characters that cannot appear on a rating label`
    );
  }
});

test("both screens clean the identifiers on the way into the payload", () => {
  assert.match(wizard, /model_number: cleanCode\(modelNumber, MAX_MODEL_NUMBER_LENGTH\) \|\| null/);
  assert.match(wizard, /serial_number: cleanCode\(serialNumber, MAX_SERIAL_NUMBER_LENGTH\) \|\| null/);
  assert.match(page, /model_number: cleanCode\(form\.model_number, MAX_MODEL_NUMBER_LENGTH\) \|\| null/);
  assert.match(page, /serial_number: cleanCode\(form\.serial_number, MAX_SERIAL_NUMBER_LENGTH\) \|\| null/);
});

// -------------------------------------------------- 4. the preferred time window

test("a clock time survives the round trip", () => {
  assert.equal(toClockTime(9, 5), "09:05");
  assert.equal(toClockTime(0, 0), "00:00");
  assert.equal(toClockTime(23, 55), "23:55");
  assert.equal(minutesOfDay("09:05"), 545);
  assert.equal(minutesOfDay("9:05"), 545, "a one-digit hour is accepted, as the API accepts it");
  assert.equal(minutesOfDay("24:00"), null);
  assert.equal(minutesOfDay("09:60"), null);
  assert.equal(minutesOfDay(""), null);
  assert.equal(minutesOfDay(null), null);
});

test("the 12-hour picker and the 24-hour payload agree", () => {
  assert.equal(hour12Of(0), 12, "midnight is 12 AM");
  assert.equal(hour12Of(12), 12, "noon is 12 PM");
  assert.equal(hour12Of(13), 1);
  assert.equal(meridiemOf(0), "AM");
  assert.equal(meridiemOf(11), "AM");
  assert.equal(meridiemOf(12), "PM");
  assert.equal(meridiemOf(23), "PM");
  assert.equal(hour24Of(12, "AM"), 0);
  assert.equal(hour24Of(12, "PM"), 12);
  assert.equal(hour24Of(1, "PM"), 13);

  // Every step of the day, through the picker and back: the value the customer sees and
  // the value the API receives must be the same time.
  for (let hour = 0; hour < 24; hour++) {
    for (const minute of [0, 5, 30, 55]) {
      const chosen = toClockTime(hour, minute);
      const rebuilt = toClockTime(hour24Of(hour12Of(hour), meridiemOf(hour)), minute);
      assert.equal(rebuilt, chosen);
    }
  }

  assert.equal(formatClockTime("09:00"), "9:00 AM");
  assert.equal(formatClockTime("13:30"), "1:30 PM");
  assert.equal(formatClockTime("00:00"), "12:00 AM");
  assert.equal(formatClockTime(""), "");
});

test("the window is a five-minute grid", () => {
  const all = timeOptions();
  assert.equal(all.length, 288, "24 hours at five-minute steps");
  assert.deepEqual(all[0], { hour: 0, minute: 0 });
  assert.deepEqual(all[1], { hour: 0, minute: 5 });
  assert.deepEqual(all[all.length - 1], { hour: 23, minute: 55 });
});

test("an end time can only be a time that follows the start", () => {
  // readRequestedWindow() drops a window whose end is not strictly later — the request
  // still submits, the stated preference just disappears. So the picker must never offer
  // such a pair in the first place.
  const after = timeOptions("09:00");
  assert.deepEqual(after[0], { hour: 9, minute: 5 }, "09:00 itself is not a legal end");
  assert.equal(after.some((option) => option.hour === 8), false, "nor is anything earlier");

  assert.equal(isAfter("09:00", "11:00"), true);
  assert.equal(isAfter("09:00", "09:05"), true);
  assert.equal(isAfter("09:00", "09:00"), false, "equal is not a window");
  assert.equal(isAfter("09:00", "08:55"), false);
  assert.equal(isAfter("", "11:00"), false, "no start, no window");
  assert.equal(isAfter("09:00", ""), false);
  assert.equal(timeOptions("23:55").length, 0, "nothing is left after the last step");
});

test("a partial pick only offers times that exist", () => {
  const valid = timeOptions("09:00");
  assert.equal(optionsFor(valid, { hour12: 9, meridiem: "AM" })[0].minute, 5, "the 9 AM block starts at :05");
  assert.equal(optionsFor(valid, { hour12: 10, meridiem: "AM" })[0].minute, 0, "10 AM is whole");
  assert.equal(optionsFor(valid, { hour12: 10, meridiem: "AM" }).length, 12);
  assert.equal(optionsFor(valid, { hour12: 8, meridiem: "AM" }).length, 0, "8 AM is gone entirely");
});

test("a stored time from Postgres reads back too", () => {
  // A `time` column returns "09:00:00". The same parser has to accept it, or the
  // availability list would print blanks.
  assert.equal(minutesOfDay("09:00:00"), 540);
  assert.equal(formatClockTime("09:00:00"), "9:00 AM");
  assert.equal(formatClockTime("17:30:00"), "5:30 PM");
});

test("working hours use a coarser grid than a visit window", () => {
  const quarter = timeOptions("09:00", 15);
  assert.deepEqual(quarter[0], { hour: 9, minute: 15 });
  assert.equal(quarter.length, 59, "quarter-hour steps from 09:15 to 23:45");
  assert.equal(timeOptions(undefined, 15).length, 96, "a whole day in quarter hours");
});

test("the availability grid picks its times from selects", () => {
  assert.match(availability, /<TimeSelect[\s\S]{0,200}id="window-start"/);
  assert.match(availability, /<TimeSelect[\s\S]{0,200}id="window-end"/);
  assert.match(availability, /after=\{startTime\}/, "the end is constrained by the start");
  assert.match(
    availability,
    /variant="single"/,
    "the compact variant: two three-select pickers will not fit one scheduling row"
  );
  assert.match(availability, /step=\{15\}/, "quarter-hour steps for working hours");
  assert.doesNotMatch(availability, /type="time"/, "no native time input is left");
  assert.doesNotMatch(
    availability,
    /function prettyTime/,
    "its own 12-hour formatter is gone — formatClockTime() is the one definition"
  );
});

test("the hour choices ARE the shop's day, and nothing else", () => {
  const hours = windowHours(serviceClockTimes());

  assert.deepEqual(
    hours.map((hour) => hour.hour),
    [9, 10, 11, 13, 14, 15, 16],
    "the shop's own hours, 9 AM to 4 PM with the lunch hour left out"
  );
  assert.deepEqual(
    hours.map((hour) => hour.label),
    ["9 AM", "10 AM", "11 AM", "1 PM", "2 PM", "3 PM", "4 PM"],
    "each hour carries its own half of the day"
  );

  // THE POINT OF THE REDESIGN. The AM/PM is a property of the hour rather than a third
  // control, so 9 PM (21) and 4 AM (4) are not on any list to be refused: they cannot
  // be assembled from these options at all.
  assert.equal(hours.some((hour) => hour.hour === 21), false, "9 PM is not an option");
  assert.equal(hours.some((hour) => hour.hour === 4), false, "nor is 4 AM");
  for (const hour of hours) {
    assert.equal(hour.meridiem, hour.hour < 12 ? "AM" : "PM", "the label follows the hour");
    assert.equal(hour.label, `${hour.hour12} ${hour.meridiem}`);
  }

  // THE COUNT IS ARITHMETIC ON THE DECLARED HOURS, not a number copied from the module:
  // widen the day in SERVICE_HOURS and both sides of this assertion move together.
  const open = minutesOfDay(SERVICE_HOURS.opens);
  const close = minutesOfDay(SERVICE_HOURS.closes);
  const breakStart = minutesOfDay(SERVICE_HOURS.break.start);
  const breakEnd = minutesOfDay(SERVICE_HOURS.break.end);
  assert.equal(hours.length, (breakStart - open) / 60 + 1 + (close - breakEnd) / 60 + 1);
  assert.equal(hours[0].hour * 60, open, "the first option opens when the shop does");
  assert.equal(hours[hours.length - 1].hour * 60, close, "the last one closes when it does");
});

test("the start and end pools never leave the day or cross lunch", () => {
  const starts = windowStartTimes();

  // A start is only offered when a legal end exists after it, inside its own block:
  // 11:00 AM runs into the break and 4:00 PM closes the shop, so neither can start.
  assert.equal(starts[0].hour, 9);
  assert.equal(starts[starts.length - 1].hour, 15);
  assert.equal(starts[starts.length - 1].minute, 55, "3:55 PM is the last legal start");
  assert.equal(starts.some((time) => toClockTime(time.hour, time.minute) === "11:00"), false);
  assert.equal(starts.some((time) => toClockTime(time.hour, time.minute) === "16:00"), false);

  for (const start of starts) {
    const from = toClockTime(start.hour, start.minute);
    const ends = windowEndTimes(from);
    assert.equal(ends.length > 0, true, `${from} is only offered because an end exists`);
    for (const end of ends) {
      assert.equal(
        isServiceRange(from, toClockTime(end.hour, end.minute)),
        true,
        `${from} to ${toClockTime(end.hour, end.minute)} must satisfy the rule it is built from`
      );
    }
  }

  // THE BLOCK BOUND. A 10:30 AM start offers ends up to 11:00 AM and no further, so the
  // lunch-crossing window that used to be offerable — and then dropped in silence by the
  // form and again by the API — is not on any list at all.
  const morningEnds = windowEndTimes("10:30").map((time) => toClockTime(time.hour, time.minute));
  assert.deepEqual(morningEnds.slice(0, 3), ["10:35", "10:40", "10:45"]);
  assert.equal(morningEnds[morningEnds.length - 1], "11:00");
  assert.equal(morningEnds.includes("13:00"), false, "the other block is not reachable");

  const afternoonEnds = windowEndTimes("13:00").map((time) => toClockTime(time.hour, time.minute));
  assert.equal(afternoonEnds[0], "13:05");
  assert.equal(afternoonEnds[afternoonEnds.length - 1], "16:00");

  // Nothing to end with before a start is chosen, which is why the end box stays shut.
  assert.deepEqual(windowEndTimes(""), []);
  assert.deepEqual(windowEndTimes(null), []);

  // The minutes offered for one hour are that hour's own grid, and the whole day is a
  // five-minute grid: twelve minutes to the hour.
  const nine = windowMinutes(serviceClockTimes(), 9);
  assert.deepEqual(nine.slice(0, 3), [0, 5, 10]);
  assert.equal(nine[nine.length - 1], 55);
  assert.equal(windowMinutes(serviceClockTimes(), null).length, 12);
});

test("a window is legal only inside the working day", () => {
  for (const [start, end] of [
    ["09:00", "11:00"],
    ["13:00", "16:00"],
    ["09:20", "10:20"], // the reason this module exists: a time no preset list names
    ["15:30", "16:00"],
    ["13:05", "13:10"],
  ]) {
    assert.equal(isServiceRange(start, end), true, `${start}-${end} should be accepted`);
  }

  for (const [start, end, why] of [
    ["01:00", "02:00", "before the shop opens"],
    ["08:55", "09:30", "starts before opening"],
    ["15:30", "16:30", "runs past closing"],
    ["11:30", "12:30", "entirely inside the lunch break"],
    ["10:30", "13:30", "crosses the break, so no technician is free for the whole span"],
    ["10:00", "10:00", "an empty window"],
    ["10:00", "09:00", "an inverted window"],
    ["", "", "nothing chosen"],
    [null, null, "no value at all"],
  ]) {
    assert.equal(isServiceRange(start, end), false, `${start}-${end} should be refused: ${why}`);
  }
});

test("a named time is any five minutes of the working day", () => {
  const times = serviceClockTimes();

  assert.deepEqual(times[0], { hour: 9, minute: 0 });
  assert.deepEqual(times[times.length - 1], { hour: 16, minute: 0 });
  assert.equal(CLOCK_STEP_MINUTES, 5);
  // 09:00–11:00 and 13:00–16:00 inclusive at five-minute steps: 25 + 37.
  assert.equal(times.length, 62, "the open hours, less the lunch break");

  const open = minutesOfDay(SERVICE_HOURS.opens);
  const close = minutesOfDay(SERVICE_HOURS.closes);
  const breakStart = minutesOfDay(SERVICE_HOURS.break.start);
  const breakEnd = minutesOfDay(SERVICE_HOURS.break.end);

  for (const time of times) {
    const minute = minutesOfDay(toClockTime(time.hour, time.minute));
    assert.equal(minute >= open && minute <= close, true, "every offered time is inside the day");
    assert.equal(
      minute > breakStart && minute < breakEnd,
      false,
      "and none is stranded inside the break, where no window could use it"
    );
  }

  // Both boundaries stay: each is a legal END even though neither can start a window.
  assert.equal(
    times.some((time) => toClockTime(time.hour, time.minute) === SERVICE_HOURS.break.start),
    true,
    "10:30–11:00 is a real window, so 11:00 has to be reachable as an end"
  );
  assert.equal(isServiceRange("11:00", "11:30"), false, "but it cannot start one");
  assert.equal(isServiceRange("16:00", "16:30"), false, "nor can closing time");
});

test("a pair of picks resolves to exactly one window", () => {
  assert.equal(resolveWindowPair("", ""), null, "any time that day means no window at all");
  assert.equal(resolveWindowPair("09:20", ""), null, "half a window is no window");
  assert.equal(resolveWindowPair("", "10:20"), null, "nor is the other half on its own");

  assert.deepEqual(resolveWindowPair("09:20", "10:20"), { start: "09:20", end: "10:20" });
  assert.equal(resolveWindowPair("10:30", "13:30"), null, "nor is one across lunch");
  assert.equal(resolveWindowPair("10:00", "10:00"), null, "an empty window is not a window");
  assert.equal(resolveWindowPair("13:00", "09:00"), null, "nor is an inverted one");
  assert.equal(resolveWindowPair("01:00", "02:00"), null, "nor is one outside the hours");

  // The one-tap fills are the day's own blocks, so they always resolve to a real window.
  for (const window of FLEXIBLE_WINDOWS) {
    assert.deepEqual(resolveWindowPair(window.start, window.end), {
      start: window.start,
      end: window.end,
    });
  }
  assert.equal(FLEXIBLE_WINDOWS.length, 2);

  assert.equal(windowLabel("09:20", "10:20"), "9:20 AM – 10:20 AM");
  assert.equal(windowLabel("13:00", "16:00"), "1:00 PM – 4:00 PM");
  assert.equal(windowLabel("", ""), "");

  // The appointment length is NOT the window: a half-hour arrival window does not shrink
  // the visit, and a three-hour "any time this afternoon" window does not ring-fence
  // three hours of a technician's day.
  assert.equal(REQUEST_DURATION_MINUTES, 120);
});

test("the window is two hour + minute boxes, with the AM/PM implied", () => {
  assert.match(
    wizard,
    /<ServiceWindowFields[\s\S]{0,300}start=\{windowStart\}/,
    "the form holds the pair, not a choice key"
  );
  assert.match(wizard, /onEndChange=\{setWindowEnd\}/);
  assert.match(wizard, /disabled=\{!preferredDate\}/, "no window before a date is chosen");
  assert.match(
    wizard,
    /<legend[\s\S]{0,120}Preferred time window/,
    "labelled as a fieldset legend, since two controls cannot share one htmlFor"
  );
  assert.doesNotMatch(
    wizard,
    /windowChoice|customStart|customEnd|ServiceWindowSelect|TimeSelect/,
    "the dropdown and the six-select pickers are gone"
  );
  assert.doesNotMatch(wizard, /type="time"/, "no native time input is left");
  assert.match(
    wizard,
    /requested_duration_minutes: REQUEST_DURATION_MINUTES/,
    "the visit keeps its length whatever the window is"
  );

  // The component itself: an hour box and a minute box per boundary, and NO AM/PM
  // control. The half of the day is read off the hour, which is what makes 9 PM and
  // 4 AM unrepresentable rather than merely refused.
  assert.match(windowFields, /`\$\{id\}-hour`/);
  assert.match(windowFields, /`\$\{id\}-minute`/);
  assert.doesNotMatch(windowFields, /-meridiem/, "there is no AM/PM select");
  assert.match(windowFields, /meridiemOf\(hour\)/, "the badge states the half of the day");
  assert.match(windowFields, /label="Earliest arrival"/);
  assert.match(windowFields, /label="Latest arrival"/);

  assert.match(
    windowFields,
    /const START_TIMES = windowStartTimes\(\)/,
    "the pool is computed once, not per render"
  );
  assert.match(windowFields, /const START_HOURS = windowHours\(START_TIMES\)/);
  assert.match(windowFields, /windowEndTimes\(start\)/, "the end pool follows the start");
  assert.match(
    windowFields,
    /disabled=\{disabled \|\| !start\}/,
    "the end box stays shut until a start exists, so no half-filled pair can be held"
  );
  assert.match(
    windowFields,
    /FLEXIBLE_WINDOWS\.map/,
    "the one-tap fills are the day's own blocks, not a list typed into the component"
  );
  assert.match(windowFields, /Any time/, "and there is a way back to no preference");
  assert.match(
    windowFields,
    /if \(end && !stillLegal\) onEndChange\(""\)/,
    "moving the start past the end clears it, rather than leaving a window the API drops"
  );

  // The removed dropdown is gone outright, so a stale import fails at build time
  // instead of quietly rendering the old control again.
  assert.throws(
    () => readFileSync(new URL("src/components/ServiceWindowSelect.tsx", ROOT), "utf8"),
    { code: "ENOENT" },
    "the old dropdown cannot be rendered again"
  );
});

test("the API enforces the same hours as the form", () => {
  const serviceTime = readFileSync(new URL(SERVICE_TIME, ROOT), "utf8");

  assert.match(
    serviceTime,
    /import \{ isServiceRange \} from "@\/lib\/service-windows"/,
    "one rule, imported rather than restated"
  );
  assert.match(
    serviceTime,
    /if \(!isServiceRange\(preferredStart, preferredEnd\)\)/,
    "a window outside the hours is dropped before it reaches the database"
  );
});

test("every date field is picked, not typed", () => {
  for (const [name, source] of [
    [WIZARD, wizard],
    [PAGE, page],
  ]) {
    assert.match(
      source,
      /<DateSelect[\s\S]{0,140}id="appliance-purchase-date"/,
      `${name} must use the shared picker for the purchase date`
    );
    assert.match(
      source,
      /<DateSelect[\s\S]{0,140}id="warranty-expiry"/,
      `${name} must use it for the warranty expiry too`
    );
    assert.equal(
      [...source.matchAll(/id="appliance-purchase-date"/g)].length,
      1,
      `${name} must not also keep a native input with the same id`
    );
    assert.doesNotMatch(
      source,
      /type="date"/,
      `${name} still has a native date input: on Firefox that is spinner segments with no calendar at all`
    );
    assert.doesNotMatch(
      source,
      /label htmlFor="appliance-purchase-date"/,
      `${name} must let the picker own its own label, or the field is labelled twice`
    );
  }

  // The wizard's other date fields: the requested service date (today .. a year ahead)
  // and the warranty expiry (either side of today).
  assert.match(
    wizard,
    /<DateSelect[\s\S]{0,160}id="preferred-date"/,
    "the service date must use the shared picker too"
  );
  assert.match(wizard, /direction="future"/);
  assert.match(wizard, /direction="any"/);
  assert.match(wizard, /direction="past"/);

  // Three selects, in the order a date is spoken: month, day, year.
  assert.match(dateSelect, /id=\{`\$\{id\}-month`\}/);
  assert.match(dateSelect, /id=\{`\$\{id\}-day`\}/);
  assert.match(dateSelect, /id=\{`\$\{id\}-year`\}/);
  assert.match(dateSelect, /aria-label=\{`\$\{label\} month`\}/);
  assert.match(
    dateSelect,
    /onChange=\{\(e\) => chooseMonth\(Number\(e\.target\.value\)\)\}/,
    "changing the month re-clamps the day"
  );
  assert.match(
    dateSelect,
    /direction === "future"\) return futureRange\(today\)/,
    "all three directions take their bounds from the lib, so they cannot drift apart"
  );
  assert.match(
    dateSelect,
    /disabled=\{chosen && !bounds\}/,
    "a month that has not happened disables the day list"
  );
});

