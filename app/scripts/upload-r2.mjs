// Uploads data/processed/ to the R2 bucket so the authenticated data proxy can
// serve it. The Pages build deletes dist/data afterwards, so the processed
// archive is never reachable as a static asset.
//
// Keys are namespaced per import id -- `processed/{importId}/{file}` -- because
// the proxy reads that same prefix. A single shared `processed/` prefix would
// mean one tenant's crawl overwrites another's bytes while both imports still
// read a completed row in D1.
//
// This uploads the repo's dataset under DEMO_IMPORT_ID (the seeded demo tenant).
// Per-user crawls upload their own prefix from scripts/crawl_from_env.py.
//
// Run from app/: `npm run upload:r2`
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const appRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = path.join(appRoot, "..", "data", "processed");
const BUCKET = "homestand-raw-archive";
const DEMO_IMPORT_ID = "demo-import";

if (!existsSync(src)) {
  console.error(`upload-r2: source not found at ${src} — run sync-data first`);
  process.exit(1);
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (entry.endsWith(".json")) yield full;
  }
}

const files = [...walk(src)];
for (const file of files) {
  const key = `processed/${DEMO_IMPORT_ID}/${path.relative(src, file).split(path.sep).join("/")}`;
  // argv array, never a shell string -- keys come from the filesystem but the
  // command must not be able to expand anything.
  execFileSync("npx", ["wrangler", "r2", "object", "put", `${BUCKET}/${key}`, "--file", file, "--local"], {
    cwd: appRoot,
    stdio: ["ignore", "ignore", "inherit"],
  });
}

// app/lib/collections.ts allowlists these three, but they live in data/manual/
// rather than data/processed/ -- so without this they 404 for the demo tenant too.
// Keep in sync with PROXY_SERVED_MANUAL_FILES in scripts/derive_owner_map.py.
const manual = path.join(appRoot, "..", "data", "manual");
let manualCount = 0;
for (const name of ["retired-owners.json", "jersey-history-overrides.json", "position-overrides.json"]) {
  const file = path.join(manual, name);
  if (!existsSync(file)) continue;
  execFileSync(
    "npx",
    ["wrangler", "r2", "object", "put", `${BUCKET}/processed/${DEMO_IMPORT_ID}/${name}`, "--file", file, "--local"],
    {
      cwd: appRoot,
      stdio: ["ignore", "ignore", "inherit"],
    }
  );
  manualCount++;
}

console.log(
  `upload-r2: uploaded ${files.length} files + ${manualCount} manual overrides to ${BUCKET}/processed/${DEMO_IMPORT_ID}/`
);
