import { Link } from "react-router-dom";
import { SectionHeading } from "../../components/SectionHeading";
import { formatOwnerNames } from "../../lib/format";
import { getTeamSlotLineages, type TeamSlotEra } from "../../lib/teamSlots";
import { ownerRef } from "../../lib/stats";
import type { Owner, Team } from "../../types";

interface TeamSlotLineageProps {
  teams: Team[];
  owners: Owner[];
}

function EraBlock({ era, owners }: { era: TeamSlotEra; owners: Owner[] }) {
  const ownerRefs = era.ownerIds.map(id => ownerRef(owners, id));
  const label = era.startYear === era.endYear ? `${era.startYear}` : `${era.startYear}–${era.endYear}`;
  const content = (
    <div className="flex h-16 w-32 flex-none flex-col justify-center rounded-lg border border-border bg-surface px-3 py-2 shadow-sm hover:bg-surface-2">
      <div className="truncate text-sm font-bold">{formatOwnerNames(ownerRefs)}</div>
      <div className="truncate text-[0.66rem] text-ink-faint">
        {label} · {era.latestTeamName}
      </div>
    </div>
  );
  return ownerRefs.length === 1 ? (
    <Link to={`/owner/${ownerRefs[0].ownerId}`} className="block flex-none">
      {content}
    </Link>
  ) : (
    content
  );
}

/** Interactive per-team-slot (espn_team_id) continuity timeline -- built
 * entirely from getTeamSlotLineages (teams.json's own owner_ids per year).
 * Each era renders as its own labeled, clickable block in chronological
 * order rather than a proportionally-scaled bar -- a slot with many short
 * eras would otherwise shrink some blocks into illegible slivers. */
export function TeamSlotLineage({ teams, owners }: TeamSlotLineageProps) {
  const lineages = getTeamSlotLineages(teams).filter(l => l.eras.length > 1);
  if (lineages.length === 0) {
    return null;
  }

  return (
    <div className="mt-9">
      <SectionHeading className="mb-3">"Relocated" Teams</SectionHeading>
      <p className="mb-4 text-xs text-ink-faint">Teams that have changed hands over time.</p>
      <div className="space-y-3">
        {lineages.map(lineage => (
          <div key={lineage.espnTeamId} className="scrollbar-accent flex gap-1.5 overflow-x-auto pb-1">
            {lineage.eras.map((era, i) => (
              <EraBlock key={i} era={era} owners={owners} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
