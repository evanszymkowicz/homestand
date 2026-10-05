#!/usr/bin/env node
// Harness-neutral guard: refuse to commit real secrets.
//
// Usage: guard-secrets.mjs [--strict] [<file-path> ...]
//        guard-secrets.mjs --staged            # scan everything git has staged
//
// Why this exists alongside check-changed-file.mjs: that core keys on SHAPES
// (an `espn_s2=...` token, a swid-shaped GUID) and deliberately skips
// config.json. Two holes follow from that, and both are reachable:
//
//   1. `git add -f config.json` stages the ESPN session cookie with no scan at
//      all, because the basename is skipped outright.
//   2. Nothing scans app/.dev.vars or app/.env, which carry ADMIN_API_KEY and
//      CREDENTIALS_ENCRYPTION_KEY -- force-add those and they commit cleanly.
//
// So this guard works on VALUES rather than shapes. It reads the known-local
// secret files, harvests their non-placeholder values, and refuses any staged
// file containing one. That catches the case shape-matching cannot: a bare
// token pasted into an unrelated file, or a credential copied over from another
// checkout. It also refuses the secret-bearing files themselves even under
// `git add -f`, since the whole point is that they are never in git.
//
// Exit 0: nothing to report. Exit 1 (--strict only): a real secret is staged.
// Advisory by default; .githooks/pre-commit passes --strict.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const strict = args.includes("--strict");
const stagedOnly = args.includes("--staged");
const projectDir = process.env.PROJECT_DIR || process.cwd();

/** Files that must never be committed at all, even force-added. */
const SECRET_FILES = ["config.json", ".dev.vars", ".env"];

/** Env-var names whose values are secret regardless of which file holds them. */
const SECRET_KEYS = [
  "espn_s2",
  "swid",
  "admin_api_key",
  "turnstile_secret_key",
  "credentials_encryption_key",
  "espn_password",
  "aws_secret_access_key",
];

/** Values that are documentation/placeholders, never real secrets. */
const PLACEHOLDERS = [
  "",
  "0",
  "changeme",
  "change-me",
  "your-value",
  "paste-your-swid-cookie-here",
  "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "1x0000000000000000000000000000000aa",
  "dev-admin-key-change-me",
];

/** Min length before we treat a harvested value as worth searching for. */
const MIN_SECRET_LEN = 12;

function isPlaceholder(v) {
  const t = v.trim().toLowerCase();
  if (PLACEHOLDERS.includes(t)) return true;
  if (/^0+$/.test(t)) return true;
  if (/^x+$/.test(t)) return true;
  if (/^(your|replace|insert|paste|example)/.test(t)) return true;
  return false;
}

/**
 * Harvest secret VALUES from the local secret files. Returns a Map of
 * value -> where it came from, for logging (never printing the value).
 */
function harvestLocalSecrets() {
  const found = new Map();
  const record = (value, origin) => {
    const v = String(value ?? "").trim();
    if (v.length < MIN_SECRET_LEN) return;
    if (isPlaceholder(v)) return;
    if (!found.has(v)) found.set(v, origin);
  };

  // config.json -- a JSON object of espn_s2/swid/etc.
  const cfgPath = path.join(projectDir, "config.json");
  if (existsSync(cfgPath)) {
    try {
      const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
      for (const [k, v] of Object.entries(cfg)) {
        if (k.startsWith("_comment")) continue; // documentation keys
        if (typeof v === "string" && SECRET_KEYS.includes(k.toLowerCase())) {
          record(v, "config.json");
        }
      }
    } catch {
      // unreadable/malformed -- nothing to harvest
    }
  }

  // .dev.vars / .env -- KEY=value lines.
  for (const rel of ["app/.dev.vars", ".dev.vars", "app/.env", ".env"]) {
    const p = path.join(projectDir, rel);
    if (!existsSync(p)) continue;
    try {
      for (const line of readFileSync(p, "utf8").split("\n")) {
        const t = line.trim();
        if (!t || t.startsWith("#")) continue;
        const eq = t.indexOf("=");
        if (eq < 1) continue;
        const key = t.slice(0, eq).trim().toLowerCase();
        const val = t.slice(eq + 1).trim();
        if (!SECRET_KEYS.includes(key)) continue;
        record(val, rel);
      }
    } catch {
      // unreadable -- skip
    }
  }

  return found;
}

/** Files git currently has staged for commit. */
function stagedFiles() {
  try {
    const out = execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR"], {
      cwd: projectDir,
      encoding: "utf8",
    });
    return out.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

function isSecretBearing(rel) {
  const base = path.basename(rel);
  return SECRET_FILES.includes(base);
}

// --- Collect targets ---
let targets = args.filter((a) => !a.startsWith("--"));
if (stagedOnly || targets.length === 0) {
  targets = stagedFiles().map((f) => path.join(projectDir, f));
}

const secrets = harvestLocalSecrets();
const messages = [];
let leak = false;

// --- 1. The secret-bearing files must not be staged, even force-added ---
for (const t of targets) {
  const rel = path.relative(projectDir, path.resolve(t));
  if (!isSecretBearing(rel)) continue;
  if (!existsSync(t)) continue;
  leak = true;
  messages.push(
    `BLOCKED: '${rel}' is staged for commit.\n` +
      "  That file holds live credentials (ESPN session cookies, admin key, " +
      "encryption key). It is gitignored on purpose and must stay that way -- " +
      "`git add -f` does not make it safe.\n" +
      "  Unstage it with: git rm --cached '" +
      rel +
      "'\n" +
      "  If it was already committed, the secret is in history: rotate it.",
  );
}

// --- 2. No staged file may contain a known local secret's value ---
// Read the blob git would actually commit, not the worktree, so a staged
// version that no longer matches disk still gets caught.
for (const t of targets) {
  if (!existsSync(t)) continue;
  if (isSecretBearing(path.relative(projectDir, path.resolve(t)))) continue; // already reported
  let content;
  try {
    if (statSync(t).size > 4 * 1024 * 1024) continue; // don't scan huge files
    content = execFileSync("git", ["show", `:${path.relative(projectDir, path.resolve(t))}`], {
      cwd: projectDir,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch {
    try {
      content = readFileSync(t, "utf8"); // fall back to the worktree copy
    } catch {
      continue;
    }
  }
  for (const [value, origin] of secrets) {
    if (content.includes(value)) {
      leak = true;
      messages.push(
        `BLOCKED: a real secret from ${origin} appears in '${path.relative(
          projectDir,
          path.resolve(t),
        )}'.\n` +
          `  ${value.length}-char value matching the ${origin} entry for a ` +
          "credential-shaped key. Secrets live only in that file -- do not copy " +
          "them into source, docs, fixtures, or another checkout.",
      );
      break;
    }
  }
}

if (messages.length > 0) {
  process.stdout.write(`${messages.join("\n\n")}\n\n`);
}

if (secrets.size > 0) {
  // Advisory note: how many local secrets this guard is actively watching.
  // Never print the values themselves.
  process.stdout.write(
    `guard-secrets: watching ${secrets.size} local secret value(s) from ${[
      ...new Set(secrets.values()),
    ].join(", ")}.\n`,
  );
}

process.exit(strict && leak ? 1 : 0);
