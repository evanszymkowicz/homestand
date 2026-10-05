import { Board } from "../../components/Board";
import { SectionHeading } from "../../components/SectionHeading";
import { getDistinctScoringPeriods, getSidePointsByPeriod } from "../../lib/boxScore";
import { formatPoints } from "../../lib/format";
import type { BoxScoreEntry } from "../../types";

interface PointsPerDayProps {
  homeLabel: string;
  awayLabel: string;
  homeEntries: BoxScoreEntry[];
  awayEntries: BoxScoreEntry[];
}

/** Diverging cell shading around zero (a real day's points is genuinely a
 * polarity — above/below zero — unlike home-vs-away, which is an identity
 * comparison), so this reuses the already-validated --color-diverge-pos/-neg
 * pair rather than a new categorical one. Magnitude is a light->saturated mix
 * toward the surface, capped well under 100% so the value text stays legible;
 * color is a secondary encoding only — every cell keeps its numeric text as
 * the primary, always-visible source of truth. */
function cellBackground(value: number, maxAbs: number): string | undefined {
  if (value === 0 || maxAbs === 0) return undefined;
  const intensity = Math.round((Math.abs(value) / maxAbs) * 55);
  const token = value > 0 ? "--color-diverge-pos" : "--color-diverge-neg";
  return `color-mix(in srgb, var(${token}) ${intensity}%, var(--color-surface))`;
}

const th = "px-3 py-2 text-center text-[0.66rem] font-semibold tracking-wide text-ink-faint uppercase";

/** Day-by-day counted points for both sides of a matchup, as a grid: each
 * distinct scoring period with data runs across the columns, each team is a
 * row. Off-days that produced no slot data for either side are omitted so they
 * don't read as zero-point columns. Only rendered when the matchup's box score
 * actually has more than one distinct scoring period (data-driven, not a
 * hardcoded pre/post-2019 cutoff) — older or thinner data honestly falls back
 * to a note instead. The grid's own numeric cells are the accessible data
 * view; no separate table is needed alongside it. */
export function PointsPerDay({ homeLabel, awayLabel, homeEntries, awayEntries }: PointsPerDayProps) {
  const periods = getDistinctScoringPeriods([...homeEntries, ...awayEntries]);

  if (periods.length <= 1) {
    return (
      <p className="text-sm text-ink-faint italic">
        Day-by-day scoring isn't available for this matchup — only one scoring period recorded.
      </p>
    );
  }

  const homeByPeriod = getSidePointsByPeriod(homeEntries, periods);
  const awayByPeriod = getSidePointsByPeriod(awayEntries, periods);
  const maxAbs = Math.max(1, ...homeByPeriod.map(Math.abs), ...awayByPeriod.map(Math.abs));
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

  const sideRows = [
    { label: homeLabel, values: homeByPeriod, total: sum(homeByPeriod) },
    { label: awayLabel, values: awayByPeriod, total: sum(awayByPeriod) },
  ];

  return (
    <div>
      <SectionHeading as="h3" className="mb-3">
        Points Per Day
      </SectionHeading>
      <p className="mb-3 text-xs text-ink-faint">Shaded in the direction of the point differential.</p>
      <Board>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th
                scope="col"
                className="px-3 py-2 text-left text-[0.66rem] font-semibold tracking-wide text-ink-faint uppercase">
                Team
              </th>
              {periods.map(period => (
                <th key={period} scope="col" className={th}>
                  Day {period}
                </th>
              ))}
              <th scope="col" className={`${th} border-l border-border`}>
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {sideRows.map(side => (
              <tr key={side.label} className="border-t border-border">
                <th scope="row" className="px-3 py-2 text-left text-sm font-semibold whitespace-nowrap text-ink-dim">
                  {side.label}
                </th>
                {side.values.map((value, i) => (
                  <td
                    key={periods[i]}
                    className="px-3 py-2 text-center tabular-nums"
                    style={{ backgroundColor: cellBackground(value, maxAbs) }}>
                    {formatPoints(value)}
                  </td>
                ))}
                <td className="border-l border-border px-3 py-2 text-center font-semibold tabular-nums">
                  {formatPoints(side.total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Board>
    </div>
  );
}
