/** MLB Team primary color, keyed by MlbTeam.abbrev -- only used for the
 * Keepers-by-franchise card grid's left-border rail (the abbreviation itself
 * is never displayed, per the Phase 5 spec). Carried over from
 * context/research/design-inspiration/keepers-by-franchise.html, where these
 * values were already picked and validated against the real card grid; no
 * `FA` entry -- the free-agent card gets a neutral/dashed rail instead of a
 * team color, handled by the caller. */
export const MLB_TEAM_COLORS: Record<string, string> = {
  ARI: "#A71930",
  ATL: "#CE1141",
  BAL: "#DF4601",
  BOS: "#BD3039",
  CHC: "#0E3386",
  CWS: "#27251F",
  CIN: "#C6011F",
  CLE: "#00385D",
  COL: "#333366",
  DET: "#0C2C56",
  HOU: "#EB6E1F",
  KC: "#004687",
  LAA: "#BA0021",
  LAD: "#005A9C",
  MIA: "#00A3E0",
  MIL: "#0A2351",
  MIN: "#002B5C",
  NYM: "#002D72",
  NYY: "#0C2340",
  OAK: "#003831",
  PHI: "#E81828",
  PIT: "#FDB827",
  SD: "#5B4A3F",
  SEA: "#0C2C56",
  SF: "#FD5A1E",
  STL: "#C41E3A",
  TB: "#092C5C",
  TEX: "#003278",
  TOR: "#134A8E",
  WSH: "#AB0003",
};
