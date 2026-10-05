import { DivergingViews } from "./DivergingViews";
import { Trades } from "./Trades";
import { useMemo } from "react";
import { TradeEvaluator } from "./TradeEvaluator";
import { RouteLoading } from "../../components/RouteLoading";
import { useAsync, useAsyncList } from "../../hooks/useAsync";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import {
  loadBoxScoresPartial,
  loadDraftPicks,
  loadKeepers,
  loadMatchups,
  loadOwners,
  loadPlayerSeasonPoints,
  loadPlayerSeasons,
  loadPlayerTeamSeasonPoints,
  loadRetiredOwnerIds,
  loadSeasons,
  loadTeams,
  loadTrades,
  loadTransactions,
  withFallback,
} from "../../lib/data";
import { getTradeRegistry } from "../../lib/trades";
import {
  buildTradeEvaluationIndex,
  computeSurplusHistogram,
  computeTradeSymmetry,
  gradeAllTrades,
  type TradeEvaluationIndex,
  type TradeGrade,
} from "../../lib/tradeEvaluation";
import { useUrlTab } from "../../lib/tabRouting";
import type {
  BoxScoreEntry,
  DraftPick,
  Keeper,
  Matchup,
  Owner,
  PlayerSeason,
  PlayerSeasonPoints,
  PlayerTeamSeasonPoints,
  Season,
  Team,
  Trade,
  Transaction,
} from "../../types";

/** Shared by every tab, and small (~390KB combined). */
interface AnalyticsData {
  owners: Owner[];
  seasons: Season[];
  teams: Team[];
  draftPicks: DraftPick[];
  seasonPoints: PlayerSeasonPoints[];
}

async function loadAnalyticsData(): Promise<AnalyticsData> {
  const [owners, seasons, teams, draftPicks, seasonPoints] = await Promise.all([
    loadOwners(),
    loadSeasons(),
    loadTeams(),
    loadDraftPicks(),
    loadPlayerSeasonPoints(),
  ]);
  return { owners, seasons, teams, draftPicks, seasonPoints };
}

/** Heavy box-score/roster data is only fetched when the evaluator tab is active. */
interface EvaluatorData {
  playerSeasons: PlayerSeason[];
  playerTeamSeasonPoints: PlayerTeamSeasonPoints[];
  boxScoresByYear: Map<number, BoxScoreEntry[]>;
}

type Tab = "diverging" | "evaluator" | "trades";

const TABS: { key: Tab; label: string }[] = [
  { key: "diverging", label: "Diverging Views" },
  { key: "evaluator", label: "Trade Machine" },
  { key: "trades", label: "Trades" },
];

/** The trade ledger (transactions.json is 2.5 MB) loads only once the Trades
 * tab is actually open; the other placeholders load nothing. */
interface TradeLedgerData {
  transactions: Transaction[];
  trades: Trade[];
}

const EMPTY_LEDGER_DATA: TradeLedgerData = { transactions: [], trades: [] };

async function loadTradeLedger(tab: Tab): Promise<TradeLedgerData> {
  if (tab !== "trades") return EMPTY_LEDGER_DATA;
  const [transactions, trades] = await Promise.all([loadTransactions(), loadTrades()]);
  return { transactions, trades };
}

/** Keeper + roster points data used to grade every trade in the Trades tab. */
interface TradeGradesData {
  keepers: Keeper[];
  playerTeamSeasonPoints: PlayerTeamSeasonPoints[];
  index: TradeEvaluationIndex | null;
  /** Owners who've left the league but whose last backfilled season still shows
   * them active -- see data/manual/retired-owners.json. */
  retiredOwnerIds: string[];
}

const EMPTY_GRADES_DATA: TradeGradesData = {
  keepers: [],
  playerTeamSeasonPoints: [],
  index: null,
  retiredOwnerIds: [],
};

async function loadTradeGradesData(tab: Tab): Promise<TradeGradesData> {
  if (tab !== "trades") return EMPTY_GRADES_DATA;
  const [keepers, playerTeamSeasonPoints, retiredOwnerIds] = await Promise.all([
    loadKeepers(),
    loadPlayerTeamSeasonPoints(),
    withFallback(loadRetiredOwnerIds(), []),
  ]);
  const index = buildTradeEvaluationIndex(playerTeamSeasonPoints, keepers);
  return { keepers, playerTeamSeasonPoints, index, retiredOwnerIds };
}

export default function Analytics() {
  const state = useAsync(loadAnalyticsData, []);
  const { currentTab: tab, setTab } = useUrlTab(
    "/analytics",
    "diverging",
    TABS.map(t => t.key)
  );
  const matchupState = useAsync(async () => (tab === "diverging" ? loadMatchups() : ([] as Matchup[])), [tab]);
  const ledgerState = useAsync(() => loadTradeLedger(tab), [tab]);
  const gradesState = useAsync(() => loadTradeGradesData(tab), [tab]);
  useDocumentTitle("Analytics");

  const { owners, teams, seasons, draftPicks, seasonPoints } =
    state.status === "success"
      ? state.data
      : {
          owners: [] as Owner[],
          teams: [] as Team[],
          seasons: [] as Season[],
          draftPicks: [] as DraftPick[],
          seasonPoints: [] as PlayerSeasonPoints[],
        };
  const transactions = useAsyncList(ledgerState, d => d.transactions);
  const trades = useAsyncList(ledgerState, d => d.trades);

  const tradeRegistry = useMemo(
    () => getTradeRegistry(draftPicks, transactions, trades, teams, seasonPoints),
    [draftPicks, transactions, trades, teams, seasonPoints]
  );

  const tradeEvalIndex = useMemo(
    () => (gradesState.status === "success" ? gradesState.data.index : null),
    [gradesState]
  );

  const retiredOwnerIds = useAsyncList(gradesState, d => d.retiredOwnerIds);

  const fullCoverageYears = useMemo(() => {
    const years = new Set<number>();
    for (const s of seasons) {
      if (s.coverage?.box_scores === "full") years.add(s.year);
    }
    return years;
  }, [seasons]);

  const tradeGrades = useMemo<TradeGrade[]>(() => {
    if (!tradeEvalIndex) return [];
    const gradable = tradeRegistry.filter(e => fullCoverageYears.has(e.year));
    const { graded } = gradeAllTrades(gradable, tradeEvalIndex, fullCoverageYears);
    return graded;
  }, [tradeRegistry, tradeEvalIndex, fullCoverageYears]);

  const tradeSymmetry = useMemo(() => computeTradeSymmetry(tradeGrades), [tradeGrades]);
  const surplusHistogram = useMemo(() => computeSurplusHistogram(tradeGrades), [tradeGrades]);

  const latestYear = useMemo(
    () => (seasons.length > 0 ? Math.max(...seasons.map(s => s.year)) : new Date().getFullYear()),
    [seasons]
  );

  const evaluatorState = useAsync(async (): Promise<EvaluatorData> => {
    if (tab !== "evaluator") {
      return { playerSeasons: [], playerTeamSeasonPoints: [], boxScoresByYear: new Map() };
    }
    const [playerSeasons, playerTeamSeasonPoints, boxScoresByYear] = await Promise.all([
      loadPlayerSeasons(),
      loadPlayerTeamSeasonPoints(),
      loadBoxScoresPartial([latestYear]),
    ]);
    return { playerSeasons, playerTeamSeasonPoints, boxScoresByYear };
  }, [tab, latestYear]);

  if (state.status === "loading") {
    return <RouteLoading label="Loading analytics…" />;
  }
  if (state.status === "error") {
    return <p className="text-ink-dim">Couldn't load analytics. Try refreshing the page.</p>;
  }

  if (teams.length === 0 || owners.length === 0) {
    return <p className="text-ink-dim">No league data available yet.</p>;
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
      </div>

      {/* The matchup dataset loads only once the Diverging tab is actually
					open; the trade ledger loads once the Trades tab opens; the
					remaining placeholders load nothing. */}
      {tab === "diverging" &&
        (matchupState.status === "loading" ? (
          <RouteLoading label="Loading…" />
        ) : matchupState.status === "error" ? (
          <p className="text-ink-dim">Couldn't load this view. Try refreshing the page.</p>
        ) : (
          <DivergingViews teams={teams} owners={owners} matchups={matchupState.data} seasons={seasons} />
        ))}
      {tab === "evaluator" &&
        (evaluatorState.status === "loading" ? (
          <RouteLoading label="Loading trade machine…" />
        ) : evaluatorState.status === "error" ? (
          <p className="text-ink-dim">Couldn&apos;t load trade machine. Try refreshing the page.</p>
        ) : (
          <TradeEvaluator
            latestYear={latestYear}
            playerSeasons={evaluatorState.data.playerSeasons}
            playerTeamSeasonPoints={evaluatorState.data.playerTeamSeasonPoints}
            seasonPoints={seasonPoints}
            draftPicks={draftPicks}
            seasons={seasons}
            teams={teams}
            owners={owners}
            boxScoresByYear={evaluatorState.data.boxScoresByYear}
          />
        ))}
      {tab === "trades" &&
        (ledgerState.status === "loading" || gradesState.status === "loading" ? (
          <RouteLoading label="Loading trades…" />
        ) : ledgerState.status === "error" || gradesState.status === "error" ? (
          <p className="text-ink-dim">Couldn't load trades. Try refreshing the page.</p>
        ) : (
          <Trades
            entries={tradeRegistry}
            owners={owners}
            seasons={seasons}
            grades={tradeGrades}
            symmetry={tradeSymmetry}
            histogram={surplusHistogram}
            index={tradeEvalIndex}
            fullCoverageYears={fullCoverageYears}
            retiredOwnerIds={retiredOwnerIds}
          />
        ))}
    </div>
  );
}
