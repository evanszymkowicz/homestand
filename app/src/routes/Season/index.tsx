import { useMemo } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { RouteLoading } from "../../components/RouteLoading";
import { useAsync, useAsyncList } from "../../hooks/useAsync";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import {
  loadDraftPicks,
  loadMatchups,
  loadOwners,
  loadPlayerSeasonPoints,
  loadSeasons,
  loadTeams,
  loadTrades,
  withFallback,
} from "../../lib/data";
import { useUrlTab } from "../../lib/tabRouting";
import type { DraftPick, Matchup, Owner, PlayerSeasonPoints, Season, Team, Trade } from "../../types";
import { PowerRankings } from "./PowerRankings";
import { SeasonRecap } from "./SeasonRecap";
import { Standings } from "./Standings";
import { WeekScoreboard } from "./WeekScoreboard";

interface SeasonData {
  seasons: Season[];
  teams: Team[];
  matchups: Matchup[];
  owners: Owner[];
}

async function loadSeasonData(): Promise<SeasonData> {
  const [seasons, teams, matchups, owners] = await Promise.all([
    loadSeasons(),
    loadTeams(),
    loadMatchups(),
    loadOwners(),
  ]);
  return { seasons, teams, matchups, owners };
}

interface SeasonRecapData {
  trades: Trade[];
  playerSeasonPoints: PlayerSeasonPoints[];
  draftPicks: DraftPick[];
}

async function loadSeasonRecapData(): Promise<SeasonRecapData> {
  // Each of these backs a panel that already renders its own coverage or empty
  // state, so they degrade independently: a 404 on one must not blank the other
  // two. `withFallback` is the house pattern for this (see lib/data.ts) --
  // `Promise.all` here made one missing file take down all three panels.
  const [trades, playerSeasonPoints, draftPicks] = await Promise.all([
    withFallback(loadTrades(), [] as Trade[]),
    withFallback(loadPlayerSeasonPoints(), [] as PlayerSeasonPoints[]),
    withFallback(loadDraftPicks(), [] as DraftPick[]),
  ]);
  return { trades, playerSeasonPoints, draftPicks };
}

type Tab = "standings" | "scoreboard" | "rankings" | "recap";

const TABS: { key: Tab; label: string }[] = [
  { key: "standings", label: "Standings" },
  { key: "scoreboard", label: "Scoreboard" },
  { key: "rankings", label: "Power Rankings" },
  { key: "recap", label: "Season Recap" },
];

export default function SeasonRoute() {
  const { year: yearParam } = useParams<{ year?: string }>();
  const navigate = useNavigate();
  const state = useAsync(loadSeasonData, []);

  // Hooks must run unconditionally on every render, so these are derived
  // before the loading/error/not-found early returns below — useAsyncList
  // falls back to a stable empty array until the data actually loads.
  const seasons = useAsyncList(state, d => d.seasons);
  const teams = useAsyncList(state, d => d.teams);
  const matchups = useAsyncList(state, d => d.matchups);
  const parsedYear = yearParam ? Number(yearParam) : undefined;
  const season = useMemo(() => seasons.find(s => s.year === parsedYear), [seasons, parsedYear]);
  useDocumentTitle(season ? `${season.year}` : "History");

  const basePath = parsedYear ? `/season/${parsedYear}` : "/season";
  const { currentTab: tab, setTab } = useUrlTab(
    basePath,
    "standings",
    TABS.map(t => t.key)
  );
  const recapState = useAsync(loadSeasonRecapData, [], tab === "recap");

  if (state.status === "loading") {
    return <RouteLoading label="Loading season data…" />;
  }
  if (state.status === "error") {
    return <p className="text-ink-dim">Couldn't load season data. Try refreshing the page.</p>;
  }
  if (seasons.length === 0) {
    return <p className="text-ink-dim">No season data available yet.</p>;
  }

  const sortedYears = [...seasons.map(s => s.year)].sort((a, b) => a - b);
  const latestYear = sortedYears[sortedYears.length - 1];

  if (!yearParam) {
    return <Navigate to={`/season/${latestYear}`} replace />;
  }

  if (!season) {
    return (
      <p className="text-ink-dim">
        No season found for "{yearParam}".{" "}
        <Link to={`/season/${latestYear}`} className="text-accent underline">
          Go to {latestYear}
        </Link>
        .
      </p>
    );
  }

  const { owners } = state.data;
  const yearIndex = sortedYears.indexOf(season.year);
  const prevYear = yearIndex > 0 ? sortedYears[yearIndex - 1] : undefined;
  const nextYear = yearIndex < sortedYears.length - 1 ? sortedYears[yearIndex + 1] : undefined;

  return (
    <div>
      {season.notes.length > 0 && (
        <div className="mb-5 rounded-xl border border-transparent bg-gold-soft px-4 py-3 text-sm text-gold">
          {season.notes.map((note, i) => (
            <p key={i} className={i > 0 ? "mt-1" : undefined}>
              {note}
            </p>
          ))}
        </div>
      )}

      <nav className="mb-6 flex items-center gap-1 overflow-x-auto border-b border-border">
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
        {tab === "scoreboard" && (
          <div className="mb-1.5 ml-auto flex items-center gap-1">
            <button
              type="button"
              disabled={prevYear === undefined}
              onClick={() => prevYear !== undefined && navigate(`/season/${prevYear}/${tab}`)}
              aria-label="Previous season"
              className="flex h-9 w-9 flex-none items-center justify-center rounded-full border border-border bg-surface text-sm text-ink-dim disabled:opacity-30 hover:text-ink">
              ‹
            </button>
            <select
              value={season.year}
              onChange={e => navigate(`/season/${e.target.value}/${tab}`)}
              aria-label="Select season year"
              className="min-h-9 rounded-full border border-border bg-surface px-3 py-1 text-sm font-semibold">
              {[...sortedYears].reverse().map(y => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={nextYear === undefined}
              onClick={() => nextYear !== undefined && navigate(`/season/${nextYear}/${tab}`)}
              aria-label="Next season"
              className="flex h-9 w-9 flex-none items-center justify-center rounded-full border border-border bg-surface text-sm text-ink-dim disabled:opacity-30 hover:text-ink">
              ›
            </button>
          </div>
        )}
      </nav>

      {tab === "standings" && (
        <Standings season={season} seasons={seasons} teams={teams} owners={owners} matchups={matchups} />
      )}
      {tab === "scoreboard" && (
        <WeekScoreboard key={season.year} season={season} teams={teams} matchups={matchups} owners={owners} />
      )}
      {tab === "rankings" && (
        <PowerRankings season={season} seasons={seasons} teams={teams} matchups={matchups} owners={owners} />
      )}
      {tab === "recap" &&
        (recapState.status === "loading" ? (
          <RouteLoading label="Loading season recap…" />
        ) : recapState.status === "error" ? (
          <p className="text-ink-dim">Couldn&apos;t load season recap data. Try refreshing the page.</p>
        ) : (
          <SeasonRecap
            season={season}
            seasons={seasons}
            teams={teams}
            owners={owners}
            matchups={matchups}
            trades={recapState.data.trades}
            playerSeasonPoints={recapState.data.playerSeasonPoints}
            draftPicks={recapState.data.draftPicks}
          />
        ))}
    </div>
  );
}
