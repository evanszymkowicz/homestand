import { useEffect, useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import { CoverageBadge } from "../../components/CoverageBadge";
import { useAsync } from "../../hooks/useAsync";
import { Board, TEN_ROWS } from "../../components/Board";
import { aggregateSeasonRoster, formatWeekRuns, getSeasonTeamEntries, getTeamSeasonILWeeks } from "../../lib/boxScore";
import { loadBoxScores, loadTransactions } from "../../lib/data";
import { getSeasonRosterMarkers } from "../../lib/transactions";
import type { BoxScoreEntry, Keeper, Season, Team, Transaction } from "../../types";
import { SeasonRosterTables } from "./SeasonRosterTables";

interface TeamSeasonRosterModalProps {
  team: Team;
  keepers: Keeper[];
  seasons: Season[];
  onClose: () => void;
}

/** Centered overlay for one team-season's full roster: keepers plus every
 * player who had a box-score entry that year, not just who's left at
 * season's end -- a trade-away or waiver-drop still shows up. Box scores are
 * fetched on demand for just this one year, the same on-demand pattern
 * PlayerPage.tsx uses, rather than loading the whole combined archive. */
const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function TeamSeasonRosterModal({ team, keepers, seasons, onClose }: TeamSeasonRosterModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Moves focus into the dialog on open and restores it to whatever triggered
  // the modal on close, since a portal-less centered overlay otherwise leaves
  // focus sitting on the (now-hidden-behind-the-overlay) trigger element.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();
    return () => {
      previouslyFocused?.focus();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !dialogRef.current) return;
      const focusables = dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const season = seasons.find(s => s.year === team.year);
  const boxScoresCovered = season?.coverage.box_scores !== "missing";
  const transactionsCovered = season?.coverage.transactions !== "missing";
  // 2018's slots are a season-end snapshot, not day-accurate, so IL needs "full".
  const slotsAreDayAccurate = season?.coverage.stat_lines === "full";
  // loadTransactions() is cached module-wide by other routes, so this rarely adds a fetch.
  const state = useAsync(async (): Promise<{ boxScores: BoxScoreEntry[]; transactions: Transaction[] }> => {
    const [boxScores, transactions] = await Promise.all([
      boxScoresCovered ? loadBoxScores(team.year) : Promise.resolve<BoxScoreEntry[]>([]),
      transactionsCovered ? loadTransactions() : Promise.resolve<Transaction[]>([]),
    ]);
    return { boxScores, transactions };
  }, [team.year, boxScoresCovered, transactionsCovered]);

  const teamKeepers = useMemo(
    () => keepers.filter(k => k.year === team.year && k.espn_team_id === team.espn_team_id),
    [keepers, team]
  );

  const teamEntries = useMemo(
    () => (state.status === "success" ? getSeasonTeamEntries(state.data.boxScores, team.espn_team_id) : []),
    [state, team.espn_team_id]
  );
  const roster = useMemo(() => aggregateSeasonRoster(teamEntries), [teamEntries]);

  // Undefined for uncovered years so no marker renders, rather than a false "nobody was dropped".
  const markers = useMemo(
    () =>
      state.status === "success" && transactionsCovered
        ? getSeasonRosterMarkers(state.data.transactions, team.year, team.espn_team_id)
        : undefined,
    [state, transactionsCovered, team.year, team.espn_team_id]
  );
  const ilRows = useMemo(
    () => (slotsAreDayAccurate ? getTeamSeasonILWeeks(teamEntries) : []),
    [slotsAreDayAccurate, teamEntries]
  );

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${team.year} roster for ${team.team_name}`}>
      <div
        className="scrollbar-accent max-h-[85vh] w-full max-w-4xl overflow-y-auto rounded-xl border border-border bg-surface shadow-lg"
        onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-surface px-4 py-3">
          <div>
            <div className="font-extrabold">
              {team.year} {team.team_name}
            </div>
            <div className="flex items-center gap-2 text-xs text-ink-faint">
              <span>Full-season roster</span>
              <CoverageBadge seasons={seasons} domain="box_scores" />
            </div>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 flex-none items-center justify-center rounded-full text-ink-faint hover:bg-surface-2 hover:text-ink">
            ✕
          </button>
        </div>

        <div className="space-y-6 p-4">
          {teamKeepers.length > 0 && (
            <div>
              <h4 className="mb-2 text-xs font-semibold tracking-wide text-ink-faint uppercase">Keepers</h4>
              <div className="flex flex-wrap gap-1.5">
                {teamKeepers.map(k => (
                  <Link
                    key={k.player_id}
                    to={`/player/${k.player_id}`}
                    onClick={onClose}
                    className="rounded-full bg-gold-soft px-2.5 py-1 text-xs font-bold text-gold hover:opacity-80">
                    {k.player_name}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {!boxScoresCovered && <p className="text-sm text-ink-dim">No box-score data on file for {team.year}.</p>}
          {boxScoresCovered && state.status === "loading" && <p className="text-ink-dim">Loading roster…</p>}
          {boxScoresCovered && state.status === "error" && (
            <p className="text-ink-dim">Couldn't load box scores. Try refreshing the page.</p>
          )}
          {boxScoresCovered && state.status === "success" && roster.length === 0 && (
            <p className="text-sm text-ink-dim">No box-score activity on record for this team-season.</p>
          )}
          {boxScoresCovered && state.status === "success" && roster.length > 0 && (
            <div className="space-y-4">
              <SeasonRosterTables roster={roster} markers={markers} slotsAreDayAccurate={slotsAreDayAccurate} />
              {ilRows.length > 0 && (
                <div>
                  <Board title="Injured List" maxHeight={TEN_ROWS}>
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr>
                          {["Player", "Weeks"].map(label => (
                            <th
                              key={label}
                              scope="col"
                              className="sticky top-0 z-10 bg-surface px-3 py-2 text-left text-[0.66rem] font-semibold tracking-wide text-ink-faint uppercase">
                              {label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {ilRows.map(row => (
                          <tr key={row.playerId} className="border-t border-border hover:bg-surface-2">
                            <td className="px-3 py-2 whitespace-nowrap">
                              <Link to={`/player/${row.playerId}`} onClick={onClose} className="hover:underline">
                                {row.playerName}
                              </Link>
                            </td>
                            <td className="px-3 py-2 text-ink-dim tabular-nums">{formatWeekRuns(row.weeks)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </Board>
                  <p className="mt-2 text-[0.66rem] text-ink-faint">
                    Players and their time on the injured list for the season.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
