#!/usr/bin/env node
// Harness-neutral guard: deny edits to the write-once raw archive.
//
// Usage: protect-raw-data.mjs <file-path>
// data/raw/ and data/audit/ hold verbatim ESPN API responses captured by the
// extraction scripts. They are evidence — nothing may hand-edit or overwrite
// them (see context/ai-interaction.md "Data Rules"). Scripts writing NEW files
// there are unaffected; this only guards hand-edits of existing content.
//
// Exit 0: path allowed. Exit 2: path inside the archive (reason on stderr).
// Any harness hook adapter or .githooks/pre-commit can call it.

import path from "node:path";

const filePath = process.argv[2];
if (!filePath) process.exit(0);

const absolute = path.resolve(process.cwd(), filePath).replace(/\\/g, "/");
if (/\/data\/(raw|audit)\//.test(absolute)) {
  process.stderr.write(
    `${filePath} is inside the write-once raw archive (data/raw/, data/audit/). ` +
      "These files are verbatim ESPN API responses and must never be edited or " +
      "overwritten — re-run the extraction script to capture fresh data instead " +
      "(see context/ai-interaction.md, Data Rules).\n",
  );
  process.exit(2);
}
process.exit(0);
