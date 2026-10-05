"""Processed-data shapes for data/processed/ — the single source of truth normalize.py
writes to and validate.py checks against. Not used for raw ESPN responses, which stay
untrusted dicts (see espn_client.py) and are validated only for the fields extracted.
"""

from dataclasses import dataclass, field
from typing import Any


@dataclass
class Owner:
    owner_id: str
    canonical_name: str
    team_names_by_year: dict[str, list[str]]


@dataclass
class EspnMemberKey:
    """One ESPN member identity belonging to an owner, as a salted hash.

    ESPN's raw member id IS the SWID -- byte-identical to the session cookie in
    config.json -- so it is treated as credential-like and never written to
    data/processed/ (data/README.md, context/ai-interaction.md, and
    owner-map.json's _readme all say so). Storing the hash instead keeps the
    thing that made ESPN's ids worth having (a stable cross-season identity that
    survives a display-name change) without putting a real person's session GUID
    into a committed file.
    """

    member_key: str  # see mapping.espn_member_key
    years: list[int]  # seasons this ESPN member identity appears in


@dataclass
class LeagueOwner:
    """ESPN-derived canonical owner -- the shape written to owners.json since
    the Phase 9.3b cutover, and a superset of the owner-map-derived Owner above
    (proven identical on every team-season 2009-2025 before the switch). Owner
    survives only as validate.derive_owners_from_owner_map's re-derivation
    target, which is how drift gets caught now that owner-map.json is no longer
    authoritative."""

    owner_id: str
    canonical_name: str
    espn_member_keys: list[EspnMemberKey]
    team_names_by_year: dict[str, list[str]]
    co_owners: list[str]
    last_active_year: int
    absent_from_latest_season: bool
    is_commissioner: bool = False


@dataclass
class TrophySlot:
    """One positional slot in ESPN's per-member achievements template.

    ESPN's achievements sub-path returns a fixed 20-slot array per member; an
    unearned slot is an empty object. The array carries no trophy id or name,
    so a slot is recorded only as its index + earned flag until a filled slot
    reveals identifying fields (espn-trophies-activity-tray-spec.md's open
    items)."""

    slot: int  # 0-based position in ESPN's template
    earned: bool


@dataclass
class LeagueAchievement:
    """One member's trophy state for one season. 2026+ only -- the feature
    launched 2026-02-04 and ESPN serves no earlier seasons (seasonId for any
    prior year returns empty slots; leagueHistory 404s the sub-path).

    member_key is the salted hash of the member's SWID (see EspnMemberKey);
    the SWID itself rides only in the request URL and the raw archive.
    owner_id/espn_team_id are None when the member or their team can't be
    resolved -- validate.py's achievements_owner_linkage check fails loudly
    on that rather than letting an unattributed trophy ship."""

    year: int
    member_key: str
    owner_id: str | None
    espn_team_id: int | None
    trophies: list[TrophySlot]


@dataclass
class Division:
    division_id: int
    name: str


@dataclass
class ScoringItem:
    stat_id: int  # ESPN MLB statId -- named in scripts/lib/stat_ids.py
    points: float  # fantasy points per unit, that season


@dataclass
class LeagueSettings:
    league_id: int
    league_name: str
    league_size: int
    is_public: bool


@dataclass
class RosterRules:
    """mSettings.rosterSettings. Verified 2009-2025: lineup_slot_counts is
    byte-identical every season (this league has never changed its roster
    construction), while position_limits genuinely changed twice, in 2010 and
    2011 -- which is the reason to store these per season rather than once."""

    lineup_slot_counts: dict[str, int]  # slot-id-as-string -> count; zeros dropped
    position_limits: dict[str, int]  # position-id-as-string -> max; ESPN's -1 dropped
    bench_unlimited: bool
    move_limit: int | None  # ESPN's -1 ("unlimited") -> None
    lineup_lock_time: str  # observed: "INDIVIDUAL_GAME" (not the spec's GAME_TIME)
    roster_lock_time: str  # observed: "FIRSTGAME_SCORINGPERIOD"
    using_undroppable_list: bool


@dataclass
class AcquisitionRules:
    """mSettings.acquisitionSettings. Two spec field types were wrong about
    ESPN: waiver_order_reset is a bool (not a strategy string) and
    waiver_process_days is a list (not a day count)."""

    acquisition_type: str  # observed: "FREEAGENCY" (not the spec's WAIVER/FREE_AGENT)
    waiver_hours: int
    waiver_order_reset: bool
    waiver_process_days: list[str]
    waiver_process_hour: int
    minimum_bid: float
    using_acquisition_budget: bool
    acquisition_budget: float | None  # None unless using_acquisition_budget
    acquisition_limit: int | None  # ESPN's -1 ("unlimited") -> None
    matchup_acquisition_limit: float | None  # per-week cap; fractional in ESPN's data
    transaction_locking_enabled: bool


@dataclass
class DraftSettings:
    """mSettings.draftSettings. keeper_order_type changing TRADITIONAL ->
    MANUAL in 2025 and keeper_count being 0 in 2009 (the league's first draft,
    before keepers existed) are the only real rule changes here."""

    draft_type: str  # observed: "SNAKE" (not the spec's STANDARD/AUCTION)
    # How the draft ORDER was set, distinct from draft_type's format. The spec's
    # single snake_order bool conflated the two.
    order_type: str  # observed: "MANUAL"
    keeper_count: int
    keeper_order_type: str
    keeper_deadline_date: int | None  # epoch ms; absent for 2009
    auction_budget: float | None  # None unless this is an auction draft
    time_per_pick: int  # seconds


@dataclass
class TradeRules:
    """mSettings.tradeSettings. ESPN omits deadline_date entirely in several
    seasons, so it is genuinely optional rather than defaulted."""

    deadline_date: int | None  # epoch ms; absent in several seasons
    max_trades: int | None  # ESPN's -1 ("unlimited") -> None
    revision_hours: int
    veto_votes_required: int


@dataclass
class Season:
    year: int
    regular_season_weeks: int
    playoff_weeks: int
    playoff_team_count: int
    playoff_brackets: list[str]
    divisions: list[Division]
    scoring: list[ScoringItem]  # per-season scoringItems; values change by year
    coverage: dict[str, str]  # data family -> "full" | "partial" | "missing"
    status: str  # "in_progress" | "final" — Phase 8, whether the season has ended
    current_week: int  # currentMatchupPeriod -- week a scoreboard should default to
    notes: list[str]  # from data/manual/season-notes.json, if any

    # --- Phase 9.3a: programmatic league rules ---
    # Deliberately does NOT restate regular_season_weeks / playoff_weeks /
    # playoff_team_count / divisions above: those already come from
    # mSettings.scheduleSettings, and duplicating them into a settings block
    # would be exactly the "two sources to reconcile at read time" the
    # Source-of-Truth Rule forbids. These four cover the rules Season had no
    # representation for at all.
    settings: LeagueSettings
    roster_rules: RosterRules
    acquisition_rules: AcquisitionRules
    draft_settings: DraftSettings
    trade_rules: TradeRules


@dataclass
class RecordSplit:
    wins: int
    losses: int
    ties: int
    points_for: float
    points_against: float


@dataclass
class TeamTransactions:
    """Season transaction counters from mTeam's transactionCounter. Present for
    all 17 seasons."""

    # Repaired where ESPN's season scalar contradicts its own per-week totals:
    # this is max(scalar, sum(acquisitions_by_week)). Affects 2018 only, whose
    # scalar reads 14 league-wide against 348 from the per-week data (see
    # normalize._team_transactions). validate.py's team_transactions re-reads
    # data/raw/ and reports every repair.
    acquisitions: int
    drops: int
    trades: int
    moves_to_active: int
    moves_to_ir: int
    # Always 0.0 across 2009-2025: this league has never run a FAAB/auction
    # acquisition budget or charged league fees through ESPN. Carried anyway so
    # the fields populate on their own if the league's settings ever change.
    acquisitions_budget_spent: float
    team_charges: float
    # matchupAcquisitionTotals: week-as-string -> acquisitions made that week.
    # Replaces the spec's waiver_acquisitions, which has no ESPN counterpart --
    # transactionCounter has no waiver-specific count, and this is strictly more
    # information (it supports "most active week" as well as a season total).
    acquisitions_by_week: dict[str, int]


@dataclass
class Team:
    year: int
    espn_team_id: int
    owner_ids: list[str]
    primary_owner_id: str
    team_name: str
    division_id: int
    final_rank: int
    playoff_seed: int
    overall: RecordSplit
    home: RecordSplit
    away: RecordSplit
    division_record: RecordSplit
    streak_type: str
    streak_length: int

    # --- in-season-only fields (Phase 9.1) ---
    # ESPN populates these while a season is live and resets them once it ends,
    # so every row in the 2009-2025 archive carries the reset value (eliminated
    # False, the ranks/periods 0->None, points_adjusted 0.0). They are captured
    # anyway because Phase 8 re-runs this pipeline daily against an in-progress
    # season, where they carry real values -- treat a historical row's value as
    # ESPN's post-season reset, not as evidence about that season.
    eliminated: bool
    elimination_matchup_period: int | None  # ESPN's 0 ("not eliminated") -> None
    points_adjusted: float  # points after league fee/trade adjustments
    current_projected_rank: int | None  # ESPN's 0 ("no projection") -> None
    is_transaction_locked: bool

    # --- end-of-season fields (Phase 9.1) ---
    draft_day_projected_rank: int | None  # preseason projection; 2021+ only, else None
    waiver_rank: int | None  # waiver priority as of the season's end
    logo_url: str | None  # not set for every pre-2019 team
    # Raw ESPN season stat COUNTS keyed by statId-as-string (scripts/lib/
    # stat_ids.py names them) -- NOT fantasy points, and not a decomposition of
    # points_for: the counts cover every rostered player, bench included, so
    # weighting them by the season's scoring lands ~10-15% above points_for
    # (validate.py's team_value_by_stat bounds that). Empty for 2009-2018, whose
    # leagueHistory-era mTeam carries no valuesByStat at all.
    value_by_stat: dict[str, float]

    # --- Phase 9.2 ---
    transactions: TeamTransactions


@dataclass
class MatchupSide:
    owner_id: str | None  # None on a bye
    espn_team_id: int | None
    score: float


@dataclass
class Matchup:
    year: int
    week: int
    matchup_id: int
    playoff_tier: str | None  # None for regular season (ESPN's "NONE" normalized away)
    winner: str  # "HOME" | "AWAY" | "TIE" | "UNDECIDED"
    home: MatchupSide
    away: MatchupSide | None  # None on a bye week


@dataclass
class BoxScoreSlot:
    scoring_period: int
    lineup_slot_id: int
    points: float
    # Per-day mapped raw stat counts -- lets a same-day live-patch rerun
    # replace this slot instead of double-counting (box_score_lines.accumulate()).
    raw_stats: dict[str, int] = field(default_factory=dict)


@dataclass
class BattingLine:
    """Raw batting counts for one player-matchup, summed across its scoring
    periods. Fields cover every batting statId any season has ever scored
    (scripts/lib/stat_ids.py), so points recompute exactly from the season's
    scoring settings. Only emitted where day-level raw stats exist
    (coverage.stat_lines != "missing" -- 2018 partial, 2019+ full)."""

    ab: int
    r: int
    singles: int
    doubles: int
    triples: int
    hr: int
    rbi: int
    bb: int
    hbp: int
    k: int
    sb: int
    cs: int
    gidp: int
    cyc: int
    gshr: int
    e: int


@dataclass
class PitchingLine:
    """Raw pitching counts for one player-matchup; see BattingLine. IP is
    derived in the app as outs/3."""

    outs: int
    h: int
    r: int
    er: int
    bb: int
    hb: int
    k: int
    wins: int
    losses: int
    sv: int
    bs: int
    hd: int
    sho: int
    nh: int
    pg: int


@dataclass
class BoxScorePlayerLine:
    year: int
    week: int
    matchup_id: int
    owner_id: str
    espn_team_id: int
    player_id: int
    player_name: str
    total_points: float
    batting: BattingLine | None  # None when no batting activity or no raw stats
    pitching: PitchingLine | None  # None when no pitching activity or no raw stats
    slots: list[BoxScoreSlot]


@dataclass
class DraftPick:
    year: int
    overall_pick_number: int
    round_id: int
    round_pick_number: int
    espn_team_id: int
    owner_id: str
    player_id: int
    player_name: str
    keeper: bool
    traded_pick: bool  # owning team differs from the pick's original round slot
    traded_from_espn_team_id: (
        int | None
    )  # original owner of a traded pick (owningTeamIds' last element); None if not traded_pick
    pro_team_id: (
        int | None
    )  # MLB team that season, per scripts/lib/mlb_teams.py; None if unresolvable that year


@dataclass
class Keeper:
    year: int
    espn_team_id: int
    owner_id: str
    player_id: int
    player_name: str
    round_id: int
    overall_pick_number: int
    validated_on_prior_roster: bool
    pro_team_id: (
        int | None
    )  # MLB team that season, per scripts/lib/mlb_teams.py; None if unresolvable that year


@dataclass
class PlayerSeasonPoints:
    """Total box-score points a player produced in a season, summed across
    every team they appeared for that year (handles in-season trades/waiver
    pickups) -- the shared primitive behind Draft's Mr. Irrelevant/Draft
    Steals and the Keepers route's keeper-points leaderboard, computed once
    in normalize.py instead of re-derived from box_scores/*.json by every
    consumer (those files run tens of MB across all years combined).

    The split mirrors the box scores' slot semantics exactly:
    `points` is full production (counted + bench/IR); `counted_points` is
    what came while in a starting slot (what team scores are made of);
    `bench_points` is the remainder. All three are stored explicitly so no
    consumer ever has to re-derive or float-subtract them."""

    year: int
    player_id: int
    player_name: str
    points: float
    counted_points: float
    bench_points: float


@dataclass
class PlayerTeamSeasonPoints:
    """Points a player produced in a season FOR ONE TEAM -- the per-owner split
    that PlayerSeasonPoints rolls up.

    Exists because "what did this pickup actually do for the manager who made
    it" and "what did this player score that year" are different questions, and
    only the first one is a record about the manager. 1,307 of the archive's
    7,195 player-seasons are split across more than one owner, so for those the
    season total credits production the acquiring manager never received.

    Box scores already attribute every row to the team that rostered the player
    that week, so this is a straight regroup of data normalize.py has already
    built -- no transaction dates are involved and none are needed.
    validate.py's player_team_points asserts these sum back to
    player_season_points exactly.

    Carries the same explicit split as PlayerSeasonPoints (full production /
    counted / bench), per this row's own box-score lines.
    """

    year: int
    player_id: int
    player_name: str
    owner_id: str
    espn_team_id: int
    points: float
    counted_points: float
    bench_points: float


@dataclass
class PlayerSeasonBackfill:
    """Full-season batting/pitching stats and fantasy points for player-seasons
    that are absent from the box-score archive -- typically players who were
    active in MLB (and in the ESPN player pool) but never rostered in the league
    that season. Source: kona_player_info.json real season stat blocks
    (statSourceId 0, statSplitTypeId 0)."""

    year: int
    player_id: int
    player_name: str
    points: float
    batting: BattingLine | None
    pitching: PitchingLine | None
    eligible_slots: list[int]
    default_position_id: int | None
    source: str  # "kona"


@dataclass
class CardPoints:
    """ESPN's full-season player-card total for one player-season: everything
    the player scored in real life under the league's scoring, rostered days
    and free-agent days alike. Source: kona_player_info.json real season stat
    blocks (statSourceId 0, statSplitTypeId 0) -- the same blocks
    PlayerSeasonBackfill reads, but for player-seasons that DO have box-score
    rows, where the box-derived total covers rostered days only. Only emitted
    for (year, player) keys present in player_season_points, so the file stays
    bounded to consumed rows."""

    year: int
    player_id: int
    player_name: str
    card_points: float


@dataclass
class TransactionItem:
    """One player movement inside a transaction. ESPN's own item `type` values:
    ADD / DROP (free agency), TRADE (a player crossing between two rosters),
    LINEUP (a start/sit move), DRAFT (a draft pick)."""

    player_id: int
    item_type: str
    # ESPN's team-id 0 means "free agency / no team" on whichever side it
    # appears -- an ADD reads fromTeamId 0, a DROP reads toTeamId 0. Normalized
    # to None so a 0 is never mistaken for a real espn_team_id.
    from_espn_team_id: int | None
    to_espn_team_id: int | None
    # ESPN's -1 means "not on a lineup" (the free-agent pool, or a drop's
    # destination) -- also normalized to None. 0 is a REAL slot id (catcher).
    from_lineup_slot_id: int | None
    to_lineup_slot_id: int | None


@dataclass
class Transaction:
    """One entry in the league's transaction ledger, from mTransactions2.

    Coverage is 2019-2025 only -- ESPN's per-period endpoint serves nothing for
    2009-2018, which is 7 of the archive's 17 seasons. Read
    seasons.json's coverage.transactions before presenting any total as
    all-time (see context/change-log/phase-9-data-enrichment.md).

    Two ESPN transaction types are deliberately NOT stored here:
      * FUTURE_ROSTER -- routine start/sit lineup shuffling, 11,619 of the
        17,097 raw rows (68%). It is roster bookkeeping, not league activity,
        and would bury every real add, drop and trade. The per-year counts are
        kept in validate.py's transaction_ledger cross-check instead.
      * DRAFT -- draft_picks.json is already the source of truth for picks and
        carries more (keeper flags, pick values). Storing them twice is exactly
        the parallel-source case the Source-of-Truth Rule forbids; validate.py
        reconciles the two counts instead.
    """

    year: int
    transaction_id: str  # ESPN's own uuid; unique within and across seasons
    transaction_type: str  # FREEAGENT | ROSTER | TRADE_PROPOSAL | TRADE_ACCEPT | ...
    scoring_period_id: int  # a DAY in this daily-scoring league, not a week
    week: int | None
    proposed_date: int | None
    espn_team_id: int
    owner_id: str | None  # the team's primary owner, via owner-map.json
    acting_member_key: str | None
    status: str | None  # EXECUTED | CANCELED | PENDING; absent on some trade rows
    is_league_manager: bool  # commissioner acting on a team's behalf
    related_transaction_id: str | None
    bid_amount: float
    items: list[TransactionItem]


@dataclass
class Trade:
    """One executed trade, reconstructed from transactions.json's TRADE_*
    family: grouped by related_transaction_id, kept only when the group
    contains a TRADE_UPHOLD (executed, not vetoed/declined/canceled).

    items comes from the originating TRADE_PROPOSAL row, which ESPN purges
    the instant a trade executes -- recoverable only when the daily
    mTransactions2 capture (sync_live_scoreboard.py, added for this reason)
    caught it while still pending. That capture exists 2026+ only; for
    2019-2025 the player exchange instead comes from a box-score roster
    diff across the execution scoring period (see normalize.py's
    _reconstruct_trade_items). Either way each item dict carries a `source`
    key (`ledger` or `box_score_diff`) so callers know which; a trade
    neither can recover keeps an empty items list.
    """

    year: int
    trade_id: str  # the originating TRADE_PROPOSAL's transaction_id
    proposed_date: int | None
    executed_date: int | None
    team_a_espn_team_id: int
    team_a_owner_id: str | None
    team_b_espn_team_id: int
    team_b_owner_id: str | None
    acting_member_key: str | None  # who proposed the trade
    items: list[dict[str, Any]]  # already-serialized TransactionItem dicts
