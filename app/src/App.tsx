import { Suspense, lazy } from "react";
import { Link, Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { RouteErrorBoundary } from "./components/RouteErrorBoundary";
import { RouteLoading } from "./components/RouteLoading";
import { useDocumentTitle } from "./hooks/useDocumentTitle";

const Players = lazy(() => import("./routes/Players"));
const Analytics = lazy(() => import("./routes/Analytics"));
const PairDetail = lazy(() => import("./routes/HeadToHead/PairDetail"));
const Matchup = lazy(() => import("./routes/Matchup"));
const Owner = lazy(() => import("./routes/Owner"));
const PlayerRoute = lazy(() => import("./routes/Player"));
const Season = lazy(() => import("./routes/Season"));
const SeasonTeamPage = lazy(() => import("./routes/Season/SeasonTeamPage"));
const Superlatives = lazy(() => import("./routes/Superlatives"));

function NotFound() {
  useDocumentTitle("Page not found");
  return (
    <div className="py-12 text-center">
      <p className="text-lg font-bold">Page not found</p>
      <p className="mt-1 text-sm text-ink-dim">
        <Link to="/season" className="text-accent underline">
          Go to Standings
        </Link>
      </p>
    </div>
  );
}

/** /draft was the Players tab's path before the rename; old links keep working. */
function LegacyDraftRedirect() {
  const { year } = useParams<{ year?: string }>();
  return <Navigate to={year ? `/players/${year}` : "/players"} replace />;
}

/** Keepers used to be a top-level route; old bookmarks now land under Players. */
function KeepersRedirect() {
  const { tab } = useParams<{ tab?: string }>();
  const validTabs = ["streaks", "points", "franchises", "heat"] as const;
  const targetTab = validTabs.includes(tab as (typeof validTabs)[number]) ? tab : "streaks";
  return <Navigate to={`/players/all-time/keepers/${targetTab}`} replace />;
}

const LOADING_LABELS: Record<string, string> = {
  "/head-to-head": "Loading matchup history…",
  "/season": "Loading season…",
  "/superlatives": "Loading superlatives…",
  "/owner": "Loading owner…",
  "/players": "Loading players…",
  "/player/": "Loading player…",
  "/analytics": "Loading analytics…",
  "/matchup": "Loading matchup…",
};

/** Pick a short, human-readable label for the route currently being code-split. */
function routeLoadingLabel(pathname: string): string {
  for (const prefix of Object.keys(LOADING_LABELS)) {
    if (pathname.startsWith(prefix)) return LOADING_LABELS[prefix];
  }
  return "Loading…";
}

function App() {
  const location = useLocation();
  const loadingLabel = routeLoadingLabel(location.pathname);
  return (
    <Suspense fallback={<RouteLoading label={loadingLabel} />}>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/season" replace />} />
          <Route
            path="head-to-head/:ownerA/:ownerB"
            element={
              <RouteErrorBoundary routeName="Head to Head">
                <PairDetail />
              </RouteErrorBoundary>
            }
          />
          <Route
            path="season"
            element={
              <RouteErrorBoundary routeName="Season">
                <Season />
              </RouteErrorBoundary>
            }
          />
          <Route
            path="season/:year"
            element={
              <RouteErrorBoundary routeName="Season">
                <Season />
              </RouteErrorBoundary>
            }
          />
          <Route
            path="season/:year/:tab"
            element={
              <RouteErrorBoundary routeName="Season">
                <Season />
              </RouteErrorBoundary>
            }
          />
          <Route
            path="season/:year/team/:teamId"
            element={
              <RouteErrorBoundary routeName="Team">
                <SeasonTeamPage />
              </RouteErrorBoundary>
            }
          />
          <Route
            path="matchup/:year/:matchupId"
            element={
              <RouteErrorBoundary routeName="Matchup">
                <Matchup />
              </RouteErrorBoundary>
            }
          />
          <Route
            path="superlatives"
            element={
              <RouteErrorBoundary routeName="Superlatives">
                <Superlatives />
              </RouteErrorBoundary>
            }
          />
          <Route
            path="superlatives/:tab"
            element={
              <RouteErrorBoundary routeName="Superlatives">
                <Superlatives />
              </RouteErrorBoundary>
            }
          />
          <Route
            path="owner"
            element={
              <RouteErrorBoundary routeName="Owner">
                <Owner />
              </RouteErrorBoundary>
            }
          />
          <Route
            path="owner/:ownerId"
            element={
              <RouteErrorBoundary routeName="Owner">
                <Owner />
              </RouteErrorBoundary>
            }
          />
          <Route
            path="players"
            element={
              <RouteErrorBoundary routeName="Players">
                <Players />
              </RouteErrorBoundary>
            }
          />
          <Route
            path="players/:year"
            element={
              <RouteErrorBoundary routeName="Players">
                <Players />
              </RouteErrorBoundary>
            }
          />
          <Route
            path="players/:year/keepers/:keepersTab"
            element={
              <RouteErrorBoundary routeName="Players">
                <Players />
              </RouteErrorBoundary>
            }
          />
          <Route
            path="players/:year/:tab"
            element={
              <RouteErrorBoundary routeName="Players">
                <Players />
              </RouteErrorBoundary>
            }
          />
          <Route path="draft" element={<Navigate to="/players" replace />} />
          <Route path="draft/:year" element={<LegacyDraftRedirect />} />
          <Route
            path="player/:playerId"
            element={
              <RouteErrorBoundary routeName="Player">
                <PlayerRoute />
              </RouteErrorBoundary>
            }
          />
          <Route path="keepers" element={<KeepersRedirect />} />
          <Route path="keepers/:tab" element={<KeepersRedirect />} />
          <Route
            path="analytics"
            element={
              <RouteErrorBoundary routeName="Analytics">
                <Analytics />
              </RouteErrorBoundary>
            }
          />
          <Route
            path="analytics/:tab"
            element={
              <RouteErrorBoundary routeName="Analytics">
                <Analytics />
              </RouteErrorBoundary>
            }
          />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
  );
}

export default App;
