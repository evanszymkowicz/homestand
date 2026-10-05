import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { RouteLoading } from "../../components/RouteLoading";
import { useAsync, useAsyncList } from "../../hooks/useAsync";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { getDraftSteals, getMrIrrelevant, getRenumberedBoardsByYear } from "../../lib/draft";
import {
  loadCardPoints,
  loadDraftPicks,
  loadJerseyHistoryOverrides,
  loadKeepers,
  loadMlbTeams,
  loadOwners,
  loadPlayers,
  loadPlayerSeasonBackfill,
  loadPlayerSeasonPoints,
  loadPlayerSeasons,
  loadSeasons,
  loadTeams,
  loadTrades,
  loadTransactions,
  withFallback,
  type JerseyHistoryOverride,
} from "../../lib/data";
import { getEligiblePositionIds } from "../../lib/positions";
import { buildCardPointsMap, toCardBasis } from "../../lib/cardPoints";
import { buildSeasonPercentiles } from "../../lib/stats";
import type {
  CardPoints,
  DraftPick,
  Keeper,
  MlbTeam,
  Owner,
  Player,
  PlayerSeason,
  PlayerSeasonBackfill,
  PlayerSeasonPoints,
  Season,
  Team,
  Trade,
  Transaction,
} from "../../types";
import { PlayerPage } from "./PlayerPage";

interface PlayerRouteData {
  players: Player[];
  seasonPoints: PlayerSeasonPoints[];
  cardPoints: CardPoints[];
  playerSeasons: PlayerSeason[];
  playerSeasonBackfill: PlayerSeasonBackfill[];
  draftPicks: DraftPick[];
  keepers: Keeper[];
  owners: Owner[];
  teams: Team[];
  seasons: Season[];
  transactions: Transaction[];
  trades: Trade[];
  mlbTeams: MlbTeam[];
  jerseyOverrides: JerseyHistoryOverride[];
}

async function loadPlayerRouteData(): Promise<PlayerRouteData> {
  const [
    players,
    seasonPoints,
    cardPoints,
    playerSeasons,
    playerSeasonBackfill,
    draftPicks,
    keepers,
    owners,
    teams,
    seasons,
    transactions,
    trades,
    mlbTeams,
    jerseyOverrides,
  ] = await Promise.all([
    loadPlayers(),
    loadPlayerSeasonPoints(),
    loadCardPoints(),
    loadPlayerSeasons(),
    loadPlayerSeasonBackfill(),
    loadDraftPicks(),
    loadKeepers(),
    loadOwners(),
    loadTeams(),
    loadSeasons(),
    loadTransactions(),
    loadTrades(),
    loadMlbTeams(),
    withFallback(loadJerseyHistoryOverrides(), []),
  ]);
  return {
    players,
    seasonPoints,
    cardPoints,
    playerSeasons,
    playerSeasonBackfill,
    draftPicks,
    keepers,
    owners,
    teams,
    seasons,
    transactions,
    trades,
    mlbTeams,
    jerseyOverrides,
  };
}

/** Detail-only route (no list view -- reached via search or a player-name
 * link elsewhere in the app, same convention as /matchup/:year/:matchupId),
 * mirroring Owner's list/detail split for its data-loading shape. */
export default function PlayerRoute() {
  const { playerId: playerIdParam } = useParams<{ playerId?: string }>();
  const state = useAsync(loadPlayerRouteData, []);

  // Hooks must run unconditionally on every render, so these are derived
  // before the loading/error/not-found early returns below.
  const players = useAsyncList(state, d => d.players);
  const seasonPoints = useAsyncList(state, d => d.seasonPoints);
  const cardPoints = useAsyncList(state, d => d.cardPoints);
  const cardPointsByYearPlayer = useMemo(() => buildCardPointsMap(cardPoints), [cardPoints]);
  const playerSeasons = useAsyncList(state, d => d.playerSeasons);
  const playerSeasonBackfill = useAsyncList(state, d => d.playerSeasonBackfill);
  const transactions = useAsyncList(state, d => d.transactions);
  const trades = useAsyncList(state, d => d.trades);
  const draftPicks = useAsyncList(state, d => d.draftPicks);
  const keepers = useAsyncList(state, d => d.keepers);
  const owners = useAsyncList(state, d => d.owners);
  const teams = useAsyncList(state, d => d.teams);
  const seasons = useAsyncList(state, d => d.seasons);
  const mlbTeams = useAsyncList(state, d => d.mlbTeams);
  const jerseyOverrides = useAsyncList(state, d => d.jerseyOverrides);
  const playerName = playerIdParam ? players.find(p => p.player_id === Number(playerIdParam))?.full_name : undefined;
  useDocumentTitle(playerName || "Players");

  const boardsByYear = useMemo(() => getRenumberedBoardsByYear(draftPicks, teams), [draftPicks, teams]);
  const mrIrrelevantEntries = useMemo(
    () => getMrIrrelevant(boardsByYear, seasonPoints, keepers),
    [boardsByYear, seasonPoints, keepers]
  );
  const draftSteals = useMemo(
    () => getDraftSteals(boardsByYear, seasonPoints, keepers),
    [boardsByYear, seasonPoints, keepers]
  );
  const seasonPointsWithBackfill = useMemo(
    () =>
      playerSeasonBackfill.length === 0
        ? seasonPoints
        : [
            ...seasonPoints,
            ...playerSeasonBackfill.map(row => ({
              year: row.year,
              player_id: row.player_id,
              player_name: row.player_name,
              points: row.points,
            })),
          ],
    [seasonPoints, playerSeasonBackfill]
  );
  // Percentiles rank the card basis, matching the season table's primary
  // column: a season's standing in the league is a production question, and
  // the card total is the complete production figure. Backfill rows fall back
  // to their own points, which already are the card basis.
  const cardBasisPoints = useMemo(
    () => toCardBasis(seasonPointsWithBackfill, cardPointsByYearPlayer),
    [seasonPointsWithBackfill, cardPointsByYearPlayer]
  );
  const percentiles = useMemo(() => buildSeasonPercentiles(cardBasisPoints), [cardBasisPoints]);
  // player_seasons.json's eligible_slots (that year's real fantasy
  // eligibility, mapped via positions.ts's getEligiblePositionIds), keyed
  // "year:player_id" -- lets Percentile by Season's position picker rank a
  // season against every other player who was ALSO eligible at that same
  // position that year, league-wide (not just whoever's primary matched).
  // Backfilled seasons carry their own eligibility from kona so they can be
  // ranked even when the player was not rostered in our league that year.
  const positionByPlayerSeason = useMemo(
    () =>
      new Map(
        [
          ...playerSeasons.map(row => {
            const key = `${row.year}:${row.player_id}`;
            return [key, getEligiblePositionIds(row.eligible_slots, row.default_position_id)] as const;
          }),
          ...playerSeasonBackfill.map(row => {
            const key = `${row.year}:${row.player_id}`;
            return [key, getEligiblePositionIds(row.eligible_slots, row.default_position_id)] as const;
          }),
        ].map(([key, value]) => [key, value] as [string, number[]])
      ),
    [playerSeasons, playerSeasonBackfill]
  );

  if (state.status === "loading") {
    return <RouteLoading label="Loading player…" />;
  }
  if (state.status === "error") {
    return <p className="text-ink-dim">Couldn't load player data. Try refreshing the page.</p>;
  }
  if (players.length === 0) {
    return <p className="text-ink-dim">No player data available yet.</p>;
  }

  const playerId = playerIdParam ? Number(playerIdParam) : undefined;
  const player = playerId === undefined ? undefined : players.find(p => p.player_id === playerId);
  if (!player) {
    return (
      <p className="text-ink-dim">
        Unknown player.{" "}
        <Link to="/players" className="text-accent underline">
          Back to Players
        </Link>
        .
      </p>
    );
  }

  return (
    <PlayerPage
      player={player}
      seasonPoints={seasonPoints}
      playerSeasons={playerSeasons}
      transactions={transactions}
      trades={trades}
      draftPicks={draftPicks}
      keepers={keepers}
      owners={owners}
      seasons={seasons}
      mlbTeams={mlbTeams}
      jerseyOverrides={jerseyOverrides}
      mrIrrelevantEntries={mrIrrelevantEntries}
      draftSteals={draftSteals}
      percentiles={percentiles}
      positionByPlayerSeason={positionByPlayerSeason}
      playerSeasonBackfill={playerSeasonBackfill}
      cardPointsByYearPlayer={cardPointsByYearPlayer}
      cardBasisSeasonPoints={cardBasisPoints}
    />
  );
}
