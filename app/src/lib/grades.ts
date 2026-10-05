import type { LetterGrade } from "./playerComparison";

/** Tailwind class bundles for the trade-grade badge, keyed by letter grade. */
export const GRADE_BG: Record<LetterGrade, string> = {
  "A+": "bg-diverge-pos-soft text-diverge-pos",
  A: "bg-diverge-pos-soft text-diverge-pos",
  B: "bg-diverge-pos/10 text-diverge-pos",
  C: "bg-surface-2 text-ink-dim",
  D: "bg-diverge-neg/10 text-diverge-neg",
  F: "bg-diverge-neg-soft text-diverge-neg",
};

/** Numeric rank used to sort the grade column from A+ to F. */
export const GRADE_RANK: Record<LetterGrade, number> = {
  "A+": 6,
  A: 5,
  B: 4,
  C: 3,
  D: 2,
  F: 1,
};
