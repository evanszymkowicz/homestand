import { useState } from "react";
import { SegmentedToggle } from "../../components/SegmentedToggle";
import { formatPoints } from "../../lib/format";
import type { SeasonPlayerLine } from "../../lib/boxScore";
import type { SeasonRosterMarkers } from "../../lib/transactions";
import { SeasonRosterTable, type SeasonRosterTableKind } from "./SeasonRosterTable";

interface SeasonRosterTablesProps {
  roster: SeasonPlayerLine[];
  /** Undefined for years the transaction ledger doesn't cover -- no marker renders. */
  markers?: SeasonRosterMarkers;
  /** stat_lines === "full" (2019+). Gates the IL/side routing below on slot
   * data being real -- 2018's slots are a season-end snapshot and pre-2019's
   * are a placeholder, so neither can say where a statless player belongs. */
  slotsAreDayAccurate: boolean;
}

const KIND_LABELS: Record<SeasonRosterTableKind, string> = {
  batting: "Batting",
  pitching: "Pitching",
  points: "Points Only",
};

/** One team-season's roster as a single toggled table rather than three
 * stacked ones. "Points Only" is a segment only when it has rows -- it exists
 * for the pre-2019 years with no raw stat line, and is empty otherwise.
 *
 * On a year with real slot data, a player who never recorded a stat is not a
 * coverage gap but a fact about their season: stashed on the IL all year (they
 * belong on the Injured List board, not here), or rostered and simply never
 * used, in which case they sit in the table for the side they were rostered as
 * with dashes for stats. */
export function SeasonRosterTables({ roster, markers, slotsAreDayAccurate }: SeasonRosterTablesProps) {
  const [kind, setKind] = useState<SeasonRosterTableKind>("batting");
  const statless = (r: SeasonPlayerLine) => r.batting === null && r.pitching === null;
  const shown = slotsAreDayAccurate ? roster.filter(r => !(statless(r) && r.ilOnly)) : roster;
  const inSide = (r: SeasonPlayerLine, side: "batting" | "pitching") =>
    r[side] !== null || (slotsAreDayAccurate && statless(r) && r.slotSide === side);
  const rowsByKind: Record<SeasonRosterTableKind, SeasonPlayerLine[]> = {
    batting: shown.filter(r => inSide(r, "batting")),
    pitching: shown.filter(r => inSide(r, "pitching")),
    points: shown.filter(r => statless(r) && !(slotsAreDayAccurate && r.slotSide !== null)),
  };

  // A pre-2019 season has no stat lines at all, so only "Points Only" is offered there.
  const kinds = (["batting", "pitching", "points"] as SeasonRosterTableKind[]).filter(k => rowsByKind[k].length > 0);
  if (kinds.length === 0) return null;
  const activeKind = kinds.includes(kind) ? kind : kinds[0];
  const pointsOnly = rowsByKind.points;

  return (
    <div className="space-y-3">
      {kinds.length > 1 && (
        <SegmentedToggle
          ariaLabel="Roster split"
          value={activeKind}
          onChange={setKind}
          options={kinds.map(k => ({ key: k, label: KIND_LABELS[k] }))}
        />
      )}
      <SeasonRosterTable
        title={KIND_LABELS[activeKind]}
        kind={activeKind}
        rows={rowsByKind[activeKind]}
        markers={markers}
      />
      {markers && (
        <p className="text-[0.66rem] text-ink-faint">
          Grayed out = dropped to waivers/free agency. <span className="font-bold">+</span> = added from free
          agency/waivers.{" "}
          <span
            className="font-bold"
            title="ESPN lost the player rows for most pre-2026 trades, so a traded player may go unmarked.">
            *
          </span>{" "}
          = acquired via trade. <span className="font-bold">-</span> = traded away this year.
        </p>
      )}
      {pointsOnly.length > 0 && (
        <p className="text-[0.66rem] text-ink-faint">
          Points Only: no raw batting/pitching stat line on file for these weeks (pre-2019, or a gap inside 2018's
          partial coverage) -- {formatPoints(pointsOnly.reduce((sum, r) => sum + r.countedPoints, 0))} combined points.
        </p>
      )}
    </div>
  );
}
