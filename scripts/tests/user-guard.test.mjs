/**
 * Contract tests for "a page never dereferences a possibly-null user".
 *
 *   npm run test:user-guard
 *
 * WHY THIS EXISTS. `getCurrentUser()` returns `null` for three legitimate states:
 * no session, no profile row, and a DEACTIVATED account (`!profile.is_active`).
 * Eighteen page components wrote `user!.id` as if that were impossible, and the
 * middleware checked only the account's ROLE — so an administrator deactivating a
 * customer in `/admin/users` produced this, on the customer's own dashboard:
 *
 *   Error: Cannot read properties of null (reading 'id')
 *   src/app/customer/dashboard/page.tsx (36:32)
 *
 * A white screen, for a customer who had done nothing wrong, with no explanation.
 * Three layers now hold, and each is pinned here:
 *
 *   1. the middleware refuses an INACTIVE account and says why (it already
 *      refused a missing profile or a wrong role);
 *   2. `requireUser()` is the page-level read of the signed-in user, and it
 *      redirects instead of returning null, so a session that expires between the
 *      middleware and the render cannot crash a page either;
 *   3. no `page.tsx` anywhere dereferences a user with `!` — the exact shape of
 *      the crash, which no other test could see because it is valid TypeScript.
 *
 * The page assertions are source-level because this repository has no component
 * runner (see TESTING.md §5).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";

const ROOT = new URL("../../", import.meta.url);

/**
 * Comments are stripped before scanning, exactly as `design-tokens.test.mjs` does.
 * Without this the scan reads its own documentation: the admin dashboard's
 * comment explains that it "used to `await getCurrentUser()` and ignore the
 * answer", which is prose about the old bug, not a call.
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
}

const read = (path) => readFileSync(new URL(path, ROOT), "utf8");
const code = (path) => stripComments(read(path));

/** Every `page.tsx` under a directory, at any depth. */
function pages(dir = "src/app", found = []) {
  for (const entry of readdirSync(new URL(`${dir}/`, ROOT))) {
    const path = `${dir}/${entry}`;
    if (statSync(new URL(path, ROOT)).isDirectory()) pages(path, found);
    else if (entry === "page.tsx") found.push(path);
  }
  return found;
}

const PAGES = pages();

test("no page dereferences a user that may be null", () => {
  const offenders = PAGES.filter((path) => /user!\./.test(code(path)));
  assert.deepEqual(
    offenders,
    [],
    `these pages assert a user exists instead of asking for one that does: ${offenders.join(", ")}`
  );
});

test("the page-level read of the signed-in user redirects instead of returning null", () => {
  const auth = read("src/lib/auth.ts");
  assert.match(auth, /export async function requireUser\(\)/, "auth.ts must export requireUser");
  assert.match(
    auth,
    /if \(!user\) redirect\("\/login"\)/,
    "requireUser must send an unauthenticated visitor to the sign-in screen"
  );
  assert.match(auth, /return user;/, "and only then hand the user back");
});

test("every customer and technician page that needs the user uses the guarded read", () => {
  const guarded = PAGES.filter((path) =>
    /^src\/app\/(customer|technician)\//.test(path.replace(/\\/g, "/"))
  ).filter((path) => read(path).includes("requireUser"));
  assert.ok(
    guarded.length >= 18,
    `expected the customer and technician workspaces to use requireUser, found ${guarded.length}`
  );

  // The two pages that legitimately read the raw call do so to redirect
  // themselves, which is the same answer by hand.
  const raw = PAGES.filter((path) => code(path).includes("getCurrentUser()"));
  for (const path of raw) {
    const source = code(path);
    assert.match(
      source,
      /if \(!user\) redirect\(/,
      `${path} reads getCurrentUser() and must guard the null itself`
    );
  }
});

test("the middleware refuses a deactivated account, and says which it was", () => {
  const middleware = read("src/middleware.ts");
  assert.match(
    middleware,
    /select\("role, is_active"\)/,
    "the role lookup must also read whether the account is active"
  );
  assert.match(
    middleware,
    /if \(!profile\.is_active\)/,
    "an inactive account must be refused before it reaches a page"
  );
  assert.match(
    middleware,
    /\/unauthorized\?reason=inactive/,
    "and the refusal must carry the reason, so the page can explain it"
  );
});

test("the refusal explains a deactivated account in its own words", () => {
  const page = read("src/app/unauthorized/page.tsx");
  assert.match(page, /reason === "inactive"/, "the page must read the reason");
  assert.match(
    page,
    /Account deactivated/,
    "a deactivated customer must be told their account was closed, not that they lack access"
  );
});
