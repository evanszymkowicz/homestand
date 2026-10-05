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

// retired-owners.json is hand-maintained (not pipeline output, unlike the
// rest of data/manual/, which only feeds the Python normalize step) --
// synced individually so the app can read it directly.
const retiredOwnersSrc = path.join(dataRoot, "manual", "retired-owners.json");
const retiredOwnersDest = path.join(dest, "retired-owners.json");
if (existsSync(retiredOwnersSrc)) {
  cpSync(retiredOwnersSrc, retiredOwnersDest);
  console.log(`sync-data: copied ${retiredOwnersSrc} -> ${retiredOwnersDest}`);
}

// jersey-history-overrides.json is likewise hand-maintained (pre-2017 jersey
// numbers ESPN never reported, backfilled from the MLB Stats API) -- synced
// individually so the app can read it directly.
const jerseyOverridesSrc = path.join(dataRoot, "manual", "jersey-history-overrides.json");
const jerseyOverridesDest = path.join(dest, "jersey-history-overrides.json");
if (existsSync(jerseyOverridesSrc)) {
  cpSync(jerseyOverridesSrc, jerseyOverridesDest);
  console.log(`sync-data: copied ${jerseyOverridesSrc} -> ${jerseyOverridesDest}`);
}

// position-overrides.json is hand-maintained where ESPN's declared default_position_id doesn't match a season's real primary position.
// synced individually so the app can read it directly.
const positionOverridesSrc = path.join(dataRoot, "manual", "position-overrides.json");
const positionOverridesDest = path.join(dest, "position-overrides.json");
if (existsSync(positionOverridesSrc)) {
  cpSync(positionOverridesSrc, positionOverridesDest);
  console.log(`sync-data: copied ${positionOverridesSrc} -> ${positionOverridesDest}`);
}
