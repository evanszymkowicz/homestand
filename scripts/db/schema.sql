-- WSOB Record Book — SQLite/D1 schema (db-migration-scoring-spec step 1).
--
-- Target: SQLite (D1-compatible subset: no generated columns beyond STORED,
-- no partial features outside D1's surface). Replaces data/processed/ JSON
-- entirely ("full replacement" decision, 2026-08-23).
--
-- Design rules:
-- * Natural keys mirror the JSON shapes field-for-field (snake_case) so the
--   golden-fixture acceptance test can serialize any table back to the exact
--   processed-file row order/shapes (see db-migration-scoring-spec.md).
-- * Cross-season identity stays owner_id (stable slug); espn_team_id /
--   matchup_id / player_id are kept as ESPN's foreign keys back into
--   data/raw/, never primary identity (data/README.md conventions).
-- * Read-whole blobs that are never queried piecewise (rule blocks, coverage,
--   ownership percentages, games_played_by_position) are stored as JSON TEXT
--   via JSON1 -- normalizing them into child tables buys nothing and breaks
--   byte-parity diffing.
-- * Derived-at-load tables (keepers, *_season_points) stay TABLEs, not VIEWs:
--   float accumulation order and round(x,2) semantics must match the Python
--   pipeline exactly, and keepers' validated_on_prior_roster needs raw-archive
--   roster evidence not present in the DB. Equality with their source rows is
--   enforced by acceptance tests instead (spec step 5).
-- * Coverage gates / status / quirks live IN the data (seasons.coverage JSON),
--   so consumers gate on rows exactly as they gate on JSON today.

PRAGMA foreign_keys = ON;

------------------------------------------------------------------------
-- Reference & season-level
------------------------------------------------------------------------

CREATE TABLE mlb_teams (
    pro_team_id INTEGER PRIMARY KEY,          -- 0 = "FA", real slot ids 0-30
    abbrev      TEXT NOT NULL,
    name        TEXT NOT NULL
);

CREATE TABLE seasons (
    year                 INTEGER PRIMARY KEY,
    regular_season_weeks INTEGER NOT NULL,
    playoff_weeks        INTEGER NOT NULL,
    playoff_team_count   INTEGER NOT NULL,
    playoff_brackets     TEXT NOT NULL,       -- JSON array of tier strings
    divisions            TEXT NOT NULL,       -- JSON [{division_id, name}]
    coverage             TEXT NOT NULL,       -- JSON {family: full|partial|missing}
    scoring              TEXT NOT NULL,       -- JSON [{stat_id, points}] per-season weights
    status               TEXT NOT NULL CHECK (status IN ('in_progress','final')),
    current_week         INTEGER NOT NULL,
    notes                TEXT NOT NULL,       -- JSON string[]
    settings             TEXT NOT NULL,       -- JSON {league_id, league_name, ...}
    roster_rules         TEXT NOT NULL,       -- JSON (Phase 9.3a block)
    acquisition_rules    TEXT NOT NULL,       -- JSON
    draft_settings       TEXT NOT NULL,       -- JSON
    trade_rules          TEXT NOT NULL        -- JSON
);

CREATE TABLE owners (
    owner_id                   TEXT PRIMARY KEY,
    canonical_name             TEXT NOT NULL,
    team_names_by_year         TEXT NOT NULL, -- JSON {year: [name,...]}
    espn_member_keys           TEXT NOT NULL, -- JSON [{member_key, years}] (salted hashes only)
    co_owners                  TEXT NOT NULL, -- JSON owner_id[]
    last_active_year           INTEGER NOT NULL,
    absent_from_latest_season  INTEGER NOT NULL CHECK (absent_from_latest_season IN (0,1)),
    is_commissioner            INTEGER NOT NULL CHECK (is_commissioner IN (0,1))
);

-- From data/manual/retired-owners.json (authority on who actually left;
-- deliberately separate from absent_from_latest_season's archive semantics).
CREATE TABLE retired_owners (
    owner_id TEXT PRIMARY KEY REFERENCES owners(owner_id)
);

-- ESPN "Fantasy Achievements" trophies, 2026+ only (the feature launched
-- 2026-02-04 and ESPN serves no earlier seasons). One row per member per
-- season; trophies is the fixed 20-slot template as JSON [{slot, earned}] --
-- the payload names no trophies, so slots stay positional
-- (context/features/espn-trophies-activity-tray-spec.md). owner_id is NULL
-- when the member resolved to no canonical owner; validate.py's
-- achievements_linkage check fails loudly on that, so NULL never ships.
CREATE TABLE achievements (
    year         INTEGER NOT NULL REFERENCES seasons(year),
    member_key   TEXT NOT NULL,       -- salted hash, never a raw SWID
    owner_id     TEXT REFERENCES owners(owner_id),
    espn_team_id INTEGER,
    trophies     TEXT NOT NULL        -- JSON [{slot, earned}] x 20
);

-- From data/manual/jersey-history-overrides.json (hand-maintained jersey/
-- team stints ESPN never reported pre-2017 or collapses across mid-season
-- trades; backfilled from the MLB Stats API). Rowid preserves file order.
CREATE TABLE jersey_history_overrides (
    player_id   INTEGER NOT NULL,
    player_name TEXT NOT NULL,
    pro_team_id INTEGER NOT NULL,
    jersey      TEXT NOT NULL,
    start_year  INTEGER NOT NULL,
    end_year    INTEGER NOT NULL,
    start_date  TEXT,                        -- real calendar dates, optional
    end_date    TEXT,
    source      TEXT                         -- provenance audit trail
);

-- From data/manual/position-overrides.json (one-off corrections where
-- ESPN's declared default_position_id doesn't match a season's real primary
-- position). Rowid preserves file order.
CREATE TABLE position_overrides (
    player_id                INTEGER NOT NULL,
    player_name              TEXT NOT NULL,
    year                     INTEGER NOT NULL REFERENCES seasons(year),
    position_id              INTEGER NOT NULL,
    espn_default_position_id INTEGER,
    source                   TEXT,
    note                     TEXT
);

-- sync_live_scoreboard.py's intraday scratch state: the patched JSON files it
-- accumulates across the day's lightweight runs, stored so the next run
-- resumes from D1 instead of R2 (Phase C deprecation, 2026-08-25).
-- Written only by publish_d1_delta.py alongside every delta; read back by
-- scripts/db/pull_live_state.py. Not app-facing.
--
-- Payloads are zlib-compressed then base64'd, and split into <=48 KB chunks:
-- D1 rejects any SQL statement over 100 KB, and the raw documents run to
-- multiple MB (box_scores/2026.json alone is ~8.7 MB), so a single-row
-- verbatim store cannot survive the inlined-INSERT transport. Chunks are
-- reassembled by key order on read-back; publish deletes each patched key's
-- rows first so stale trailing chunks from an earlier (larger) version can
-- never linger.
CREATE TABLE live_sync_state (
    key        TEXT NOT NULL,      -- relative path, e.g. "box_scores/2026.json"
    chunk_idx  INTEGER NOT NULL,   -- 0-based position within the payload
    payload    TEXT NOT NULL,      -- base64(zlib(chunk of the JSON document))
    updated_at INTEGER NOT NULL,   -- epoch ms of the publishing run
    PRIMARY KEY (key, chunk_idx)
);

CREATE TABLE teams (
    year                      INTEGER NOT NULL REFERENCES seasons(year),
    espn_team_id              INTEGER NOT NULL,
    primary_owner_id          TEXT NOT NULL REFERENCES owners(owner_id),
    team_name                 TEXT NOT NULL,
    division_id               INTEGER,
    final_rank                INTEGER,
    playoff_seed              INTEGER,
    overall                   TEXT NOT NULL, -- JSON {wins,losses,ties,pf,pa} (regular season only)
    home                      TEXT NOT NULL, -- JSON, same shape
    away                      TEXT NOT NULL, -- JSON
    division_record           TEXT NOT NULL, -- JSON
    streak_type               TEXT,
    streak_length             INTEGER,
    draft_day_projected_rank  INTEGER,       -- real 2021+ only, NULL earlier
    waiver_rank               INTEGER,
    logo_url                  TEXT,
    value_by_stat             TEXT NOT NULL, -- JSON {statId: count}, empty pre-2019
    transactions              TEXT NOT NULL, -- JSON counter block (2018 acquisitions repaired)
    eliminated                INTEGER NOT NULL CHECK (eliminated IN (0,1)),
    elimination_matchup_period INTEGER,
    points_adjusted           REAL NOT NULL,
    current_projected_rank    INTEGER,
    is_transaction_locked     INTEGER NOT NULL CHECK (is_transaction_locked IN (0,1)),
    PRIMARY KEY (year, espn_team_id)
);

CREATE TABLE team_owners (
    year         INTEGER NOT NULL,
    espn_team_id INTEGER NOT NULL,
    owner_id     TEXT NOT NULL REFERENCES owners(owner_id),
    position     INTEGER NOT NULL,            -- index within teams.owner_ids[]
    PRIMARY KEY (year, espn_team_id, owner_id),
    FOREIGN KEY (year, espn_team_id) REFERENCES teams(year, espn_team_id)
);

------------------------------------------------------------------------
-- Matchups
------------------------------------------------------------------------

CREATE TABLE matchups (
    year         INTEGER NOT NULL REFERENCES seasons(year),
    week         INTEGER NOT NULL,
    matchup_id   INTEGER NOT NULL,
    playoff_tier TEXT,                        -- NULL = regular season (ESPN NONE normalized away)
    winner       TEXT NOT NULL CHECK (winner IN ('HOME','AWAY','TIE','UNDECIDED')),
    PRIMARY KEY (year, matchup_id)
);
CREATE INDEX idx_matchups_week ON matchups(year, week);

-- One row per side; away is simply absent on a playoff bye. score matches the
-- official counted total (pf_box_score_reconciliation's authority).
CREATE TABLE matchup_sides (
    year         INTEGER NOT NULL,
    matchup_id   INTEGER NOT NULL,
    side         TEXT NOT NULL CHECK (side IN ('home','away')),
    espn_team_id INTEGER NOT NULL,
    owner_id     TEXT NOT NULL REFERENCES owners(owner_id),
    score        REAL NOT NULL,
    PRIMARY KEY (year, matchup_id, side),
    FOREIGN KEY (year, matchup_id) REFERENCES matchups(year, matchup_id),
    FOREIGN KEY (year, espn_team_id) REFERENCES teams(year, espn_team_id)
);
CREATE INDEX idx_sides_team ON matchup_sides(year, espn_team_id);

------------------------------------------------------------------------
-- Box scores (the large fact table)
------------------------------------------------------------------------

-- One row per (player, matchup, team): mirrors box_scores/{year}.json entries.
-- Batting/pitching stat fields are wide NULLable INTEGER columns named exactly
-- as stat_ids.py maps them (NULL = no activity on that side of the ball, i.e.
-- the JSON's null batting/pitching object). total_points is FULL PRODUCTION:
-- active-slot points plus bench/IR slot points in every season (normalize's
-- snapshot anchoring adds bench back on top of ESPN's counted-only snapshots).
CREATE TABLE box_score_lines (
    year         INTEGER NOT NULL,
    week         INTEGER NOT NULL,
    matchup_id   INTEGER NOT NULL,
    espn_team_id INTEGER NOT NULL,
    owner_id     TEXT NOT NULL REFERENCES owners(owner_id),
    player_id    INTEGER NOT NULL,
    player_name  TEXT NOT NULL,
    total_points REAL NOT NULL,
    -- batting (stat_ids.py BATTING_STAT_IDS order)
    b_ab         INTEGER, b_doubles INTEGER, b_triples INTEGER, b_hr INTEGER,
    b_singles    INTEGER, b_bb INTEGER, b_hbp INTEGER, b_r INTEGER,
    b_rbi        INTEGER, b_sb INTEGER, b_cs INTEGER, b_gidp INTEGER,
    b_k          INTEGER, b_cyc INTEGER, b_gshr INTEGER, b_e INTEGER,
    -- pitching (PITCHING_STAT_IDS order; outs = IP*3, display derives app-side)
    p_outs       INTEGER, p_h INTEGER, p_bb INTEGER, p_hb INTEGER,
    p_r          INTEGER, p_er INTEGER, p_k INTEGER, p_wins INTEGER,
    p_losses     INTEGER, p_sv INTEGER, p_bs INTEGER, p_hd INTEGER,
    p_sho        INTEGER, p_nh INTEGER, p_pg INTEGER,
    PRIMARY KEY (year, matchup_id, espn_team_id, player_id)
);
CREATE INDEX idx_lines_player ON box_score_lines(year, player_id);
CREATE INDEX idx_lines_team_week ON box_score_lines(year, espn_team_id, week);

-- Per-day breakdown, 2019+ meaningful (pre-2019: one synthetic slot,
-- lineup_slot_id 0). lineup_slot_id 16/17 = bench/IR, never counted toward
-- totals (enforced by tests, not constraints -- bench points are real data).
-- raw_stats is live-patch bookkeeping ({stat_id_str: count} JSON); empty {}
-- sentinel means "not yet reflected in totals" (box_score_lines.py accumulate()).
CREATE TABLE box_score_slots (
    year            INTEGER NOT NULL,
    matchup_id      INTEGER NOT NULL,
    espn_team_id    INTEGER NOT NULL,
    player_id       INTEGER NOT NULL,
    scoring_period  INTEGER NOT NULL,
    lineup_slot_id  INTEGER NOT NULL,
    points          REAL NOT NULL,
    raw_stats       TEXT NOT NULL,            -- JSON object
    PRIMARY KEY (year, matchup_id, espn_team_id, player_id, scoring_period),
    FOREIGN KEY (year, matchup_id, espn_team_id, player_id)
        REFERENCES box_score_lines(year, matchup_id, espn_team_id, player_id) ON DELETE CASCADE
);

------------------------------------------------------------------------
-- Players
------------------------------------------------------------------------

CREATE TABLE players (
    player_id                  INTEGER PRIMARY KEY,  -- post-override canonical id
    full_name                  TEXT NOT NULL,        -- latest-seen value
    default_position_id        INTEGER NOT NULL,     -- career-level
    eligible_slots             TEXT NOT NULL,        -- JSON int[] (career union)
    games_played_by_position   TEXT NOT NULL,        -- JSON {positionId: games}
    active                     INTEGER NOT NULL CHECK (active IN (0,1)),
    pro_team_id                INTEGER,              -- latest-wins, NOT per-year truth
    jersey                     TEXT,                 -- 2017+ only
    droppable                  INTEGER,
    seasons_seen               TEXT NOT NULL,        -- JSON int[]
    roster_days                INTEGER NOT NULL      -- 2019+ count only
);

CREATE TABLE player_seasons (
    year                      INTEGER NOT NULL REFERENCES seasons(year),
    player_id                 INTEGER NOT NULL REFERENCES players(player_id),
    player_name               TEXT NOT NULL,
    eligible_slots            TEXT NOT NULL,      -- JSON int[] (that season)
    games_played_by_position  TEXT NOT NULL,      -- JSON (position-id space, 12=PH excluded app-side)
    default_position_id       INTEGER NOT NULL,   -- per-season on purpose
    jersey                    TEXT,
    injury_status             TEXT,               -- NULL pre-2017 = "not reported"
    injured                   INTEGER CHECK (injured IN (0,1)),
    pro_team_id               INTEGER,            -- that season's real MLB team (0=FA on file)
    fantasy_team_id           INTEGER,            -- espn_team_id rostering him that season, NULL unrostered
    PRIMARY KEY (year, player_id)
);
CREATE INDEX idx_pseasons_player ON player_seasons(player_id);

------------------------------------------------------------------------
-- Derived scoring rollups (tables; equality w/ lines enforced by tests)
--
-- player_season_points is deliberately NOT a table: it is exactly the
-- per-player roll-up of player_team_season_points (rebuild.py derives it
-- for validate_db; data.ts derives it client-side), so storing it was a
-- second copy of one number. The processed JSON file remains the
-- pipeline's internal artifact, pinned by scripts/validate.py.
------------------------------------------------------------------------

CREATE TABLE player_team_season_points (
    year         INTEGER NOT NULL REFERENCES seasons(year),
    player_id    INTEGER NOT NULL,
    owner_id     TEXT NOT NULL REFERENCES owners(owner_id),
    espn_team_id INTEGER NOT NULL,
    player_name  TEXT NOT NULL,
    points       REAL NOT NULL,               -- round(2), per (player, team)
    counted_points REAL NOT NULL,
    bench_points   REAL NOT NULL,
    PRIMARY KEY (year, player_id, espn_team_id)
);

-- 2026 live-season backfill rows (Phase 7 shape: partial batting/pitching +
-- kona-sourced eligibility until the weekly rebuild replaces them).
CREATE TABLE player_season_backfill (
    year                INTEGER NOT NULL REFERENCES seasons(year),
    player_id           INTEGER NOT NULL,
    player_name         TEXT NOT NULL,
    points              REAL NOT NULL,
    batting             TEXT,                 -- JSON BattingLine or NULL
    pitching            TEXT,                 -- JSON PitchingLine or NULL
    eligible_slots      TEXT NOT NULL,        -- JSON int[]
    default_position_id INTEGER NOT NULL,
    source              TEXT NOT NULL,        -- e.g. 'kona'
    PRIMARY KEY (year, player_id)
);

-- 2026 cross-league ownership snapshot rows (player_seasons.ownership's
-- live-season counterpart, flattened).
CREATE TABLE player_season_ownership (
    year                                  INTEGER NOT NULL REFERENCES seasons(year),
    player_id                             INTEGER NOT NULL,
    player_name                           TEXT NOT NULL,
    percent_owned                         REAL NOT NULL,
    percent_started                       REAL NOT NULL,
    percent_change                        REAL NOT NULL,
    average_draft_position                REAL,  -- sentinels already normalized to NULL
    average_draft_position_percent_change REAL NOT NULL,
    auction_value_average                 REAL,
    auction_value_average_change          REAL NOT NULL,
    PRIMARY KEY (year, player_id)
);

------------------------------------------------------------------------
-- Draft, keepers, transactions, trades
------------------------------------------------------------------------

CREATE TABLE draft_picks (
    year               INTEGER NOT NULL REFERENCES seasons(year),
    overall_pick_number INTEGER NOT NULL,
    round_id           INTEGER NOT NULL,
    round_pick_number  INTEGER NOT NULL,
    espn_team_id       INTEGER NOT NULL,
    owner_id           TEXT NOT NULL REFERENCES owners(owner_id),
    player_id          INTEGER NOT NULL,      -- may resolve to no players row (unresolvable picks)
    player_name        TEXT NOT NULL DEFAULT '',  -- '' for unresolvable picks, by design
    keeper             INTEGER NOT NULL CHECK (keeper IN (0,1)),
    traded_pick        INTEGER NOT NULL CHECK (traded_pick IN (0,1)),
    traded_from_espn_team_id INTEGER,          -- original slot when the pick was exercised via trade
    pro_team_id        INTEGER,               -- that draft year's MLB team, NULL outside kona cap
    PRIMARY KEY (year, overall_pick_number)
);
CREATE INDEX idx_picks_team ON draft_picks(year, espn_team_id);
CREATE INDEX idx_picks_player ON draft_picks(player_id);

-- Derived from draft_picks + raw-archive prior-roster evidence
-- (validated_on_prior_roster is NOT recomputable inside the DB), so it stays
-- a table. The 20 documented exceptions are data, not errors.
CREATE TABLE keepers (
    year                        INTEGER NOT NULL REFERENCES seasons(year),
    espn_team_id                INTEGER NOT NULL,
    owner_id                    TEXT NOT NULL REFERENCES owners(owner_id),
    player_id                   INTEGER NOT NULL,
    player_name                 TEXT NOT NULL,
    round_id                    INTEGER NOT NULL,
    overall_pick_number         INTEGER NOT NULL,
    validated_on_prior_roster   INTEGER NOT NULL CHECK (validated_on_prior_roster IN (0,1)),
    pro_team_id                 INTEGER,
    PRIMARY KEY (year, espn_team_id, player_id),
    FOREIGN KEY (year, overall_pick_number) REFERENCES draft_picks(year, overall_pick_number)
);

-- Add/drop/trade ledger, 2019+ only (coverage.transactions gates this table's
-- emptiness for 2009-2018). transaction_id is ESPN's uuid.
CREATE TABLE transactions (
    year                   INTEGER NOT NULL REFERENCES seasons(year),
    transaction_id         TEXT NOT NULL,
    transaction_type       TEXT NOT NULL,     -- FREEAGENT..TRADE_VETO vocabulary
    scoring_period_id      INTEGER NOT NULL,  -- a DAY, not a week
    week                   INTEGER,           -- NULL on preseason/ASG/postseason days
    proposed_date          INTEGER,           -- epoch ms; NULL ~236 rows (mostly 2020)
    espn_team_id           INTEGER NOT NULL,
    owner_id               TEXT NOT NULL REFERENCES owners(owner_id),
    acting_member_key      TEXT,              -- salted hash, joins owners.espn_member_keys
    status                 TEXT CHECK (status IN ('EXECUTED','CANCELED','PENDING')),
    is_league_manager      INTEGER NOT NULL CHECK (is_league_manager IN (0,1)),
    related_transaction_id TEXT,
    bid_amount             REAL NOT NULL,     -- always 0 here, kept for shape parity
    PRIMARY KEY (year, transaction_id)
);
CREATE INDEX idx_tx_team_period ON transactions(year, espn_team_id, scoring_period_id);
CREATE INDEX idx_tx_related ON transactions(year, related_transaction_id);

-- FUTURE_ROSTER and DRAFT types are dropped BY DESIGN (draft_picks owns picks);
-- transaction_ledger acceptance test reconciles the dropped counts.
CREATE TABLE transaction_items (
    year                INTEGER NOT NULL,
    transaction_id      TEXT NOT NULL,
    item_index          INTEGER NOT NULL,
    player_id           INTEGER NOT NULL,    -- may join to nothing (7 ledger-only ids)
    item_type           TEXT CHECK (item_type IS NULL OR item_type IN ('ADD','DROP','TRADE','LINEUP')),
    from_espn_team_id   INTEGER,             -- ESPN 0 (free agency) normalized to NULL
    to_espn_team_id     INTEGER,
    from_lineup_slot_id INTEGER,             -- -1 ("not on a lineup") normalized to NULL
    to_lineup_slot_id   INTEGER,
    PRIMARY KEY (year, transaction_id, item_index),
    FOREIGN KEY (year, transaction_id) REFERENCES transactions(year, transaction_id) ON DELETE CASCADE
);

-- Executed trades only (TRADE_UPHOLD present); items carry provenance because
-- 9 of 11 historical exchanges are reconstructed, not recorded.
CREATE TABLE trades (
    year                  INTEGER NOT NULL REFERENCES seasons(year),
    trade_id              TEXT NOT NULL,     -- originating TRADE_PROPOSAL uuid
    proposed_date         INTEGER,           -- NULL pre-2026 without daily capture
    executed_date         INTEGER NOT NULL,  -- from TRADE_UPHOLD, always present
    team_a_espn_team_id   INTEGER NOT NULL,
    team_a_owner_id       TEXT NOT NULL REFERENCES owners(owner_id),
    team_b_espn_team_id   INTEGER NOT NULL,
    team_b_owner_id       TEXT NOT NULL REFERENCES owners(owner_id),
    acting_member_key     TEXT,
    PRIMARY KEY (year, trade_id)
);

CREATE TABLE trade_items (
    year                INTEGER NOT NULL,
    trade_id            TEXT NOT NULL,
    item_index          INTEGER NOT NULL,
    player_id           INTEGER NOT NULL,
    item_type           TEXT NOT NULL CHECK (item_type IN ('ADD','DROP','TRADE','LINEUP')),
    from_espn_team_id   INTEGER,
    to_espn_team_id     INTEGER,
    from_lineup_slot_id INTEGER,
    to_lineup_slot_id   INTEGER,
    source              TEXT NOT NULL CHECK (source IN ('ledger','box_score_diff')),
    PRIMARY KEY (year, trade_id, item_index),
    FOREIGN KEY (year, trade_id) REFERENCES trades(year, trade_id) ON DELETE CASCADE
);
