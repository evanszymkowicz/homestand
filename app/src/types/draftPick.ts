export interface DraftPick {
  year: number;
  overall_pick_number: number;
  round_id: number;
  round_pick_number: number;
  espn_team_id: number;
  owner_id: string;
  player_id: number;
  player_name: string;
  keeper: boolean;
  traded_pick: boolean;
  traded_from_espn_team_id: number | null;
  pro_team_id: number | null;
}
