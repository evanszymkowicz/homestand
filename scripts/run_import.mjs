#!/usr/bin/env node
/** Trigger a local import crawl for a given import ID.
 *
 * Requires Wrangler to be logged in and the D1 database to have the import row
 * plus encrypted credentials. It does NOT read the credentials itself; it
 * shell-exports them into the environment of the Python worker.
 *
 * Every child process is spawned with an argv array -- never a shell string.
 * The import id reaches us from an API response, so interpolating it into a
 * `"..."` shell command is arbitrary code execution.
 */
import { execFileSync, spawnSync } from "node:child_process";
import process from "node:process";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../app");
const repoDir = path.resolve(appDir, "..");

const { values } = parseArgs({ options: { importId: { type: "string" } } });
const importId = values.importId;
if (!importId) {
  console.error("--importId is required");
  process.exit(1);
}

// Import ids are UUIDs. Reject anything else rather than relying on the caller.
if (!/^[0-9a-fA-F-]{1,64}$/.test(importId)) {
  console.error("--importId must be a UUID-ish token ([0-9a-f-], max 64 chars)");
  process.exit(1);
}

function d1Query(sql) {
  const out = execFileSync(
    "npx",
    ["wrangler", "d1", "execute", "homestand-db", "--local", "--command", sql],
    { cwd: appDir, encoding: "utf-8" }
  );
  const jsonStart = out.indexOf("[");
  if (jsonStart === -1) throw new Error(`No JSON in d1 output:\n${out}`);
  return JSON.parse(out.slice(jsonStart))[0];
}

const importRows = d1Query(
  `SELECT account_id, league_id, year_start, year_end FROM imports WHERE id = '${importId}'`
);
const credRows = d1Query(
  `SELECT encrypted_espn_s2, encrypted_swid FROM espn_credentials WHERE import_id = '${importId}'`
);

const importRow = importRows.results[0];
const credRow = credRows.results[0];
if (!importRow || !credRow) {
  console.error("Import or credentials not found");
  process.exit(1);
}
if (!credRow.encrypted_espn_s2 || !credRow.encrypted_swid) {
  console.error("Import has no stored ESPN session. Save cookies first.");
  process.exit(1);
}

const encryptionKey = process.env.CREDENTIALS_ENCRYPTION_KEY;
if (!encryptionKey) {
  console.error("CREDENTIALS_ENCRYPTION_KEY env var is required");
  process.exit(1);
}

const env = {
  ...process.env,
  ESPN_IMPORT_ID: importId,
  ESPN_LEAGUE_ID: String(importRow.league_id),
  ESPN_YEAR_START: String(importRow.year_start),
  ESPN_YEAR_END: String(importRow.year_end),
  ESPN_S2_ENCRYPTED: credRow.encrypted_espn_s2,
  ESPN_SWID_ENCRYPTED: credRow.encrypted_swid,
  CREDENTIALS_ENCRYPTION_KEY: encryptionKey,
};

const result = spawnSync("python3", ["scripts/crawl_from_env.py"], {
  cwd: repoDir,
  env,
  stdio: "inherit",
});

process.exit(result.status ?? 1);
