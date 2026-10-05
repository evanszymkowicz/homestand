---
name: complete
description: Use once a feature has passed review — records its outcome in context/change-log/, resets context/current-feature.md, and hands git operations back to the user.
---

# Complete a Feature

Closes out whatever `context/current-feature.md` currently points at. Run `review` first —
this skill doesn't re-check whether the work is actually done.

> The user handles all git operations (commit, merge, push, branch deletion). Do **not**
> run them — only suggest.

## Steps

1. Read `context/current-feature.md` for the feature name, spec reference, and what
   shipped.
2. Write a change-log entry to `context/change-log/{slug}.md` (reuse the spec's filename
   slug if one exists, e.g. `phase-0-data-audit.md`; otherwise derive a short kebab-case
   slug from the feature name). Include: what was built, any deviations from the original
   spec/acceptance criteria, and follow-ups pushed to `context/future-items.md` if any came
   up.
3. Reset `context/current-feature.md`:
   - H1 back to `# Current Feature` (no name).
   - Clear `## Goal`, `## Status`, `## Next Steps`, `## Acceptance Criteria`,
     `## Out of Scope` back to empty/placeholder content — don't leave stale text from the
     completed feature.
4. Check `context/future-items.md`'s Phase Queue for what's next and mention it, but don't
   auto-load it — that's a separate `load` call once the user's ready.
5. Tell the user the feature is complete and remind them to commit, merge, and push.
   Suggest a conventional-commit message for the reset (e.g.
   `chore: reset current-feature.md after completing phase 0`) — never include AI attribution
   ("Co-Authored-By" trailers etc.), per `@context/ai-interaction.md`.

## Notes

- Never delete a change-log entry once written; it's the durable record of what shipped
  each phase.
