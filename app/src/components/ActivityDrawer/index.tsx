import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { SegmentedToggle } from "../SegmentedToggle";
import { OwnerLink } from "../OwnerLink";
import { EventRow } from "./EventRow";
import { TrophyPlaceholderRow } from "./TrophyPlaceholderRow";
import {
  loadAchievements,
  loadBoxScores,
  loadMatchups,
  loadOwners,
  loadPlayers,
  loadSeasons,
  loadTeams,
  loadTrades,
  loadTransactions,
} from "../../lib/data";
import {
  ALL_EVENT_KINDS,
  KIND_LABELS,
  buildActivityFeed,
  currentSeason,
  filterFeedByOwner,
  loadStoredFilters,
  loadStoredOwnerFilter,
  loadStoredScope,
  saveStoredFilters,
  saveStoredOwnerFilter,
  saveStoredScope,
  type ActivityScope,
  type EventKind,
} from "../../lib/activityDrawer";
import { formatPoints } from "../../lib/format";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { findTeam } from "../../lib/schedule";
import { ownerHue } from "../../lib/ownerColors";
import type {
  BoxScoreEntry,
  Matchup,
  Owner,
  Player,
  Season,
  Team,
  Trade,
  Transaction,
  TrophyRecord,
} from "../../types";

interface DrawerData {
  season: Season;
  owners: Owner[];
  teams: Team[];
  players: Player[];
  matchups: Matchup[];
  transactions: Transaction[];
  trades: Trade[];
  /** null when the season's box scores failed to load — Highlights hide
   * rather than fail the whole drawer. */
  boxScores: BoxScoreEntry[] | null;
  /** null when the achievements file failed to load or the season lacks
   * achievements coverage — the ESPN Trophies section then shows its
   * placeholder rather than failing the whole drawer. */
  achievements: TrophyRecord[] | null;
}

interface ActivityDrawerProps {
  open: boolean;
  onClose: () => void;
}

function formatDate(epochMs: number | null): string {
  if (epochMs === null) return "";
  return new Date(epochMs).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function weekLabel(week: number | null): string {
  return week === null ? "" : `Week ${week}`;
}

function dateMeta(date: number | null, week: number | null): string {
  return [formatDate(date), weekLabel(week)].filter(Boolean).join(" · ");
}

/** First letter of the first two name parts — the icon for rows that open
 * with a human name. Single-word names take the first two letters. */
function nameInitials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

const SECTION_CAP = 100;

function moreLine(hiddenCount: number) {
  return hiddenCount > 0 ? <p className="px-3 py-1 text-[0.7rem] text-ink-faint">+{hiddenCount} more</p> : null;
}

export function ActivityDrawer({ open, onClose }: ActivityDrawerProps) {
  const [scope, setScope] = useState<ActivityScope>(loadStoredScope);
  const [filters, setFilters] = useState<EventKind[]>(loadStoredFilters);
  const [ownerFilter, setOwnerFilter] = useState<string | null>(loadStoredOwnerFilter);
  const [data, setData] = useState<DrawerData | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const loadedRef = useRef(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      // Kick every independent fetch in parallel, including the box-score
      // fetch that depends on seasons: read the resolved seasons promise with
      // .then() so its fetch can start as soon as seasons is available
      // instead of waiting for the full Promise.allSettled to drain.
      const seasonsPromise = loadSeasons();
      const [owners, teams, players, matchups, transactions, trades, achievements] = await Promise.allSettled([
        loadOwners(),
        loadTeams(),
        loadPlayers(),
        loadMatchups(),
        loadTransactions(),
        loadTrades(),
        loadAchievements(),
      ]);
      const required = <T,>(result: PromiseSettledResult<T>): T => {
        if (result.status === "rejected") throw result.reason;
        return result.value;
      };
      const eventRows = <T,>(result: PromiseSettledResult<T[]>): T[] => {
        if (result.status === "rejected") {
          console.warn("ActivityDrawer: an activity source failed to load", result.reason);
          return [];
        }
        return result.value;
      };
      const optional = <T,>(result: PromiseSettledResult<T>): T | null => {
        if (result.status === "rejected") {
          console.warn("ActivityDrawer: an optional source failed to load", result.reason);
          return null;
        }
        return result.value;
      };
      const seasons = await seasonsPromise.catch(error => {
        throw new Error("loadSeasons failed", { cause: error });
      });
      const season = currentSeason(seasons);
      if (season === null) throw new Error("No seasons on record");
      const boxScores = await loadBoxScores(season.year).catch(error => {
        console.warn("ActivityDrawer: box scores unavailable", error);
        return null;
      });
      setData({
        season,
        owners: required(owners),
        teams: required(teams),
        players: required(players),
        matchups: eventRows(matchups),
        transactions: eventRows(transactions),
        trades: eventRows(trades),
        boxScores,
        achievements: optional(achievements),
      });
    } catch (error) {
      console.error(error);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && !loadedRef.current) {
      loadedRef.current = true;
      void loadData();
    }
    if (!open) {
      loadedRef.current = false;
    }
  }, [open, loadData]);

  // Focus entry, Tab trap, Escape and the body scroll lock live in the shared hook.
  useFocusTrap(panelRef, open, onClose, closeRef);

  // Offseason: the newest season is final, so both scopes collapse to it.
  const scopeLocked = data !== null && data.season.status === "final";
  const effectiveScope: ActivityScope = scopeLocked ? "season" : scope;

  const ownerOptions = useMemo(() => {
    if (data === null) return [];
    const ids = new Set<string>();
    for (const team of data.teams) {
      if (team.year === data.season.year) team.owner_ids.forEach(id => ids.add(id));
    }
    return data.owners
      .filter(o => ids.has(o.owner_id))
      .sort((a, b) => a.canonical_name.localeCompare(b.canonical_name));
  }, [data]);

  const effectiveOwner =
    ownerFilter !== null && ownerOptions.some(o => o.owner_id === ownerFilter) ? ownerFilter : null;

  const scopedFeed = useMemo(() => {
    if (data === null) return null;
    return buildActivityFeed({
      season: data.season,
      scope: effectiveScope,
      matchups: data.matchups,
      teams: data.teams,
      owners: data.owners,
      players: data.players,
      transactions: data.transactions,
      trades: data.trades,
      boxScores: data.boxScores,
      achievements: data.achievements,
    });
  }, [data, effectiveScope]);

  const feed = useMemo(
    () => (scopedFeed === null ? null : filterFeedByOwner(scopedFeed, effectiveOwner)),
    [scopedFeed, effectiveOwner]
  );

  const enabled = (kind: EventKind) => filters.includes(kind);

  const toggleFilter = (kind: EventKind) => {
    const next = enabled(kind) ? filters.filter(k => k !== kind) : [...filters, kind];
    setFilters(next);
    saveStoredFilters(next);
  };

  const changeScope = (next: ActivityScope) => {
    setScope(next);
    saveStoredScope(next);
  };

  const changeOwnerFilter = (ownerId: string | null) => {
    setOwnerFilter(ownerId);
    saveStoredOwnerFilter(ownerId);
  };

  const playerLink = (playerId: number, name: string) => (
    <Link to={`/player/${playerId}`} className="hover:underline">
      {name}
    </Link>
  );

  /** Owner-colored initials chip for rows that open with a human name
   */
  const ownerChipFor = (ownerId: string | null): { initials: string; hue: number } | undefined => {
    if (ownerId === null) return undefined;
    const name = data?.owners.find(o => o.owner_id === ownerId)?.canonical_name;
    if (name === undefined) return undefined;
    return { initials: nameInitials(name), hue: ownerHue(ownerId) };
  };

  const renderAchievements = () => {
    if (feed === null || !enabled("achievement")) return null;
    const rows = feed.achievements.slice(0, SECTION_CAP);
    const windowLabel =
      effectiveScope === "matchup" ? `Week ${data!.season.current_week}` : `${data!.season.year} Season`;
    const hiddenCount = feed.achievements.length - rows.length;
    return (
      <section aria-label="Highlights">
        <h4 className="px-3 pb-1 pt-3 text-[0.62rem] font-bold tracking-widest text-ink-faint uppercase">
          Highlights — {windowLabel}
        </h4>
        {rows.map(event => (
          <EventRow
            key={event.id}
            kind="achievement"
            headshot={{ playerId: event.playerId, playerName: event.playerName }}
            title={
              <>
                {playerLink(event.playerId, event.playerName)} {event.label}
                {event.detail !== null ? ` — ${event.detail}` : ""}
              </>
            }
            meta={
              <>
                Week {event.week} · Owned by <OwnerLink owners={data!.owners} ownerId={event.ownerId} />
              </>
            }
            points={event.points === null ? null : formatPoints(event.points)}
          />
        ))}
        {moreLine(hiddenCount)}
      </section>
    );
  };

  const renderRecords = () => {
    if (feed === null || !enabled("record") || feed.records.length === 0) return null;
    const rows = feed.records.slice(0, SECTION_CAP);
    const hiddenCount = feed.records.length - rows.length;
    return (
      <section aria-label="League records">
        <h4 className="px-3 pb-1 pt-3 text-[0.62rem] font-bold tracking-widest text-ink-faint uppercase">
          League Records — Week {data!.season.current_week}
        </h4>
        {rows.map(event => (
          <EventRow
            key={event.id}
            kind="record"
            ownerChip={ownerChipFor(event.ownerId)}
            title={
              <>
                <OwnerLink owners={data!.owners} ownerId={event.ownerId} /> {event.label}
                {event.detail !== null ? ` — ${event.detail}` : ""}
              </>
            }
            meta={
              <>
                Week {event.week} ·{" "}
                <Link to={`/matchup/${event.year}/${event.matchupId}`} className="hover:underline">
                  box score
                </Link>
              </>
            }
            points={event.points === null ? null : formatPoints(event.points)}
          />
        ))}
        {moreLine(hiddenCount)}
      </section>
    );
  };

  const trophySectionActive =
    feed !== null &&
    enabled("trophy") &&
    effectiveScope === "season" &&
    data !== null &&
    data.achievements !== null &&
    data.season.coverage.achievements !== "missing";

  const renderTrophies = () => {
    if (!trophySectionActive) return null;
    const rows = feed!.trophies.slice(0, SECTION_CAP);
    const hiddenCount = feed!.trophies.length - rows.length;
    return (
      <section aria-label="ESPN Trophies">
        <h4 className="px-3 pb-1 pt-3 text-[0.62rem] font-bold tracking-widest text-ink-faint uppercase">
          ESPN Trophies — {data!.season.year} Season
        </h4>
        {rows.map(event => {
          const team = findTeam(data!.teams, event.year, event.espnTeamId);
          return (
            <EventRow
              key={event.id}
              kind="trophy"
              ownerChip={ownerChipFor(event.ownerId)}
              title={
                <>
                  <OwnerLink owners={data!.owners} ownerId={event.ownerId} /> won the {event.trophyName}
                </>
              }
              meta={
                team ? (
                  <Link to={`/season/${event.year}/team/${event.espnTeamId}`} className="hover:underline">
                    {team.team_name}
                  </Link>
                ) : null
              }
            />
          );
        })}
        {moreLine(hiddenCount)}
        {/* Placeholder only when nobody has earned anything pre-filter — an
            owner filter hiding others' rows must not claim the API serves nothing. */}
        {feed!.trophies.length === 0 && scopedFeed!.trophies.length === 0 ? <TrophyPlaceholderRow /> : null}
      </section>
    );
  };

  const renderTrades = () => {
    if (feed === null || !enabled("trade") || feed.trades.length === 0) return null;
    const rows = feed.trades.slice(0, SECTION_CAP);
    const hiddenCount = feed.trades.length - rows.length;
    return (
      <section aria-label="Trades">
        <h4 className="px-3 pb-1 pt-3 text-[0.62rem] font-bold tracking-widest text-ink-faint uppercase">Trades</h4>
        {rows.map(event => (
          <EventRow
            key={event.id}
            kind="trade"
            ownerChip={ownerChipFor(event.fromOwnerId)}
            title={
              event.outPlayers.length === 0 && event.inPlayers.length === 0 ? (
                <>
                  Trade between <OwnerLink owners={data!.owners} ownerId={event.fromOwnerId} /> and{" "}
                  <OwnerLink owners={data!.owners} ownerId={event.toOwnerId} /> (players unrecoverable)
                </>
              ) : (
                <>
                  <OwnerLink owners={data!.owners} ownerId={event.fromOwnerId} /> traded{" "}
                  {event.outPlayers.map((p, i) => (
                    <span key={p.playerId}>
                      {i > 0 && ", "}
                      {playerLink(p.playerId, p.name)}
                    </span>
                  ))}{" "}
                  to <OwnerLink owners={data!.owners} ownerId={event.toOwnerId} />
                  {event.inPlayers.length > 0 ? ` for ${event.inPlayers.map(p => p.name).join(", ")}` : null}
                </>
              )
            }
            meta={dateMeta(event.executedDate, event.week)}
          />
        ))}
        {moreLine(hiddenCount)}
      </section>
    );
  };

  const renderFas = () => {
    if (feed === null || !enabled("fa") || feed.fas.length === 0) return null;
    const rows = feed.fas.slice(0, SECTION_CAP);
    const hiddenCount = feed.fas.length - rows.length;
    return (
      <section aria-label="Waiver and free agent moves">
        <h4 className="px-3 pb-1 pt-3 text-[0.62rem] font-bold tracking-widest text-ink-faint uppercase">
          Waivers/Free Agent Acquisitions
        </h4>
        {rows.map(event => (
          <EventRow
            key={event.id}
            kind="fa"
            action={event.action}
            ownerChip={ownerChipFor(event.ownerId)}
            title={
              <>
                <OwnerLink owners={data!.owners} ownerId={event.ownerId} /> {event.action}{" "}
                {playerLink(event.playerId, event.playerName)}
              </>
            }
            meta={dateMeta(event.date, event.week)}
          />
        ))}
        {moreLine(hiddenCount)}
      </section>
    );
  };

  const renderIls = () => {
    if (feed === null || !enabled("il") || feed.ils.length === 0) return null;
    const rows = feed.ils.slice(0, SECTION_CAP);
    const hiddenCount = feed.ils.length - rows.length;
    return (
      <section aria-label="IL moves">
        <h4 className="px-3 pb-1 pt-3 text-[0.62rem] font-bold tracking-widest text-ink-faint uppercase">
          Injured List
        </h4>
        {rows.map(event => (
          <EventRow
            key={event.id}
            kind="il"
            ownerChip={ownerChipFor(event.ownerId)}
            title={
              <>
                <OwnerLink owners={data!.owners} ownerId={event.ownerId} />{" "}
                {event.action === "placed" ? "placed" : "activated"} {playerLink(event.playerId, event.playerName)}{" "}
                {event.action === "placed" ? "on the IL" : "from the IL"}
              </>
            }
            meta={dateMeta(event.date, event.week)}
          />
        ))}
        {moreLine(hiddenCount)}
      </section>
    );
  };

  const renderMatchups = () => {
    if (feed === null || !enabled("matchup") || feed.matchups.length === 0) return null;
    const rows = feed.matchups.slice(0, SECTION_CAP);
    const hiddenCount = feed.matchups.length - rows.length;
    return (
      <section aria-label="Matchup results">
        <h4 className="px-3 pb-1 pt-3 text-[0.62rem] font-bold tracking-widest text-ink-faint uppercase">
          Matchup Results {effectiveScope === "matchup" ? `— Week ${data!.season.current_week}` : ""}
        </h4>
        {rows.map(event => (
          <EventRow
            key={event.id}
            kind="matchup"
            action="win"
            title={
              <>
                {event.winnerTeamId === null ? (
                  event.winnerName
                ) : (
                  <Link to={`/season/${event.year}/team/${event.winnerTeamId}`} className="hover:underline">
                    {event.winnerName}
                  </Link>
                )}{" "}
                defeated{" "}
                {event.loserTeamId === null ? (
                  event.loserName
                ) : (
                  <Link to={`/season/${event.year}/team/${event.loserTeamId}`} className="hover:underline">
                    {event.loserName}
                  </Link>
                )}
              </>
            }
            meta={
              <>
                Week {event.week} · {formatPoints(event.winnerScore)} – {formatPoints(event.loserScore)} ·{" "}
                <Link to={`/matchup/${event.year}/${event.matchupId}`} className="hover:underline">
                  box score
                </Link>
              </>
            }
          />
        ))}
        {moreLine(hiddenCount)}
      </section>
    );
  };

  // When the trophy section is active it always has content — real rows or,
  // while none can be named yet, the placeholder row.
  const anySection =
    trophySectionActive ||
    (feed !== null &&
      ((enabled("achievement") && feed.achievements.length > 0) ||
        (enabled("trade") && feed.trades.length > 0) ||
        (enabled("fa") && feed.fas.length > 0) ||
        (enabled("il") && feed.ils.length > 0) ||
        (enabled("matchup") && feed.matchups.length > 0) ||
        (enabled("record") && feed.records.length > 0)));

  return (
    <div inert={!open}>
      <div
        className={`fixed inset-0 z-40 bg-ink/30 transition-opacity duration-200 dark:bg-black/45 ${open ? "opacity-100" : "opacity-0"}`}
        onClick={onClose}
      />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Activity"
        className={`activity-drawer fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-border shadow-xl transition-transform duration-200 md:w-[380px] ${
          open ? "translate-x-0" : "translate-x-full"
        }`}>
        <div className="flex items-center gap-2 border-b border-border px-3 pb-2 pt-3">
          <h3 className="flex-1 text-[0.95rem] font-bold">Activity</h3>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close activity log"
            className="flex h-7 w-7 items-center justify-center rounded text-ink-faint hover:bg-surface-2 hover:text-ink">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
              className="h-4 w-4">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {!scopeLocked ? (
          <div className="border-b border-border px-3 py-2">
            <SegmentedToggle
              ariaLabel="Activity scope"
              value={scope}
              onChange={changeScope}
              options={[
                { key: "matchup", label: "Matchup" },
                { key: "season", label: "Season" },
              ]}
            />
          </div>
        ) : null}

        <div className="flex flex-wrap gap-x-3 gap-y-1 border-b border-border px-3 py-2">
          {ALL_EVENT_KINDS.map(kind => (
            <label key={kind} className="flex cursor-pointer items-center gap-1.5 text-xs text-ink-dim select-none">
              <input
                type="checkbox"
                checked={enabled(kind)}
                onChange={() => toggleFilter(kind)}
                className="h-3.5 w-3.5 accent-accent"
              />
              <span>{KIND_LABELS[kind]}</span>
            </label>
          ))}
        </div>

        {ownerOptions.length > 0 ? (
          <div className="border-b border-border px-3 py-2">
            <select
              value={effectiveOwner ?? ""}
              onChange={event => changeOwnerFilter(event.target.value === "" ? null : event.target.value)}
              aria-label="Filter activity by owner"
              className="w-full rounded-full border border-border bg-surface-2 px-2.5 py-1 text-xs font-semibold text-ink">
              <option value="">All owners</option>
              {ownerOptions.map(owner => (
                <option key={owner.owner_id} value={owner.owner_id}>
                  {owner.canonical_name}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div className="scrollbar-accent flex-1 overflow-y-auto pb-4">
          {loading ? <p className="px-3 py-6 text-center text-sm text-ink-faint">Loading activity…</p> : null}
          {loadError ? (
            <div className="px-3 py-6 text-center">
              <p className="text-sm text-ink-dim">Couldn't load activity.</p>
              <button
                type="button"
                onClick={() => void loadData()}
                className="mt-2 rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-ink">
                Try again
              </button>
            </div>
          ) : null}
          {data !== null && !loading && !loadError && !anySection ? (
            <p className="px-3 py-6 text-center text-sm text-ink-faint">No activity in this window.</p>
          ) : null}
          {renderAchievements()}
          {renderRecords()}
          {renderTrophies()}
          {renderTrades()}
          {renderFas()}
          {renderIls()}
          {renderMatchups()}
        </div>
      </aside>
    </div>
  );
}
