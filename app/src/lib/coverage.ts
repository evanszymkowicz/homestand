import type { Season, SeasonCoverage, Team } from "../types";

export type CoverageDomain = keyof SeasonCoverage;

export type CoverageStatus = "full" | "partial" | "missing";

export interface CoverageSummary {
  status: CoverageStatus;
  label: string;
  coveredYears: number[];
  missingYears: number[];
}

/**
 * Derives an honest coverage label for a stat domain (e.g. "teams", "box_scores")
 * purely from seasons.json — this is the only place "since {year}"-style strings get produced.
 * Missing years aren't assumed to be a leading gap so it gets called out explicitly rather than mislabeled as a clean cutoff.
 */
export function summarizeCoverage(seasons: Season[], domain: CoverageDomain): CoverageSummary {
  const sorted = [...seasons].sort((a, b) => a.year - b.year);
  const missingYears = sorted.filter(s => s.coverage[domain] !== "full").map(s => s.year);
  const coveredYears = sorted.filter(s => s.coverage[domain] === "full").map(s => s.year);

  if (missingYears.length === 0) {
    return {
      status: "full",
      label: "full history",
      coveredYears,
      missingYears,
    };
  }
  if (coveredYears.length === 0) {
    return {
      status: "missing",
      label: "no data yet",
      coveredYears,
      missingYears,
    };
  }

  let thresholdYear = sorted[sorted.length - 1].year;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].coverage[domain] === "full") {
      thresholdYear = sorted[i].year;
    } else {
      break;
    }
  }
  const isCleanThreshold = sorted.every(s =>
    s.year >= thresholdYear ? s.coverage[domain] === "full" : s.coverage[domain] !== "full"
  );

  if (isCleanThreshold) {
    return {
      status: "partial",
      label: `since ${thresholdYear}`,
      coveredYears,
      missingYears,
    };
  }

  return {
    status: "partial",
    label: `partial — missing ${missingYears.join(", ")}`,
    coveredYears,
    missingYears,
  };
}

/**
 * Team-seasons from finished seasons only. A season's `final_rank` is a
 * live/provisional value until its status flips to "final" (Phase 8), so any
 * all-time ranking keyed off final_rank === champion must exclude a season
 * still in progress to avoid crediting a phantom title.
 */
export function finalYearTeams(teams: Team[], seasons: Season[]): Team[] {
  const finalYears = new Set(seasons.filter(s => s.status === "final").map(s => s.year));
  return teams.filter(t => finalYears.has(t.year));
}
