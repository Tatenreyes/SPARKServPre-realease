/**
 * Tests for the installable web app: the manifest, the service worker, the offline
 * fallback and the install offer.
 *
 *   npm run test:pwa
 *
 * WHY THIS FILE EXISTS. The service worker already existed for push notifications,
 * but nothing registered it on an ordinary page load and there was no manifest — so
 * the app could not be installed, which is the one way a capstone competes with the
 * Play-Store apps the rest of this market ships. It also pins the two things that
 * make a service worker dangerous: it must never cache HTML ahead of time, and it
 * must never intercept a write.
 *
 * The most useful assertion here is the dullest one: **every icon the manifest
 * declares must exist on disk.** A manifest that references a missing file fails
 * Chrome's validation with errors, so the app ends up less installable than one that
 * declares nothing at all.
 *
 * What is NOT covered here: whether Chrome actually offers the install prompt, how
 * the icon renders once masked, and whether the offline fallback looks right — all
 * of which need a browser.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const ROOT = new URL("../../", import.meta.url);
const MANIFEST = "src/app/manifest.ts";
const WORKER = "public/sw.js";
const OFFLINE = "src/app/offline/page.tsx";
const PROMPT = "src/components/InstallPrompt.tsx";
const LAYOUT = "src/app/layout.tsx";
const TAILWIND = "tailwind.config.ts";

const manifest = readFileSync(new URL(MANIFEST, ROOT), "utf8");
const worker = readFileSync(new URL(WORKER, ROOT), "utf8");
const offline = readFileSync(new URL(OFFLINE, ROOT), "utf8");
const prompt = readFileSync(new URL(PROMPT, ROOT), "utf8");
const layout = readFileSync(new URL(LAYOUT, ROOT), "utf8");
const tailwind = readFileSync(new URL(TAILWIND, ROOT), "utf8");

/**
 * The file with its comments stripped.
 *
 * The manifest's own header lists the three PNG entries to add once the icons are
 * exported — as an example in a comment. Scanning the raw file made this guard
 * report those as declared-but-missing, so the scan runs on code only.
 */
function withoutComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

// ------------------------------------------------- 1. the manifest

test("the manifest carries what an install needs", () => {
  assert.match(manifest, /name: "/);
  assert.match(manifest, /short_name: "/);
  assert.match(manifest, /start_url: "\/"/);
  assert.match(manifest, /display: "standalone"/, "a browser tab is not an app");
  assert.match(manifest, /theme_color: "/);
  assert.match(manifest, /background_color: "/, "the splash screen must not flash white");
});

test("the manifest wears the app's own colours", () => {
  // The bar colour is brand-600 and the splash field is navy-900, so an installed
  // app opens looking like the product rather than like a web page.
  assert.match(tailwind, /600: "#0E429F"/, "brand-600 moved: update the manifest");
  assert.match(manifest, /theme_color: "#0E429F"/);
  assert.match(manifest, /background_color: "#0E172A"/);
});

test("every icon the manifest declares actually exists", () => {
  const code = withoutComments(manifest);
  const declared = [...code.matchAll(/src: "(\/icons\/[^"]+)"/g)].map((match) => match[1]);
  assert.ok(declared.length > 0, "the manifest declares no icon at all");
  for (const src of declared) {
    assert.ok(
      existsSync(new URL(`public${src}`, ROOT)),
      `${src} is declared in the manifest but missing from public/ — a manifest with a missing icon fails validation`
    );
  }
});

// ------------------------------------------------- 2. the service worker

test("the worker does both of its jobs and nothing else", () => {
  assert.match(worker, /addEventListener\("install"/);
  assert.match(worker, /addEventListener\("activate"/);
  assert.match(worker, /addEventListener\("fetch"/);
  assert.match(worker, /addEventListener\("push"/, "the push handler must survive");
  assert.match(worker, /addEventListener\("notificationclick"/);
});

test("the worker never serves a stale page", () => {
  // Only /offline is cached. A worker that precaches HTML answers a question the
  // server has already changed the answer to — and in an app where a technician
  // accepts a job, that is a wrong answer rather than a slow one.
  const cached = [...worker.matchAll(/cache\.add\(\s*([^)]*)/g)].map((match) => match[1]);
  assert.ok(cached.length > 0, "the offline fallback must be cached, or it cannot work offline");
  for (const target of cached) {
    assert.match(
      target,
      /OFFLINE_URL/,
      `the worker caches ${target.trim()}, but only the offline page may be cached`
    );
  }
});

test("the worker never intercepts a write", () => {
  assert.match(
    worker,
    /if \(request\.method !== "GET" \|\| request\.mode !== "navigate"\) return;/,
    "only a top-level GET navigation may be intercepted: an API call or a POST must reach the network"
  );
});

// ------------------------------------------------- 3. the offline fallback

test("the offline page needs no data to render", () => {
  assert.doesNotMatch(
    offline,
    /createClient|getCurrentUser|await /,
    "it is shown when nothing can be fetched"
  );
  assert.match(offline, /You are offline/);
  // It states the consequence instead of soothing it: a submission that never reached
  // the server is not a queued job.
  assert.match(offline, /send\s+it again when you are back online/i);
  assert.doesNotMatch(offline, /nothing .{0,20}(has been )?lost/i, "that would be a false reassurance");
});

// ------------------------------------------------- 4. the install offer

test("the worker is registered on an ordinary page load", () => {
  assert.match(
    prompt,
    /serviceWorker\.register\("\/sw\.js"\)/,
    "installability cannot depend on the visitor enabling push first"
  );
});

test("the install offer never prompts on its own", () => {
  assert.match(prompt, /addEventListener\("beforeinstallprompt"/);
  assert.match(prompt, /event\.preventDefault\(\)/, "the browser's own mini-infobar must not compete");
  assert.match(prompt, /await deferred\.prompt\(\)/, "the dialog only opens on a press");
  // A dismissal is remembered, so the banner cannot nag on every page.
  assert.match(prompt, /localStorage\.setItem\(DISMISSED_KEY/);
});

test("the root layout mounts it and still declares an iOS icon", () => {
  assert.match(layout, /<InstallPrompt \/>/);
  assert.match(
    layout,
    /apple: "/,
    "iOS ignores the manifest: without an apple-touch-icon the home screen shows a screenshot"
  );
});
