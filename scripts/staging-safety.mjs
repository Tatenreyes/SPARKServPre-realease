/**
 * Staging safety — the gate every staging script goes through.
 *
 * WHY THIS EXISTS. A staging test writes: it creates users, moves roles and demotes
 * super administrators. Run against the live project it would corrupt real accounts, and
 * the mistake is one environment variable away — a copied `.env.local`, a shell still
 * holding yesterday's export, or a file named `.env.staging` containing the wrong URL.
 *
 * So a target must satisfy THREE independent conditions before a staging script touches
 * it:
 *
 *   1. an explicit staging environment file (`.env.staging`, or `SPARKSERV_ENV_FILE`) that
 *      has actually been filled in — a copy of `.env.staging.example` is refused as a copy
 *      of the template, before anything is contacted;
 *   2. a URL that is not the production project — compared against `.env.local` **and**
 *      against the known production ref, so a missing `.env.local` is not a free pass;
 *   3. a marker row in the DATABASE (`system_settings`), so the database itself says it
 *      is the disposable one. Guessing a URL is not enough; the target has to declare
 *      itself.
 *
 * Nothing in this module writes, and the verdict is a pure function, so the rules are
 * unit-tested without a network or a database (`scripts/tests/staging-safety.test.mjs`).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Production, by project ref — the belt for the braces below. */
export const PRODUCTION_PROJECT_REF = "ioduxclcifdicikmvdtx";

export const DEFAULT_MARKER_KEY = "staging_environment";
export const DEFAULT_MARKER_VALUE = "sparkserv-staging";

export const STAGING_ENV_FILE = ".env.staging";

/** A refusal, not a crash: callers exit 2 and print the reason without a stack trace. */
export class StagingRefused extends Error {}

/** The project ref a Supabase URL belongs to, or null when it is not a URL. */
export function projectRef(url) {
  if (typeof url !== "string" || !url.trim()) return null;
  try {
    return new URL(url.trim()).hostname.split(".")[0] || null;
  } catch {
    return null;
  }
}

/**
 * Words that only ever appear in an unfilled template. A project ref is a random
 * 20-character string and a real key is a JWT (`eyJ…`) or an `sb_publishable_` /
 * `sb_secret_` key, so these are a reliable tell — and worth catching, because an
 * unfilled `.env.staging` otherwise surfaces as "the database did not answer", which
 * sends the operator looking at the database instead of at their copy-paste.
 */
const PLACEHOLDER_PREFIX = /^(your|example|placeholder|changeme|todo|dummy|fake|xxx)/i;

/** Is this value (or the project ref inside it) still template text rather than a real one? */
export function looksLikePlaceholder(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  const text = value.trim();
  if (PLACEHOLDER_PREFIX.test(text)) return true;
  const ref = projectRef(text);
  return ref ? PLACEHOLDER_PREFIX.test(ref) : false;
}

/**
 * Pure verdict: may this target be used? Every refusal carries the reason in the words
 * the operator needs to fix it.
 *
 * `checkMarker: false` validates the URL ALONE, which is how the loader screens the target
 * before it makes any request — a production URL must be refused without being contacted.
 * With the default, an unanswered marker (`null` — a read that returned nothing, an HTTP
 * error, or a host that did not resolve) is a refusal: a database that did not answer is
 * not a database that said yes.
 */
export function stagingVerdict({
  stagingUrl,
  productionUrl = null,
  markerValue = null,
  requiredMarkerValue = DEFAULT_MARKER_VALUE,
  checkMarker = true,
}) {
  const ref = projectRef(stagingUrl);
  if (!ref) {
    return { ok: false, reason: "no usable NEXT_PUBLIC_SUPABASE_URL in the staging environment file" };
  }
  if (looksLikePlaceholder(ref)) {
    return {
      ok: false,
      reason: `the staging URL is still the template's placeholder (${ref}) — it names no real project`,
    };
  }
  if (ref === PRODUCTION_PROJECT_REF) {
    return { ok: false, reason: `that URL is the PRODUCTION project (${PRODUCTION_PROJECT_REF})` };
  }
  if (productionUrl && projectRef(productionUrl) === ref) {
    return {
      ok: false,
      reason: `that URL is the project \`.env.local\` points at (${ref}) — production, not staging`,
    };
  }
  if (markerValue === null && checkMarker) {
    return { ok: false, reason: "the database did not answer the staging marker read" };
  }
  if (markerValue !== requiredMarkerValue && checkMarker) {
    return {
      ok: false,
      reason:
        `the database's staging marker is ${JSON.stringify(markerValue)} but this run requires ` +
        `${JSON.stringify(requiredMarkerValue)} — the target has not declared itself as staging`,
    };
  }
  return { ok: true, ref };
}

/** `.env` parser: KEY=VALUE, `#` comments, surrounding quotes stripped. */
export function parseEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

export function readEnvFile(file) {
  return fs.existsSync(file) ? parseEnv(fs.readFileSync(file, "utf8")) : {};
}

/**
 * Load and verify the staging target. Throws `StagingRefused`, never a bare Error, so a
 * caller can exit 2 with the reason and no stack trace.
 *
 * The URL conditions are checked BEFORE any request, so a production URL is not even
 * contacted; the marker read is the only network call this module makes, and it is a
 * GET.
 */
export async function loadStagingTarget({ requireMarker = true } = {}) {
  const file = process.env.SPARKSERV_ENV_FILE
    ? path.resolve(process.env.SPARKSERV_ENV_FILE)
    : path.join(REPO_ROOT, STAGING_ENV_FILE);

  if (!fs.existsSync(file)) {
    throw new StagingRefused(
      `no staging environment file at ${file}. Copy .env.staging.example to ` +
        `${STAGING_ENV_FILE} and fill it in from the sparkserv-staging project (STAGING.md §1).`
    );
  }

  const staging = readEnvFile(file);
  const production = readEnvFile(path.join(REPO_ROOT, ".env.local"));
  const template = readEnvFile(path.join(REPO_ROOT, `${STAGING_ENV_FILE}.example`));

  const url = staging.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = staging.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = staging.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !serviceKey || !anonKey) {
    throw new StagingRefused(
      `${path.basename(file)} is missing NEXT_PUBLIC_SUPABASE_URL, ` +
        `NEXT_PUBLIC_SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY.`
    );
  }

  /**
   * Which values never got filled in? Compared against `${STAGING_ENV_FILE}.example` itself
   * (so this keeps working if the template is edited) and against the placeholder words, so
   * a file that is still a copy of the template is refused as a template — BEFORE any
   * request, and with a message that says what to do instead of "the database did not
   * answer". An unfilled file is the likeliest way to get here, and it must not look like a
   * database problem.
   */
  const unfilled = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"].filter(
    (name) => staging[name] === template[name] || looksLikePlaceholder(staging[name])
  );
  const templateNote = unfilled.length
    ? `\n  still holding the template's placeholder value: ${unfilled.join(", ")}` +
      `\n  fill them in from the sparkserv-staging project (Settings → API; STAGING.md §1)`
    : "";

  // URL conditions only — no marker yet (checkMarker: false), because this refusal must
  // happen before the request that would read the marker. Without this flag the pure rule
  // would answer "did not answer the marker read" for every target, including a correct one.
  const urlVerdict = stagingVerdict({
    stagingUrl: url,
    productionUrl: production.NEXT_PUBLIC_SUPABASE_URL,
    checkMarker: false,
  });
  if (!urlVerdict.ok) {
    throw new StagingRefused(`${urlVerdict.reason}${templateNote}\n  file: ${file}`);
  }
  if (unfilled.length) {
    throw new StagingRefused(`that staging environment file has not been filled in yet:${templateNote}\n  file: ${file}`);
  }

  const markerKey = staging.SPARKSERV_STAGING_MARKER_KEY || DEFAULT_MARKER_KEY;
  const requiredMarkerValue = staging.SPARKSERV_STAGING_MARKER_VALUE || DEFAULT_MARKER_VALUE;

  let markerValue = null;
  if (requireMarker) {
    const endpoint =
      `${url.replace(/\/$/, "")}/rest/v1/system_settings` +
      `?key=eq.${encodeURIComponent(markerKey)}&select=value`;
    try {
      const response = await fetch(endpoint, {
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      });
      if (response.ok) {
        const rows = await response.json();
        markerValue = Array.isArray(rows) && rows.length ? rows[0].value : null;
      } else {
        markerValue = `HTTP ${response.status}`;
      }
    } catch (err) {
      markerValue = `unreachable: ${err.message}`;
    }
  }

  const verdict = stagingVerdict({
    stagingUrl: url,
    productionUrl: production.NEXT_PUBLIC_SUPABASE_URL,
    markerValue: requireMarker ? markerValue : requiredMarkerValue,
    requiredMarkerValue,
  });

  if (!verdict.ok) {
    throw new StagingRefused(
      `${verdict.reason}\n  target: ${url}\n  marker: ${markerKey} (add the row described in ` +
        `${path.basename(file)} and STAGING.md §2)`
    );
  }

  return { url, serviceKey, anonKey, ref: verdict.ref, markerKey, markerValue, file };
}

/** Print a refusal the way every staging script should, and return the exit code. */
export function reportStagingRefusal(error) {
  const reason =
    error instanceof StagingRefused ? error.message : `unexpected: ${error?.message ?? String(error)}`;
  console.error(`\nREFUSED — that is not a verified staging target.\n  ${reason}\n`);
  console.error("Nothing was created, changed or deleted. See STAGING.md.\n");
  return 2;
}

/* ---------------------------------------------------------------- CLI ----- */
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    const target = await loadStagingTarget();
    console.log("staging target VERIFIED");
    console.log(`  file    ${path.relative(REPO_ROOT, target.file)}`);
    console.log(`  project ${target.ref}`);
    console.log(`  marker  ${target.markerKey} = ${JSON.stringify(target.markerValue)}`);
  } catch (error) {
    process.exit(reportStagingRefusal(error));
  }
}
