/**
 * One-time migration: normalises every colour utility in `src/` to the theme tokens
 * and the contrast floor.
 *
 *   node scripts/normalise-ui-colours.mjs           # dry run: report only
 *   node scripts/normalise-ui-colours.mjs --write   # apply
 *
 * WHY A SCRIPT AND NOT HAND EDITS. A UI audit found ~250 occurrences of the same
 * handful of mistakes across ~60 files. Doing that by hand invites both misses and
 * typos, and leaves no record of what changed. This is deterministic, idempotent
 * (re-running it changes nothing once the code is normalised) and prints every
 * replacement it makes.
 *
 * WHAT IT CHANGES, AND WHY EACH ONE
 *
 *   text-ink/30..60      -> text-ink/70
 *     Measured against the light theme's #FFFFFF surface: /30 is 1.9:1, /40 is
 *     2.4:1, /50 is 3.1:1 and /60 is 4.2:1. All four fail WCAG AA (4.5:1) for
 *     normal-size text. /70 is 5.7:1. These were the table headers, timestamps and
 *     empty states that read as grey smudge.
 *
 *   placeholder:text-ink/30..45 -> /50
 *     A placeholder is a hint and never the only label (every field in this app has
 *     a visible label), so it is held to 3:1 rather than 4.5:1. /50 is 3.1:1.
 *
 *   text-muted/N         -> text-muted
 *     `muted` is already the secondary-text token. Fading it to /80 dropped it to
 *     3.7:1 — the same failure through a different name. The token itself was also
 *     darkened (slate-500 -> slate-600) so that `text-muted` on the canvas is 7:1.
 *
 *   border-ink/8..15     -> border-line
 *     10% ink on a white surface is ~1.1:1: the border was there but unreadable,
 *     which is why input boxes looked like they had no edges. `border-line` is the
 *     theme-aware token and is now strong enough to read as an edge in both themes.
 *
 *   focus:ring-line      -> focus:ring-brand-500/20
 *     A focus ring drawn in the colour of the border it is highlighting is not a
 *     focus indicator. It has to be the brand colour.
 *
 *   text-[10px]          -> text-[11px]
 *     10px is unreadable on a phone at arm's length. Inside `components/mobile/`
 *     both 10px and 11px become 12px (`text-xs`), because that is where the app is
 *     used one-handed.
 *
 *   bg-brand-50, ring-brand-50, ... -> the matching `-soft` token
 *     globals.css warns that the `-50` shades are near-white tints: on the dark
 *     canvas they are glaring white patches. The `-soft` tokens are theme-aware.
 *
 * It deliberately does NOT touch comments (they explain the old values), the navy
 * marketing bands (white on a brand fill is correct), or `text-white` anywhere: that
 * one is a judgement call per site, and `npm run test:design` is the guard.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";

const ROOT = new URL("../", import.meta.url);
const WRITE = process.argv.includes("--write");

const RULES = [
  {
    why: "placeholder floor (3:1)",
    find: /(placeholder:text-ink)\/(\d+)(?![\d])/g,
    to: (match, prefix, opacity) => (Number(opacity) < 50 ? `${prefix}/50` : match),
  },
  {
    why: "text floor (AA 4.5:1)",
    // The lookbehind keeps this from re-writing the placeholder rule's output.
    find: /(?<!placeholder:)(text-ink)\/(\d+)(?![\d])/g,
    to: (match, prefix, opacity) => (Number(opacity) < 70 ? `${prefix}/70` : match),
  },
  { why: "secondary text is a token, not an opacity", find: /(text-muted)\/\d+/g, to: "$1" },
  { why: "a faint border is not an edge", find: /(border-ink)\/(?:8|10|12|15)(?![\d])/g, to: "border-line" },
  { why: "a faint border is not an edge", find: /(divide-ink)\/(?:8|10|12|15)(?![\d])/g, to: "divide-line" },
  { why: "visible focus ring", find: /(focus:ring)-line/g, to: "$1-brand-500/20" },
  { why: "visible focus ring", find: /(focus-visible:ring)-line/g, to: "$1-brand-500/20" },
  { why: "10px is unreadable on a phone", find: /text-\[10px\]/g, to: "text-[11px]" },
  {
    why: "theme-aware tint instead of a near-white -50 shade",
    find: /(bg|ring|border|from|to|via)-(brand|signal|alert|accent|warn)-50(?![0-9])/g,
    to: "$1-$2-soft",
  },
];

/** Applied only to `src/components/mobile/**`: the one-handed reading rule. */
const MOBILE_RULES = [{ why: "mobile reading floor is 12px", find: /text-\[1[01]px\]/g, to: "text-xs" }];

/**
 * Every comment and every quoted or backticked string, in one pass.
 *
 * Comments come first in the alternation so they win the race and are returned
 * untouched: without that, backticked prose in a doc comment (`text-ink/50` while
 * explaining the floor) is indistinguishable from a template literal, and re-running
 * this script would rewrite the sentence explaining the rule. A `//` inside a string is
 * safe too — the string alternative consumes it first.
 */
const TOKEN = /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"([^"\n]*)"|'([^'\n]*)'|`([\s\S]*?)`/g;

function normalise(value, rules) {
  let result = value;
  const applied = [];
  for (const rule of rules) {
    rule.find.lastIndex = 0;
    if (!rule.find.test(result)) continue;
    rule.find.lastIndex = 0;
    applied.push(rule.why);
    result = result.replace(rule.find, rule.to);
  }
  return { result, applied };
}

function sourceFiles(dir = "src", found = []) {
  for (const entry of readdirSync(new URL(`${dir}/`, ROOT))) {
    const path = `${dir}/${entry}`;
    if (statSync(new URL(`${path}`, ROOT)).isDirectory()) sourceFiles(path, found);
    else if (/\.(ts|tsx)$/.test(entry)) found.push(path);
  }
  return found;
}

let filesChanged = 0;
let edits = 0;
const reasons = new Map();

for (const path of sourceFiles()) {
  const before = readFileSync(new URL(path, ROOT), "utf8");
  const rules = path.includes("components/mobile/") ? [...RULES, ...MOBILE_RULES] : RULES;

  const after = before.replace(TOKEN, (match, double, single, backtick) => {
    // A comment: nothing to normalise, and nothing that should be.
    if (double === undefined && single === undefined && backtick === undefined) return match;
    const quote = match[0];
    const value = double ?? single ?? backtick ?? "";
    const { result, applied } = normalise(value, rules);
    if (result === value) return match;
    edits += 1;
    for (const why of applied) reasons.set(why, (reasons.get(why) ?? 0) + 1);
    return quote + result + quote;
  });

  if (after !== before) {
    filesChanged += 1;
    console.log(`${WRITE ? "updated" : "would update"} ${path}`);
    if (WRITE) writeFileSync(new URL(path, ROOT), after);
  }
}

console.log(
  `\n${edits} string(s) in ${filesChanged} file(s)${WRITE ? "" : " (dry run — pass --write to apply)"}`
);
for (const [why, count] of [...reasons].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(count).padStart(4)}  ${why}`);
}
if (!edits) console.log("  nothing to do — the source is already normalised");
