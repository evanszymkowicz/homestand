#!/usr/bin/env node
// Harness-neutral advisory check for a file that was just edited.
//
// Usage: check-changed-file.mjs [--strict] <file-path>
// Two checks:
//   1. Credential scan — warn if an espn_s2-style token appears in any file, or
//      a SWID leaks outside data/raw/ + data/audit/ (raw payloads legitimately
//      contain member GUIDs, which ARE member SWIDs). config.json is gitignored.
//   2. Ruff — lint + format-check .py files, if ruff is available.
// Findings go to stdout so any agent harness can feed them back into the turn.
// Advisory by default (always exit 0); with --strict, exits 1 when credentials
// are found — used by .githooks/pre-commit to block commits.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
// Catches the owner's own SWID (from gitignored config.json) pasted bare into a
// file — the keyed regex below only fires on swid-shaped key/value dumps.
function matchesConfigSwid(content, projectDir) {
  const cfgPath = path.join(projectDir, "config.json");
  if (!existsSync(cfgPath)) return false;
  try {
    const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
    return typeof cfg.swid === "string" && cfg.swid.length >= 16 && content.includes(cfg.swid);
  } catch {
    return false;
  }
}



const args = process.argv.slice(2);
const strict = args.includes("--strict");
const filePath = args.find((a) => !a.startsWith("--"));
if (!filePath || !existsSync(filePath)) process.exit(0);

const projectDir = process.env.PROJECT_DIR || process.cwd();
const rel = path.relative(projectDir, path.resolve(process.cwd(), filePath));
const messages = [];
let credentialLeak = false;

// --- 1. Credential scan (skip config.json — cookies belong there, gitignored) ---
if (path.basename(filePath) !== "config.json") {
  try {
    const statMax = 2 * 1024 * 1024; // don't scan huge files
    const content = readFileSync(filePath, "utf8");
    if (content.length <= statMax) {
      // Raw payloads legitimately carry member GUIDs (= member SWIDs, see
      // scripts/lib/schema.py); only an espn_s2 token is a real leak there.
      const inRawArchive = rel.startsWith("data/raw/") || rel.startsWith("data/audit/");
      const espnS2 = /espn_s2['"\s:=]+[A-Za-z0-9%+/]{40,}/i;
      const swidKeyed = /swid['"\s:=]+\{?[0-9A-Fa-f]{8}(-[0-9A-Fa-f]{4}){3}-[0-9A-Fa-f]{12}\}?/i;
      const leak =
        espnS2.test(content) ||
        (!inRawArchive && (swidKeyed.test(content) || matchesConfigSwid(content, projectDir)));
      if (leak) {
        credentialLeak = true;
        messages.push(
          `Possible ESPN credential (espn_s2 token or SWID GUID) in ${rel}. ` +
            "Cookies belong ONLY in the gitignored config.json — remove them from " +
            "this file (and from any logs/reports it generates).",
        );
      }
    }
  } catch {
    // unreadable/binary — skip silently
  }
}

// --- 2. Ruff on Python files ---
if (filePath.endsWith(".py")) {
  const candidates = [
    path.join(projectDir, ".venv", "bin", "ruff"),
    "ruff", // PATH fallback
  ];
  const ruff = candidates.find((c) => c === "ruff" || existsSync(c));
  for (const cmdArgs of [
    ["check", filePath],
    ["format", "--check", filePath],
  ]) {
    try {
      execFileSync(ruff, cmdArgs, {
        cwd: projectDir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      if (err.code === "ENOENT") break; // ruff not installed — skip silently
      const out = `${err.stdout ?? ""}${err.stderr ?? ""}`.trim();
      if (out) messages.push(`ruff ${cmdArgs[0]} on ${rel}:\n${out}`);
    }
  }
}

if (messages.length > 0) {
  const MAX = 4000;
  let combined = messages.join("\n\n");
  if (combined.length > MAX) combined = `${combined.slice(0, MAX)}\n…(truncated)`;
  process.stdout.write(`Advisory findings for ${rel}:\n\n${combined}\n`);
}

process.exit(strict && credentialLeak ? 1 : 0);
