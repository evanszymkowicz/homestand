export interface BoxScoreSlot {
  scoring_period: number;
  lineup_slot_id: number;
  points: number;
  // Internal live-patch bookkeeping (scripts/lib/box_score_lines.py's
  // accumulate()) -- not meant for display; absent on older slots.
  raw_stats?: Record<string, number>;
}

// Raw batting/pitching counts for a matchup, named in scripts/lib/stat_ids.py.
// Only populated where day-level raw stats exist (coverage.stat_lines != "missing").
export interface BattingLine {
  ab: number;
  r: number;
  singles: number;
  doubles: number;
  triples: number;
  hr: number;
  rbi: number;
  bb: number;
  hbp: number;
  k: number;
  sb: number;
  cs: number;
  gidp: number;
  cyc: number;
  gshr: number;
  e: number;
}

// IP is derived in the app as outs / 3.
export interface PitchingLine {
  outs: number;
  h: number;
  r: number;
  er: number;
  bb: number;
  hb: number;
  k: number;
  wins: number;
  losses: number;
  sv: number;
  bs: number;
  hd: number;
  sho: number;
  nh: number;
  pg: number;
}

export interface BoxScoreEntry {
  year: number;
  week: number;
  matchup_id: number;
  owner_id: string;
  espn_team_id: number;
  player_id: number;
  player_name: string;
  total_points: number;
  batting: BattingLine | null;
  pitching: PitchingLine | null;
  slots: BoxScoreSlot[];
}
