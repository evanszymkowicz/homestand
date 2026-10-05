export type MatchupWinner = "HOME" | "AWAY" | "TIE" | "UNDECIDED";

export interface MatchupSide {
  owner_id: string | null; // null on a bye
  espn_team_id: number | null;
  score: number;
}

export interface Matchup {
  year: number;
  week: number;
  matchup_id: number;
  playoff_tier: string | null;
  winner: MatchupWinner;
  home: MatchupSide;
  away: MatchupSide | null; // null on a bye week
}
