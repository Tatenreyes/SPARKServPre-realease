#!/usr/bin/env node
/**
 * Does the manuscript still describe this codebase?
 * =================================================
 *
 *   npm run manuscript:check
 *
 * MANUSCRIPT_REVISION.md and MANUSCRIPT_CORRECTIONS.md cite source files, test files and commands
 * as the evidence for their claims (Appendix A). A citation is only worth anything if the thing it
 * points at exists — and a document that survives a refactor by pointing at deleted files is worse
 * than no document, because it reads as verified.
 *
 * WHAT THIS CHECKS. Every backticked path in those two files that looks like a repository path
 * (`src/...`, `supabase/...`, `scripts/...`, `public/...`) must exist. Every `npm run <script>`
 * named must be a script in package.json. Nothing else — it cannot tell whether a claim is TRUE,
 * only whether its evidence is still there.
 *
 * READ-ONLY. Exit code 0 when every citation resolves.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const DOCUMENTS = ["MANUSCRIPT_REVISION.md", "MANUSCRIPT_CORRECTIONS.md"];

const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const scripts = new Set(Object.keys(pkg.scripts ?? {}));

/** Repository-relative paths, as they appear inside backticks in the documents. */
const PATH_PREFIXES = ["src/", "supabase/", "scripts/", "public/"];

let checkedPaths = 0;
let checkedScripts = 0;
const missingPaths = [];
const missingScripts = [];

for (const document of DOCUMENTS) {
  const file = path.join(repoRoot, document);
  if (!fs.existsSync(file)) continue;

  const text = fs.readFileSync(file, "utf8");

  // Only backticked spans are citations; prose is not a citation.
  for (const match of text.matchAll(/`([^`\n]+)`/g)) {
    const token = match[1].trim();

    // `npm run <script>` — the script must exist.
    const npm = /^npm run ([a-z0-9:_-]+)$/i.exec(token);
    if (npm) {
      checkedScripts += 1;
      if (!scripts.has(npm[1])) missingScripts.push(`${document}: npm run ${npm[1]}`);
      continue;
    }

    // A repository path. A trailing directory or a glob is accepted as-is; anything else must
    // resolve on disk. A path may carry a line reference (`file.ts:218`) — strip it first.
    const candidate = token.split(":")[0].replace(/\/$/, "");
    if (!PATH_PREFIXES.some((prefix) => candidate.startsWith(prefix))) continue;
    if (candidate.includes("*")) continue; // a glob (e.g. `supabase/migration_*.sql`)

    checkedPaths += 1;
    if (!fs.existsSync(path.join(repoRoot, candidate))) {
      missingPaths.push(`${document}: ${candidate}`);
    }
  }
}

for (const line of missingPaths) console.error(`missing path   — ${line}`);
for (const line of missingScripts) console.error(`missing script — ${line}`);

const problems = missingPaths.length + missingScripts.length;

if (problems) {
  console.error(
    `\n${problems} citation(s) point at something that does not exist.\n` +
      `The manuscript cites these as evidence; fix the document or the code.`
  );
  process.exit(1);
}

console.log(
  `manuscript citations resolve — ${checkedPaths} path(s), ${checkedScripts} npm script(s), ` +
    `${DOCUMENTS.length} document(s) checked`
);
