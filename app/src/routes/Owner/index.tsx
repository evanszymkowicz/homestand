import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Board } from "../../components/Board";
import { ChampionBadge } from "../../components/ChampionBadge";
import { CommissionerBadge } from "../../components/CommissionerBadge";
import { OwnerScopeToggle, type OwnerScope } from "../../components/OwnerScopeToggle";
import { RouteLoading } from "../../components/RouteLoading";
import { SectionHeading } from "../../components/SectionHeading";
import { SegmentedToggle } from "../../components/SegmentedToggle";
import { useAsync, useAsyncList } from "../../hooks/useAsync";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { finalYearTeams } from "../../lib/coverage";
import { buildTeamOwnersIndex, getPairRecords, type MatchupScope } from "../../lib/h2h";
import { Grid } from "../HeadToHead/Grid";
import {
  loadDraftPicks,
  loadKeepers,
  loadMatchups,
  loadOwners,
  loadPlayers,
  loadPlayerSeasonPoints,
  loadPlayerTeamSeasonPoints,
  loadSeasons,
  loadTeams,
  loadTrades,
  loadTransactions,
} from "../../lib/data";
import { formatRecord, formatWinPct } from "../../lib/format";
import { getCareerStandings, getCurrentOwnerIds, getTitlesLeaderboard } from "../../lib/stats";
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
import { OwnerPage } from "./OwnerPage";
import { TeamSlotLineage } from "./TeamSlotLineage";

interface OwnerRouteData {
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
  teamSeasonPoints: PlayerTeamSeasonPoints[];
}

/** Every file the Owner route needs. player_team_season_points.json (~2MB) is
 * the "unique players owned" milestone's source; it replaces the ~90MB
 * box-score archive the milestone used to fetch, and its rows equal box_scores'
 * distinct (year, team, player) triples for every season including 2018. */
async function loadOwnerRouteData(): Promise<OwnerRouteData> {
  const [
    owners,
    teams,
    matchups,
    draftPicks,
    keepers,
    players,
    seasonPoints,
    seasons,
    teamSeasonPoints,
    transactions,
    trades,
  ] = await Promise.all([
    loadOwners(),
    loadTeams(),
    loadMatchups(),
    loadDraftPicks(),
    loadKeepers(),
    loadPlayers(),
    loadPlayerSeasonPoints(),
    loadSeasons(),
    loadPlayerTeamSeasonPoints(),
    loadTransactions(),
    // trades.json (~13KB) is the trade-count source of truth. The ledger only
    // retains item_type === "TRADE" for a small minority of executed deals,
    // so deriving the owner's trade count from transactions.json alone
    // understated it — this owner page and the Trades route were counting
    // different things.
    loadTrades(),
  ]);
  return {
    owners,
    teams,
    matchups,
    draftPicks,
    keepers,
    players,
    seasonPoints,
    seasons,
    teamSeasonPoints,
    transactions,
    trades,
  };
}

interface OwnerDirectoryProps {
  owners: Owner[];
  teams: Team[];
  matchups: Matchup[];
  seasons: Season[];
}

const H2H_SCOPE_OPTIONS: { key: MatchupScope; label: string }[] = [
  { key: "regular", label: "Regular Season" },
  { key: "playoffs", label: "Playoffs" },
  { key: "combined", label: "Combined" },
];

/** Card grid of all canonical owners — the first "grid of link-cards" in the
 * app; styled like Championships.tsx's existing year cards since no reusable
 * card-grid component exists yet. Active/All-Time scope reuses the same
 * OwnerScopeToggle + getCurrentOwnerIds pair the Records screen's tabs
 * already use — same toggle, same meaning, not a new concept. The
 * head-to-head grid (formerly its own top-level tab) renders below the cards
 * and follows the same single Active/All-Time toggle. */
function OwnerDirectory({ owners, teams, matchups, seasons }: OwnerDirectoryProps) {
  const [scope, setScope] = useState<OwnerScope>("current");
  const [matchupScope, setMatchupScope] = useState<MatchupScope>("combined");
  const teamOwnersIndex = useMemo(() => buildTeamOwnersIndex(teams), [teams]);
  const records = useMemo(
    () => getPairRecords(matchups, teamOwnersIndex, matchupScope),
    [matchups, teamOwnersIndex, matchupScope]
  );
  // Career record (wins/losses/points) is built from already-decided games,
  // so an in-progress season's games-so-far are real, not gated -- unlike
  // titles, which need final_rank and stay frozen until a season ends.
  const standings = getCareerStandings(teams, owners);
  const titles = getTitlesLeaderboard(finalYearTeams(teams, seasons), owners);
  const currentOwnerIds = getCurrentOwnerIds(teams);
  const scopedOwners = owners.filter(o => scope === "all" || currentOwnerIds.has(o.owner_id));
  const sortedOwners = [...scopedOwners].sort((a, b) => {
    const aTitles = titles.find(t => t.owner.ownerId === a.owner_id)?.titles ?? 0;
    const bTitles = titles.find(t => t.owner.ownerId === b.owner_id)?.titles ?? 0;
    if (aTitles !== bTitles) {
      return bTitles - aTitles;
    }
    const aStanding = standings.find(s => s.owner.ownerId === a.owner_id);
    const bStanding = standings.find(s => s.owner.ownerId === b.owner_id);
    const aWins = aStanding?.wins ?? 0;
    const bWins = bStanding?.wins ?? 0;
    return bWins - aWins;
  });

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <SectionHeading>Owners</SectionHeading>
        <OwnerScopeToggle value={scope} onChange={setScope} />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {sortedOwners.map(owner => {
          const standing = standings.find(s => s.owner.ownerId === owner.owner_id);
          const titleRow = titles.find(t => t.owner.ownerId === owner.owner_id);
          return (
            <Link
              key={owner.owner_id}
              to={`/owner/${owner.owner_id}`}
              className="rounded-xl border border-border bg-surface p-4 shadow-sm hover:bg-surface-2">
              <div className="flex items-center gap-1.5 font-bold">
                <span>{owner.canonical_name}</span>
                {owner.is_commissioner && <CommissionerBadge />}
                {titleRow && titleRow.titles > 0 && (
                  <span className="flex items-center gap-0.5 text-xs font-semibold text-gold">
                    <ChampionBadge label={`${titleRow.titles} title${titleRow.titles > 1 ? "s" : ""}`} />{" "}
                    {titleRow.titles}
                  </span>
                )}
              </div>
              <div className="mt-1 text-xs text-ink-faint">
                {standing
                  ? `${standing.seasons} season${standing.seasons === 1 ? "" : "s"} · ${formatRecord(standing.wins, standing.losses, standing.ties)} (${formatWinPct(standing.winPct)})`
                  : "No seasons on record"}
              </div>
            </Link>
          );
        })}
      </div>

      {matchups.length > 0 && (
        <div className="mt-9">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-wrap items-end gap-2">
              <SectionHeading>Every Owner vs. Every Owner, All-Time</SectionHeading>
            </div>
            <SegmentedToggle
              ariaLabel="Matchup scope"
              size="sm"
              value={matchupScope}
              onChange={setMatchupScope}
              options={H2H_SCOPE_OPTIONS}
            />
          </div>
          <Board>
            <Grid owners={scopedOwners} records={records} />
          </Board>
        </div>
      )}

      {teams.length > 0 && <TeamSlotLineage teams={teams} owners={owners} />}
    </div>
  );
}

export default function OwnerRoute() {
  const { ownerId } = useParams<{ ownerId?: string }>();
  const state = useAsync(loadOwnerRouteData, []);

  // Hooks must run unconditionally on every render, so these are derived
  // before the loading/error/not-found early returns below — useAsyncList
  // falls back to a stable empty array until the data actually loads.
  const owners = useAsyncList(state, d => d.owners);
  const teams = useAsyncList(state, d => d.teams);
  const matchups = useAsyncList(state, d => d.matchups);
  const draftPicks = useAsyncList(state, d => d.draftPicks);
  const keepers = useAsyncList(state, d => d.keepers);
  const players = useAsyncList(state, d => d.players);
  const seasonPoints = useAsyncList(state, d => d.seasonPoints);
  const seasons = useAsyncList(state, d => d.seasons);
  const teamSeasonPoints = useAsyncList(state, d => d.teamSeasonPoints);
  const transactions = useAsyncList(state, d => d.transactions);
  const trades = useAsyncList(state, d => d.trades);
  const ownerName = ownerId ? owners.find(o => o.owner_id === ownerId)?.canonical_name : undefined;
  useDocumentTitle(ownerName || "Owners");

  if (state.status === "loading") {
    return <RouteLoading label="Loading owners…" />;
  }
  if (state.status === "error") {
    return <p className="text-ink-dim">Couldn't load owner data. Try refreshing the page.</p>;
  }
  if (owners.length === 0) {
    return <p className="text-ink-dim">No owner data available yet.</p>;
  }

  if (!ownerId) {
    return <OwnerDirectory owners={owners} teams={teams} matchups={matchups} seasons={seasons} />;
  }

  const owner = owners.find(o => o.owner_id === ownerId);
  if (!owner) {
    return (
      <p className="text-ink-dim">
        Unknown owner.{" "}
        <Link to="/owner" className="text-accent underline">
          Back to Owners
        </Link>
        .
      </p>
    );
  }

  return (
    <OwnerPage
      owner={owner}
      owners={owners}
      teams={teams}
      matchups={matchups}
      draftPicks={draftPicks}
      keepers={keepers}
      players={players}
      seasonPoints={seasonPoints}
      seasons={seasons}
      transactions={transactions}
      trades={trades}
      teamSeasonPoints={teamSeasonPoints}
    />
  );
}
