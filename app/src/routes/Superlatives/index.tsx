import { RouteLoading } from "../../components/RouteLoading";
import { loadKeepers, loadMatchups, loadOwners, loadPlayerSeasonPoints, loadSeasons, loadTeams } from "../../lib/data";
import { useAsync } from "../../hooks/useAsync";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { useUrlTab } from "../../lib/tabRouting";
import type { Keeper, Matchup, Owner, PlayerSeasonPoints, Season, Team } from "../../types";
import { HallOfFame } from "./HallOfFame";
import { StreaksAndDroughts } from "./StreaksAndDroughts";
import { SundayCollapse } from "./SundayCollapse";
import { Trivia } from "./Trivia";
import { WorstLineupDecision } from "./WorstLineupDecision";

/** Shared by every tab, and small (~390KB combined). */
interface SuperlativesData {
  owners: Owner[];
  seasons: Season[];
  teams: Team[];
}

const TABS = [
  { key: "streaks", label: "Streaks & Droughts" },
  { key: "lineup", label: "Worst Lineup Decision" },
  { key: "sundaycollapse", label: "Sunday Collapse" },
  { key: "halloffame", label: "Hall of Fame" },
  { key: "trivia", label: "Trivia" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

async function loadSuperlativesData(): Promise<SuperlativesData> {
  const [owners, seasons, teams] = await Promise.all([loadOwners(), loadSeasons(), loadTeams()]);
  return { owners, seasons, teams };
}

interface SuperlativesTabData {
  matchups: Matchup[];
  keepers: Keeper[];
  seasonPoints: PlayerSeasonPoints[];
}

const EMPTY_TAB_DATA: SuperlativesTabData = { matchups: [], keepers: [], seasonPoints: [] };

/**
 * The per-tab datasets, fetched only when a tab that needs them is opened.
 *
 * Streaks & Droughts and Worst Lineup Decision need none of these, so opening
 * the page and going straight to either now costs nothing extra;
 * Hall of Fame's keepers + season points (~940KB) no longer load for everyone.
 * `loadJson` caches by path, so moving between tabs re-uses resolved promises
 * rather than refetching.
 */
async function loadSuperlativesTabData(tab: TabKey): Promise<SuperlativesTabData> {
  if (tab === "trivia" || tab === "sundaycollapse") {
    const matchups = await loadMatchups();
    return { ...EMPTY_TAB_DATA, matchups };
  }
  if (tab === "halloffame") {
    const [keepers, seasonPoints] = await Promise.all([loadKeepers(), loadPlayerSeasonPoints()]);
    return { matchups: [], keepers, seasonPoints };
  }
  return EMPTY_TAB_DATA;
}

export default function Superlatives() {
  const state = useAsync(loadSuperlativesData, []);
  const { currentTab: tab, setTab } = useUrlTab(
    "/superlatives",
    "streaks",
    TABS.map(t => t.key)
  );
  const tabState = useAsync(() => loadSuperlativesTabData(tab), [tab]);
  useDocumentTitle("Superlatives");

  if (state.status === "loading") {
    return <RouteLoading label="Loading superlatives…" />;
  }
  if (state.status === "error") {
    return <p className="text-ink-dim">Couldn't load superlatives. Try refreshing the page.</p>;
  }

  const { owners, teams, seasons } = state.data;
  if (teams.length === 0 || owners.length === 0) {
    return <p className="text-ink-dim">No league data available yet.</p>;
  }

  return (
    <div>
      <div className="mb-7 border-b border-border">
        <nav className="scrollbar-accent flex gap-1 overflow-x-auto">
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

      {tab === "streaks" && <StreaksAndDroughts teams={teams} owners={owners} seasons={seasons} />}
      {tab === "lineup" && <WorstLineupDecision teams={teams} owners={owners} seasons={seasons} />}

      {/* Tabs whose data is deferred each render their own load/error state, so
          a slow fetch never blanks the tab bar the user just clicked. */}
      {(tab === "halloffame" || tab === "trivia" || tab === "sundaycollapse") &&
        (tabState.status === "loading" ? (
          <RouteLoading label="Loading…" />
        ) : tabState.status === "error" ? (
          <p className="text-ink-dim">Couldn't load this view. Try refreshing the page.</p>
        ) : (
          <>
            {tab === "halloffame" && (
              <HallOfFame
                owners={owners}
                seasons={seasons}
                keepers={tabState.data.keepers}
                seasonPoints={tabState.data.seasonPoints}
              />
            )}
            {tab === "trivia" && (
              <Trivia teams={teams} owners={owners} matchups={tabState.data.matchups} seasons={seasons} />
            )}
            {tab === "sundaycollapse" && (
              <SundayCollapse teams={teams} owners={owners} matchups={tabState.data.matchups} seasons={seasons} />
            )}
          </>
        ))}
    </div>
  );
}
