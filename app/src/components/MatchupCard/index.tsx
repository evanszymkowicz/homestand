import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { formatPoints } from "../../lib/format";
import type { MatchupTurningPoint } from "../../lib/matchupTurningPoints";
import { findTeam } from "../../lib/schedule";
import { teamOwnerNames } from "../../lib/stats";
import type { Matchup, MatchupSide, Owner, Team } from "../../types";

/** A bracket-tier winner badge (winners-bracket crown, losers-ladder clown) —
 *  generic over emoji so both tiers share one rendering path. Not to be
 *  confused with the shared `ChampionBadge` component (crown+gold treatment
 *  used outside brackets, e.g. Standings/SeasonHistory/OwnerDirectory). */
export interface ChampionTierBadge {
  teamId: number;
  emoji: string;
  label: string;
}

/** `bracket` cards are fixed-width and drop the owner line so every card in a
 *  column keeps the same height -- `BracketTree` positions cards absolutely
 *  from a constant, so a card that grew taller would overlap its neighbour.
 *  `fluid` cards are the week-scoreboard grid, which has room for owner names,
 *  a described turning-point footer, and an inline champion emoji. */
export type MatchupCardVariant = "fluid" | "bracket";

interface MatchupCardProps {
  matchup: Matchup;
  teams: Team[];
  /** Required for the owner line on `fluid` cards; bracket cards omit it. */
  owners?: Owner[];
  champion?: ChampionTierBadge;
  turningPoint?: MatchupTurningPoint | null;
  variant?: MatchupCardVariant;
}

const TURNING_POINT_META: Record<MatchupTurningPoint["type"], { emoji: string; label: string }> = {
  biggest_differential: { emoji: "💥", label: "Biggest blowout" },
  upset: { emoji: "⚡", label: "Upset" },
  comeback: { emoji: "🔄", label: "Comeback" },
};

/** The side that won, or null for an undecided or tied matchup. */
function winningTeamId(matchup: Matchup): number | null {
  if (matchup.winner === "HOME") return matchup.home.espn_team_id;
  if (matchup.winner === "AWAY") return matchup.away?.espn_team_id ?? null;
  return null;
}

/** `inline` hangs the marker off a bracket card's name row so tagging a matchup
 *  cannot change the card's height and break the tree's absolute layout; the
 *  fluid card gets a described footer instead. */
function TurningPointTag({ turningPoint, inline }: { turningPoint: MatchupTurningPoint; inline: boolean }) {
  const meta = TURNING_POINT_META[turningPoint.type];
  const emoji = (
    <span role="img" aria-label={inline ? `${meta.label}: ${turningPoint.description}` : meta.label}>
      {meta.emoji}
    </span>
  );
  return inline ? (
    <span className="flex-none text-xs" title={turningPoint.description}>
      {emoji}
    </span>
  ) : (
    <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-ink-dim">
      {emoji}
      <span>{turningPoint.description}</span>
    </div>
  );
}

/** One side of a matchup. `bracket` picks the compact treatment: seed as `N.`,
 * no owner line, smaller type, and the inline turning-point marker -- so tagging
 * a bracket matchup cannot change the card's height and break the tree's
 * layout. Fluid cards get the owner line and the described footer instead. */
function Side({
  side,
  year,
  teams,
  owners,
  isWinner,
  bracket,
  marker,
  champion,
}: {
  side: MatchupSide;
  year: number;
  teams: Team[];
  owners: Owner[];
  isWinner: boolean;
  bracket: boolean;
  marker?: ReactNode;
  champion?: ChampionTierBadge;
}) {
  const team = findTeam(teams, year, side.espn_team_id);
  const emphasis = isWinner ? "font-bold text-ink" : "text-ink-dim";
  const text = bracket ? "text-xs" : "text-sm";

  return (
    <div
      className={`flex items-center justify-between ${bracket ? "gap-1.5 px-2 py-1.5" : "gap-3 px-3 py-2"}`}>
      <div className={bracket ? "min-w-0 flex-1" : "min-w-0"}>
        <div className={`flex items-center gap-1.5 ${text} ${emphasis}`}>
          <span className="truncate">
            {bracket && team?.playoff_seed != null && (
              <span className="text-ink-faint">{team.playoff_seed}.</span>
            )}
            {team?.team_name ?? (bracket ? "TBD" : "Unknown team")}
          </span>
          {!bracket &&
            champion &&
            side.espn_team_id === champion.teamId && (
              <span className="flex-none" role="img" aria-label={champion.label} title={champion.label}>
                {champion.emoji}
              </span>
            )}
          {marker}
        </div>
        {!bracket && (
          <div className="truncate text-xs text-ink-faint">
            {team ? teamOwnerNames(team, owners) : "—"}
          </div>
        )}
      </div>
      <div className={`flex-none tabular-nums ${text} ${emphasis}`}>{formatPoints(side.score)}</div>
    </div>
  );
}



/** One matchup as a card, shared by the week scoreboard and the playoff
 *  brackets -- so a turning point or champion badge added here shows up in
 *  both places instead of only in one copy. Winner is emphasized by
 *  font-weight only (never color alone — same CVD rule the head-to-head grid
 *  follows). Byes render as a single side with a "Bye" line instead of a
 *  second row. */
export function MatchupCard({
  matchup,
  teams,
  owners,
  champion,
  turningPoint,
  variant = "fluid",
}: MatchupCardProps) {
  const isBracket = variant === "bracket";
  const hasAway = matchup.away != null;
  const shared = { year: matchup.year, teams, owners: owners ?? [], bracket: isBracket };
  const bye = isBracket ? "px-2 py-1.5 text-center" : "px-3 py-2";

  const body = (
    <>
      <Side
        {...shared}
        side={matchup.home}
        isWinner={matchup.winner === "HOME"}
        marker={
          isBracket && turningPoint ? <TurningPointTag turningPoint={turningPoint} inline /> : undefined
        }
        champion={isBracket ? undefined : champion}
      />
      {isBracket && <div className="border-t border-border" />}
      {hasAway ? (
        <Side
          {...shared}
          side={matchup.away!}
          isWinner={matchup.winner === "AWAY"}
          champion={isBracket ? undefined : champion}
        />
      ) : (
        <div className={`text-xs text-ink-faint italic ${bye}`}>Bye</div>
      )}
      {isBracket && champion && winningTeamId(matchup) === champion.teamId && (
        <div className="border-t border-border bg-gold-soft px-2 py-1 text-center text-xs font-bold text-gold">
          {champion.emoji} Champion
        </div>
      )}
      {!isBracket && turningPoint && <TurningPointTag turningPoint={turningPoint} inline={false} />}
    </>
  );

  return (
    <Link
      to={`/matchup/${matchup.year}/${matchup.matchup_id}`}
      className={
        isBracket
          ? "block w-44 rounded-lg border border-border bg-surface shadow-sm hover:bg-surface-2"
          : "block divide-y divide-border rounded-xl border border-border bg-surface shadow-sm hover:bg-surface-2"
      }>
      {body}
    </Link>
  );
}