"""ESPN MLB statId -> box-score stat-line field mapping.

Covers exactly the union of statIds that appear in any season's scoring settings
(data/raw/{year}/mSettings.json -> settings.scoringSettings.scoringItems,
2009-2025) -- 31 ids, 16 batting + 15 pitching. Because the mapped set is the
scored union and ESPN scoring is linear per id, a stat line recomputes its
fantasy points exactly: sum(stat_value * that_season's_points_per_unit) ==
appliedTotal. validate.py's stat-line reconciliation check depends on this.

Verification methodology (Phase 4, PR 1 -- run against data/raw/, 2026-07-17):
- Linearity: appliedStats[id] == stats[id] * scoringItem.points held for all
  30,535 sampled (id, block) pairs across 2018/2019/2021/2024/2025 day blocks
  (statSourceId 0, statSplitTypeId 5), with appliedTotal == sum(appliedStats)
  in every block. Every mapped id's raw value is a whole number everywhere.
- Batting ids pinned by exact arithmetic identities over 2,272 day blocks
  (0 failures): H(1) = 1B(7)+2B(3)+3B(4)+HR(5); XBH(6) = 2B+3B+HR;
  TB(8) = 1B+2*2B+3*3B+4*HR; PA(16) = AB(0)+BB(10)+HBP(12)+SF(13)+SH(14).
- Pitching ids pinned by cross-stat identities over every 2018/2019/2021/2024
  day block: ERA(47) == 9*ER(45)/(OUTS(34)/3) (10,102/0) and R(44) >= ER(45)
  (16,526/0); K/9(49) and OBA(38) consistent with K(48), BF(35), H(37).
- Rare ids pinned by event fingerprints plus real-world corroboration:
  SHO(64) -> CG with 0 runs (shortened-game CGs included); NH(65) -> the ten
  flagged pitcher-days are exactly the real no-hitters in those seasons
  (Verlander/Fiers 2019, Musgrove/Rodon/Means/Miley/Kluber 2021, Cease 2024);
  CYC(30) -> 1B/2B/3B/HR all >= 1 in every flagged day, and 2009's season
  values flag exactly 2009's real cycle hitters; GSHR(31) -> HR >= 1 and
  RBI >= 4 in all 340 flagged days; E(72) season totals match famous error
  counts (Castro 27 in 2010, Desmond's MLB-leading 34); HD(60) season leaders
  are setup men (Hughes 18 in 2009), not closers.
- PG(66) never occurs in this league's rostered-player data (checked all of
  2023 for German's perfect game -- unrostered), so its name is inferred from
  the scoring ladder (SHO +4 < NH +7 < PG +9 since 2013; +6/+10/+15 before)
  and ESPN convention. It never contributes to reconciliation.

Field-name notes: singles/doubles/triples avoid digit-leading keys ("1b");
pitching wins/losses are spelled out because a field named `l` trips E741.
Batting and pitching H/R/BB/K share names but live in separate objects.
"""

# Batting: statId -> BattingLine field (scripts/lib/schema.py).
BATTING_STAT_IDS: dict[int, str] = {
    0: "ab",
    3: "doubles",
    4: "triples",
    5: "hr",
    7: "singles",
    10: "bb",
    12: "hbp",
    20: "r",
    21: "rbi",
    23: "sb",
    24: "cs",
    26: "gidp",
    27: "k",
    30: "cyc",  # hit for the cycle
    31: "gshr",  # grand slam home runs (subset of hr)
    72: "e",  # fielding errors (scored 2010-2011 only, kept for completeness)
}

# Pitching: statId -> PitchingLine field (scripts/lib/schema.py).
PITCHING_STAT_IDS: dict[int, str] = {
    34: "outs",  # outs recorded; IP display = outs/3 (app-side derivation)
    37: "h",
    39: "bb",
    42: "hb",
    44: "r",
    45: "er",
    48: "k",
    53: "wins",
    54: "losses",
    57: "sv",
    58: "bs",
    60: "hd",  # holds (scored 2009-2010 only, kept for completeness)
    64: "sho",  # shutouts (ESPN also awards shortened-game CG shutouts)
    65: "nh",  # no-hitters
    66: "pg",  # perfect games (inferred; see module docstring)
}
