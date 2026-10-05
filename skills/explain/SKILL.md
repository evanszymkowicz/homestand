---
name: explain
description: Use after a feature is implemented to document what changed and why — walks the diff file-by-file and summarizes how the pieces connect.
---

# Explain a Feature

Produces a human-readable summary of what a feature's diff actually did, for handoff or
for the `complete` skill's change-log entry.

## Steps

1. Read `context/current-feature.md` to understand what was supposed to change.
2. Run `git diff <base-branch> --name-only` to list every file created or modified.
3. For each file:
   - Show the file path and whether it's new or modified.
   - Give a 1–2 sentence explanation of what it does/what changed.
   - Highlight any key functions, components, or non-obvious patterns used.
4. End with a short summary of how the pieces fit together (data/control flow between the
   changed files).

## Output Format

```
## Files Changed

**path/to/file.py** (new)
Brief explanation of what this file does and why it was added.

**path/to/other.ts** (modified)
What changed and why.

## How It All Connects

Brief summary of the data/control flow between those files.
```

## Notes

- This documents intent and shape, not a line-by-line diff — the diff itself is already
  visible in git.
