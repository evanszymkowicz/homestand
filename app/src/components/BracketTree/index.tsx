import type { BracketRound } from "../../lib/schedule";
import type { MatchupTurningPoint } from "../../lib/matchupTurningPoints";
import type { Team } from "../../types";
import { MatchupCard, type ChampionTierBadge } from "../MatchupCard";

interface BracketTreeProps {
  rounds: BracketRound[];
  teams: Team[];
  champion?: ChampionTierBadge;
  /** Turning points by matchup id, so playoff cards get the same upset /
   * comeback markers the regular-season scoreboard shows. */
  turningPointByMatchup?: Map<number, MatchupTurningPoint>;
}

const ROUND_LABELS = ["First Round", "Semifinals", "Finals", "Round 4", "Round 5"];

// Must cover the tallest card the bracket can render: the gold champion banner
// adds a row to the final card (~84px vs ~59px), and the tree positions cards
// from this constant -- a shorter value lets champion cards crowd the matchup
// below them (the measured overlap was 6px, which is 84 - 78 slot spacing).
const CARD_HEIGHT = 84;
const CARD_GAP = 16;

function computePositions(rounds: BracketRound[]): Map<string, number> {
  const positions = new Map<string, number>();

  for (let m = 0; m < rounds[0].matchups.length; m++) {
    positions.set(`0-${m}`, m * (CARD_HEIGHT + CARD_GAP));
  }

  for (let r = 1; r < rounds.length; r++) {
    for (let m = 0; m < rounds[r].matchups.length; m++) {
      const key = `${r}-${m}`;
      const sourceKeys: number[] = [];

      for (let prev = 0; prev < rounds[r - 1].matchups.length; prev++) {
        const prevMatchup = rounds[r - 1].matchups[prev];
        const teamA = prevMatchup.home.espn_team_id;
        const teamB = prevMatchup.away?.espn_team_id;
        const current = rounds[r].matchups[m];

        if (
          current.home.espn_team_id === teamA ||
          current.home.espn_team_id === teamB ||
          current.away?.espn_team_id === teamA ||
          current.away?.espn_team_id === teamB
        ) {
          sourceKeys.push(prev);
        }
      }

      if (sourceKeys.length >= 2) {
        const posA = positions.get(`${r - 1}-${sourceKeys[0]}`) ?? 0;
        const posB = positions.get(`${r - 1}-${sourceKeys[1]}`) ?? 0;
        positions.set(key, (posA + posB) / 2);
      } else if (sourceKeys.length === 1) {
        positions.set(key, positions.get(`${r - 1}-${sourceKeys[0]}`) ?? 0);
      } else {
        positions.set(key, m * (CARD_HEIGHT + CARD_GAP));
      }
    }
  }

  const spacing = CARD_HEIGHT + CARD_GAP;
  for (let r = 0; r < rounds.length; r++) {
    const byPos = new Map<number, string[]>();
    for (let m = 0; m < rounds[r].matchups.length; m++) {
      const key = `${r}-${m}`;
      const pos = positions.get(key) ?? 0;
      const group = byPos.get(pos);
      if (group) group.push(key);
      else byPos.set(pos, [key]);
    }
    for (const keys of byPos.values()) {
      if (keys.length <= 1) continue;
      const center = positions.get(keys[0]) ?? 0;
      const offset = (-(keys.length - 1) * spacing) / 2;
      keys.forEach((k, i) => positions.set(k, center + offset + i * spacing));
    }
  }

  return positions;
}

export function BracketTree({ rounds, teams, champion, turningPointByMatchup }: BracketTreeProps) {
  if (rounds.length === 0) return null;

  const positions = computePositions(rounds);
  const maxPos = Math.max(...Array.from(positions.values()));
  const containerHeight = maxPos + CARD_HEIGHT + 16;

  return (
    <div>
      <div className="relative" style={{ height: containerHeight }}>
        {rounds.map((round, roundIdx) => (
          <div key={round.week} className="absolute" style={{ left: roundIdx * 200 }}>
            <div
              className="text-center text-[0.66rem] font-semibold tracking-wide text-ink-faint uppercase"
              style={{ height: 32 }}>
              {ROUND_LABELS[roundIdx] ?? `Round ${roundIdx + 1}`}
            </div>
            {round.matchups.map((matchup, matchupIdx) => {
              const top = positions.get(`${roundIdx}-${matchupIdx}`) ?? 0;
              // The "Champion" footer marks the card that crowned this tier's
              // winner -- the final round's match won by the champion team.
              // Passing `champion` to every card would crown every one of that
              // team's earlier wins too.
              const isFinal = roundIdx === rounds.length - 1;
              const winnerId =
                matchup.winner === "HOME"
                  ? matchup.home.espn_team_id
                  : matchup.winner === "AWAY"
                    ? matchup.away?.espn_team_id
                    : null;
              const showChampion = isFinal && champion != null && winnerId === champion.teamId;

              return (
                <div key={matchup.matchup_id} className="absolute" style={{ top: top + 32 }}>
                  <MatchupCard
                    matchup={matchup}
                    teams={teams}
                    variant="bracket"
                    champion={showChampion ? champion : undefined}
                    turningPoint={turningPointByMatchup?.get(matchup.matchup_id)}
                  />
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
