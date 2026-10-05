---
name: review
description: Use once a feature's implementation looks done — checks the diff against context/current-feature.md's Goal/Acceptance Criteria/Out of Scope and gives a ready-to-complete verdict.
---

# Review a Feature

Checks implemented code against what `context/current-feature.md` actually asked for —
distinct from `test` (build/tests/browser) and from the `code-scanner` /
`data-integrity-auditor` agents (security/data-hygiene audits), which this skill should
recommend when the diff touches Python/app code or `data/`.

## Steps

1. Read `context/current-feature.md` — `## Goal`, `## Acceptance Criteria`, and
   `## Out of Scope`.
2. Review the actual changes (`git diff` against the branch's base) made for this feature.
3. Check for, and call out explicitly:
   - ✅ Acceptance criteria met
   - ❌ Criteria missing or incomplete
   - ⚠️ Code quality issues, bugs, or violations of `@context/coding-standards.md`
   - 🚫 Scope creep — work outside `## Goal`/`## Acceptance Criteria` or inside
     `## Out of Scope`
4. If the diff touches `data/`, mapping files, or credentials handling, say so and suggest
   running the `data-integrity-auditor` agent before completing. If it touches Python or
   app code broadly, suggest `code-scanner`.
5. Give a verdict: **Ready to complete** or **Needs changes**, with a short list of what's
   blocking if the latter.

## Notes

- This is a judgment check against the spec, not a re-run of lint/tests/build — that's
  `test`. Don't skip straight to "looks fine" without reading the Acceptance Criteria first.
- Verify each finding against the actual source (re-read the cited file:line ranges,
  re-run the arithmetic against `data/processed/`) before acting on it — reviews and
  specs can both be wrong, and an incorrect "fix" is a real regression. When a finding
  doesn't hold, reject it explicitly and report a **Fixed / Rejected** split with the
  rationale, so the verdict stays auditable.
- Keep standalone review/planning artifacts out of the repo — they are working notes,
  not part of the shipped feature. Summarize the outcome in `context/change-log/` and
  point `context/current-feature.md` at the next slice instead.
