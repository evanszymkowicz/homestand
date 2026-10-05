// Removes dist/data after the Vite build. sync-data.mjs puts the processed
// archive in public/data so Vitest can read fixtures off disk, but shipping it
// as a static asset would make every collection publicly fetchable and bypass
// the authenticated proxy in functions/api/data/. The real copy lives in R2
// (see upload-r2.mjs), which only the proxy can read.
import { existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const appRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const target = path.join(appRoot, "dist", "data");

if (existsSync(target)) {
  rmSync(target, { recursive: true, force: true });
  console.log("strip-public-data: removed dist/data (served from R2 via the authenticated proxy)");
}
