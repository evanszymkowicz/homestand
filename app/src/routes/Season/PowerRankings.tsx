import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FilterSelect } from "../../components/FilterSelect";
import { SectionHeading } from "../../components/SectionHeading";
import { divergingBackground } from "../../lib/diverging";
import { formatOwnerNames, formatPoints } from "../../lib/format";
import { computeWeeklyPowerRankings } from "../../lib/powerRankings";
import { ownerRef } from "../../lib/stats";
import type { Matchup, Owner, Season, Team } from "../../types";

interface PowerRankingsProps {
  season: Season;
  seasons: Season[];
  teams: Team[];
  matchups: Matchup[];
  owners: Owner[];
}

interface ReplayTeam {
  espnTeamId: number;
  label: string;
  rankByWeek: number[];
  pointsByWeek: number[];
}

/** Red-blue heat for one row: the leader sits at the red pole, the last-place
 * team at the blue, neutral in the middle, scaled off how far the rank sits from
 * mid-table. Built from the shared diverging theme tokens so it follows the
 * light/dark theme like the rest of the site's heat indexes. */
function rankBackground(rank: number, teamCount: number) {
  const center = (teamCount + 1) / 2;
  return divergingBackground(((center - rank) / center) * 55);
}

export function PowerRankings({ season, seasons, teams, matchups, owners }: PowerRankingsProps) {
  const navigate = useNavigate();
  const sortedYears = useMemo(() => [...seasons.map(s => s.year)].sort((a, b) => b - a), [seasons]);

  const { weeks, rows } = useMemo(() => {
    const weekly = computeWeeklyPowerRankings(season.year, matchups, teams);
    const weekList = weekly.weeks;

    // Keyed by espn_team_id: one owner can hold two teams in a season, so owner
    // name is not a safe key. Labels list every co-owner.
    const teamRows: ReplayTeam[] = teams
      .filter(t => t.year === season.year)
      .map(team => {
        const byWeek = new Map(
          weekly.weeks.map(w => [w.week, w.rankings.find(r => r.espnTeamId === team.espn_team_id)])
        );
        return {
          espnTeamId: team.espn_team_id,
          label: formatOwnerNames(team.owner_ids.map(id => ownerRef(owners, id))),
          rankByWeek: weekList.map(w => byWeek.get(w.week)?.rank ?? 0),
          pointsByWeek: weekList.map(w => byWeek.get(w.week)?.cumulativePoints ?? 0),
        };
      })
      .sort((a, b) => (b.rankByWeek.at(-1) ?? 0) - (a.rankByWeek.at(-1) ?? 0));

    return { weeks: weekList, rows: teamRows };
  }, [season.year, matchups, teams, owners]);

  // The scrubber opens parked on the season's final week. Changing season
  // resets it there, and the clamp covers a season change that has fewer weeks
  // than the cursor was parked on.
  const lastIndex = weeks.length - 1;
  const [weekCursor, setWeekCursor] = useState(lastIndex);
  const [playing, setPlaying] = useState(false);
  const index = Math.min(weekCursor, lastIndex);
  const atEnd = index >= lastIndex;
  useEffect(() => setWeekCursor(lastIndex), [lastIndex]);
  // Autoplay is user-initiated only, so no reduced-motion handling is needed.
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setWeekCursor(c => Math.min(c + 1, lastIndex)), 800);
    return () => clearInterval(id);
  }, [playing, lastIndex]);
  // Stop on the final week rather than hammering the cursor there.
  useEffect(() => {
    if (playing && atEnd) setPlaying(false);
  }, [playing, atEnd]);

  if (rows.length === 0 || weeks.length === 0) {
    return <p className="text-sm text-ink-dim">No matchups on file for this season.</p>;
  }

  const order = rows.map(team => ({ team, rank: team.rankByWeek[index] })).sort((a, b) => a.rank - b.rank);

  const week = weeks[index];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SectionHeading>Power Rankings</SectionHeading>
        <FilterSelect
          value={season.year}
          onChange={e => navigate(`/season/${e.target.value}/rankings`)}
          aria-label="Select season year">
          {sortedYears.map(y => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </FilterSelect>
      </div>

      <div className="rounded-lg border border-border bg-surface p-4">
        <p className="mb-4 max-w-2xl text-xs text-ink-faint">
          Scrub the standings week by week, or play the season out.
        </p>

        <div className="mb-4 flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              if (atEnd) setWeekCursor(0);
              setPlaying(!playing);
            }}
            aria-label={playing ? "Pause week replay" : atEnd ? "Replay from week 1" : "Play week replay"}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-surface-2 text-ink hover:bg-bg">
            {/* Glyphs, not inline SVG -- same convention as the delta arrows
                below, and the aria-label already carries the state. */}
            <span aria-hidden="true" className="text-sm leading-none">
              {playing ? "❚❚" : "▶"}
            </span>
          </button>
          <input
            type="range"
            min={1}
            max={weeks.length}
            value={index + 1}
            onChange={e => setWeekCursor(Number(e.target.value) - 1)}
            aria-label="Week"
            aria-valuetext={`Week ${week.week}`}
            className="min-w-40 flex-1"
          />
          {/* Announces the week as the slider steps. Manual scrubbing is
              announced twice over, by this and by the slider's aria-valuetext. */}
          <span
            role="status"
            aria-live="polite"
            className="w-16 shrink-0 text-right text-sm font-semibold tabular-nums text-ink">
            Week {week.week}
          </span>
        </div>

        <ol className="space-y-1">
          {order.map(({ team, rank }) => {
            const previous = index > 0 ? team.rankByWeek[index - 1] : null;
            const delta = previous === null ? 0 : previous - rank;
            const highest = Math.min(...team.rankByWeek.slice(0, index + 1));
            const deltaLabel =
              delta > 0 ? `up ${delta} from last week` : delta < 0 ? `down ${-delta} from last week` : "unchanged";

            return (
              /* Fixed grid tracks, not auto-width spans: the conditional
                 "highest #x" chip would otherwise shove the points and delta
                 columns out of alignment on exactly the rows that lack it. */
              <li
                key={team.espnTeamId}
                className="grid grid-cols-[1.5rem_minmax(0,1fr)_4.25rem_2rem] items-center gap-2 rounded-md px-2 py-1.5 sm:grid-cols-[1.5rem_minmax(0,1fr)_4.75rem_5rem_2.5rem] sm:gap-3"
                style={rankBackground(rank, rows.length)}>
                <span className="text-center text-sm font-extrabold tabular-nums text-ink">{rank}</span>
                <span className="truncate text-sm font-medium text-ink">{team.label}</span>
                {/* Hidden on phones: the owner name needs the width more than the chip, and
                    the fixed track keeps every row's points/delta column lined
                    up whether or not the chip is shown. */}
                <span className="hidden text-right text-xs tabular-nums text-ink-faint sm:block">
                  {highest < rank ? `highest #${highest}` : ""}
                </span>
                <span className="text-right text-sm tabular-nums text-ink-dim">
                  {formatPoints(team.pointsByWeek[index])}
                </span>
                <span
                  className="text-right text-sm font-bold tabular-nums"
                  style={{
                    color:
                      delta > 0
                        ? "var(--color-accent)"
                        : delta < 0
                          ? "var(--color-matchup-loss)"
                          : "var(--color-ink-faint)",
                  }}>
                  <span aria-hidden="true">{delta > 0 ? `▲${delta}` : delta < 0 ? `▼${-delta}` : "–"}</span>
                  {/* The arrow glyph is the visual cue; carry the meaning as text
                      rather than aria-label, which a role-less span does not
                      reliably expose. */}
                  <span className="sr-only">{deltaLabel}</span>
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
