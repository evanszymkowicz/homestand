import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { OwnerLink } from "../../components/OwnerLink";
import { SortHeader } from "../../components/SortHeader";
import { useSortableRows } from "../../hooks/useSortableRows";
import { formatPoints } from "../../lib/format";
import {
  getLiveDraftYears,
  getPlayerDraftHistory,
  redraftMarker,
  redraftMarkerClass,
  searchPlayers,
} from "../../lib/draft";
import type { DraftStealEntry, MrIrrelevantEntry, PlayerDraftHistoryEntry } from "../../lib/draft";
import { ownerRef } from "../../lib/stats";
import type { DraftPick, Owner, Player, PlayerSeasonPoints } from "../../types";

type HistorySortKey = "year" | "owner" | "status" | "points";

interface DraftPlayerSearchProps {
  players: Player[];
  draftPicks: DraftPick[];
  seasonPoints: PlayerSeasonPoints[];
  owners: Owner[];
  mrIrrelevantEntries: MrIrrelevantEntry[];
  draftSteals: DraftStealEntry[];
  /** Called when a search result is selected, so the parent (which owns the
   * currently-viewed year) can navigate to a year this player has a live
   * pick in. An empty liveDraftYears means no navigation happens. */
  onLocate: (playerId: number, liveDraftYears: number[]) => void;
}

export function DraftPlayerSearch({
  players,
  draftPicks,
  seasonPoints,
  owners,
  mrIrrelevantEntries,
  draftSteals,
  onLocate,
}: DraftPlayerSearchProps) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  const results = useMemo(() => searchPlayers(players, query), [players, query]);
  const draftedIds = useMemo(() => new Set(draftPicks.map(p => p.player_id)), [draftPicks]);

  const selectedName = selectedId !== null ? players.find(p => p.player_id === selectedId)?.full_name : undefined;
  const history = useMemo(
    () =>
      selectedId !== null
        ? getPlayerDraftHistory(selectedId, draftPicks, seasonPoints, mrIrrelevantEntries, draftSteals)
        : [],
    [selectedId, draftPicks, seasonPoints, mrIrrelevantEntries, draftSteals]
  );
  function getHistoryValue(h: PlayerDraftHistoryEntry, key: HistorySortKey): number | string {
    switch (key) {
      case "year":
        return h.year;
      case "owner":
        return ownerRef(owners, h.ownerId).name;
      case "status":
        return h.isKeeper ? "Kept" : "Draft pick";
      case "points":
        return h.points ?? -Infinity;
    }
  }

  const {
    sorted: sortedHistory,
    sortKey: historySortKey,
    direction: historyDirection,
    toggleSort: toggleHistorySort,
  } = useSortableRows<PlayerDraftHistoryEntry, HistorySortKey>(history, getHistoryValue, "year", "desc");

  const close = () => setSelectedId(null);

  const showDropdown = query.trim() !== "" && selectedId === null;
  const showPopup = selectedId !== null;
  const isOpen = showDropdown || showPopup;

  useEffect(() => {
    if (selectedId === null) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedId]);

  // The search bar lives inside a horizontally-scrolling tab nav (mobile fix
  // for the year selector/tabs). A dropdown/popup positioned `absolute`
  // relative to that nav gets clipped: setting only `overflow-x-auto` forces
  // the browser to compute `overflow-y: auto` too (CSS overflow spec), which
  // makes the nav a clipping box for anything that pops out below it. Portal
  // the dropdown/popup to <body> and position it with `fixed` coordinates
  // computed from the anchor's own bounding rect instead, so no ancestor's
  // overflow/scroll state can clip or hide it.
  useEffect(() => {
    if (!isOpen) return;
    const update = () => {
      if (anchorRef.current) setAnchorRect(anchorRef.current.getBoundingClientRect());
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [isOpen, query, selectedId]);

  return (
    <div ref={anchorRef} className="relative min-w-0 flex-1 sm:flex-none">
      <div className="flex items-center gap-1">
        <input
          type="search"
          value={query}
          onChange={e => {
            setQuery(e.target.value);
            setSelectedId(null);
          }}
          placeholder="Search any player…"
          aria-label="Search players"
          className="w-full min-w-0 rounded-full border border-border bg-surface px-3 py-1 text-sm sm:w-56"
        />
      </div>

      {showDropdown &&
        anchorRect &&
        createPortal(
          <div
            style={{ position: "fixed", top: anchorRect.bottom + 4, right: window.innerWidth - anchorRect.right }}
            className="z-30 w-64 overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
            {results.length === 0 ? (
              <p className="px-3 py-2 text-sm text-ink-dim">No players match "{query}".</p>
            ) : (
              <ul>
                {results.map(r => (
                  <li key={r.playerId}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedId(r.playerId);
                        setQuery(r.playerName);
                        onLocate(r.playerId, getLiveDraftYears(r.playerId, draftPicks));
                      }}
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2">
                      <span>{r.playerName}</span>
                      <span
                        className={`flex-none rounded-full px-2 py-0.5 text-[0.62rem] font-bold ${
                          draftedIds.has(r.playerId) ? "bg-gold-soft text-gold" : "text-ink-faint"
                        }`}>
                        {draftedIds.has(r.playerId) ? "Drafted" : "Waivers"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>,
          document.body
        )}

      {showPopup &&
        anchorRect &&
        createPortal(
          <>
            <button
              type="button"
              aria-label="Close player draft history"
              onClick={close}
              className="fixed inset-0 z-20 cursor-default bg-ink/10 backdrop-blur-[1px]"
            />
            <div
              style={{ position: "fixed", top: anchorRect.bottom + 4, right: window.innerWidth - anchorRect.right }}
              className="z-30 max-h-[70vh] w-[min(90vw,640px)] overflow-auto rounded-xl border border-border bg-surface shadow-xl">
              <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-3">
                <div>
                  <h3 className="text-sm font-bold">{selectedName} Draft History</h3>
                  <Link to={`/player/${selectedId}`} onClick={close} className="text-xs text-accent hover:underline">
                    View full player history →
                  </Link>
                </div>
                <button
                  type="button"
                  onClick={close}
                  aria-label="Close"
                  className="flex h-6 w-6 flex-none items-center justify-center rounded-full text-ink-faint hover:bg-surface-2 hover:text-ink">
                  ✕
                </button>
              </div>
              {history.length === 0 ? (
                <p className="px-3 py-3 text-sm text-ink-dim">
                  No draft or keeper record on file — added via waiver or trade.
                </p>
              ) : (
                <>
                  <div className="scrollbar-accent overflow-x-auto">
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr>
                          <SortHeader
                            label="Year"
                            sortKey="year"
                            activeKey={historySortKey}
                            direction={historyDirection}
                            onSort={toggleHistorySort}
                            align="center"
                          />
                          <SortHeader
                            label="Owner"
                            sortKey="owner"
                            activeKey={historySortKey}
                            direction={historyDirection}
                            onSort={toggleHistorySort}
                            align="left"
                          />
                          <SortHeader
                            label="Status"
                            sortKey="status"
                            activeKey={historySortKey}
                            direction={historyDirection}
                            onSort={toggleHistorySort}
                            align="left"
                          />
                          <SortHeader
                            label="Points"
                            sortKey="points"
                            activeKey={historySortKey}
                            direction={historyDirection}
                            onSort={toggleHistorySort}
                            align="center"
                          />
                        </tr>
                      </thead>
                      <tbody>
                        {sortedHistory.map(h => (
                          <tr key={h.year} className="border-t border-border hover:bg-surface-2">
                            <td className="px-3 py-2 text-center">
                              <Link to={`/players/${h.year}`} onClick={close} className="hover:underline">
                                {h.year}
                              </Link>
                            </td>
                            <td className="px-3 py-2">
                              <OwnerLink owners={owners} ownerId={h.ownerId} />
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex flex-wrap items-center gap-1">
                                {h.isKeeper ? (
                                  <span className="rounded-full bg-gold-soft px-2 py-0.5 text-[0.64rem] font-bold text-gold">
                                    Kept
                                  </span>
                                ) : (
                                  <span className="text-ink-faint">Draft pick</span>
                                )}
                                {h.isMrIrrelevant && (
                                  <span className="rounded-full bg-gold-soft px-2 py-0.5 text-[0.64rem] font-bold text-gold">
                                    Mr. Irrelevant
                                  </span>
                                )}
                                {h.valueLabel === "steal" && (
                                  <span className="rounded-full bg-diverge-pos-soft px-2 py-0.5 text-[0.64rem] font-bold text-diverge-pos">
                                    Steal
                                  </span>
                                )}
                                {h.valueLabel === "bust" && (
                                  <span className="rounded-full bg-diverge-neg-soft px-2 py-0.5 text-[0.64rem] font-bold text-diverge-neg">
                                    Bust
                                  </span>
                                )}
                                {h.redraftStatus && h.redraftStatus !== "gone" && (
                                  <span
                                    className={`text-sm font-bold ${redraftMarkerClass(h.redraftStatus)}`}
                                    title={
                                      h.redraftStatus === "kept"
                                        ? "Kept the following season"
                                        : h.redraftStatus === "improved"
                                          ? "Redrafted into an earlier round"
                                          : "Redrafted into the same or a later round"
                                    }>
                                    {redraftMarker(h.redraftStatus)}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2 text-center tabular-nums">
                              {h.points === null ? (
                                <span className="text-ink-faint">no data</span>
                              ) : (
                                formatPoints(h.points)
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="border-t border-border px-3 py-2 text-xs text-ink-faint">
                    {history.length} draft{history.length === 1 ? "" : "s"} on record
                  </p>
                </>
              )}
            </div>
          </>,
          document.body
        )}
    </div>
  );
}
