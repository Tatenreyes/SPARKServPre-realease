/**
 * Tests for the colour system: the theme tokens themselves, and how components
 * are allowed to consume them.
 *
 *   npm run test:design
 *
 * WHY THIS FILE EXISTS. A UI audit found two classes of defect that no other test
 * could have caught, because both are invisible in the theme the author happened
 * to be using:
 *
 *   1. Text that is the same colour as the surface behind it. The repair-request
 *      wizard, the service-location picker and the technician profile form all
 *      painted `text-white` on `bg-surface` — which is #FFFFFF in light mode. In
 *      dark mode they looked perfect; in light mode the customer typed into blank
 *      white boxes. The app follows the OS theme by default, so this broke for any
 *      customer whose phone was in light mode, with no way for the developer to
 *      notice.
 *   2. Contrast below the WCAG AA floor. Measured against a white surface, the
 *      opacities in use came out at: `text-ink/30` 1.9:1, `/40` 2.4:1, `/50` 3.1:1
 *      and `/60` 4.2:1 — every one of them below the 4.5:1 AA needs for normal-size
 *      text. They were the table headers, timestamps and empty states across the
 *      dashboards, which is why the detail text read as grey smudge. `text-muted/80`
 *      (3.2:1) was the same mistake through a different token.
 *
 * The first half of this file COMPUTES the contrast ratio of every token pair the
 * app actually relies on, in both themes, from the RGB triplets in `globals.css`.
 * That is the important part: it is arithmetic, not opinion, and it fails the moment
 * someone adds a token that cannot be read.
 *
 * The second half greps the source for the patterns that produced the defects.
 *
 * What is NOT covered here: how any of it actually LOOKS. Contrast maths proves a
 * pair is legible in isolation; it cannot see a colour that clashes with a
 * neighbour, a hairline border that vanishes on a dark canvas, or an element the
 * mobile install banner covers. Those need eyes on a screen, and they are listed in
 * TESTING.md as manual checks.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");
const globals = read("src/app/globals.css");

/* ------------------------------------------------------------------ contrast
   WCAG 2.1 relative luminance and contrast ratio. Kept inline and dependency-free
   so this test can never drift from the formula it is asserting against. */

/** `rgb(var(--spark-ink))` triplets are stored as "16 38 74". */
function parseTokens(block) {
  const tokens = {};
  for (const [, name, value] of block.matchAll(/--spark-([a-z-]+):\s*([\d]+ [\d]+ [\d]+)/g)) {
    tokens[name] = value.trim().split(/\s+/).map(Number);
  }
  return tokens;
}

function channel(value) {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function luminance([r, g, b]) {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * Contrast ratio of `foreground` on `background`, where the foreground may carry
 * an alpha (`text-ink/60`). Alpha is composited over the background first, which is
 * what the browser does — ignoring it would overstate every faded colour.
 */
function contrast(foreground, background, alpha = 1) {
  const composited = foreground.map((value, i) => value * alpha + background[i] * (1 - alpha));
  const [lighter, darker] = [luminance(composited), luminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

// The two theme blocks: `:root` is light, `.dark` overrides it.
const light = parseTokens(globals.match(/:root\s*\{([\s\S]*?)\n\}/)[1]);
const dark = parseTokens(globals.match(/\.dark\s*\{([\s\S]*?)\n\}/)[1]);

/**
 * The pairs the app actually renders, and the floor each one must clear.
 *
 * 4.5:1 is WCAG AA for normal-size text — the standard the dashboards are held to,
 * because almost all of this text is 12-14px. Pairs that are only ever used as
 * borders or fills are not listed; they are not text.
 */
const TEXT_PAIRS = [
  ["ink on surface", "ink", "surface", 1],
  ["ink on canvas", "ink", "canvas", 1],
  ["muted on surface", "muted", "surface", 1],
  ["muted on canvas", "muted", "canvas", 1],
  ["muted on soft", "muted", "soft", 1],
  // The faintest text the app is allowed to use: `text-ink/70` (5.7:1 on a surface).
  // For scale, the opacities this replaced measured: /30 1.9:1, /40 2.4:1, /50
  // 3.1:1, /60 4.2:1 — all below the AA floor for normal-size text.
  ["ink/70 on surface (faint floor)", "ink", "surface", 0.7],
  ["ink/70 on canvas (faint floor)", "ink", "canvas", 0.7],
  ["ink/70 on soft (faint floor)", "ink", "soft", 0.7],
  // Read-as-text tones, each on the tonal fill it is paired with in StatusBadge.
  ["brand-ink on brand-soft", "brand-ink", "brand-soft", 1],
  ["signal-ink on signal-soft", "signal-ink", "signal-soft", 1],
  ["alert-ink on alert-soft", "alert-ink", "alert-soft", 1],
  ["accent-ink on accent-soft", "accent-ink", "accent-soft", 1],
  ["warn-ink on warn-soft", "warn-ink", "warn-soft", 1],
  // Read-as-text tones used on a plain surface (links, inline validation).
  ["brand-ink on surface", "brand-ink", "surface", 1],
  ["signal-ink on surface", "signal-ink", "surface", 1],
  ["alert-ink on surface", "alert-ink", "surface", 1],
  ["accent-ink on surface", "accent-ink", "surface", 1],
  ["warn-ink on surface", "warn-ink", "surface", 1],
];

for (const [label, mode] of [["light", light], ["dark", dark]]) {
  test(`every text token pair clears WCAG AA in the ${label} theme`, () => {
    const failures = [];
    for (const [name, fg, bg, alpha] of TEXT_PAIRS) {
      assert.ok(mode[fg], `${label}: token --spark-${fg} is missing`);
      assert.ok(mode[bg], `${label}: token --spark-${bg} is missing`);
      const ratio = contrast(mode[fg], mode[bg], alpha);
      if (ratio < 4.5) failures.push(`${name}: ${ratio.toFixed(2)}:1 (needs 4.5:1)`);
    }
    assert.deepEqual(
      failures,
      [],
      `${label} theme has unreadable text pairs:\n  ${failures.join("\n  ")}`
    );
  });
}

test("the border token stays perceivable in both themes", () => {
  // A 1px hairline is not text, but it still has to be visible — this is the reason
  // `border-line` is a token rather than a raw `border-ink/10`, which measured
  // ~1.1:1 and is why cards and inputs read as having no edge. The light theme's
  // 1.37:1 and the dark theme's 1.39:1 are deliberately the same strength.
  for (const [label, mode] of [["light", light], ["dark", dark]]) {
    for (const surface of ["surface", "canvas"]) {
      const ratio = contrast(mode.line, mode[surface]);
      assert.ok(
        ratio >= 1.3,
        `${label}: line on ${surface} is ${ratio.toFixed(2)}:1 — too faint to read as an edge`
      );
    }
  }
});

/* ------------------------------------------------------------------- source
   Rules for how components may consume the tokens.

   These are greps, and greps are blunt, so two deliberate concessions:
   - Comments are stripped first. Otherwise the explanatory comments in this very
     codebase (which quote `text-white` while describing why it is banned) would
     fail the rule they document.
   - Only string literals are inspected, never JSX text or prose, so a sentence that
     happens to contain the word "text-white" cannot fail a build.
*/

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ") // block comments, including JSX {/* */}
    .replace(/(^|\s)\/\/.*$/gm, "$1"); // line comments, but not https:// inside strings
}

/** Every quoted or backticked string in the file. */
function stringLiterals(source) {
  return [...stripComments(source).matchAll(/"([^"\n]*)"|'([^'\n]*)'|`([\s\S]*?)`/g)]
    .map((match) => match[1] ?? match[2] ?? match[3] ?? "")
    .filter((value) => /(?:^|[\s"'])(?:text|bg|ring|border|placeholder|focus)[-:]/.test(value));
}

function sourceFiles(dir = "src", found = []) {
  for (const entry of readdirSync(new URL(`${dir}/`, ROOT))) {
    const path = `${dir}/${entry}`;
    if (statSync(new URL(`${path}`, ROOT)).isDirectory()) sourceFiles(path, found);
    else if (/\.(ts|tsx)$/.test(entry)) found.push(path);
  }
  return found;
}

const SOURCES = sourceFiles().map((path) => ({
  path,
  // Normalised so the assertions read the same on Windows and on CI.
  id: relative(".", path).split(sep).join("/"),
  strings: stringLiterals(read(path)),
}));

/**
 * Splits a class string into independent segments.
 *
 * A template literal can hold several alternative class lists — `${active ?
 * "bg-brand-600 text-white" : "bg-surface text-ink"}` — and the branches are never
 * applied at the same time. Checking the raw literal would report a conflict that
 * cannot happen, so the quoted branches are checked separately from the static part
 * around them.
 */
function segments(value) {
  if (!/["']/.test(value)) return [value];
  return value.split(/["']/).filter((part) => part.length > 0);
}

/** Runs `check` over every string literal in the repo; returns "file: string" lines. */
function violations(check) {
  const found = [];
  for (const { id, strings } of SOURCES) {
    for (const value of strings) {
      for (const segment of segments(value)) {
        const reason = check(segment);
        if (reason) found.push(`${id}: ${reason}`);
      }
    }
  }
  return [...new Set(found)].sort();
}

test("no white text is painted onto a light surface", () => {
  // The defect that started this: `bg-surface text-white` is #FFFFFF on #FFFFFF in
  // light mode. White on a brand fill (`bg-brand-600 text-white`) is correct and is
  // deliberately not flagged — only a surface or soft fill counts.
  const found = violations((value) =>
    /text-white/.test(value) && /(?:^|\s)(?:hover:|focus:)?bg-(?:surface|soft|canvas)(?:\s|$)/.test(value)
      ? "white text on a surface fill"
      : null
  );
  assert.deepEqual(found, [], `white-on-surface text:\n  ${found.join("\n  ")}`);
});

test("no placeholder is white", () => {
  const found = violations((value) =>
    /placeholder:text-white/.test(value) ? "white placeholder" : null
  );
  assert.deepEqual(found, [], `white placeholders:\n  ${found.join("\n  ")}`);
});

test("focus rings are brand-tinted, never the colour of the border", () => {
  // `focus:ring-line` draws a ring in the exact colour of the border it is meant to
  // highlight, so focusing a field changed nothing. Same for `ring-ink/N` at low
  // alpha. The ring must be the brand colour.
  const found = violations((value) => {
    const ring = value.match(/(?:focus|focus-visible|focus-within):ring-(line|ink\/\d+|white\/\d+)/);
    return ring ? `invisible focus ring (ring-${ring[1]})` : null;
  });
  assert.deepEqual(found, [], `invisible focus rings:\n  ${found.join("\n  ")}`);
});

test("text never falls below the contrast floor", () => {
  // The floors are derived from the contrast test above, and were measured, not
  // guessed:
  //   text-ink/70            = 5.7:1 -> the floor for normal-size text
  //   placeholder:text-ink/50 = 3.1:1 -> a hint, held to the 3:1 non-text floor,
  //                                    which is safe here because every field in
  //                                    this app has a visible label as well
  //   text-ink/50 = 3.1:1, /40 = 2.4:1, /30 = 1.9:1 -> never
  // `text-muted/N` is banned at any opacity because `muted` is already the
  // secondary-text token; fading it below 100% is what made it fail.
  const found = violations((value) => {
    const ink = [...value.matchAll(/(placeholder:)?text-ink\/(\d+)/g)];
    for (const [, placeholder, opacity] of ink) {
      const floor = placeholder ? 50 : 70;
      if (Number(opacity) < floor) {
        return `${placeholder ? "placeholder " : ""}text-ink/${opacity} is below the floor of /${floor}`;
      }
    }
    const muted = value.match(/text-muted\/(\d+)/);
    return muted ? `text-muted/${muted[1]} — use plain text-muted` : null;
  });
  assert.deepEqual(found, [], `sub-floor text opacity:\n  ${found.join("\n  ")}`);
});

test("no text is set at 10px", () => {
  // 10px is unreadable on a phone at arm's length, which is where most of this app
  // is used. 12px is the floor; 11px is allowed only for uppercase tracked labels.
  const found = violations((value) => (/text-\[10px\]/.test(value) ? "text-[10px]" : null));
  assert.deepEqual(found, [], `10px text:\n  ${found.join("\n  ")}`);
});

test("the mobile shell keeps an 11px floor", () => {
  // The bottom nav, the notification list and the mobile headers are read one-handed
  // on a phone, so they get the stricter rule: nothing below 11px, and the labels
  // that carry meaning are 12px.
  const found = violations((value) => (/text-\[1[01]px\]/.test(value) ? "sub-12px text" : null))
    .filter((line) => line.startsWith("src/components/mobile/"));
  assert.deepEqual(found, [], `tiny mobile text:\n  ${found.join("\n  ")}`);
});

test("a state variant never repeats the value it is meant to override", () => {
  // Added after the normalisation sweep was caught flattening states: it rewrote
  // `text-ink/30 hover:text-ink/60` to `text-ink/70 hover:text-ink/70`, because both
  // values were below the floor. The password-visibility toggle then had a hover state
  // identical to its resting state — the button stopped responding to the pointer, and
  // no colour assertion could see it, because each class was individually valid.
  // Any hover/focus/active utility that duplicates its own base is dead weight.
  const STATE = /^(hover|focus|focus-visible|focus-within|active|group-hover|peer-checked|disabled)$/;
  const found = violations((value) => {
    const tokens = value.split(/\s+/).filter(Boolean);
    const base = new Set(tokens.filter((token) => !token.includes(":")));
    for (const token of tokens) {
      const parts = token.split(":");
      const utility = parts.pop() ?? "";
      if (!parts.some((part) => STATE.test(part))) continue;
      // `disabled:hover:bg-X` where the base is `bg-X` is the standard way to cancel a
      // hover style on a disabled control. That no-op is the point, not a mistake.
      if (parts.includes("disabled") && parts.includes("hover")) continue;
      if (base.has(utility)) return `${token} repeats its own base — the state change is invisible`;
    }
    return null;
  });
  assert.deepEqual(found, [], `dead state variants:\n  ${found.join("\n  ")}`);
});

test("no near-white -50 tints are used as fills", () => {
  // globals.css says it plainly: the `-50` shades are near-white tints, and dropped
  // onto a dark canvas they read as glaring light patches. `bg-brand-50` in a dark
  // theme is a white box. The theme-aware replacements are the `-soft` tokens.
  const found = violations((value) => {
    const tint = value.match(
      /(?:^|\s)(?:hover:|focus:|active:|group-hover:)?(?:bg|ring|border)-(?:brand|signal|alert|accent|warn)-50(?![0-9])/
    );
    return tint ? `${tint[0].trim()} is a fixed near-white tint` : null;
  });
  assert.deepEqual(found, [], `unthemed -50 tints:\n  ${found.join("\n  ")}`);
});

test("every field recipe sets ink text, a themed placeholder and a visible focus ring", () => {
  // Discovered rather than listed. Six components declare their own `FIELD` (or a
  // `Field`), and the white-on-white bug lived in two of them while the others were
  // fine — so a hardcoded list of names is the wrong shape for this guard: a new form,
  // or a rename, would slip straight past it. Every local recipe is found and held to
  // the same three properties.
  const recipes = [];
  for (const { id } of SOURCES) {
    for (const match of stripComments(read(id)).matchAll(/const FIELD =[\s\S]{0,4}?"([^"]+)"/g)) {
      recipes.push({ id, value: match[1] });
    }
  }

  assert.ok(recipes.length >= 4, `expected the app's local FIELD recipes, found ${recipes.length}`);
  const problems = [];
  for (const { id, value } of recipes) {
    if (!/(?:^|\s)text-ink(?:\s|$)/.test(value)) problems.push(`${id}: text colour is not text-ink`);
    if (!/placeholder:text-ink\//.test(value)) problems.push(`${id}: the placeholder is not themed`);
    if (!/focus:ring-brand-/.test(value)) problems.push(`${id}: the focus ring is not visible`);
    if (/text-white/.test(value)) problems.push(`${id}: the field text is white`);
  }
  assert.deepEqual(problems, [], `field recipes:\n  ${problems.join("\n  ")}`);

  // ProfileForm's Field is the same recipe, built from a template literal.
  const profile = SOURCES.find((entry) => entry.id === "src/components/ProfileForm.tsx").strings;
  const field = profile.find((value) => value.includes("placeholder:text-ink/"));
  assert.ok(field, "ProfileForm: could not find the Field recipe");
  assert.match(field, /(?:^|\s)text-ink(?:\s|$)/, "ProfileForm: Field must set text-ink");
  assert.match(field, /focus:ring-brand-/, "ProfileForm: Field must have a visible focus ring");
});
