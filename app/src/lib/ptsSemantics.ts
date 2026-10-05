export const PTS_SEMANTICS_TOOLTIP_SEASON_SHORT = [
  "Points the player scored while on a fantasy roster during matchup periods: started slots and bench/IL days alike.",
  "",
  "Rostered production — everything the player scored while on a fantasy roster during matchup periods (bench/IL days included). ESPN's player card counts all real-world production and can run higher: it adds free-agent days outside the matchup calendar and two-way pitching that never occupied a roster slot.",
].join("\n");

/** All production in the week WHILE ROSTERED: started slots and bench/IL days
 * alike. This is `total_points` verbatim -- verified against the archive to
 * equal the sum of every slot's points, so no separate counted/bench
 * subtraction is needed. NOT ESPN's season card total, which also counts
 * free-agent days outside the matchup calendar (see
 * PTS_SEMANTICS_TOOLTIP_SEASON_SHORT above); a mid-season acquisition's first
 * week legitimately reads low for that reason. */
export const PTS_SEMANTICS_TOOLTIP_ALL_WEEK = [
  "What the points column measures",
  "",
  "All of the player's production that week while on a roster, including bench and IL days, not just points that counted toward a team score.",
].join("\n");

export const PTS_SEMANTICS_TOOLTIP_COUNTED = [
  "What the points column measures",
  "",
  "Scored for fantasy teams; bench/IL production is excluded. ESPN's player card counts all real-world production and can run higher.",
].join("\n");
