/**
 * Regression guard for the staging safety gate.
 *
 *   npm test   (or: node --test scripts/tests/staging-safety.test.mjs)
 *
 * WHY THIS EXISTS. `scripts/staging-verify-role-sync.mjs` creates accounts, moves roles and
 * demotes super administrators, so pointing it at production would corrupt real accounts.
 * The gate in `scripts/staging-safety.mjs` is the only thing between a mistyped environment
 * variable and that outcome — which makes it exactly the code that must not be taken on
 * trust. Its rules are a pure function, and they are pinned here.
 *
 * The verdict tests need no network and no database: the marker value is an argument.
 * The loader tests use a throwaway file in the system temp directory and assert that a
 * production URL is refused WITHOUT any request being made — the refusal happens on the
 * URL alone.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  PRODUCTION_PROJECT_REF,
  projectRef,
  looksLikePlaceholder,
  parseEnv,
  stagingVerdict,
  loadStagingTarget,
  StagingRefused,
} from "../staging-safety.mjs";

const ROOT = new URL("../../", import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), "utf8");
const exists = (p) => existsSync(new URL(p, ROOT));

const STAGING_URL = "https://stagingprojref.supabase.co";
const PRODUCTION_URL = `https://${PRODUCTION_PROJECT_REF}.supabase.co`;
const GOOD_MARKER = "sparkserv-staging";

test("a production URL is refused however it is reached", () => {
  const byRef = stagingVerdict({ stagingUrl: PRODUCTION_URL, markerValue: GOOD_MARKER });
  assert.equal(byRef.ok, false);
  assert.match(byRef.reason, /PRODUCTION project/);

  // The same project behind a path or trailing slash is still the same project.
  const trailing = stagingVerdict({ stagingUrl: `${PRODUCTION_URL}/`, markerValue: GOOD_MARKER });
  assert.equal(trailing.ok, false);

  // And even a project ref we have never seen is refused when `.env.local` points at it —
  // a rotated production project must not become a free pass just because the constant
  // above is stale.
  const rotated = stagingVerdict({
    stagingUrl: "https://someotherref.supabase.co",
    productionUrl: "https://someotherref.supabase.co",
    markerValue: GOOD_MARKER,
  });
  assert.equal(rotated.ok, false);
  assert.match(rotated.reason, /\.env\.local/);
});

test("the staging marker is the second lock, and it is required", () => {
  const missing = stagingVerdict({ stagingUrl: STAGING_URL, markerValue: null });
  assert.equal(missing.ok, false, "a database that did not answer must not be accepted");

  const wrong = stagingVerdict({ stagingUrl: STAGING_URL, markerValue: "production" });
  assert.equal(wrong.ok, false);
  assert.match(wrong.reason, /not declared itself as staging/);

  const unreadable = stagingVerdict({ stagingUrl: STAGING_URL, markerValue: "HTTP 404" });
  assert.equal(unreadable.ok, false, "a missing system_settings table is a refusal, not a pass");

  const good = stagingVerdict({ stagingUrl: STAGING_URL, markerValue: GOOD_MARKER });
  assert.equal(good.ok, true);
  assert.equal(good.ref, "stagingprojref");
});

test("an unusable URL is refused rather than guessed at", () => {
  for (const value of [undefined, null, "", "   ", "not-a-url", "example.com"]) {
    const verdict = stagingVerdict({ stagingUrl: value, markerValue: GOOD_MARKER });
    assert.equal(verdict.ok, false, `expected ${JSON.stringify(value)} to be refused`);
  }
  assert.equal(projectRef("https://abc.supabase.co"), "abc");
  assert.equal(projectRef("nonsense"), null);
});

test("template placeholders are recognised, real values are not", () => {
  for (const value of [
    "YOUR_STAGING_PROJECT_REF",
    "https://YOUR_STAGING_PROJECT_REF.supabase.co",
    "your-staging-anon-publishable-key",
    "  YourSenderName  ",
  ]) {
    assert.equal(looksLikePlaceholder(value), true, `${value} should read as a placeholder`);
  }

  for (const value of [
    "stagingprojref",
    STAGING_URL,
    PRODUCTION_PROJECT_REF,
    "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.x",
    "sb_publishable_abc123",
    "",
    null,
    undefined,
  ]) {
    assert.equal(looksLikePlaceholder(value), false, `${value} must not be mistaken for a placeholder`);
  }
});

test("a placeholder URL is refused even when the database answers with the marker", () => {
  // The marker is the third lock, not a rescue: a URL that names no project cannot be made
  // acceptable by anything the database says.
  const verdict = stagingVerdict({
    stagingUrl: "https://YOUR_STAGING_PROJECT_REF.supabase.co",
    markerValue: GOOD_MARKER,
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /placeholder/);
});

test("the env parser reads what the env files actually contain", () => {
  const env = parseEnv(
    [
      "# a comment",
      "NEXT_PUBLIC_SUPABASE_URL=https://x.supabase.co",
      'SUPABASE_SERVICE_ROLE_KEY="quoted-value"',
      "",
      "SPARKSERV_STAGING_MARKER_VALUE='sparkserv-staging'",
    ].join("\n")
  );
  assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, "https://x.supabase.co");
  assert.equal(env.SUPABASE_SERVICE_ROLE_KEY, "quoted-value");
  assert.equal(env.SPARKSERV_STAGING_MARKER_VALUE, "sparkserv-staging");
});

/* --------------------------------------------------------------------- loader -- */

test("with no staging environment file, nothing is contacted and nothing runs", async () => {
  const missing = path.join(tmpdir(), `sparkserv-absent-${Date.now()}.env`);
  process.env.SPARKSERV_ENV_FILE = missing;
  try {
    await assert.rejects(loadStagingTarget(), (error) => {
      assert.ok(error instanceof StagingRefused);
      assert.match(error.message, /no staging environment file/);
      return true;
    });
  } finally {
    delete process.env.SPARKSERV_ENV_FILE;
  }
});

test("a staging file holding the PRODUCTION url is refused before any request", async () => {
  const file = path.join(tmpdir(), `sparkserv-prod-${Date.now()}.env`);
  // A real key is NOT needed: the URL check runs first, so the refusal must not depend on
  // reaching the network (the host in this file is production's).
  writeFileSync(
    file,
    [
      `NEXT_PUBLIC_SUPABASE_URL=${PRODUCTION_URL}`,
      "NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder",
      "SUPABASE_SERVICE_ROLE_KEY=placeholder",
    ].join("\n")
  );
  process.env.SPARKSERV_ENV_FILE = file;
  try {
    await assert.rejects(loadStagingTarget(), (error) => {
      assert.ok(error instanceof StagingRefused, `expected a refusal, got ${error?.constructor?.name}`);
      assert.match(error.message, /PRODUCTION project|\.env\.local/);
      return true;
    });
  } finally {
    delete process.env.SPARKSERV_ENV_FILE;
    rmSync(file, { force: true });
  }
});

test("an unfilled copy of the template is refused as a template, before any request", async () => {
  const file = path.join(tmpdir(), `sparkserv-template-${Date.now()}.env`);
  // A verbatim copy of the template is the likeliest mistake of all, and it must NOT be
  // reported as a database problem — an operator sent looking at their database when the
  // real answer is "you copied the file and never filled it in" loses the afternoon.
  writeFileSync(file, read(".env.staging.example"));
  process.env.SPARKSERV_ENV_FILE = file;
  try {
    await assert.rejects(loadStagingTarget(), (error) => {
      assert.ok(error instanceof StagingRefused);
      assert.match(error.message, /template|placeholder/);
      assert.match(error.message, /NEXT_PUBLIC_SUPABASE_URL/, "and it names what to fill in");
      assert.doesNotMatch(error.message, /did not answer/, "the refusal must not come from the marker read");
      return true;
    });
  } finally {
    delete process.env.SPARKSERV_ENV_FILE;
    rmSync(file, { force: true });
  }
});

test("a real URL with template keys is refused by name, before any request", async () => {
  const file = path.join(tmpdir(), `sparkserv-keys-${Date.now()}.env`);
  const template = parseEnv(read(".env.staging.example"));
  // A plausible project URL, but the keys were never replaced. The host is a real-looking
  // ref, so a request would be a real request — the refusal has to happen before that.
  writeFileSync(
    file,
    [
      `NEXT_PUBLIC_SUPABASE_URL=${STAGING_URL}`,
      `NEXT_PUBLIC_SUPABASE_ANON_KEY=${template.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
      `SUPABASE_SERVICE_ROLE_KEY=${template.SUPABASE_SERVICE_ROLE_KEY}`,
    ].join("\n")
  );
  process.env.SPARKSERV_ENV_FILE = file;
  try {
    await assert.rejects(loadStagingTarget(), (error) => {
      assert.ok(error instanceof StagingRefused);
      assert.match(error.message, /has not been filled in/);
      assert.match(error.message, /NEXT_PUBLIC_SUPABASE_ANON_KEY/);
      assert.match(error.message, /SUPABASE_SERVICE_ROLE_KEY/);
      assert.doesNotMatch(error.message, /did not answer/, "the refusal must not come from the marker read");
      return true;
    });
  } finally {
    delete process.env.SPARKSERV_ENV_FILE;
    rmSync(file, { force: true });
  }
});

test("a filled-in staging file whose database carries the marker is ACCEPTED", async () => {
  // The success path, pinned. Without this test the loader could refuse every target —
  // including a correct one — and the unit tests would all still pass, because each of them
  // expects a refusal. The marker read is a GET, so it is safe to stub here: this proves the
  // request the gate makes (URL, query, and that the service key is what is sent), not the
  // network.
  const file = path.join(tmpdir(), `sparkserv-good-${Date.now()}.env`);
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), headers: options.headers ?? {} });
    return new Response(JSON.stringify([{ value: GOOD_MARKER }]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    writeFileSync(
      file,
      [
        `NEXT_PUBLIC_SUPABASE_URL=${STAGING_URL}`,
        "NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_test_only",
        "SUPABASE_SERVICE_ROLE_KEY=sb_secret_test_only",
      ].join("\n")
    );
    process.env.SPARKSERV_ENV_FILE = file;

    const target = await loadStagingTarget();
    assert.equal(target.ref, "stagingprojref");
    assert.equal(target.markerValue, GOOD_MARKER);
    assert.equal(target.url, STAGING_URL);

    assert.equal(calls.length, 1, "the marker read is the only request the gate makes");
    assert.match(
      calls[0].url,
      /^https:\/\/stagingprojref\.supabase\.co\/rest\/v1\/system_settings\?key=eq\.staging_environment&select=value$/
    );
    assert.ok(calls[0].headers.apikey?.startsWith("sb_secret_"), "it must authenticate with the service key");
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.SPARKSERV_ENV_FILE;
    rmSync(file, { force: true });
  }
});

/* ------------------------------------------------------------------ wiring ---- */

test("the staging scripts are wired in, and the verify script stays out of the offline suite", () => {
  assert.ok(exists("scripts/staging-verify-role-sync.mjs"), "the staging verify script is missing");
  assert.ok(
    !exists("scripts/tests/staging-verify-role-sync.test.mjs"),
    "it must not be reachable from the `scripts/tests/*.test.mjs` glob `npm test` runs — it writes"
  );

  const pkg = read("package.json");
  assert.match(pkg, /"staging:verify-role-sync": "node scripts\/staging-verify-role-sync\.mjs"/);
  assert.match(pkg, /"staging:safety": "node scripts\/staging-safety\.mjs"/);
  assert.match(
    pkg,
    /"test:staging-safety": "node --test scripts\/tests\/staging-safety\.test\.mjs"/,
    "the gate's own tests must be runnable on their own"
  );
});

test("the verify script goes through the gate before it builds any client", () => {
  const script = read("scripts/staging-verify-role-sync.mjs");

  const gate = script.indexOf("loadStagingTarget()");
  const client = script.indexOf("createClient(");
  assert.notEqual(gate, -1, "it must load and verify the target");
  assert.ok(gate < client, "the target must be verified before a Supabase client exists");
  assert.match(script, /reportStagingRefusal/, "and a refusal must exit with the guard's own words");
  assert.match(
    script,
    /function assertThrowaway\(/,
    "it must refuse to change the role of an account this run did not create"
  );
  assert.match(script, /Promise\.all\(\[/, "and it must genuinely fire the two demotions together");
  assert.match(script, /admin\.auth\.admin\.deleteUser/, "cleanup must delete what it created");
  assert.match(script, /activeSuperAdmins/, "and it must check the project keeps an administrator");
});

test("the staging template is a template, and the real file is ignored", () => {
  const example = read(".env.staging.example");

  assert.ok(example.includes("YOUR_STAGING_PROJECT_REF"), "the URL must be a placeholder");
  assert.ok(!example.includes(PRODUCTION_PROJECT_REF), "the template must not name the production project");
  assert.doesNotMatch(example, /sb_secret_|sb_publishable_|eyJ/, "and must carry no real key material");
  assert.match(
    example,
    /SPARKSERV_STAGING_MARKER_VALUE=sparkserv-staging/,
    "it documents the marker the gate checks"
  );

  const ignore = read(".gitignore");
  assert.match(ignore, /^\.env\.staging$/m, "the real staging file must be ignored");
  assert.match(ignore, /^\.env\*\.local$/m, "and the local one stays ignored");
});
