import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Board } from "../../components/Board";
import { FilterSelect } from "../../components/FilterSelect";
import { Headshot } from "../../components/Headshot";
import { SectionHeading } from "../../components/SectionHeading";
import { formatDifferential, formatPoints } from "../../lib/format";
import { GRADE_BG } from "../../lib/grades";
import { POSITION_LABELS } from "../../lib/positions";
import {
  buildComparisonIndex,
  compareTradeSides,
  type PlayerComparisonInput,
  type PlayerComparisonResult,
  type SideComparison,
} from "../../lib/playerComparison";
import { buildRadarComparison, computeWeeklyHeadToHead } from "../../lib/tradeCharts";
import { teamOwnerNames } from "../../lib/stats";
import { computePositionZscoreStats, computeSeasonZscoreStats } from "../../lib/zscore";
import type {
  BoxScoreEntry,
  DraftPick,
  Owner,
  PlayerSeason,
  PlayerSeasonPoints,
  PlayerTeamSeasonPoints,
  Season,
  Team,
} from "../../types";

interface TradeEvaluatorProps {
  latestYear: number;
  playerSeasons: PlayerSeason[];
  playerTeamSeasonPoints: PlayerTeamSeasonPoints[];
  seasonPoints: PlayerSeasonPoints[];
  draftPicks: DraftPick[];
  seasons: Season[];
  teams: Team[];
  owners: Owner[];
  boxScoresByYear: Map<number, BoxScoreEntry[]>;
}

interface RosterPlayer {
  playerId: number;
  playerName: string;
  positionId: number;
  teamPoints: number;
}

const EYEBROW = "text-eyebrow font-bold tracking-wide text-ink-faint uppercase";

function formatZscore(n: number | null): string {
  if (n === null) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}`;
}

function formatPercentile(n: number | null): string {
  if (n === null) return "—";
  return `${Math.round(n)}%`;
}

function formatDraftValue(n: number | null): string {
  if (n === null) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}`;
}

function formatCv(n: number | null): string {
  if (n === null) return "—";
  return n.toFixed(2);
}

export function TradeEvaluator({
  latestYear,
  playerSeasons,
  playerTeamSeasonPoints,
  seasonPoints,
  draftPicks,
  seasons,
  teams,
  owners,
  boxScoresByYear,
}: TradeEvaluatorProps) {
  const [teamAOwner, setTeamAOwner] = useState<string>("");
  const [teamBOwner, setTeamBOwner] = useState<string>("");
  const [selectedA, setSelectedA] = useState<Set<number>>(new Set());
  const [selectedB, setSelectedB] = useState<Set<number>>(new Set());

  const teamsForYear = useMemo(
    () => teams.filter(t => t.year === latestYear).sort((a, b) => a.team_name.localeCompare(b.team_name)),
    [teams, latestYear]
  );

  const comparisonIndex = useMemo(
    () => buildComparisonIndex(seasonPoints, playerSeasons, draftPicks, seasons),
    [seasonPoints, playerSeasons, draftPicks, seasons]
  );
  const seasonZscoreStats = useMemo(
    () => computeSeasonZscoreStats(seasonPoints, playerSeasons),
    [seasonPoints, playerSeasons]
  );
  const positionZscoreStats = useMemo(
    () => computePositionZscoreStats(seasonPoints, playerSeasons),
    [seasonPoints, playerSeasons]
  );

  const latestWeek = useMemo(() => {
    const entries = boxScoresByYear.get(latestYear) ?? [];
    return entries.length > 0 ? Math.max(...entries.map(e => e.week)) : 0;
  }, [boxScoresByYear, latestYear]);

  const fullCoverageYears = useMemo(() => {
    const years = new Set<number>();
    for (const s of seasons) {
      if (s.coverage?.box_scores === "full") years.add(s.year);
    }
    return years;
  }, [seasons]);

  const currentRosterKeys = useMemo(() => {
    const keys = new Set<string>();
    const entries = boxScoresByYear.get(latestYear) ?? [];
    for (const entry of entries) {
      if (entry.week === latestWeek) {
        keys.add(`${entry.owner_id}:${entry.player_id}`);
      }
    }
    return keys;
  }, [boxScoresByYear, latestYear, latestWeek]);

  const rosterByOwner = useMemo(() => {
    const map = new Map<string, Map<number, RosterPlayer>>();
    for (const row of playerTeamSeasonPoints) {
      if (row.year !== latestYear) continue;
      if (currentRosterKeys.size > 0 && !currentRosterKeys.has(`${row.owner_id}:${row.player_id}`)) continue;
      const teamMap = map.get(row.owner_id) ?? new Map<number, RosterPlayer>();
      teamMap.set(row.player_id, {
        playerId: row.player_id,
        playerName: row.player_name,
        positionId: comparisonIndex.positionByKey.get(`${row.year}:${row.player_id}`) ?? -1,
        teamPoints: row.points,
      });
      map.set(row.owner_id, teamMap);
    }
    return map;
  }, [playerTeamSeasonPoints, latestYear, comparisonIndex, currentRosterKeys]);

  const rosterA = useMemo(() => {
    const map = rosterByOwner.get(teamAOwner);
    return map ? Array.from(map.values()).sort((a, b) => a.playerName.localeCompare(b.playerName)) : [];
  }, [rosterByOwner, teamAOwner]);

  const rosterB = useMemo(() => {
    const map = rosterByOwner.get(teamBOwner);
    return map ? Array.from(map.values()).sort((a, b) => a.playerName.localeCompare(b.playerName)) : [];
  }, [rosterByOwner, teamBOwner]);

  const comparison: SideComparison | null = useMemo(() => {
    if (selectedA.size === 0 && selectedB.size === 0) return null;
    const inputsA: PlayerComparisonInput[] = Array.from(selectedA).map(playerId => ({ playerId, year: latestYear }));
    const inputsB: PlayerComparisonInput[] = Array.from(selectedB).map(playerId => ({ playerId, year: latestYear }));
    return compareTradeSides(
      inputsA,
      inputsB,
      comparisonIndex,
      seasonZscoreStats,
      positionZscoreStats,
      boxScoresByYear
    );
  }, [selectedA, selectedB, latestYear, comparisonIndex, seasonZscoreStats, positionZscoreStats, boxScoresByYear]);

  const toggleSelection = (side: "A" | "B", playerId: number) => {
    const set = side === "A" ? new Set(selectedA) : new Set(selectedB);
    if (set.has(playerId)) set.delete(playerId);
    else set.add(playerId);
    if (side === "A") setSelectedA(set);
    else setSelectedB(set);
  };

  const reset = () => {
    setTeamAOwner("");
    setTeamBOwner("");
    setSelectedA(new Set());
    setSelectedB(new Set());
  };

  const teamAName = useMemo(() => teamShortName(teamsForYear, teamAOwner), [teamsForYear, teamAOwner]);
  const teamBName = useMemo(() => teamShortName(teamsForYear, teamBOwner), [teamsForYear, teamBOwner]);

  return (
    <div className="space-y-6">
      <ControlBar
        teamsForYear={teamsForYear}
        teamAOwner={teamAOwner}
        teamBOwner={teamBOwner}
        onTeamAChange={owner => {
          setTeamAOwner(owner);
          setSelectedA(new Set());
        }}
        onTeamBChange={owner => {
          setTeamBOwner(owner);
          setSelectedB(new Set());
        }}
        onReset={reset}
      />

      {comparison && <VerdictPanel comparison={comparison} teamAName={teamAName} teamBName={teamBName} />}

      {comparison && (
        <>
          <div>
            <SectionHeading className="mb-3">Per-Stat Comparison</SectionHeading>
            <p className="mb-3 text-xs text-ink-faint">
              Season points, z-score of the position field, percentile, and draft value over replacement for every
              player in the deal. The best value in each row is highlighted in green.
            </p>
            <ComparisonTable sideA={comparison.sideA} sideB={comparison.sideB} />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <RadarComparison
              sideA={comparison.sideA}
              sideB={comparison.sideB}
              teamAName={teamAName}
              teamBName={teamBName}
            />
            <WeeklyHeadToHead
              sideA={selectedA}
              sideB={selectedB}
              year={latestYear}
              boxScoresByYear={boxScoresByYear}
              teamAName={teamAName}
              teamBName={teamBName}
              fullCoverageYears={fullCoverageYears}
            />
          </div>

          <AdvancedMetrics
            sideA={comparison.sideA}
            sideB={comparison.sideB}
            teamAName={teamAName}
            teamBName={teamBName}
          />
        </>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <TeamPanel
          title={teamAOwner ? teamLabel(teamsForYear, owners, teamAOwner) : "Team A"}
          roster={rosterA}
          selected={selectedA}
          onToggle={playerId => toggleSelection("A", playerId)}
        />
        <TeamPanel
          title={teamBOwner ? teamLabel(teamsForYear, owners, teamBOwner) : "Team B"}
          roster={rosterB}
          selected={selectedB}
          onToggle={playerId => toggleSelection("B", playerId)}
        />
      </div>
    </div>
  );
}

function teamLabel(teamsForYear: Team[], owners: Owner[], ownerId: string): string {
  const team = teamsForYear.find(t => t.primary_owner_id === ownerId || t.owner_ids.includes(ownerId));
  if (!team) return ownerId;
  return `${team.team_name} · ${teamOwnerNames(team, owners)}`;
}

function teamShortName(teamsForYear: Team[], ownerId: string): string {
  const team = teamsForYear.find(t => t.primary_owner_id === ownerId || t.owner_ids.includes(ownerId));
  return team ? team.team_name : ownerId;
}

interface ControlBarProps {
  teamsForYear: Team[];
  teamAOwner: string;
  teamBOwner: string;
  onTeamAChange: (owner: string) => void;
  onTeamBChange: (owner: string) => void;
  onReset: () => void;
}

function ControlBar({ teamsForYear, teamAOwner, teamBOwner, onTeamAChange, onTeamBChange, onReset }: ControlBarProps) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-[16rem] flex-col gap-1">
          <span className={EYEBROW}>Team A</span>
          <FilterSelect value={teamAOwner} onChange={e => onTeamAChange(e.target.value)}>
            <option value="">— select team —</option>
            {teamsForYear.map(t => (
              <option key={t.espn_team_id} value={t.primary_owner_id}>
                {t.team_name}
              </option>
            ))}
          </FilterSelect>
        </label>

        <label className="flex min-w-[16rem] flex-col gap-1">
          <span className={EYEBROW}>Team B</span>
          <FilterSelect value={teamBOwner} onChange={e => onTeamBChange(e.target.value)}>
            <option value="">— select team —</option>
            {teamsForYear.map(t => (
              <option key={t.espn_team_id} value={t.primary_owner_id}>
                {t.team_name}
              </option>
            ))}
          </FilterSelect>
        </label>

        <button
          type="button"
          onClick={onReset}
          className="rounded-full border border-border bg-surface px-3 py-1 text-xs font-semibold text-ink hover:bg-surface-2">
          Reset
        </button>
      </div>
    </div>
  );
}

interface TeamPanelProps {
  title: string;
  roster: RosterPlayer[];
  selected: Set<number>;
  onToggle: (playerId: number) => void;
}

function TeamPanel({ title, roster, selected, onToggle }: TeamPanelProps) {
  return (
    <Board title={title}>
      {roster.length === 0 ? (
        <p className="px-3.5 py-3 text-sm text-ink-dim">Select a team above to view its current roster.</p>
      ) : (
        <div className="space-y-2 p-4">
          {roster.map(player => (
            <button
              key={player.playerId}
              type="button"
              onClick={() => onToggle(player.playerId)}
              className={`flex w-full items-center gap-3 rounded-lg border p-2.5 text-left transition-colors ${
                selected.has(player.playerId)
                  ? "border-accent bg-accent/10"
                  : "border-border bg-surface hover:bg-surface-2"
              }`}>
              <Headshot playerId={player.playerId} playerName={player.playerName} size={36} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-ink">{player.playerName}</div>
                <div className="text-xs text-ink-faint">{POSITION_LABELS[player.positionId] ?? "—"}</div>
              </div>
              <div className="flex flex-none items-baseline gap-0.5 text-right">
                <span className="text-sm font-bold tabular-nums text-ink">{formatPoints(player.teamPoints)}</span>
                <span className="text-[0.62rem] text-ink-faint">pts</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </Board>
  );
}

interface VerdictPanelProps {
  comparison: SideComparison;
  teamAName: string;
  teamBName: string;
}

function VerdictPanel({ comparison, teamAName, teamBName }: VerdictPanelProps) {
  const { aggregate, sideA, sideB } = comparison;
  const grade = aggregate.letterGrade;
  const sideAHasAdvantage = aggregate.surplusPoints > 0;
  const aLabel = teamAName || "Team A";
  const bLabel = teamBName || "Team B";

  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div
          className="flex items-center gap-3"
          title="Letter grade for the trade based on the percentage difference in points between the two sides.">
          <div
            className={`flex h-10 w-10 flex-none items-center justify-center rounded-full text-base font-extrabold ${
              GRADE_BG[grade] ?? "bg-surface-2 text-ink-faint"
            }`}>
            {grade}
          </div>
          <div>
            <div className={EYEBROW}>Trade Grade</div>
            <div className="text-sm text-ink-faint">{aggregate.isFair ? "Fair trade" : "Not a fair trade"}</div>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-6 text-sm">
          <div
            className="text-center"
            title="Raw points advantage for the first team. Positive means it gets more value; negative means the second team gets more value.">
            <div className={EYEBROW}>Points Surplus</div>
            <div
              className={`text-xl font-extrabold tabular-nums ${sideAHasAdvantage ? "text-diverge-pos" : "text-diverge-neg"}`}>
              {formatDifferential(aggregate.surplusPoints)}
            </div>
          </div>
          <div
            className="text-center"
            title="Combined z-score advantage for the first team. Positive means its players ranked higher relative to their position fields.">
            <div className={EYEBROW}>Z-Score Surplus</div>
            <div
              className={`text-xl font-extrabold tabular-nums ${aggregate.surplusZscore >= 0 ? "text-diverge-pos" : "text-diverge-neg"}`}>
              {formatZscore(aggregate.surplusZscore)}
            </div>
          </div>
          <div className="text-center">
            <div className={EYEBROW}>{aLabel} Total</div>
            <div className="text-xl font-extrabold tabular-nums text-ink">{formatPoints(aggregate.sideAPoints)}</div>
          </div>
          <div className="text-center">
            <div className={EYEBROW}>{bLabel} Total</div>
            <div className="text-xl font-extrabold tabular-nums text-ink">{formatPoints(aggregate.sideBPoints)}</div>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <SelectedSummary title={`${aLabel} gives up`} results={sideA} />
        <SelectedSummary title={`${bLabel} gives up`} results={sideB} />
      </div>
    </div>
  );
}

function SelectedSummary({ title, results }: { title: string; results: PlayerComparisonResult[] }) {
  return (
    <div className="rounded-lg bg-surface p-3 shadow-sm">
      <h4 className={`${EYEBROW} mb-2 font-semibold`}>{title}</h4>
      {results.length === 0 ? (
        <p className="text-xs text-ink-dim">No players selected.</p>
      ) : (
        <div className="space-y-1">
          {results.map((r, i) => (
            <div key={i} className="flex items-baseline justify-between gap-2 text-sm">
              <span className="truncate text-ink">{r.playerName}</span>
              <span className="flex-none text-xs text-ink-faint tabular-nums">
                {r.points !== null ? formatPoints(r.points) : "—"} pts · z {formatZscore(r.zscore)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const TH = "text-eyebrow bg-surface px-3 py-2 font-semibold tracking-wide text-ink-faint uppercase";

function ComparisonTable({ sideA, sideB }: { sideA: PlayerComparisonResult[]; sideB: PlayerComparisonResult[] }) {
  const allResults = [...sideA, ...sideB];

  const renderStatRow = (
    label: string,
    getValue: (r: PlayerComparisonResult) => number | null,
    format: (value: number | null) => string
  ) => {
    const values = allResults.map(getValue);
    const numeric = values.filter((v): v is number => v !== null);
    const best = numeric.length > 0 ? Math.max(...numeric) : null;

    const renderCell = (r: PlayerComparisonResult, key: string) => {
      const value = getValue(r);
      const isBest = value !== null && best !== null && value === best;
      return (
        <td
          key={key}
          className={`px-3 py-2 text-right tabular-nums ${isBest ? "font-semibold text-accent" : "text-ink"}`}
          title={isBest ? "Best value in this row" : undefined}>
          {format(value)}
          {isBest && <span className="sr-only"> (best)</span>}
        </td>
      );
    };

    return (
      <tr className="border-t border-border">
        <th scope="row" className="px-3 py-2 text-left font-semibold text-ink-faint normal-case tracking-normal">
          {label}
        </th>
        {sideA.map((r, i) => renderCell(r, `a-${i}`))}
        {sideB.map((r, i) => renderCell(r, `b-${i}`))}
      </tr>
    );
  };

  return (
    <Board>
      <table className="w-full min-w-[36rem] border-collapse text-sm">
        <thead>
          <tr>
            <th scope="col" className={`${TH} text-left`}>
              <span className="sr-only">Stat</span>
            </th>
            {sideA.map((r, i) => (
              <th key={`a-${i}`} scope="col" className={`${TH} text-right`}>
                {r.playerName}
              </th>
            ))}
            {sideB.map((r, i) => (
              <th key={`b-${i}`} scope="col" className={`${TH} text-right`}>
                {r.playerName}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {renderStatRow(
            "Points",
            r => r.points,
            v => (v !== null ? formatPoints(v) : "—")
          )}
          {renderStatRow(
            "Z-Score",
            r => r.zscore,
            v => formatZscore(v)
          )}
          {renderStatRow(
            "Percentile",
            r => r.percentile,
            v => formatPercentile(v)
          )}
          {renderStatRow(
            "Draft Value",
            r => r.draftValueOverReplacement,
            v => formatDraftValue(v)
          )}
        </tbody>
      </table>
    </Board>
  );
}

interface RadarComparisonProps {
  sideA: PlayerComparisonResult[];
  sideB: PlayerComparisonResult[];
  teamAName: string;
  teamBName: string;
}

function RadarComparison({ sideA, sideB, teamAName, teamBName }: RadarComparisonProps) {
  const data = useMemo(() => buildRadarComparison(sideA, sideB), [sideA, sideB]);

  return (
    <Board title="Profile Comparison">
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart cx="50%" cy="50%" outerRadius="80%" data={data}>
            <PolarGrid />
            <PolarAngleAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--color-ink-faint)" }} />
            <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
            {/* strokeDasharray is not decoration: in light mode --color-accent and
              --color-diverge-neg BOTH resolve to var(--hs-blue), so the two
              series were the same colour and the legend swatches gave a
              reader no way to tell them apart (WCAG 1.4.1 Use of Color). The
              dash pattern is the non-colour channel that survives both themes. */}
            <Radar
              name={teamAName || "Team A"}
              dataKey="sideA"
              stroke="var(--color-accent)"
              fill="var(--color-accent)"
              fillOpacity={0.3}
              strokeDasharray="none"
            />
            <Radar
              name={teamBName || "Team B"}
              dataKey="sideB"
              stroke="var(--color-diverge-neg)"
              fill="var(--color-diverge-neg)"
              fillOpacity={0.2}
              strokeDasharray="6 3"
              strokeWidth={2}
            />
            <Legend verticalAlign="bottom" height={24} iconType="circle" />
            <Tooltip
              contentStyle={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
              itemStyle={{ color: "var(--color-ink)" }}
              formatter={(value, name) => [`${Math.round(Number(value))}`, `${name}`]}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>
    </Board>
  );
}

interface WeeklyHeadToHeadProps {
  sideA: Set<number>;
  sideB: Set<number>;
  year: number;
  boxScoresByYear: Map<number, BoxScoreEntry[]>;
  teamAName: string;
  teamBName: string;
  fullCoverageYears: Set<number>;
}

function WeeklyHeadToHead({
  sideA,
  sideB,
  year,
  boxScoresByYear,
  teamAName,
  teamBName,
  fullCoverageYears,
}: WeeklyHeadToHeadProps) {
  const data = useMemo(
    () => computeWeeklyHeadToHead(Array.from(sideA), Array.from(sideB), year, boxScoresByYear),
    [sideA, sideB, year, boxScoresByYear]
  );

  const hasCoverage = fullCoverageYears.has(year) && data.length > 0;

  return (
    <Board title="Week-by-Week Head-to-Head">
      {!hasCoverage ? (
        <p className="px-3.5 py-3 text-sm text-ink-dim">
          {!fullCoverageYears.has(year)
            ? "Weekly box scores are not fully covered for this season; head-to-head scoring is only charted when box-score coverage is complete."
            : "Select players on both sides to see their weekly scoring matchup."}
        </p>
      ) : (
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 16, right: 16, bottom: 28, left: 4 }}>
              <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="week"
                tick={{ fontSize: 11, fill: "var(--color-ink-faint)" }}
                label={{
                  value: "Week",
                  position: "insideBottom",
                  offset: -10,
                  fill: "var(--color-ink-faint)",
                  fontSize: 11,
                }}
              />
              <YAxis tick={{ fontSize: 11, fill: "var(--color-ink-faint)" }} tickFormatter={v => formatPoints(v)} />
              <Tooltip
                contentStyle={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
                itemStyle={{ color: "var(--color-ink)" }}
                formatter={(value, name) => [`${formatPoints(Number(value))} pts`, `${name}`]}
                labelFormatter={label => `Week ${label}`}
              />
              <Legend verticalAlign="top" height={24} iconType="rect" />
              <Bar dataKey="sideA" name={teamAName || "Team A"} fill="var(--color-accent)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="sideB" name={teamBName || "Team B"} fill="var(--color-diverge-neg)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Board>
  );
}

function AdvancedMetrics({
  sideA,
  sideB,
  teamAName,
  teamBName,
}: {
  sideA: PlayerComparisonResult[];
  sideB: PlayerComparisonResult[];
  teamAName: string;
  teamBName: string;
}) {
  const hasData = [...sideA, ...sideB].some(r => r.weeklyConsistency !== null || r.playoffSplit !== null);
  if (!hasData) return null;

  const rows = [
    ...sideA.map((r, i) => ({ ...r, key: `a-${i}`, team: teamAName || "Team A" })),
    ...sideB.map((r, i) => ({ ...r, key: `b-${i}`, team: teamBName || "Team B" })),
  ];

  return (
    <Board title="Weekly Consistency & Playoff Splits">
      <div className="divide-y divide-border">
        {rows.map(r => (
          <div key={r.key} className="flex items-center gap-4 px-3 py-2 text-sm">
            <div className="min-w-0 flex-1">
              <div className="truncate text-ink">{r.playerName}</div>
              <div className="truncate text-xs text-ink-faint">{r.team}</div>
            </div>
            <div className="flex flex-none items-baseline gap-6 text-xs text-ink-faint tabular-nums">
              <span className="text-right">
                {r.weeklyConsistency ? (
                  <>
                    <span title="Average weekly points">μ {formatPoints(r.weeklyConsistency.mean)}</span>
                    <span className="text-ink-faint/40"> · </span>
                    <span title="Standard deviation of weekly points; lower means more consistent">
                      σ {formatPoints(r.weeklyConsistency.stdev)}
                    </span>
                    <span className="text-ink-faint/40"> · </span>
                    <span
                      title={
                        "Coefficient of variation (σ ÷ μ); lower means less week-to-week variance " +
                        (r.weeklyConsistency.mean > 0 ? "relative to output" : "")
                      }>
                      CV {formatCv(r.weeklyConsistency.cv)}
                    </span>
                  </>
                ) : (
                  <span className="text-ink-faint/60" title="No weekly box-score data for this player.">
                    Consistency —
                  </span>
                )}
              </span>
              <span className="text-right">
                {r.playoffSplit ? (
                  <>
                    <span title="Total points across all regular-season weeks in the box scores">
                      RS {formatPoints(r.playoffSplit.regularSeasonPoints)}
                    </span>
                    <span className="text-ink-faint/40"> · </span>
                    <span title="Total points across all playoff weeks in the box scores">
                      PO {formatPoints(r.playoffSplit.playoffPoints)}
                    </span>
                  </>
                ) : (
                  <span className="text-ink-faint/60" title="No playoff box-score data for this player.">
                    Playoff —
                  </span>
                )}
              </span>
            </div>
          </div>
        ))}
      </div>
    </Board>
  );
}
