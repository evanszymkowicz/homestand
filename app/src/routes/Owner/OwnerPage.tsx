import { useMemo } from "react";
import { Link } from "react-router-dom";
import { CommissionerBadge } from "../../components/CommissionerBadge";
import { SectionHeading } from "../../components/SectionHeading";
import { StatCard } from "../../components/StatCard";
import { formatPoints, formatRecord, formatWinPct } from "../../lib/format";
import { buildTeamOwnersIndex, getPairRecords } from "../../lib/h2h";
import { getOwnerKeeperHistoryByPlayer, getOwnerKeeperStreakAndPoints } from "../../lib/ownerHistory";
import { positionLabel } from "../../lib/positions";
import { finalYearTeams } from "../../lib/coverage";
import { getCareerPoints, getCareerStandings, getTitlesLeaderboard } from "../../lib/stats";
import { getHotColdFormStrips } from "../../lib/divergingViews";
import { computeOwnerMilestones, computeOwnerStreaksByOwner } from "../../lib/ownerMilestones";
import type {
  DraftPick,
  Keeper,
  Matchup,
  Owner,
  Player,
  PlayerSeasonPoints,
  PlayerTeamSeasonPoints,
  Season,
  Team,
  Trade,
  Transaction,
} from "../../types";
import { OwnerKeeperHistory } from "./OwnerKeeperHistory";
import { OwnerMilestones } from "./OwnerMilestones";
import { SeasonHistory } from "./SeasonHistory";
import { TransactionActivity } from "./TransactionActivity";
import { VsEveryone } from "./VsEveryone";

interface OwnerPageProps {
  owner: Owner;
  owners: Owner[];
  teams: Team[];
  matchups: Matchup[];
  draftPicks: DraftPick[];
  keepers: Keeper[];
  players: Player[];
  seasonPoints: PlayerSeasonPoints[];
  seasons: Season[];
  transactions: Transaction[];
  trades: Trade[];
  /** Per-(year, team, player) production rows — the "distinct players
   * rostered" milestone's source, ~2MB instead of the box-score archive. */
  teamSeasonPoints: PlayerTeamSeasonPoints[];
}

/** No useMemo here for the h2h derivations — unlike HeadToHead/index.tsx (which
 * memoizes the same two calls to avoid recomputing on every scope-toggle
 * click), this page has no interactive state to guard against, so a plain
 * call in the render body is the honest cost/benefit call. See
 * future-items.md's Decisions Deferred for the broader revisit note. */
export function OwnerPage({
  owner,
  owners,
  teams,
  matchups,
  draftPicks,
  keepers,
  players,
  seasonPoints,
  seasons,
  transactions,
  trades,
  teamSeasonPoints,
}: OwnerPageProps) {
  // Career record and points are built from already-decided games, so an
  // in-progress season's games-so-far are real, not gated -- unlike titles,
  // which need final_rank and stay frozen until a season ends (mirrors
  // Owner/index.tsx's OwnerDirectory).
  const standing = getCareerStandings(teams, owners).find(s => s.owner.ownerId === owner.owner_id);
  const points = getCareerPoints(teams, owners).find(p => p.owner.ownerId === owner.owner_id);
  const titleRow = getTitlesLeaderboard(finalYearTeams(teams, seasons), owners).find(
    t => t.owner.ownerId === owner.owner_id
  );

  const teamOwnersIndex = buildTeamOwnersIndex(teams);
  const records = getPairRecords(matchups, teamOwnersIndex, "combined");

  const keeperPlayerSummaries = getOwnerKeeperHistoryByPlayer(owner.owner_id, keepers, draftPicks, seasonPoints, teams);
  const positionByPlayerId = new Map(players.map(p => [p.player_id, positionLabel(p.default_position_id)]));
  // keeperPlayerSummaries stays live -- it's an itemized season-by-season
  // list, not a ranked total. The streak/points pair below has its own,
  // different gating rule -- see getOwnerKeeperStreakAndPoints's comment.
  const { keeperPoints, hasFinalKeeperSeason } = getOwnerKeeperStreakAndPoints(
    owner.owner_id,
    keepers,
    seasons,
    seasonPoints,
    owners
  );

  // These two walk matchups.json (multi-MB) once for all owners, so they're
  // memoized separately from the per-owner milestone computation. Switching
  // between owner detail pages then reuses the league-wide pass instead of
  // re-walking the file for every owner.
  const formStrips = useMemo(() => getHotColdFormStrips(matchups, teams, seasons), [matchups, teams, seasons]);
  const streaksByOwner = useMemo(() => computeOwnerStreaksByOwner(teams, matchups), [teams, matchups]);
  const milestones = useMemo(
    () =>
      computeOwnerMilestones({
        ownerId: owner.owner_id,
        teams,
        seasons,
        transactions,
        trades,
        teamSeasonPoints,
        formStrips,
        streaksByOwner,
      }),
    [owner.owner_id, teams, seasons, transactions, trades, teamSeasonPoints, formStrips, streaksByOwner]
  );

  return (
    <div>
      <Link to="/owner" className="text-xs text-ink-faint hover:text-ink">
        ← Owners
      </Link>
      <h2 className="mt-2 text-xl font-bold">
        {owner.canonical_name}
        {owner.is_commissioner && (
          <>
            {" "}
            <CommissionerBadge size="md" />
          </>
        )}
      </h2>

      {standing && points ? (
        <div className="mt-5 grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard
            label="Titles"
            value={String(titleRow?.titles ?? 0)}
            labelBelow

            detail={`${titleRow?.runnerUps ?? 0} Runner-up finish${(titleRow?.runnerUps ?? 0) === 1 ? "" : "es"}`}
            accent={titleRow && titleRow.titles > 0 ? "gold" : undefined}
          />
          <StatCard
            label="Career Record"
            value={formatRecord(standing.wins, standing.losses, standing.ties)}
            // Qualified, not bare "All-Time": these cards sum teams[].overall,
            // which data/README.md defines as regular season only (ESPN's
            // record.overall excludes playoffs). The H2H table lower on this
            // page is built from matchups.json on a "combined" scope, regular
            // PLUS playoffs, so the two records genuinely differ — for Henry
            // Loop, 83-75 here vs 92-86 there. Unlabelled, the page looked
            // self-contradictory.
            detail={`${standing.seasons} season${standing.seasons === 1 ? "" : "s"} · regular season`}
            labelBelow
          />
          <StatCard label="Win%" value={formatWinPct(standing.winPct)} detail="All-Time · regular season" labelBelow />
          <StatCard
            label="Points For"
            value={formatPoints(points.pointsFor)}
            detail={`${formatPoints(points.pointsForPerGame)} per matchup · regular season`}
            labelBelow
          />
          <StatCard
            label="Points Against"
            value={formatPoints(points.pointsAgainst)}
            detail="All-Time · regular season"
            labelBelow
          />
        </div>
      ) : (
        <p className="mt-4 text-ink-dim">No career data on record yet.</p>
      )}

      <SectionHeading as="h3" className="mt-7 mb-3">
        Season History
      </SectionHeading>
      <SeasonHistory ownerId={owner.owner_id} teams={teams} owners={owners} keepers={keepers} seasons={seasons} />

      <OwnerMilestones milestones={milestones} />

      <TransactionActivity
        ownerId={owner.owner_id}
        owners={owners}
        teams={teams}
        transactions={transactions}
        trades={trades}
        seasons={seasons}
      />

      <VsEveryone ownerId={owner.owner_id} owners={owners} teams={teams} records={records} />

      <OwnerKeeperHistory
        key={owner.owner_id}
        seasons={seasons}
        playerSummaries={keeperPlayerSummaries}
        points={keeperPoints}
        hasFinalKeeperSeason={hasFinalKeeperSeason}
        positions={positionByPlayerId}
      />
    </div>
  );
}
