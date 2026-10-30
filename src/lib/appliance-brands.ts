/**
 * The brand a customer picks for an appliance, and the one place the appliance
 * list is defined.
 *
 * ## Why this module exists
 *
 * The request wizard used to hold its own brand table covering only three
 * appliances — refrigerator, air conditioner and washing machine — and fall back
 * to a single option for everything else:
 *
 *     {(BRANDS[applianceType] || ["Other"]).map(...)}
 *
 * So for a television, a rice cooker or an electric fan the Brand field was
 * `required` and its only choice was the literal word "Other". The customer had
 * to record a meaningless brand, that string became the appliance's stored
 * `brand`, and the appliance's own name was built from it ("Other RT32K5530S8").
 * A real brand the customer had already saved on `/customer/appliances` (a free
 * text field) could not even be selected back in the wizard.
 *
 * ## What is in the lists, and why that order
 *
 * Every list below is the brands that actually reach Philippine repair benches:
 * the majors (Samsung, LG, Panasonic, Whirlpool, Haier, Condura, Fujidenzo,
 * Sharp, Electrolux, Carrier, Kolin) plus the local value brands that dominate
 * small-appliance volume (Hanabishi, Imarflex, Kyowa, Asahi, Camel, Union, 3D,
 * Firefly). Two deliberate inclusions:
 *
 *   * `National` under rice cookers — Panasonic's former name, still moulded into
 *     millions of working Philippine units, so it must stay selectable even
 *     though nobody buys it new.
 *   * `Speed Queen` / `Maytag` under dryers — a dryer repair is
 *     disproportionately a laundromat repair.
 *
 * The order is **prevalence, not alphabet**: the first entries are the ones most
 * repairs involve, so the common answer is one tap away and the rarer names are
 * still there. Each list is capped around a dozen entries (plus "Other") because
 * this is a phone-sized native `<select>`.
 *
 * `Other` is NOT stored in the lists — `brandOptionsFor()` appends it, so a
 * caller can never mistake it for a real brand. Choosing it opens a required
 * free-text box (see `RequestRepairWizard`), and `isListedBrand()` is what tells
 * the wizard that a saved brand falls outside the list and must be preserved as
 * free text rather than silently dropped.
 *
 * ## Adding an appliance
 *
 * The appliance list is derived from `APPLIANCE_ISSUES` — the canonical
 * catalogue — so an appliance can never exist for issues but not for brands.
 * Adding one there means adding its brand list here, and
 * `scripts/tests/appliance-brands.test.mjs` fails loudly if it is forgotten.
 */

import { APPLIANCE_ISSUES } from "./appliance-issues.ts";

/**
 * Every appliance a customer can register, in the order the wizard offers them.
 *
 * Derived, never re-typed: the wizard, `/customer/appliances` and the
 * technician's specialisation picker all read this, so the three can no longer
 * drift apart (which is how the missing brand lists went unnoticed).
 */
export const APPLIANCE_TYPES: string[] = Object.keys(APPLIANCE_ISSUES);

/** The "none of the above" choice. Opens a free-text brand box. */
export const BRAND_OTHER = "Other";

/**
 * Brands per appliance type, most-repaired first.
 *
 * Sources: the brand index of a major Philippine appliance retailer plus
 * PH-specific 2026 buying guides for each category (mybest PH, ProductNation PH,
 * Racaaph, TheBudolFinds, Kim'z House).
 */
export const BRANDS_BY_TYPE: Record<string, string[]> = {
  Refrigerator: [
    "Samsung",
    "LG",
    "Panasonic",
    "Whirlpool",
    "Haier",
    "Condura",
    "Fujidenzo",
    "Sharp",
    "Electrolux",
    "Kolin",
    "Midea",
    "White Westinghouse",
    "GE",
  ],
  "Air Conditioner": [
    "Samsung",
    "LG",
    "Panasonic",
    "Daikin",
    "Mitsubishi",
    "Carrier",
    "Kolin",
    "Condura",
    "Gree",
    "Midea",
    "Sharp",
    "TCL",
    "Koppel",
  ],
  "Washing Machine": [
    "Samsung",
    "LG",
    "Panasonic",
    "Whirlpool",
    "Haier",
    "Condura",
    "Fujidenzo",
    "Sharp",
    "Electrolux",
    "Midea",
    "Beko",
    "Toshiba",
    "Speed Queen",
  ],
  Television: [
    "Samsung",
    "LG",
    "Sony",
    "TCL",
    "Sharp",
    "Panasonic",
    "Devant",
    "Hisense",
    "Toshiba",
    "Skyworth",
    "Xiaomi",
    "ACE",
  ],
  "Electric Fan": [
    "Hanabishi",
    "Asahi",
    "Imarflex",
    "Kyowa",
    "Camel",
    "Firefly",
    "Iwata",
    "KDK",
    "Panasonic",
    "Jisulife",
    "Union",
    "3D",
    "Standard",
  ],
  "Microwave Oven": [
    "American Home",
    "Samsung",
    "Hanabishi",
    "Sharp",
    "Panasonic",
    "LG",
    "Fujidenzo",
    "Whirlpool",
    "Imarflex",
    "Kyowa",
    "Oster",
    "Midea",
    "Galanz",
  ],
  "Rice Cooker": [
    "Panasonic",
    "Imarflex",
    "Hanabishi",
    "Kyowa",
    "Tiger",
    "Cuckoo",
    "Sharp",
    "American Heritage",
    "National",
    "Midea",
  ],
  "Electric Stove": [
    "Hanabishi",
    "Imarflex",
    "Kyowa",
    "American Home",
    "Asahi",
    "Midea",
    "La Germania",
    "Elba",
    "Tecnogas",
  ],
  "Induction Cooker": [
    "Kyowa",
    "Imarflex",
    "Hanabishi",
    "American Home",
    "Midea",
    "Philips",
    "Xiaomi",
    "Asahi",
  ],
  "Water Dispenser": [
    "Hanabishi",
    "American Home",
    "Fujidenzo",
    "Kyowa",
    "Asahi",
    "Toshiba",
    "Sharp",
    "LG",
    "Panasonic",
    "Midea",
    "Eureka",
    "Dowell",
  ],
  "Electric Kettle": [
    "Imarflex",
    "Hanabishi",
    "Kyowa",
    "American Home",
    "Philips",
    "Xiaomi",
    "Oster",
    "Panasonic",
    "Midea",
    "Acerpure",
  ],
  "Vacuum Cleaner": [
    "Imarflex",
    "Hanabishi",
    "Kyowa",
    "Xiaomi",
    "Bissell",
    "Shark",
    "Deerma",
    "Philips",
    "Electrolux",
    "Dyson",
    "Roborock",
    "Karcher",
    "Levoit",
  ],
  "Clothes Dryer": [
    "LG",
    "Samsung",
    "Electrolux",
    "Whirlpool",
    "Haier",
    "Midea",
    "Condura",
    "Beko",
    "Speed Queen",
    "Maytag",
  ],
  Freezer: [
    "Condura",
    "Fujidenzo",
    "Kolin",
    "White Westinghouse",
    "Haier",
    "Midea",
    "Sharp",
    "CHiQ",
    "Union",
    "Dowell",
    "Chigo",
    "Mondial",
  ],
  "Water Heater": [
    "Joven",
    "Champs",
    "A.O. Smith",
    "Stiebel Eltron",
    "Panasonic",
    "Ariston",
    "Midea",
    "Vector",
    "Hydromax",
    "Alpha",
    "Electrolux",
    "Rinnai",
  ],
};

/**
 * The choices for one appliance: its brands, then "Other" last.
 *
 * Never empty — an appliance whose list was forgotten still offers the free-text
 * escape rather than trapping the customer on a required field with nothing to
 * choose (the bug this module replaces).
 */
export function brandOptionsFor(applianceType: string): string[] {
  return [...(BRANDS_BY_TYPE[applianceType] ?? []), BRAND_OTHER];
}

/**
 * Is this brand one of the listed choices for this appliance?
 *
 * `false` for a blank brand, for a brand belonging to a different appliance and
 * for a legacy/custom value such as "Chigo" on a television. The wizard uses
 * that answer to preserve such a value as free text instead of dropping it.
 */
export function isListedBrand(applianceType: string, brand: string | null | undefined): boolean {
  const value = (brand ?? "").trim();
  if (!value) return false;
  return (BRANDS_BY_TYPE[applianceType] ?? []).includes(value);
}

/** Longest accepted brand name. The longest real one here ("White Westinghouse") is 18. */
export const MAX_BRAND_LENGTH = 40;

/**
 * Everything a brand name may contain: letters, digits, spaces and the
 * punctuation real names use — "A.O. Smith", "3D", "White Westinghouse",
 * "CHiQ". Anything else is dropped as it is typed, so a pasted sentence cannot
 * become a brand.
 *
 * The accented Latin ranges are spelled out rather than written as `\p{L}`: a
 * unicode property escape needs the `u` flag AND an `es2018` target, and this
 * project compiles at `es2017` (TypeScript 5.5 rejects the escape there).
 */
const NON_BRAND_CHARACTERS = /[^A-Za-zÀ-ÖØ-öø-ÿĀ-ž0-9\s&'’.\-+]/g;

/** Strip and cap on every keystroke, so the field already shows what will be stored. */
export function sanitiseBrandInput(value: string): string {
  return value.replace(NON_BRAND_CHARACTERS, "").slice(0, MAX_BRAND_LENGTH);
}

/**
 * The stored form of a typed brand: stripped, internal whitespace collapsed,
 * trimmed and capped. Applied on the way into the payload as well as in the
 * field, so a row saved before this cap existed is repaired when it is edited.
 */
export function cleanBrand(value: string): string {
  const collapsed = value.replace(NON_BRAND_CHARACTERS, "").replace(/\s+/g, " ").trim();
  return collapsed.slice(0, MAX_BRAND_LENGTH).trim();
}
