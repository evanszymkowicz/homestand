import { useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { CoverageBadge } from "../../components/CoverageBadge";
import type { OwnerScope } from "../../components/OwnerScopeToggle";
import { PartialCoverageNote } from "../../components/PartialCoverageNote";
import { RouteLoading } from "../../components/RouteLoading";
import { SectionHeading } from "../../components/SectionHeading";
import { useAsync, useAsyncList } from "../../hooks/useAsync";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { getDraftSteals, getMrIrrelevant, getRenumberedBoardsByYear } from "../../lib/draft";
import { buildCardPointsMap } from "../../lib/cardPoints";
import { aggregateRostersByYear } from "../../lib/playerHistory";
import { buildAllTimeStatRows, buildSeasonStatRows } from "../../lib/seasonStats";
import {
  getActiveStreaks,
  getKeeperHandoffs,
  getKeeperPointsByOwner,
  getKeeperPointsByPlayer,
  getKeepersByFranchise,
  getLongestKeptAnyOwner,
  getMostPlayedNeverKept,
} from "../../lib/keepers";
import { buildSeasonPercentiles, getCurrentOwnerIds } from "../../lib/stats";
import {
  loadCardPoints,
  loadDraftPicks,
  loadKeepers,
  loadMlbTeams,
  loadOwners,
  loadPlayers,
  loadPlayerSeasonBackfill,
  loadPlayerSeasonPoints,
  loadPlayerSeasons,
  loadPlayerTeamSeasonPoints,
  loadRetiredOwnerIds,
  loadSeasons,
  loadTeams,
  loadTransactions,
  withFallback,
  loadBoxScores,
  loadBoxScoresPartial,
} from "../../lib/data";
import { positionLabel } from "../../lib/positions";
import type {
  BoxScoreEntry,
  CardPoints,
  DraftPick,
  Keeper,
  MlbTeam,
  Owner,
  Player,
  PlayerSeason,
  PlayerSeasonBackfill,
  PlayerSeasonPoints,
  PlayerTeamSeasonPoints,
  Season,
  Team,
  Transaction,
} from "../../types";
import { DraftPlayerSearch } from "./DraftPlayerSearch";
import { DraftSteals } from "./DraftSteals";
import { MrIrrelevant } from "./MrIrrelevant";
import { AllTimeStatsTable } from "./AllTimeStatsTable";
import { SeasonStatsTable } from "./SeasonStatsTable";
import Top10ByPosition from "./Top10ByPosition";
import { WireAndRoster } from "./WireAndRoster";
import { FranchiseGrid } from "../Keepers/FranchiseGrid";
import { HeatIndex } from "../Keepers/HeatIndex";
import { PointsLeaderboards } from "../Keepers/PointsLeaderboards";
import { StreakLeaderboards } from "../Keepers/StreakLeaderboards";

interface DraftData {
  teams: Team[];
  owners: Owner[];
  draftPicks: DraftPick[];
  keepers: Keeper[];
  players: Player[];
  seasonPoints: PlayerSeasonPoints[];
  mlbTeams: MlbTeam[];
  seasons: Season[];
  retiredOwnerIds: string[];
}

/** Everything the Seasons / Keepers / Steals & Busts tabs need.
 * These are the small combined files (a few hundred KB total) -- unlike
 * box_scores/*.json, they're cheap enough to load once for the route.
 *
 * transactions.json (2.5MB), player_seasons.json (5.66MB), and
 * player_team_season_points.json (1.51MB) are deliberately NOT here: at ~9MB
 * combined they'd more than double the landing cost of /players for data only
 * some tabs read. See loadTabData and loadSeasonStatsExtraData below.
 * box_scores/{year}.json (the Seasons tab's stat/roster-status source) is
 * loaded separately per year -- see seasonBoxScoresState. */
async function loadDraftData(): Promise<DraftData> {
  const [teams, owners, draftPicks, keepers, players, seasonPoints, mlbTeams, seasons, retiredOwnerIds] =
    await Promise.all([
      loadTeams(),
      loadOwners(),
      loadDraftPicks(),
      loadKeepers(),
      loadPlayers(),
      loadPlayerSeasonPoints(),
      loadMlbTeams(),
      loadSeasons(),
      withFallback(loadRetiredOwnerIds(), []),
    ]);
  return { teams, owners, draftPicks, keepers, players, seasonPoints, mlbTeams, seasons, retiredOwnerIds };
}

interface SeasonStatsExtraData {
  playerSeasons: PlayerSeason[];
  playerTeamSeasonPoints: PlayerTeamSeasonPoints[];
  playerSeasonBackfill: PlayerSeasonBackfill[];
  cardPoints: CardPoints[];
}

const EMPTY_SEASON_STATS_EXTRA_DATA: SeasonStatsExtraData = {
  playerSeasons: [],
  playerTeamSeasonPoints: [],
  playerSeasonBackfill: [],
  cardPoints: [],
};

/** player_seasons.json + player_team_season_points.json + player_season_backfill.json
 * + card_points.json,
 * fetched only once the Seasons tab (the only consumer of buildSeasonStatRows) is
 * actually open -- these total ~7MB, so bundling them into loadDraftData would
 * block every other tab's initial render on data it never touches. Cached by
 * path the same as loadTabData below, so switching tabs re-uses the resolved
 * promise rather than refetching. */
async function loadSeasonStatsExtraData(tab: Tab): Promise<SeasonStatsExtraData> {
  if (tab !== "seasons") return EMPTY_SEASON_STATS_EXTRA_DATA;
  const [playerSeasons, playerTeamSeasonPoints, playerSeasonBackfill, cardPoints] = await Promise.all([
    loadPlayerSeasons(),
    loadPlayerTeamSeasonPoints(),
    loadPlayerSeasonBackfill(),
    loadCardPoints(),
  ]);
  return { playerSeasons, playerTeamSeasonPoints, playerSeasonBackfill, cardPoints };
}

interface DraftTabData {
  teamSeasonPoints: PlayerTeamSeasonPoints[];
  transactions: Transaction[];
}

const EMPTY_TAB_DATA: DraftTabData = { teamSeasonPoints: [], transactions: [] };

/** The multi-MB datasets, fetched only once a tab that needs them is opened.
 * `loadJson` in lib/data.ts caches by path, so switching back and forth
 * re-uses the same in-flight or resolved promise rather than refetching. */
async function loadTabData(tab: Tab): Promise<DraftTabData> {
  if (tab === "wire") {
    const [teamSeasonPoints, transactions] = await Promise.all([loadPlayerTeamSeasonPoints(), loadTransactions()]);
    return { ...EMPTY_TAB_DATA, teamSeasonPoints, transactions };
  }
  return EMPTY_TAB_DATA;
}

type Tab = "seasons" | "keepers" | "steals" | "wire";

const TABS: { key: Tab; label: string }[] = [
  { key: "seasons", label: "Seasons" },
  { key: "keepers", label: "Keepers" },
  { key: "wire", label: "Roster & Wire" },
  { key: "steals", label: "Steals & Busts" },
];

type KeepersTab = "streaks" | "points" | "franchises" | "heat";

const KEEPERS_TABS: { key: KeepersTab; label: string }[] = [
  { key: "streaks", label: "Streaks" },
  { key: "points", label: "Points" },
  { key: "franchises", label: "Franchises" },
  { key: "heat", label: "Heat Index" },
];

export default function Players() {
  const {
    year: yearParam,
    tab: tabParam,
    keepersTab: keepersTabParam,
  } = useParams<{ year?: string; tab?: string; keepersTab?: string }>();
  const navigate = useNavigate();
  const state = useAsync(loadDraftData, []);

  // Hooks must run unconditionally on every render so these are derived before the loading/error/not-found early returns below.
  const teams = useAsyncList(state, d => d.teams);
  const owners = useAsyncList(state, d => d.owners);
  const draftPicks = useAsyncList(state, d => d.draftPicks);
  const keepers = useAsyncList(state, d => d.keepers);
  const players = useAsyncList(state, d => d.players);
  const seasonPoints = useAsyncList(state, d => d.seasonPoints);
  const mlbTeams = useAsyncList(state, d => d.mlbTeams);
  const seasons = useAsyncList(state, d => d.seasons);
  const retiredOwnerIds = useAsyncList(state, d => d.retiredOwnerIds);

  const isAllTime = yearParam === "all-time";
  const parsedYear = isAllTime ? undefined : yearParam ? Number(yearParam) : undefined;
  const basePath = isAllTime ? "/players/all-time" : parsedYear ? `/players/${parsedYear}` : "/players";
  const validTabs = TABS.map(t => t.key);
  const tab: Tab = keepersTabParam ? "keepers" : validTabs.includes(tabParam as Tab) ? (tabParam as Tab) : "seasons";
  const setTab = (newTab: Tab) => {
    if (newTab === "keepers") {
      navigate(`${basePath}/keepers/streaks`);
    } else {
      navigate(`${basePath}/${newTab}`);
    }
  };

  const keepersTab: KeepersTab = KEEPERS_TABS.map(t => t.key).includes(keepersTabParam as KeepersTab)
    ? (keepersTabParam as KeepersTab)
    : "streaks";
  const [keepersSearch, setKeepersSearch] = useState("");
  const [ownerScope, setOwnerScope] = useState<OwnerScope>("current");

  const tabState = useAsync(() => loadTabData(tab), [tab]);
  const teamSeasonPoints = useAsyncList(tabState, d => d.teamSeasonPoints);
  const transactions = useAsyncList(tabState, d => d.transactions);

  const seasonStatsExtraState = useAsync(() => loadSeasonStatsExtraData(tab), [tab]);
  const playerSeasons = useAsyncList(seasonStatsExtraState, d => d.playerSeasons);
  const playerTeamSeasonPoints = useAsyncList(seasonStatsExtraState, d => d.playerTeamSeasonPoints);
  const playerSeasonBackfill = useAsyncList(seasonStatsExtraState, d => d.playerSeasonBackfill);
  const cardPoints = useAsyncList(seasonStatsExtraState, d => d.cardPoints);
  const cardPointsByYearPlayer = useMemo(() => buildCardPointsMap(cardPoints), [cardPoints]);

  const boardsByYear = useMemo(() => getRenumberedBoardsByYear(draftPicks, teams), [draftPicks, teams]);
  const sortedYears = useMemo(() => Array.from(boardsByYear.keys()).sort((a, b) => a - b), [boardsByYear]);
  const latestYear = sortedYears[sortedYears.length - 1];
  const positionByPlayerId = useMemo(
    () => new Map(players.map(p => [p.player_id, positionLabel(p.default_position_id)])),
    [players]
  );
  const mrIrrelevantEntries = useMemo(
    () => getMrIrrelevant(boardsByYear, seasonPoints, keepers),
    [boardsByYear, seasonPoints, keepers]
  );
  const draftSteals = useMemo(
    () => getDraftSteals(boardsByYear, seasonPoints, keepers),
    [boardsByYear, seasonPoints, keepers]
  );
  // The Steals & Busts tab is a top-N all-time leaderboard, so it's frozen to
  // finished seasons -- an in-progress season's partial points would rank a
  // pick as a phantom bust. draftSteals itself stays unfiltered since
  // DraftPlayerSearch/getPlayerDraftHistory use it for per-player context,
  // not a ranking.
  const finalYears = useMemo(() => new Set(seasons.filter(s => s.status === "final").map(s => s.year)), [seasons]);
  const finalDraftSteals = useMemo(
    () => draftSteals.filter(e => finalYears.has(e.pick.year)),
    [draftSteals, finalYears]
  );

  const currentOwnerIds = useMemo(() => getCurrentOwnerIds(teams), [teams]);
  const retiredOwnerIdSet = useMemo(() => new Set(retiredOwnerIds), [retiredOwnerIds]);
  const scopedOwners = useMemo(
    () =>
      ownerScope === "current"
        ? owners.filter(o => currentOwnerIds.has(o.owner_id) && !retiredOwnerIdSet.has(o.owner_id))
        : owners,
    [owners, ownerScope, currentOwnerIds, retiredOwnerIdSet]
  );

  const finalSeasonPoints = useMemo(() => seasonPoints.filter(p => finalYears.has(p.year)), [seasonPoints, finalYears]);

  const anyOwnerStreaks = useMemo(() => getLongestKeptAnyOwner(keepers, owners), [keepers, owners]);
  const activeAnyOwnerStreaks = useMemo(() => getActiveStreaks(anyOwnerStreaks, keepers), [anyOwnerStreaks, keepers]);
  const handoffs = useMemo(() => getKeeperHandoffs(keepers, owners), [keepers, owners]);

  const neverKept = useMemo(
    () => getMostPlayedNeverKept(players, keepers, finalSeasonPoints, 50),
    [players, keepers, finalSeasonPoints]
  );

  const pointsByOwner = useMemo(
    () => getKeeperPointsByOwner(keepers, finalSeasonPoints, scopedOwners),
    [keepers, finalSeasonPoints, scopedOwners]
  );
  const pointsByPlayer = useMemo(
    () => getKeeperPointsByPlayer(keepers, finalSeasonPoints),
    [keepers, finalSeasonPoints]
  );

  const franchises = useMemo(() => getKeepersByFranchise(keepers, mlbTeams, owners), [keepers, mlbTeams, owners]);

  const keeperYears = useMemo(() => Array.from(new Set(keepers.map(k => k.year))).sort((a, b) => b - a), [keepers]);
  const percentiles = useMemo(() => buildSeasonPercentiles(seasonPoints), [seasonPoints]);

  useDocumentTitle(isAllTime ? "Players · All-Time" : parsedYear !== undefined ? `Players · ${parsedYear}` : "Players");

  const seasonForYear = useMemo(() => seasons.find(s => s.year === parsedYear), [seasons, parsedYear]);

  // box_scores/{year}.json is the Seasons tab's stat/roster-status source and
  // is only fetched when that tab is actually open, on the same
  // cached-by-path loadJson as loadTabData below -- switching tabs/years and
  // back re-uses the resolved promise rather than refetching.
  const seasonBoxScoresState = useAsync((): Promise<BoxScoreEntry[]> => {
    if (
      tab !== "seasons" ||
      parsedYear === undefined ||
      !seasonForYear ||
      seasonForYear.coverage.box_scores === "missing"
    ) {
      return Promise.resolve([]);
    }
    return loadBoxScores(parsedYear);
  }, [tab, parsedYear, seasonForYear?.coverage.box_scores]);
  const seasonBoxScores = useAsyncList(seasonBoxScoresState, d => d);

  const seasonStatRows = useMemo(
    () =>
      parsedYear === undefined
        ? []
        : buildSeasonStatRows(
            parsedYear,
            latestYear,
            playerTeamSeasonPoints,
            playerSeasonBackfill,
            draftPicks,
            playerSeasons,
            seasonBoxScores,
            teams,
            cardPointsByYearPlayer
          ),
    [
      parsedYear,
      latestYear,
      playerTeamSeasonPoints,
      playerSeasonBackfill,
      draftPicks,
      playerSeasons,
      seasonBoxScores,
      teams,
      cardPointsByYearPlayer,
    ]
  );

  // All-time stat lines cover only seasons with raw stat-line box scores
  // (2019+, 2018 partial) — the same stat_lines coverage the CoverageBadge
  // labels. Every such season is final in the current archive, but the status
  // gate keeps a future in-progress 2019+ season's partial lines out too.
  const allTimeStatYears = useMemo(
    () => seasons.filter(s => s.status === "final" && s.coverage.stat_lines === "full").map(s => s.year),
    [seasons]
  );

  // The all-time view fans out every box-score year: the pre-2019 files don't
  // feed stat lines (gated above), but they resolve which of a historical
  // season's multiple stints ended last — the Owner column's "latest known
  // affiliation" is decided by the final team, not stint order.
  const allTimeBoxScoreYears = useMemo(
    () => seasons.filter(s => s.status === "final" && s.coverage.box_scores !== "missing").map(s => s.year),
    [seasons]
  );

  const allTimeBoxScoresState = useAsync((): Promise<Map<number, BoxScoreEntry[]>> => {
    if (tab !== "seasons" || !isAllTime || allTimeBoxScoreYears.length === 0) {
      return Promise.resolve(new Map());
    }
    return loadBoxScoresPartial(allTimeBoxScoreYears);
  }, [tab, isAllTime, allTimeBoxScoreYears]);

  const allTimeStatRows = useMemo(() => {
    if (!isAllTime || tab !== "seasons" || allTimeBoxScoresState.status !== "success") return [];
    const statYearBoxScores = new Map(allTimeBoxScoresState.data);
    for (const year of Array.from(statYearBoxScores.keys())) {
      if (!allTimeStatYears.includes(year)) statYearBoxScores.delete(year);
    }
    const rostersByYear = aggregateRostersByYear(statYearBoxScores);
    return buildAllTimeStatRows(
      playerTeamSeasonPoints,
      playerSeasons,
      players,
      cardPointsByYearPlayer,
      latestYear,
      teams,
      rostersByYear,
      allTimeBoxScoresState.data
    );
  }, [
    isAllTime,
    tab,
    allTimeBoxScoresState,
    allTimeStatYears,
    playerTeamSeasonPoints,
    playerSeasons,
    players,
    cardPointsByYearPlayer,
    latestYear,
    teams,
  ]);

  const allTimeLoadedYears = useMemo(
    () => new Set(allTimeBoxScoresState.status === "success" ? allTimeBoxScoresState.data.keys() : []),
    [allTimeBoxScoresState]
  );
  const allTimeFailedYears = useMemo(
    () => (isAllTime ? allTimeStatYears.filter(year => !allTimeLoadedYears.has(year)) : []),
    [isAllTime, allTimeStatYears, allTimeLoadedYears]
  );

  if (state.status === "loading") {
    return <RouteLoading label="Loading draft data…" />;
  }
  if (state.status === "error") {
    return <p className="text-ink-dim">Couldn't load draft data. Try refreshing the page.</p>;
  }
  if (draftPicks.length === 0) {
    return <p className="text-ink-dim">No draft data available yet.</p>;
  }

  if (yearParam === undefined) {
    return <Navigate to={`/players/${latestYear}`} replace />;
  }
  if (isAllTime) {
    // All-Time is a Seasons-tab view; the other tabs are year-scoped, so an
    // all-time URL for one of them bounces to the numeric-year equivalent
    // instead of pretending an "all-time" wire/steals view exists.
    // Keepers is the exception: its analytics are all-time, so it stays under
    // /players/all-time/keepers/:keepersTab.
    if (tab !== "seasons" && tab !== "keepers") {
      return <Navigate to={`/players/${latestYear}/${tab}`} replace />;
    }
  } else if (parsedYear === undefined || !boardsByYear.has(parsedYear)) {
    return (
      <p className="text-ink-dim">
        No draft found for "{yearParam}".{" "}
        <Link to={`/players/${latestYear}`} className="text-accent underline">
          Go to {latestYear}
        </Link>
        .
      </p>
    );
  }

  if (tab === "keepers" && keepersTabParam !== keepersTab) {
    return <Navigate to={`${basePath}/keepers/${keepersTab}`} replace />;
  }

  const currentYear = parsedYear;
  const yearIndex = currentYear === undefined ? -1 : sortedYears.indexOf(currentYear);
  // Scoped to a single year; all-time sentinel has no year index to walk.
  const prevYear = isAllTime ? undefined : yearIndex > 0 ? sortedYears[yearIndex - 1] : undefined;
  const nextYear = isAllTime ? undefined : yearIndex < sortedYears.length - 1 ? sortedYears[yearIndex + 1] : undefined;

  function handleLocatePlayer(_playerId: number, liveDraftYears: number[]) {
    if (liveDraftYears.length === 0) return;
    const targetYear =
      currentYear !== undefined && liveDraftYears.includes(currentYear)
        ? currentYear
        : liveDraftYears[liveDraftYears.length - 1];
    if (targetYear !== currentYear) navigate(`/players/${targetYear}/${tab}`);
  }

  function goToYear(year: number) {
    navigate(`/players/${year}/${tab}`);
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-border">
        <nav className="flex items-center gap-1 overflow-x-auto">
          {TABS.map((t, i) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`border-b-2 py-2 ${i === 0 ? "pr-3" : "px-3"} text-sm font-semibold whitespace-nowrap ${
                tab === t.key ? "border-accent text-ink" : "border-transparent text-ink-faint hover:text-ink"
              }`}>
              {t.label}
            </button>
          ))}
        </nav>
        {tab === "seasons" && (
          <div className="ml-auto flex flex-wrap items-center gap-2 pb-1.5">
            <div className="flex items-center gap-1">
              {!isAllTime && (
                <button
                  type="button"
                  disabled={prevYear === undefined}
                  onClick={() => prevYear !== undefined && goToYear(prevYear)}
                  aria-label="Previous draft"
                  className="flex h-8 w-8 flex-none items-center justify-center rounded-full border border-border bg-surface text-sm text-ink-dim disabled:opacity-30 hover:text-ink">
                  ‹
                </button>
              )}
              <select
                value={yearParam}
                onChange={e =>
                  e.target.value === "all-time"
                    ? navigate("/players/all-time/seasons")
                    : goToYear(Number(e.target.value))
                }
                aria-label="Select draft year"
                className="rounded-full border border-border bg-surface px-3 py-1 text-sm font-semibold">
                <option value="all-time">All-Time</option>
                {[...sortedYears].reverse().map(y => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
              {!isAllTime && (
                <button
                  type="button"
                  disabled={nextYear === undefined}
                  onClick={() => nextYear !== undefined && goToYear(nextYear)}
                  aria-label="Next draft"
                  className="flex h-8 w-8 flex-none items-center justify-center rounded-full border border-border bg-surface text-sm text-ink-dim disabled:opacity-30 hover:text-ink">
                  ›
                </button>
              )}
            </div>
            <DraftPlayerSearch
              players={players}
              draftPicks={draftPicks}
              seasonPoints={seasonPoints}
              owners={owners}
              mrIrrelevantEntries={mrIrrelevantEntries}
              draftSteals={draftSteals}
              onLocate={handleLocatePlayer}
            />
          </div>
        )}
      </div>

      {tab === "keepers" && (
        <div className="mb-6 flex items-center gap-1 overflow-x-auto border-b border-border">
          {KEEPERS_TABS.map((t, i) => (
            <button
              key={t.key}
              type="button"
              onClick={() => navigate(`${basePath}/keepers/${t.key}`)}
              className={`border-b-2 py-2 ${i === 0 ? "pr-3" : "px-3"} text-sm font-semibold whitespace-nowrap ${
                keepersTab === t.key ? "border-accent text-ink" : "border-transparent text-ink-faint hover:text-ink"
              }`}>
              {t.label}
            </button>
          ))}
          <input
            type="search"
            value={keepersSearch}
            onChange={e => setKeepersSearch(e.target.value)}
            placeholder={keepersTab === "franchises" ? "Search any player or franchise…" : "Search any player…"}
            aria-label="Search keepers"
            className="mb-1.5 ml-auto w-56 flex-none rounded-full border border-border bg-surface px-3 py-1 text-sm"
          />
        </div>
      )}

      {tab === "seasons" &&
        (isAllTime ? (
          <div>
            <div className="mb-3 flex items-center gap-2">
              <SectionHeading>All-Time Season Stats</SectionHeading>
              <CoverageBadge seasons={seasons} domain="stat_lines" />
            </div>
            {(allTimeBoxScoresState.status === "loading" || seasonStatsExtraState.status === "loading") && (
              <p className="text-ink-dim">Loading all-time stats…</p>
            )}
            {(allTimeBoxScoresState.status === "error" || seasonStatsExtraState.status === "error") && (
              <p className="text-ink-dim">Couldn't load season stats. Try refreshing the page.</p>
            )}
            {allTimeBoxScoresState.status === "success" && seasonStatsExtraState.status === "success" && (
              <>
                <PartialCoverageNote failedYears={allTimeFailedYears} />
                <AllTimeStatsTable rows={allTimeStatRows} owners={owners} mlbTeams={mlbTeams} />
                <p className="mt-2 text-[0.66rem] text-ink-faint">
                  Batting/pitching columns cover 2019 on (when raw stat lines begin; 2020's shortened 8-week season is
                  included); Points and Seasons span the full archive.
                </p>
              </>
            )}
          </div>
        ) : (
          <div>
            <div className="mb-3 flex items-center gap-2">
              <SectionHeading>Season Stats</SectionHeading>
              <CoverageBadge seasons={seasons} domain="stat_lines" />
            </div>
            {(seasonBoxScoresState.status === "loading" || seasonStatsExtraState.status === "loading") && (
              <p className="text-ink-dim">Loading season…</p>
            )}
            {(seasonBoxScoresState.status === "error" || seasonStatsExtraState.status === "error") && (
              <p className="text-ink-dim">Couldn't load season data. Try refreshing the page.</p>
            )}
            {seasonBoxScoresState.status === "success" && seasonStatsExtraState.status === "success" && (
              <>
                <SeasonStatsTable rows={seasonStatRows} owners={owners} mlbTeams={mlbTeams} year={parsedYear} />
                {seasonForYear && seasonForYear.coverage.stat_lines !== "full" && (
                  <p className="mt-2 text-[0.66rem] text-ink-faint">
                    No raw batting/pitching stat line on file for some or all of {currentYear} — batting/pitching
                    columns read blank where that data doesn't exist (pre-2019, or a gap inside 2018's partial
                    coverage).
                  </p>
                )}
                <Top10ByPosition seasonPoints={seasonPoints} playerSeasons={playerSeasons} year={parsedYear} />
              </>
            )}
          </div>
        ))}
      {tab === "steals" && (
        <div className="space-y-8">
          <DraftSteals seasons={seasons} entries={finalDraftSteals} owners={owners} />
          <MrIrrelevant
            seasons={seasons}
            entries={mrIrrelevantEntries}
            owners={owners}
            positionByPlayerId={positionByPlayerId}
          />
        </div>
      )}
      {tab === "wire" &&
        (tabState.status === "loading" ? (
          <RouteLoading label="Loading wire activity…" />
        ) : tabState.status === "error" ? (
          <p className="text-ink-dim">Couldn't load wire activity. Try refreshing the page.</p>
        ) : (
          <WireAndRoster
            owners={owners}
            seasons={seasons}
            teams={teams}
            players={players}
            seasonPoints={seasonPoints}
            teamSeasonPoints={teamSeasonPoints}
            draftPicks={draftPicks}
            keepers={keepers}
            transactions={transactions}
          />
        ))}
      {tab === "keepers" && (
        <>
          {keepersTab === "streaks" && (
            <StreakLeaderboards
              seasons={seasons}
              search={keepersSearch}
              longestKept={anyOwnerStreaks}
              activeStreaks={activeAnyOwnerStreaks}
              handoffs={handoffs}
            />
          )}
          {keepersTab === "points" && (
            <PointsLeaderboards
              search={keepersSearch}
              seasons={seasons}
              byOwner={pointsByOwner}
              byPlayer={pointsByPlayer}
              neverKept={neverKept}
              ownerScope={ownerScope}
              onOwnerScopeChange={setOwnerScope}
            />
          )}
          {keepersTab === "franchises" && (
            <FranchiseGrid seasons={seasons} groups={franchises} search={keepersSearch} />
          )}
          {keepersTab === "heat" && (
            <HeatIndex
              keepers={keepers}
              seasonPoints={seasonPoints}
              positionByPlayerId={positionByPlayerId}
              boardsByYear={boardsByYear}
              percentiles={percentiles}
              years={keeperYears}
              search={keepersSearch}
              owners={owners}
            />
          )}
        </>
      )}
    </div>
  );
}
