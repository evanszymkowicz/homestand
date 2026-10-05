"""ESPN's MLB pro-team ID reference (`player.proTeamId` in raw payloads).

Not documented anywhere in the raw archive itself (no `proTeamSchedules`-style view was
captured), so this table was built and verified empirically against real, unambiguous
players in data/raw/*/kona_player_info.json — e.g. Miguel Cabrera (Tigers his whole career)
= 6 in 2012; Albert Pujols shows 24 (STL) 2009-2011, then 3 (LAA) for all nine seasons
2012-2020 (not just his first Angels year), not found in 2021 (released by the Angels
mid-season, too low-owned that year to make kona_player_info's ~500-player cap), then 24
(STL) again in 2022, his final season. ESPN hasn't renumbered these across 2009-2025 (no
franchise relocations in this window either).

0 is not a real team -- see scripts/normalize.py's load_pro_team_lookup() docstring for
what it means.
"""

PRO_TEAM_ID_UNKNOWN = 0

MLB_TEAMS: dict[int, dict[str, str]] = {
    0: {"abbrev": "FA", "name": "Free Agent/No Team On File"},
    1: {"abbrev": "BAL", "name": "Baltimore Orioles"},
    2: {"abbrev": "BOS", "name": "Boston Red Sox"},
    3: {"abbrev": "LAA", "name": "Los Angeles Angels"},
    4: {"abbrev": "CWS", "name": "Chicago White Sox"},
    5: {"abbrev": "CLE", "name": "Cleveland Guardians"},
    6: {"abbrev": "DET", "name": "Detroit Tigers"},
    7: {"abbrev": "KC", "name": "Kansas City Royals"},
    8: {"abbrev": "MIL", "name": "Milwaukee Brewers"},
    9: {"abbrev": "MIN", "name": "Minnesota Twins"},
    10: {"abbrev": "NYY", "name": "New York Yankees"},
    11: {"abbrev": "OAK", "name": "Athletics"},
    12: {"abbrev": "SEA", "name": "Seattle Mariners"},
    13: {"abbrev": "TEX", "name": "Texas Rangers"},
    14: {"abbrev": "TOR", "name": "Toronto Blue Jays"},
    15: {"abbrev": "ATL", "name": "Atlanta Braves"},
    16: {"abbrev": "CHC", "name": "Chicago Cubs"},
    17: {"abbrev": "CIN", "name": "Cincinnati Reds"},
    18: {"abbrev": "HOU", "name": "Houston Astros"},
    19: {"abbrev": "LAD", "name": "Los Angeles Dodgers"},
    20: {"abbrev": "WSH", "name": "Washington Nationals"},
    21: {"abbrev": "NYM", "name": "New York Mets"},
    22: {"abbrev": "PHI", "name": "Philadelphia Phillies"},
    23: {"abbrev": "PIT", "name": "Pittsburgh Pirates"},
    24: {"abbrev": "STL", "name": "St. Louis Cardinals"},
    25: {"abbrev": "SD", "name": "San Diego Padres"},
    26: {"abbrev": "SF", "name": "San Francisco Giants"},
    27: {"abbrev": "COL", "name": "Colorado Rockies"},
    28: {"abbrev": "MIA", "name": "Miami Marlins"},
    29: {"abbrev": "ARI", "name": "Arizona Diamondbacks"},
    30: {"abbrev": "TB", "name": "Tampa Bay Rays"},
}
