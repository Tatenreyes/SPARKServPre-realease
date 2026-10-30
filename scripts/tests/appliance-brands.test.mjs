/**
 * Unit tests for the appliance brand layer: the per-appliance brand lists, the
 * "Other" escape and the cap on a typed brand.
 *
 *   npm run test:appliance-brands
 *
 * These run the REAL module (`src/lib/appliance-brands.ts`) — Node 24 strips the
 * TypeScript types, so there is no build step and no duplicated copy of the rules
 * to drift. The three screens are also read as text, because the lists have to be
 * WIRED INTO the fields, not merely defined.
 *
 * The bug this file exists for: the request wizard's brand table covered only
 * three appliances and fell back to `["Other"]`, so a television, rice cooker or
 * electric fan had a `required` Brand field whose only choice was the literal
 * word "Other" — and that word was what got stored.
 *
 * What is NOT covered here: the rendered controls themselves and anything that
 * needs the live database.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { APPLIANCE_ISSUES } from "../../src/lib/appliance-issues.ts";
import {
  APPLIANCE_TYPES,
  BRANDS_BY_TYPE,
  BRAND_OTHER,
  MAX_BRAND_LENGTH,
  brandOptionsFor,
  cleanBrand,
  isListedBrand,
  sanitiseBrandInput,
} from "../../src/lib/appliance-brands.ts";

const ROOT = new URL("../../", import.meta.url);
const WIZARD = "src/components/RequestRepairWizard.tsx";
const PAGE = "src/app/customer/appliances/page.tsx";
const PROFILE = "src/components/ProfileForm.tsx";
const wizard = readFileSync(new URL(WIZARD, ROOT), "utf8");
const page = readFileSync(new URL(PAGE, ROOT), "utf8");
const profile = readFileSync(new URL(PROFILE, ROOT), "utf8");

const CATALOGUE = Object.keys(APPLIANCE_ISSUES);

test("every appliance in the catalogue has a brand list", () => {
  for (const applianceType of CATALOGUE) {
    const brands = BRANDS_BY_TYPE[applianceType];
    assert.ok(Array.isArray(brands), `${applianceType} has no brand list`);
    assert.ok(
      brands.length >= 3,
      `${applianceType} lists only ${brands.length} brand(s) — that is the "Other"-only bug again`
    );
  }
});

test("the appliance list is the catalogue, not a second copy of it", () => {
  // Derived from APPLIANCE_ISSUES, so an appliance can never exist for issues but
  // not for brands. If this ever fails, someone re-typed the list.
  assert.deepEqual(APPLIANCE_TYPES, CATALOGUE);
  assert.deepEqual(Object.keys(BRANDS_BY_TYPE), CATALOGUE, "no extra or missing appliance key");
});

test("no brand list contains the Other escape", () => {
  for (const [applianceType, brands] of Object.entries(BRANDS_BY_TYPE)) {
    assert.equal(
      brands.includes(BRAND_OTHER),
      false,
      `${applianceType} stores "Other" as a brand — it is appended by brandOptionsFor(), never listed`
    );
  }
});

test("a brand list has no duplicates and no sloppy names", () => {
  for (const [applianceType, brands] of Object.entries(BRANDS_BY_TYPE)) {
    assert.equal(new Set(brands).size, brands.length, `${applianceType} repeats a brand`);
    for (const brand of brands) {
      assert.equal(brand, brand.trim(), `${applianceType}: "${brand}" has surrounding space`);
      assert.ok(brand.length > 0, `${applianceType} has an empty brand`);
      assert.ok(
        brand.length <= MAX_BRAND_LENGTH,
        `${applianceType}: "${brand}" is longer than the ${MAX_BRAND_LENGTH}-character cap`
      );
      // A name that survives its own cleaner unchanged is one the wizard can
      // round-trip: what is stored is what the list offered.
      assert.equal(cleanBrand(brand), brand, `${applianceType}: "${brand}" is not a clean name`);
    }
  }
});

test("Other is appended last, and an unknown appliance still has a choice", () => {
  for (const applianceType of CATALOGUE) {
    const options = brandOptionsFor(applianceType);
    assert.equal(options.at(-1), BRAND_OTHER, `${applianceType}: "Other" must come last`);
    assert.equal(options.length, BRANDS_BY_TYPE[applianceType].length + 1);
  }

  // Never empty: an appliance whose list was forgotten still offers the free-text
  // escape rather than trapping the customer on a required field with no options.
  assert.deepEqual(brandOptionsFor("Espresso Machine"), [BRAND_OTHER]);
});

test("isListedBrand answers per appliance, not globally", () => {
  assert.equal(isListedBrand("Air Conditioner", "Daikin"), true);
  assert.equal(isListedBrand("Refrigerator", "Daikin"), false, "Daikin is an aircon brand");
  assert.equal(isListedBrand("Rice Cooker", "National"), true, "the legacy Panasonic name stays");
  assert.equal(isListedBrand("Television", "Chigo"), false, "a custom name is not listed");
  assert.equal(isListedBrand("Television", "  Samsung  "), true, "surrounding space is forgiven");

  // Blank means "nothing chosen yet", never a match — otherwise the wizard would
  // treat an empty brand as a listed one.
  assert.equal(isListedBrand("Refrigerator", ""), false);
  assert.equal(isListedBrand("Refrigerator", "   "), false);
  assert.equal(isListedBrand("Refrigerator", null), false);
  assert.equal(isListedBrand("Refrigerator", undefined), false);
});

test("a typed brand survives what a keyboard can produce", () => {
  assert.equal(sanitiseBrandInput("A.O. Smith"), "A.O. Smith", "the dots are part of the name");
  assert.equal(sanitiseBrandInput("3D"), "3D", "and so are the digits");
  assert.equal(sanitiseBrandInput("CHiQ"), "CHiQ");
  assert.equal(sanitiseBrandInput("Café"), "Café", "an accented name is still a name");
  assert.equal(sanitiseBrandInput("Samsung, LG"), "Samsung LG", "a comma is not");
  assert.equal(sanitiseBrandInput("LG⭐"), "LG");
  assert.equal(sanitiseBrandInput(""), "");
});

test("the typed brand is capped in the field and again on the way in", () => {
  const long = "B".repeat(120);
  assert.equal(sanitiseBrandInput(long).length, MAX_BRAND_LENGTH);
  assert.equal(cleanBrand(long).length, MAX_BRAND_LENGTH);
});

test("cleanBrand collapses, trims and repairs a sliced value", () => {
  assert.equal(cleanBrand("  White   Westinghouse  "), "White Westinghouse");
  assert.equal(cleanBrand("Samsung\nLG"), "Samsung LG", "a newline is whitespace");
  assert.equal(cleanBrand(""), "");
  // A slice landing on the space the collapse just normalised must not leave one
  // behind — "White Westinghouse " is not a brand.
  const sliced = cleanBrand(`${"A".repeat(MAX_BRAND_LENGTH - 1)} B`);
  assert.equal(sliced, "A".repeat(MAX_BRAND_LENGTH - 1));
  assert.equal(sliced.endsWith(" "), false);
});

test("the wizard takes its brands from the shared list", () => {
  assert.match(wizard, /brandOptionsFor\(applianceType\)/);
  assert.doesNotMatch(
    wizard,
    /\|\|\s*\["Other"\]/,
    'the `|| ["Other"]` fallback is back: every other appliance would offer nothing but "Other"'
  );
  assert.doesNotMatch(wizard, /const BRANDS/, "the wizard must not keep a brand table of its own");
});

test("choosing Other asks for the real name, and stores it", () => {
  assert.match(wizard, /\{brand === BRAND_OTHER && \(/, "the free-text box is not conditional");
  assert.match(
    wizard,
    /id="appliance-brand-other"[\s\S]{0,400}required/,
    "the typed brand is required — the word \"Other\" is not a brand"
  );
  assert.match(wizard, /maxLength=\{MAX_BRAND_LENGTH\}/);
  assert.match(
    wizard,
    /const effectiveBrand = brand === BRAND_OTHER \? cleanBrand\(otherBrand\) : brand/,
    "what is stored must be the typed name, not the word Other"
  );
  assert.match(wizard, /brand: effectiveBrand \|\| null/);
});

test("changing the appliance cannot strand a brand that no longer exists", () => {
  assert.match(
    wizard,
    /id="appliance-type"[\s\S]{0,600}setBrand\(""\)/,
    "a stale option in a required select blocks the submit with nothing visible to fix"
  );
  assert.match(
    wizard,
    /isListedBrand\(appliance\.appliance_type, savedBrand\)/,
    "a saved brand outside the list must come back as free text, not vanish"
  );
});

test("no screen re-declares the appliance list", () => {
  for (const [name, source] of [
    [WIZARD, wizard],
    [PAGE, page],
    [PROFILE, profile],
  ]) {
    assert.doesNotMatch(source, /const APPLIANCE_TYPES = \[/, `${name} re-typed the appliance list`);
    assert.match(source, /from "@\/lib\/appliance-brands"/, `${name} must use the shared module`);
  }
});

test("the appliance register offers the same brands without forcing them", () => {
  assert.match(page, /list="appliance-brand-options"/, "the suggestions are not wired up");
  assert.match(page, /brandOptionsFor\(form\.appliance_type\)/);
  assert.match(page, /brand: cleanBrand\(form\.brand\) \|\| null/, "the stored brand is not cleaned");
});
