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

/** Grade order, best first — the `LetterGrade` union's own declaration order,
 * so sorting is `GRADE_ORDER.indexOf(grade)` rather than a parallel map. */
export const GRADE_ORDER: LetterGrade[] = ["A+", "A", "B", "C", "D", "F"];
