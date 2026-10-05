---
name: start
description: Use when beginning implementation of the feature/phase already loaded into context/current-feature.md — sets it In Progress and works through its Next Steps one by one.
---

# Start Implementation

Begins work on whatever `context/current-feature.md` currently points at. Run `load` first
if nothing is loaded.

## Steps

1. Read `context/current-feature.md`. If there's no active feature (H1 has no name, or
   `## Goal`/`## Next Steps` are empty), stop and say: "Run the `load` skill first."
2. Set `## Status` to `In Progress` if it isn't already.
3. Confirm a branch exists for this work (`feature/<desc>` or `fix/<desc>`, per
   `@context/ai-interaction.md`) — the user creates branches, not you. If none exists,
   flag it and ask before writing code.
4. List the `## Next Steps` back to the user, then implement them in order.
5. Stay inside `## Out of Scope` boundaries and the phase boundary in
   `@context/project-overview.md` — don't pull work forward from a later phase without
   asking.
6. Respect the data rules in `@context/ai-interaction.md` at all times: never modify
   `data/raw/`, never touch credentials in `config.json`, don't delete mapping files.
7. Do **not** test as part of implementation — no test/build runs, no dev-server checks, no
   screenshots. All of that belongs to the `test` skill.
8. If unsure about current ESPN API behavior or a library's API surface, verify against
   real docs/responses before writing code — don't guess (see `espn-extraction` for known
   API traps).

## Notes

- Small, reviewable increments over one giant diff — this repo is PR-per-change.
- If a Next Step turns out to be wrong or missing once you're in the code, say so and
  propose an update to `context/current-feature.md` rather than silently deviating.
