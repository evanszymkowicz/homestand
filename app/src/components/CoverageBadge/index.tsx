import type { CoverageDomain } from "../../lib/coverage";
import { summarizeCoverage } from "../../lib/coverage";
import type { Season } from "../../types";

interface CoverageBadgeProps {
  seasons: Season[];
  domain: CoverageDomain;
}

/** Gold flag badge for indicating partial or missing coverage. */
export function CoverageBadge({ seasons, domain }: CoverageBadgeProps) {
  const { status, label } = summarizeCoverage(seasons, domain);
  if (status === "full") return null;

  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-transparent bg-gold-soft px-2 py-0.5 text-[0.64rem] font-bold tracking-wide text-gold">
      {label}
    </span>
  );
}
