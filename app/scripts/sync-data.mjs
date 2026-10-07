// Copies data/processed/ into public/data/ for the dev server,
// tests that read fixture data off disk, and the Pages build
// (where the bundled copy is served as static JSON instead of
// through a D1-backed Pages Function). Never edit public/data/
// directly.
import { cpSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const appRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataRoot = path.join(appRoot, "..", "data");
const src = path.join(dataRoot, "processed");
const dest = path.join(appRoot, "public", "data");

if (!existsSync(src)) {
  console.error(`sync-data: source not found at ${src}`);
  process.exit(1);
}

cpSync(src, dest, { recursive: true });
console.log(`sync-data: copied ${src} -> ${dest}`);

// These three live in data/manual/ rather than data/processed/ (the bulk copy
// above), because they are hand-maintained rather than pipeline output:
// retired-owners.json is the league's departed members, jersey-history-overrides
// backfills pre-2017 numbers ESPN never reported, and position-overrides fixes
// player_seasons.json's declared primary position. All three are allowlisted by
// app/lib/collections.ts, so the proxy serves them alongside the archive.
for (const name of ["retired-owners.json", "jersey-history-overrides.json", "position-overrides.json"]) {
  const src = path.join(dataRoot, "manual", name);
  if (!existsSync(src)) continue;
  cpSync(src, path.join(dest, name));
  console.log(`sync-data: copied ${src} -> ${path.join(dest, name)}`);
}
