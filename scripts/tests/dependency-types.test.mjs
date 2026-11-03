/**
 * Tests for the type declarations the production build needs.
 *
 *   npm run test:dependency-types
 *
 * WHY THIS FILE EXISTS. `next build` type-checks everything under `src/`, and
 * `next.config.js` does not set `typescript.ignoreBuildErrors`, so a missing
 * declaration file is a failed deployment rather than a warning. That is what
 * happened on 4 Nov: the Leaflet map landed with `leaflet` and `react-leaflet` in
 * `package.json` but no `@types/leaflet`, and the Vercel build died on
 *
 *   ./src/components/LeafletLocationMap.tsx:17:15
 *   Type error: Could not find a declaration file for module 'leaflet'
 *
 * `leaflet` ships plain JavaScript (`"main": "dist/leaflet-src.js"`, no `types`
 * field) and so does `web-push` (`"main": "src/index.js"`), which `src/lib/push.ts`
 * imports for the notification routes. Neither can type-check without its
 * DefinitelyTyped package, and neither is a development tool: they are imported by
 * code that ships, so their declarations are a **build input** and belong in
 * `dependencies`. A Vercel install that omits dev-dependencies — a
 * `NODE_ENV=production` project variable, or a customised install command — drops
 * dev-dependencies silently, and the failure then surfaces as a type error in a
 * source file nobody touched.
 *
 * The first half pins those two packages: declared as production dependencies,
 * present in the lockfile's root dependency set, NOT flagged `dev` inside the
 * lockfile (a `dev` flag is what `--omit=dev` prunes), and resolvable on disk.
 *
 * The second half reads every bare import under `src/` and asks the compiler's own
 * module resolver where that package goes — the same call `next build` makes — so a
 * dependency that resolves to JavaScript instead of a declaration file fails here,
 * in a test, instead of in a deployment. That is the assertion which would have
 * caught the original defect, and it catches the next library anybody adds.
 *
 * What is NOT covered here: whether the declarations are CORRECT — only the
 * compiler proves that, and `npm run build` is the run that does — and whether a
 * deployment really installs with dev-dependencies omitted, which is a project
 * setting this repository cannot read.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");
const readJson = (path) => JSON.parse(read(path));

const manifest = readJson("package.json");
const lock = readJson("package-lock.json");

const dependencies = manifest.dependencies ?? {};
const devDependencies = manifest.devDependencies ?? {};
const lockRoot = lock.packages[""];
const lockDependencies = lockRoot.dependencies ?? {};
const lockDevDependencies = lockRoot.devDependencies ?? {};

/**
 * The runtime packages this app imports that ship no types of their own, and the
 * DefinitelyTyped package each one needs. If a library ever starts shipping its own
 * declarations, the "still needed" test below fails and says so, so this list can
 * only rot loudly.
 */
const UNTYPED_RUNTIME_PACKAGES = {
  leaflet: "@types/leaflet",
  "web-push": "@types/web-push",
};

const nodeModulesInstalled =
  existsSync(new URL("node_modules/react/package.json", ROOT)) &&
  existsSync(new URL("node_modules/typescript/package.json", ROOT));
const NO_NODE_MODULES = "node_modules is not installed — run npm ci first";

/** `@scope/pkg/deep/path` → `@scope/pkg`; `pkg/deep/path` → `pkg`. */
function packageRoot(specifier) {
  const segments = specifier.split("/");
  return specifier.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0];
}

/** DefinitelyTyped's name for a package: `@scope/pkg` → `@types/scope__pkg`. */
function typesNameFor(packageName) {
  return `@types/${packageName.replace(/^@/, "").replace("/", "__")}`;
}

const BUILTINS = new Set([
  "assert", "buffer", "child_process", "crypto", "events", "fs", "http", "https",
  "os", "path", "process", "stream", "string_decoder", "timers", "tls", "url",
  "util", "v8", "vm", "zlib",
]);

/** Project paths, Node built-ins and the `@/` alias are not npm packages. */
function isLocalSpecifier(specifier) {
  return (
    specifier.startsWith(".") ||
    specifier.startsWith("@/") ||
    specifier.startsWith("node:") ||
    BUILTINS.has(specifier)
  );
}

/** The installed package's own `package.json`, or null when it is not installed. */
function installedPackage(packageName) {
  const path = new URL(`node_modules/${packageName}/package.json`, ROOT);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

/** The compiler options `next build` uses, read straight from `tsconfig.json`. */
function compilerOptions() {
  const configPath = fileURLToPath(new URL("tsconfig.json", ROOT));
  const { config } = ts.readConfigFile(configPath, ts.sys.readFile);
  return ts.parseJsonConfigFileContent(config, ts.sys, fileURLToPath(ROOT)).options;
}

/**
 * Where TypeScript sends a bare import when it type-checks a file in `src/`, or null
 * when it cannot resolve the package at all.
 *
 * This is the compiler's own resolver — the same call `next build` makes — so it is
 * the compiler's own answer to "can this import be type-checked?". Guessing from
 * `types`/`typings` fields would be wrong: `@supabase/ssr` declares neither and still
 * resolves, because its declaration files sit beside its `main` entry point.
 */
function resolveFromSource(packageName, options) {
  const containingFile = fileURLToPath(new URL("src/app/layout.tsx", ROOT));
  const resolved = ts.resolveModuleName(packageName, containingFile, options, ts.sys).resolvedModule;
  return resolved?.resolvedFileName?.replace(/\\/g, "/") ?? null;
}

/** Every `.ts`/`.tsx` file under `src/`, relative to the repository root. */
function sourceFiles(directory = "src", found = []) {
  for (const entry of readdirSync(new URL(`${directory}/`, ROOT), { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) sourceFiles(path, found);
    else if (/\.(ts|tsx)$/.test(entry.name)) found.push(path);
  }
  return found;
}

const IMPORT_PATTERNS = [
  /\bfrom\s*["']([^"']+)["']/g,
  /\bimport\s*\(\s*["']([^"']+)["']/g,
  /\brequire\s*\(\s*["']([^"']+)["']/g,
];

/** Every module specifier the file imports, however it is imported. */
function importsIn(text) {
  const specifiers = new Set();
  for (const pattern of IMPORT_PATTERNS) {
    for (const [, specifier] of text.matchAll(pattern)) specifiers.add(specifier);
  }
  return specifiers;
}

test("the declarations a deployment needs are production dependencies", () => {
  for (const [runtime, types] of Object.entries(UNTYPED_RUNTIME_PACKAGES)) {
    assert.ok(
      dependencies[runtime],
      `${runtime} is imported by src/ and must stay a runtime dependency`,
    );
    assert.ok(
      dependencies[types],
      `${types} must be in "dependencies", not "devDependencies": an install that ` +
        `omits dev-dependencies leaves the import untyped and next build fails`,
    );
    assert.equal(
      devDependencies[types],
      undefined,
      `${types} is listed in both blocks — keep it in "dependencies" only`,
    );

    assert.equal(
      lockDependencies[types],
      dependencies[types],
      `package-lock.json must resolve ${types} from the root dependency set, or npm ci installs without it`,
    );
    assert.equal(
      lockDevDependencies[types],
      undefined,
      `${types} must not be a lockfile devDependency`,
    );

    const entry = lock.packages[`node_modules/${types}`];
    assert.ok(entry, `package-lock.json has no entry for ${types} — run npm install`);
    assert.notEqual(
      entry.dev,
      true,
      `${types} is flagged "dev" in package-lock.json, so an install with --omit=dev ` +
        `prunes it even though package.json calls it a dependency`,
    );
  }
});

test(
  "the declarations those packages need resolve on disk",
  { skip: nodeModulesInstalled ? false : NO_NODE_MODULES },
  () => {
    for (const [runtime, types] of Object.entries(UNTYPED_RUNTIME_PACKAGES)) {
      const pkg = installedPackage(types);
      assert.ok(pkg, `${types} is not installed — run npm ci`);

      const entryPoint = pkg.types ?? pkg.typings;
      assert.ok(entryPoint, `${types} declares no types entry point`);
      assert.ok(
        existsSync(new URL(`node_modules/${types}/${entryPoint}`, ROOT)),
        `node_modules/${types}/${entryPoint} is missing, so TypeScript cannot read it`,
      );

      assert.ok(installedPackage(runtime), `${runtime} is not installed — run npm ci`);
    }
  },
);

test(
  "each untyped runtime package still needs its @types package",
  { skip: nodeModulesInstalled ? false : NO_NODE_MODULES },
  () => {
    const options = compilerOptions();
    for (const [runtime, types] of Object.entries(UNTYPED_RUNTIME_PACKAGES)) {
      const resolved = resolveFromSource(runtime, options);
      assert.ok(resolved, `TypeScript cannot resolve ${runtime} from src/ at all`);
      assert.ok(
        resolved.endsWith(".d.ts"),
        `TypeScript resolves ${runtime} to ${resolved}, which is JavaScript — ${types} is ` +
          `not installed or not readable, so next build would fail with ` +
          `"Could not find a declaration file"`,
      );
      assert.ok(
        resolved.includes(`/node_modules/${types}/`),
        `${runtime} no longer needs ${types}: it now resolves to ${resolved}. Drop the ` +
          `${types} entry from package.json and from UNTYPED_RUNTIME_PACKAGES in this file`,
      );
    }
  },
);

test(
  "every dependency imported by src/ resolves to declarations",
  { skip: nodeModulesInstalled ? false : NO_NODE_MODULES },
  () => {
    const options = compilerOptions();
    const resolutions = new Map();
    const offenders = [];

    for (const file of sourceFiles()) {
      for (const specifier of importsIn(read(file))) {
        if (isLocalSpecifier(specifier)) continue;

        const root = packageRoot(specifier);
        // Only shipped dependencies are in scope: anything that is not a runtime
        // dependency cannot reach a deployment at all.
        if (!dependencies[root]) continue;

        if (!resolutions.has(root)) resolutions.set(root, resolveFromSource(root, options));
        const resolved = resolutions.get(root);
        if (resolved?.endsWith(".d.ts")) continue;

        offenders.push(
          `${file} imports "${specifier}", but TypeScript resolves ${root} to ` +
            `${resolved ?? "nothing"}, so next build would fail with ` +
            `"Could not find a declaration file" — declare ${typesNameFor(root)}`,
        );
      }
    }

    assert.deepEqual([...new Set(offenders)], []);
  },
);

