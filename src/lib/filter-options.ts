/**
 * The one vocabulary for every admin filter.
 *
 * WHY THIS EXISTS. Filtering was improvised per screen: the technician queue had
 * a local chip row with its own order and its own styling, and every other admin
 * list had no filter at all, so "show me the live jobs" or "only the technical
 * issues" could only be answered by reading the whole table. A filter is a claim
 * about the data, so the claim lives here, once, with the rules written down and
 * tested (`scripts/tests/admin-filter-options.test.mjs`):
 *
 *   * every facet offers its FULL vocabulary, `All` first, so the control never
 *     changes shape as the data does;
 *   * the options after `All` are sorted A→Z by their LABEL, so a filter is
 *     scannable without knowing the database's enum order (an enum order is a
 *     schema detail, and it read as a random sequence on screen);
 *   * a facet may carry BUCKETS — one option spanning several values. "Active" is
 *     `pending + in_progress + awaiting_inspection + awaiting_payment`, taken from
 *     `ACTIVE_BOOKING_STATUSES` so the option and the "Active Jobs" tile can never
 *     disagree about what active means;
 *   * a facet is MULTI-SELECT: ticking two statuses is an OR inside the facet, and
 *     facets are ANDed with each other. "Open and In progress, technical issues"
 *     is two ticks and nothing else;
 *   * counts are FACETED, and they answer the question the tick is about — "how
 *     many rows would I see if I ticked this as well?" — so they are computed
 *     against the rows passing the OTHER facets plus the selection already made in
 *     this one;
 *   * a value present in the data but missing from the vocabulary is appended
 *     rather than dropped, so a new database status can never become unfilterable.
 *
 * Deliberately dependency-free (no React, no Supabase, no `@/` runtime import) so
 * the same rules run in the pages and under Node's type stripping in the tests.
 */

/** The value that means "no filter". Reserved, so a real status can never collide with it. */
export const ALL_FILTER_VALUE = "all";

/** One option that stands for several row values ("Active", "Unavailable"). */
export interface FacetBucket {
  key: string;
  label: string;
  values: string[];
}

/** One dimension a list can be filtered by: Status, Type, Priority, Role, … */
export interface FacetSpec<T> {
  /** Stable key. This is the URL parameter (or the state key) for the facet. */
  key: string;
  /** What the facet is called on screen, e.g. "Status". */
  label: string;
  /** The vocabulary. Order here is irrelevant, the control sorts it. */
  values: readonly string[];
  /** Reads the row's value for this facet. */
  get: (row: T) => string;
  /** Display names. A missing value falls back to a humanised form of the raw value. */
  labels?: Record<string, string>;
  /** Options that span several values. */
  buckets?: readonly FacetBucket[];
  /**
   * Severity order for the options (most urgent first). When omitted the list is
   * alphabetical, which is right for every facet whose values have no ranking.
   */
  order?: readonly string[];
}

export interface FilterOption {
  key: string;
  label: string;
  /** The row values this option matches. Empty means "every row" (the All option). */
  values: string[];
  /** How many rows this option would show, given everything else selected. */
  count: number;
  /** Whether the option is currently ticked. */
  selected: boolean;
}

export interface FilterGroup {
  key: string;
  label: string;
  options: FilterOption[];
}

/** The ticked options per facet. A missing or empty array means "All". */
export type FilterSelection = Record<string, string[] | undefined>;

/** `"pending_verification"` → `"Pending verification"`. */
export function humanizeFilterValue(value: string): string {
  const spaced = value.replace(/_/g, " ").trim();
  if (!spaced) return value;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function labelFor<T>(spec: FacetSpec<T>, value: string): string {
  return spec.labels?.[value] ?? humanizeFilterValue(value);
}

/** The row values one option key stands for: a bucket's list, or the value itself. */
function valuesFor<T>(spec: FacetSpec<T>, key: string): string[] {
  const bucket = spec.buckets?.find((candidate) => candidate.key === key);
  return bucket ? bucket.values : [key];
}

/**
 * Does this row pass one facet? Nothing ticked passes everything; otherwise the
 * row must match ANY ticked option (an OR inside the facet).
 */
export function rowPasses<T>(spec: FacetSpec<T>, row: T, selected?: string[]): boolean {
  if (!selected?.length) return true;
  const value = spec.get(row);
  return selected.some((key) => valuesFor(spec, key).includes(value));
}

/** Does this row pass EVERY facet? This is the list the filter produces. */
export function rowMatches<T>(
  specs: readonly FacetSpec<T>[],
  row: T,
  selected: FilterSelection = {}
): boolean {
  return specs.every((spec) => rowPasses(spec, row, selected[spec.key]));
}


function sortOptions(options: FilterOption[], order?: readonly string[]): FilterOption[] {
  const [all, ...rest] = options;
  const rank = (option: FilterOption) => {
    if (!order) return null;
    const index = order.indexOf(option.key);
    return index === -1 ? null : index;
  };

  rest.sort((a, b) => {
    const rankA = rank(a);
    const rankB = rank(b);
    // A ranked facet (priority) keeps its severity order; an unranked one is
    // alphabetical. Values outside the declared order sort after the ranked ones.
    if (rankA !== null || rankB !== null) {
      if (rankA === null) return 1;
      if (rankB === null) return -1;
      if (rankA !== rankB) return rankA - rankB;
    }
    const byLabel = a.label.localeCompare(b.label, "en", { sensitivity: "base" });
    return byLabel !== 0 ? byLabel : a.key.localeCompare(b.key, "en");
  });

  return [all, ...rest];
}

/**
 * Build every facet for a list, with honest counts and the current tick state.
 *
 * A count answers the question a checkbox raises — "how many rows would I see if I
 * ticked this?" — so it is computed against the rows passing the OTHER facets plus
 * the selection already made in this one. Ticking a second status therefore shows
 * the size of the UNION, not of a replacement.
 */
export function buildFacets<T>(
  specs: readonly FacetSpec<T>[],
  rows: readonly T[],
  selected: FilterSelection = {}
): FilterGroup[] {
  return specs.map((spec) => {
    const ticked = selected[spec.key] ?? [];

    // The rows this facet's numbers start from: everything passing the other facets.
    const others = rows.filter((row) =>
      specs.every((other) => other.key === spec.key || rowPasses(other, row, selected[other.key]))
    );

    const present = new Set<string>();
    for (const value of spec.values) {
      if (value !== ALL_FILTER_VALUE) present.add(value);
    }
    // A value the vocabulary does not know about still gets a box: a status that
    // exists in the data but not here would otherwise be unreachable.
    for (const row of rows) {
      const value = spec.get(row);
      if (value && value !== ALL_FILTER_VALUE) present.add(value);
    }

    const countWith = (key: string) =>
      others.filter((row) => rowPasses(spec, row, [...ticked, key])).length;

    const options: FilterOption[] = [
      {
        key: ALL_FILTER_VALUE,
        label: "All",
        values: [],
        count: others.length,
        selected: ticked.length === 0,
      },
      ...[...present].map((value) => ({
        key: value,
        label: labelFor(spec, value),
        values: [value],
        count: countWith(value),
        selected: ticked.includes(value),
      })),
      ...(spec.buckets ?? []).map((bucket) => ({
        key: bucket.key,
        label: bucket.label,
        values: [...bucket.values],
        count: countWith(bucket.key),
        selected: ticked.includes(bucket.key),
      })),
    ];

    return { key: spec.key, label: spec.label, options: sortOptions(options, spec.order) };
  });
}

/**
 * Read a filter selection off a URL, clamped to each facet's own vocabulary.
 *
 * A facet travels as one comma-separated parameter (`?status=open,in_progress`).
 * A query string is user-editable, so an unknown key is DROPPED rather than
 * rendering an empty table with no explanation; a facet left with nothing is
 * simply "All".
 */
export function resolveActive<T>(
  specs: readonly FacetSpec<T>[],
  raw: Readonly<Record<string, string | undefined>>
): FilterSelection {
  const resolved: FilterSelection = {};
  for (const spec of specs) {
    const known = new Set<string>([
      ...spec.values,
      ...(spec.buckets ?? []).map((bucket) => bucket.key),
    ]);
    const keys = (raw[spec.key] ?? "")
      .split(",")
      .map((key) => key.trim())
      .filter((key) => Boolean(key) && key !== ALL_FILTER_VALUE && known.has(key));
    resolved[spec.key] = [...new Set(keys)];
  }
  return resolved;
}

/**
 * One facet's selection as a URL parameter value, or undefined when nothing is
 * ticked. Kept beside `resolveActive` so the format has one owner and the round
 * trip is testable.
 */
export function selectionParam(keys: readonly string[] | undefined): string | undefined {
  return keys?.length ? keys.join(",") : undefined;
}

/**
 * Tick or untick one option. Ticking `All` clears the facet, which is what the
 * "All" checkbox means: no filter on this dimension.
 *
 * The order of the ticked keys is preserved so a URL built from a selection reads
 * in the order the admin clicked, and re-ticking something does not silently
 * reorder the query string.
 */
export function toggleFilterOption(
  selected: FilterSelection,
  facetKey: string,
  optionKey: string
): FilterSelection {
  const current = selected[facetKey] ?? [];
  const next =
    optionKey === ALL_FILTER_VALUE
      ? []
      : current.includes(optionKey)
        ? current.filter((key) => key !== optionKey)
        : [...current, optionKey];
  return { ...selected, [facetKey]: next };
}

/**
 * The query string for a whole selection: one comma-separated parameter per
 * facet, in the order the facets are declared. A facet with nothing ticked is
 * omitted entirely, so "no filter" is a clean address rather than `?status=`.
 */
export function selectionQuery(
  groups: readonly FilterGroup[],
  selected: FilterSelection
): string {
  const params = new URLSearchParams();
  for (const group of groups) {
    const value = selectionParam(selected[group.key]);
    if (value) params.set(group.key, value);
  }
  return params.toString();
}

