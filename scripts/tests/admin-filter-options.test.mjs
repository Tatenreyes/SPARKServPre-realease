/**
 * Contract tests for the one admin filter vocabulary.
 *
 *   npm run test:admin-filters
 *
 * WHY THIS EXISTS. Filtering was improvised per screen: the technician queue had
 * a local chip row with its own order and its own styling, and every other admin
 * list had no filter at all, so "show me the live jobs" or "only the technical
 * issues" could only be answered by reading the whole table. The control is now a
 * dropdown of checkboxes per facet, and the rules that matter are exactly the ones
 * a hurried edit would break:
 *
 *   1. every facet offers its full vocabulary, `All` first, then A→Z by LABEL, so
 *      the control never changes shape and never exposes the database's enum order;
 *   2. a facet is MULTI-SELECT: two ticks are an OR inside the facet, and facets
 *      are ANDed with each other;
 *   3. a count answers the question the tick raises — "how many rows would I see if
 *      I ticked this AS WELL?" — so ticking a second option counts the union;
 *   4. a bucket ("Active") is one option over several values, taken from the shared
 *      status list rather than re-typed;
 *   5. a value the vocabulary does not know still gets a box, while a value typed
 *      into the URL that no option matches is dropped rather than showing nothing;
 *   6. the selection survives a round trip through the query string.
 *
 * The module is imported for real under Node's type stripping, so there is no
 * second copy of the rules to drift. The page assertions are source-level because
 * this repository has no component runner (see TESTING.md §5).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  ALL_FILTER_VALUE,
  buildFacets,
  humanizeFilterValue,
  resolveActive,
  rowMatches,
  rowPasses,
  selectionParam,
  selectionQuery,
  toggleFilterOption,
} from "../../src/lib/filter-options.ts";
import { ACTIVE_BOOKING_STATUSES } from "../../src/lib/booking-status.ts";

const ROOT = new URL("../../", import.meta.url);
const source = (path) => readFileSync(new URL(path, ROOT), "utf8");

// A small stand-in for the payments queue: two statuses, three rows.
const ROWS = [
  { id: "p1", status: "pending_verification", covered: "not_covered" },
  { id: "p2", status: "confirmed", covered: "covered" },
  { id: "p3", status: "confirmed", covered: "covered" },
];

const SPECS = [
  {
    key: "status",
    label: "Status",
    values: ["pending_verification", "confirmed", "rejected"],
    get: (row) => row.status,
  },
  {
    key: "warranty",
    label: "Warranty",
    values: ["covered", "not_covered"],
    labels: { covered: "Covered", not_covered: "Not covered" },
    get: (row) => row.covered,
  },
];

const labels = (group) => group.options.map((option) => option.label);
const option = (group, key) => group.options.find((candidate) => candidate.key === key);
const ids = (rows) => rows.map((row) => row.id);

// ------------------------------------------------- 1. All first, then alphabetical

test("All is pinned first and carries the true total", () => {
  const [status] = buildFacets(SPECS, ROWS);
  assert.equal(status.options[0].key, ALL_FILTER_VALUE);
  assert.equal(status.options[0].label, "All");
  assert.equal(status.options[0].count, 3);
  assert.equal(status.options[0].selected, true, "an untouched facet reads as All");
});

test("the rest of the list is alphabetical by label, not by the enum order", () => {
  const [status] = buildFacets(SPECS, ROWS);
  // The vocabulary was given as pending_verification, confirmed, rejected.
  assert.deepEqual(labels(status).slice(1), ["Confirmed", "Pending verification", "Rejected"]);
});

test("the labels come from the caller, and a missing one is humanised", () => {
  const [status] = buildFacets(SPECS, ROWS);
  assert.equal(option(status, "pending_verification").label, "Pending verification");
  assert.equal(humanizeFilterValue("awaiting_inspection"), "Awaiting inspection");
  // Every underscore, not just the first.
  assert.equal(humanizeFilterValue("waiting_for_technician"), "Waiting for technician");
});

test("a vocabulary value with no rows still gets a box, showing zero", () => {
  const [status] = buildFacets(SPECS, ROWS);
  assert.equal(option(status, "rejected").count, 0);
});

// ------------------------------------------------- 2. multi-select

test("two ticks in one facet are an OR", () => {
  const selected = { status: ["pending_verification", "confirmed"] };
  assert.deepEqual(
    ids(ROWS.filter((row) => rowMatches(SPECS, row, selected))),
    ["p1", "p2", "p3"]
  );
  // One tick is a subset of that.
  assert.deepEqual(ids(ROWS.filter((row) => rowMatches(SPECS, row, { status: ["confirmed"] }))), [
    "p2",
    "p3",
  ]);
});

test("facets are ANDed with each other", () => {
  assert.deepEqual(
    ids(ROWS.filter((row) => rowMatches(SPECS, row, { status: ["confirmed"], warranty: ["not_covered"] }))),
    []
  );
  assert.deepEqual(
    ids(ROWS.filter((row) => rowMatches(SPECS, row, { status: ["confirmed"], warranty: ["covered"] }))),
    ["p2", "p3"]
  );
});

test("a ticked option is reported as ticked, and All stops being ticked", () => {
  const [status] = buildFacets(SPECS, ROWS, { status: ["confirmed"] });
  assert.equal(option(status, "confirmed").selected, true);
  assert.equal(option(status, "pending_verification").selected, false);
  assert.equal(option(status, ALL_FILTER_VALUE).selected, false);
});

// ------------------------------------------------- 3. honest (faceted) counts

test("a count answers 'how many if I tick this as well' — the union, not a replacement", () => {
  const [status, warranty] = buildFacets(SPECS, ROWS, { status: ["confirmed"] });

  // The status facet ignores its own selection for its own numbers, because with
  // multi-select a tick ADDS: "Pending verification" would show the union of what
  // is ticked and itself, which is the whole table here.
  assert.equal(option(status, "confirmed").count, 2);
  assert.equal(option(status, "pending_verification").count, 3);
  assert.equal(option(status, ALL_FILTER_VALUE).count, 3);

  // The warranty facet IS narrowed by the status selection: of the confirmed rows,
  // both are covered.
  assert.equal(option(warranty, "covered").count, 2);
  assert.equal(option(warranty, "not_covered").count, 0);
});

test("the All box of a narrowed facet counts what is left, not everything", () => {
  const [, warranty] = buildFacets(SPECS, ROWS, { status: ["pending_verification"] });
  assert.equal(warranty.options[0].count, 1);
});

// ------------------------------------------------- 4. buckets

test("a bucket is one option over several values", () => {
  const specs = [
    {
      key: "status",
      label: "Status",
      values: ACTIVE_BOOKING_STATUSES,
      buckets: [{ key: "active", label: "Active", values: [...ACTIVE_BOOKING_STATUSES] }],
      get: (row) => row.status,
    },
  ];
  const rows = [{ status: "pending" }, { status: "in_progress" }, { status: "completed" }];
  const [status] = buildFacets(specs, rows);

  assert.equal(option(status, "active").count, 2);
  assert.equal(status.options[0].count, 3);
  // "Active" sorts among the labels it sits beside (All is dropped first).
  assert.deepEqual(labels(status).slice(1, 3), ["Active", "Awaiting inspection"]);
});

test("a bucket key matches any of its values, and a bare value matches exactly", () => {
  const spec = {
    key: "status",
    label: "Status",
    values: ["pending", "completed"],
    buckets: [{ key: "active", label: "Active", values: ["pending", "in_progress"] }],
    get: (row) => row.status,
  };
  assert.equal(rowPasses(spec, { status: "in_progress" }, ["active"]), true);
  assert.equal(rowPasses(spec, { status: "completed" }, ["active"]), false);
  assert.equal(rowPasses(spec, { status: "pending" }, ["pending"]), true);
  // A bucket and a value ticked together still pass either one.
  assert.equal(rowPasses(spec, { status: "completed" }, ["active", "completed"]), true);
  // Nothing ticked passes everything.
  assert.equal(rowPasses(spec, { status: "pending" }, []), true);
  assert.equal(rowPasses(spec, { status: "pending" }, undefined), true);
});

// ------------------------------------------------- 5. unknown values, and the URL

test("a value the vocabulary does not know still gets a box", () => {
  const rows = [...ROWS, { id: "p4", status: "refunded", covered: "not_covered" }];
  const [status] = buildFacets(SPECS, rows);
  assert.equal(option(status, "refunded").label, "Refunded");
  assert.equal(option(status, "refunded").count, 1);
});

test("a value typed into the URL that no option matches is dropped", () => {
  assert.deepEqual(resolveActive(SPECS, { status: "deleted", warranty: "covered" }), {
    status: [],
    warranty: ["covered"],
  });
  // A bucket key is a legitimate selection even though it is not a vocabulary value.
  const specs = [
    {
      key: "status",
      label: "Status",
      values: ["pending"],
      buckets: [{ key: "active", label: "Active", values: ["pending"] }],
      get: (row) => row.status,
    },
  ];
  assert.deepEqual(resolveActive(specs, { status: "active" }).status, ["active"]);
});

test("a multi-select facet survives the round trip through the query string", () => {
  const groups = buildFacets(SPECS, ROWS);
  const selection = { status: ["open_ish", "confirmed"], warranty: ["covered"] };

  const param = selectionParam(selection.status);
  assert.equal(param, "open_ish,confirmed");

  const query = selectionQuery(groups, selection);
  assert.equal(query, "status=open_ish%2Cconfirmed&warranty=covered");

  // Read back exactly what was written, for the keys the facet knows.
  const parsed = Object.fromEntries(new URLSearchParams(query));
  assert.deepEqual(resolveActive(SPECS, parsed), {
    status: ["confirmed"],
    warranty: ["covered"],
  });

  // Nothing ticked produces no parameters at all, not an empty one.
  assert.equal(selectionQuery(groups, {}), "");
  assert.equal(selectionParam([]), undefined);
  assert.equal(selectionParam(undefined), undefined);
});

test("toggling an option adds it, removes it, and All clears the facet", () => {
  const one = toggleFilterOption({}, "status", "confirmed");
  assert.deepEqual(one, { status: ["confirmed"] });

  const two = toggleFilterOption(one, "status", "pending_verification");
  assert.deepEqual(two.status, ["confirmed", "pending_verification"], "tick order is preserved");

  const back = toggleFilterOption(two, "status", "confirmed");
  assert.deepEqual(back.status, ["pending_verification"]);

  assert.deepEqual(toggleFilterOption(two, "status", ALL_FILTER_VALUE).status, []);
  // Clearing one facet leaves the others alone.
  const both = toggleFilterOption(two, "warranty", "covered");
  assert.deepEqual(toggleFilterOption(both, "status", ALL_FILTER_VALUE), {
    status: [],
    warranty: ["covered"],
  });
});

// ------------------------------------------------- 6. the declared order wins

test("a declared severity order wins over alphabetical", () => {
  const specs = [
    {
      key: "priority",
      label: "Priority",
      values: ["low", "medium", "high", "critical"],
      order: ["critical", "high", "medium", "low"],
      get: (row) => row.priority,
    },
  ];
  const [priority] = buildFacets(specs, [{ priority: "low" }]);
  assert.deepEqual(labels(priority).slice(1), ["Critical", "High", "Medium", "Low"]);
});

// ------------------------------------------------- 7. the control is wired everywhere

test("every admin list uses the checkbox dropdown", () => {
  const clientLists = [
    "src/components/AdminPaymentsClient.tsx",
    "src/components/AdminServiceConcernsClient.tsx",
    "src/components/UserManagementClient.tsx",
  ];
  for (const path of clientLists) {
    const file = source(path);
    assert.match(file, /from "@\/components\/FilterDropdown"/, `${path} must use the shared control`);
    assert.match(file, /buildFacets/, `${path} must build its facets from the shared rules`);
    assert.match(file, /type FilterSelection/, `${path} must hold a multi-select selection`);
  }

  const serverLists = [
    "src/app/admin/job-monitoring/page.tsx",
    "src/app/admin/progress/page.tsx",
    "src/app/admin/technicians/page.tsx",
  ];
  for (const path of serverLists) {
    const file = source(path);
    assert.match(file, /FilterDropdownLinks/, `${path} must use the navigating variant`);
    assert.match(file, /resolveActive/, `${path} must clamp the URL before it filters`);
    assert.match(file, /basePath="\/admin\//, `${path} must tell the control where to navigate`);
  }
});

test("the control is a disclosure with real checkboxes, not a link list", () => {
  const control = source("src/components/FilterDropdown.tsx");
  assert.match(control, /type="checkbox"/, "each option is a checkbox");
  assert.match(control, /aria-expanded=\{open\}/, "the trigger reports its state");
  assert.match(control, /aria-controls=\{panelId\}/, "and points at the panel it opens");
  assert.match(control, /event\.key === "Escape"/, "Escape closes the panel");
  assert.match(control, /mousedown/, "and a click outside does too");
  assert.match(control, /scroll: false/, "a navigation keeps the reader where they were");
  // The old single-choice chip bar is gone: a facet must not go back to one choice.
  assert.doesNotMatch(control, /aria-pressed/, "a checkbox set is not a pressed-button set");
});

test("the technician queue shares the chip instead of hand-rolling one", () => {
  const queue = source("src/app/admin/technician-queue/page.tsx");
  assert.match(queue, /filterChipClass/, "the queue must use the shared chip recipe");
  // The old local chip painted its own active state; a second definition is how
  // the two controls drifted apart in the first place.
  assert.doesNotMatch(queue, /border-brand-600 bg-brand-600 text-white/);
});



