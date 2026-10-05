"""Owner and player identity resolution for normalize.py.

Owner resolution reads the hand-maintained data/manual/owner-map.json as the
authoritative (year, espn_team_id) -> owner_id lookup. It also builds a
name-based index (first+last name, case-insensitive, per the league's join-key
convention) so validate.py can re-derive owner_ids straight from data/raw/ and
confirm the manual file hasn't drifted out of sync -- ESPN member IDs (SWIDs)
are read transiently for that join and never persisted (see owner-map.json's
_readme for why).

Player resolution accumulates identity across every place a player object
appears in the raw archive (kona_player_info, box scores, rosters) since no
single view lists every player who ever appeared, then applies
data/manual/player-overrides.json for any ESPN player-ID inconsistencies
validate.py has caught.
"""

import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# Domain-separation salt for espn_member_key(). Committed on purpose, and safe
# to be: a SWID is a 128-bit random GUID, so knowing the salt does not make the
# hash reversible by brute force. What the salt buys is that these keys can't be
# matched against a plain SHA-256 of the same SWID computed anywhere else.
#
# It is committed rather than kept in config.json so that normalize.py stays
# reproducible -- a secret salt would make data/processed/ differ between
# machines and break the byte-identical re-run property validate.py relies on.
# Changing this string rewrites every member_key in the output, so don't.
ESPN_MEMBER_KEY_SALT = "wsob-record-book/espn-member/v1"


def espn_member_key(swid: str) -> str:
    """A stable, non-reversible key for an ESPN member id (SWID).

    Truncated to 16 hex chars: still 64 bits, which is far past collision risk
    for a league that has had ~30 members ever, and keeps owners.json readable.
    """
    digest = hashlib.sha256(f"{ESPN_MEMBER_KEY_SALT}:{swid}".encode()).hexdigest()
    return digest[:16]


class MappingError(Exception):
    """An owner or player reference that can't be resolved -- always a data
    problem worth surfacing, never silently skipped."""


@dataclass
class OwnerMap:
    owners_by_id: dict[str, dict[str, Any]]
    name_index: dict[tuple[str, str], str]  # (first_lower, last_lower) -> owner_id
    team_seasons: dict[tuple[int, int], dict[str, Any]]  # (year, espn_team_id) -> entry


def load_owner_map(path: Path) -> OwnerMap:
    raw = json.loads(path.read_text())

    owners_by_id: dict[str, dict[str, Any]] = {}
    name_index: dict[tuple[str, str], str] = {}
    for owner in raw["owners"]:
        owner_id = owner["owner_id"]
        owners_by_id[owner_id] = owner
        names = [owner["canonical_name"], *owner.get("name_variants", [])]
        for name in names:
            first, _, last = name.partition(" ")
            key = (first.strip().lower(), last.strip().lower())
            existing = name_index.get(key)
            if existing and existing != owner_id:
                raise MappingError(
                    f"name collision: {name!r} maps to both {existing!r} and "
                    f"{owner_id!r} in owner-map.json"
                )
            name_index[key] = owner_id

    team_seasons: dict[tuple[int, int], dict[str, Any]] = {}
    for entry in raw["team_seasons"]:
        team_seasons[(entry["year"], entry["espn_team_id"])] = entry

    return OwnerMap(
        owners_by_id=owners_by_id, name_index=name_index, team_seasons=team_seasons
    )


def resolve_team_owner(
    owner_map: OwnerMap, year: int, espn_team_id: int
) -> dict[str, Any]:
    """The primary resolution path normalize.py uses: a direct lookup into the
    hand-vetted owner-map.json. Raises loudly on a miss -- an unmapped
    team-season is exactly what the spec calls an orphan, and normalize.py
    must not guess an attribution."""
    entry = owner_map.team_seasons.get((year, espn_team_id))
    if entry is None:
        raise MappingError(
            f"{year} espn_team_id={espn_team_id} has no entry in "
            "data/manual/owner-map.json's team_seasons -- add one before normalizing."
        )
    return entry


def derive_owner_ids_from_raw(
    owner_map: OwnerMap,
    members_by_swid: dict[str, dict[str, Any]],
    team: dict[str, Any],
) -> tuple[list[str], str | None]:
    """Re-derives owner_ids/primary_owner_id straight from a raw mTeam.json
    payload's members[]/teams[] via the name-index, independent of
    owner-map.json's stored team_seasons. Used by validate.py to confirm the
    manual mapping hasn't drifted from what ESPN actually reports."""

    def owner_id_for_swid(swid: str) -> str:
        member = members_by_swid.get(swid)
        if member is None:
            raise MappingError(
                "member-swid referenced by a team but absent from members[]"
            )
        key = (
            member.get("firstName", "").strip().lower(),
            member.get("lastName", "").strip().lower(),
        )
        owner_id = owner_map.name_index.get(key)
        if owner_id is None:
            raise MappingError(
                f"no owner-map.json entry for name {key!r} (member-swid) -- "
                "a new person or a name change needs a new/updated owner entry."
            )
        return owner_id

    owner_ids = sorted({owner_id_for_swid(s) for s in team.get("owners", [])})
    primary_owner_id = (
        owner_id_for_swid(team["primaryOwner"]) if team.get("primaryOwner") else None
    )
    return owner_ids, primary_owner_id


# ESPN reports "no average draft position" two different ways depending on the
# season -- a 9999 sentinel, or a plain 0.0 (all of 2019 reads 0.0). Neither is
# a real draft slot, so both become None. auctionValueAverage uses 0.0 the same
# way; its *Change counterparts are genuine deltas where 0.0 means "no change"
# and must be preserved.
NO_DRAFT_VALUE_SENTINELS = (0.0, 9999.0)


def _optional_market_value(value: Any) -> float | None:
    if value is None or float(value) in NO_DRAFT_VALUE_SENTINELS:
        return None
    return float(value)


def _player_ownership(ownership: dict[str, Any]) -> dict[str, Any]:
    """Maps one raw ESPN `ownership` object to the ownership dict shape shared
    by player_seasons.json rows and player_season_ownership.json.

    Cross-league, not this league: percentages and ADP are averaged over every
    ESPN fantasy baseball league of this type, so they measure how the wider
    fantasy world valued the player that year -- which is exactly what makes
    them useful here (a high-scoring, low-percent_owned player is a genuine
    waiver steal). They are NOT derived from this league's 10 rosters, and ADP
    is present for undrafted players too. Verified per-season-accurate rather
    than a present-day snapshot: Albert Pujols reads 100% owned 2009-2012 and
    8.9% by 2020, and Derek Jeter disappears after his 2014 retirement.

    ESPN's activityLevel/date/leagueType are dropped: across the whole archive
    the first two are always null and leagueType is always 0."""
    return {
        "percent_owned": ownership.get("percentOwned") or 0.0,
        "percent_started": ownership.get("percentStarted") or 0.0,
        "percent_change": ownership.get("percentChange") or 0.0,
        "average_draft_position": _optional_market_value(
            ownership.get("averageDraftPosition")
        ),
        "average_draft_position_percent_change": ownership.get(
            "averageDraftPositionPercentChange"
        ),
        "auction_value_average": _optional_market_value(
            ownership.get("auctionValueAverage")
        ),
        "auction_value_average_change": ownership.get("auctionValueAverageChange"),
    }


# season_fields keys that pass straight through to a player_seasons.json row,
# unlike eligible_slots/games_played_by_position/ownership (structured, need
# their own merge/default) and active/droppable (career-only: they aggregate
# into players.json and never appear per-season).
# Single source of truth for to_player_seasons() below -- add a name here and
# it starts flowing into player_seasons.json with no further wiring.
SEASON_ONLY_FIELDS = (
    "default_position_id",
    "jersey",
    "injury_status",
    "injured",
    "pro_team_id",
    "fantasy_team_id",
)


@dataclass
class PlayerRegistry:
    """Accumulates player identity across every raw view that embeds a player
    object. No single ESPN view lists every player who ever appeared (kona_
    player_info is capped at the top ~500 by ownership per year), so this
    merges what's seen across kona_player_info, box scores, and rosters."""

    players: dict[int, dict[str, Any]] = field(default_factory=dict)
    overrides: dict[int, int] = field(
        default_factory=dict
    )  # player_id -> canonical_player_id
    # canonical player_id -> last active season, for retiring players who would
    # otherwise linger in the latest kona player pool after they leave the game
    # (loaded from data/manual/retired-players.json -- see that file's _readme).
    retired: dict[int, int] = field(default_factory=dict)
    # player_id -> distinct (year, scoring_period) days seen on any roster.
    # Only 2019+ has this by default so
    # the emitted roster_days undercounts careers that started earlier.
    roster_day_keys: dict[int, set[tuple[int, int]]] = field(default_factory=dict)
    # player_id -> year -> the season-varying bio/eligibility fields, merged
    # across every raw view that year. Held per-year rather than flattened as
    # it's read: these genuinely change season to season, so a single
    # last-write-wins slot would make the result depend on which view normalize.py
    # happened to parse last. to_sorted_list() collapses this to career values.
    season_fields: dict[int, dict[int, dict[str, Any]]] = field(default_factory=dict)

    @classmethod
    def load(cls, overrides_path: Path) -> "PlayerRegistry":
        raw = json.loads(overrides_path.read_text())
        overrides = {
            o["player_id"]: o["canonical_player_id"] for o in raw.get("overrides", [])
        }
        return cls(overrides=overrides)

    @classmethod
    def with_retired(
        cls, overrides_path: Path, retired: dict[int, int]
    ) -> "PlayerRegistry":
        """load() plus the hand-maintained retirement cap (canonical player_id ->
        last active season). Kept separate from load() so callers who don't care about
        retirement don't have to know about it."""
        registry = cls.load(overrides_path)
        registry.retired = retired
        return registry

    def canonical_id(self, player_id: int) -> int:
        return self.overrides.get(player_id, player_id)

    def record(self, player_obj: dict[str, Any], year: int) -> int:
        """Registers a player's appearance in a given season; returns the
        canonical player_id to store on whatever record references it."""
        raw_id = player_obj["id"]
        player_id = self.canonical_id(raw_id)
        entry = self.players.setdefault(
            player_id,
            {
                "player_id": player_id,
                "full_name": player_obj.get("fullName", ""),
                "default_position_id": player_obj.get("defaultPositionId"),
                "seasons_seen": set(),
            },
        )
        entry["seasons_seen"].add(year)
        # Prefer the most recently seen full_name -- ESPN corrects typos/name
        # changes over time and later data is more likely to be right.
        if player_obj.get("fullName"):
            entry["full_name"] = player_obj["fullName"]
        if player_obj.get("defaultPositionId") is not None:
            entry["default_position_id"] = player_obj["defaultPositionId"]
        self._record_season_fields(player_id, year, player_obj)
        return player_id

    def _record_season_fields(
        self, player_id: int, year: int, player_obj: dict[str, Any]
    ) -> None:
        """Merges one raw player object into this player's record for `year`.
        Views carry different subsets -- box-score player objects have no
        active/jersey/droppable at all -- so every field merges independently
        and an absent one never clears what another view supplied."""
        season = self.season_fields.setdefault(player_id, {}).setdefault(year, {})

        slots = player_obj.get("eligibleSlots")
        if slots:
            season["eligible_slots"] = sorted(
                set(season.get("eligible_slots", ())) | set(slots)
            )

        games = player_obj.get("gamesPlayedByPosition")
        if games:
            merged = dict(season.get("games_played_by_position", {}))
            for position_id, count in games.items():
                # Views for the same season differ only by recency (a mid-season
                # snapshot vs. the season-final one) and these counts only ever
                # grow, so the larger value is the later one -- max() makes the
                # merge independent of which view normalize.py reads first.
                key = str(position_id)
                merged[key] = max(merged.get(key, 0), int(count))
            season["games_played_by_position"] = merged

        for raw_key, name in (
            ("proTeamId", "pro_team_id"),
            ("active", "active"),
            ("jersey", "jersey"),
            ("droppable", "droppable"),
            ("injuryStatus", "injury_status"),
            ("injured", "injured"),
            ("defaultPositionId", "default_position_id"),
        ):
            value = player_obj.get(raw_key)
            if value is not None:  # not truthiness: proTeamId 0 and False are real
                season[name] = value
        # `active`/`droppable` are deliberately career-only and
        # stop here -- everything else captured above that should also appear
        # per-season must be added to SEASON_ONLY_FIELDS
        # below, or to_player_seasons() will keep capturing it into season_fields
        # and then silently drop it from the emitted row (this bit us once with
        # pro_team_id).

        ownership = player_obj.get("ownership")
        if ownership:
            # Merge per key, never wholesale: mRoster's ownership object is a
            # strict SUBSET of kona_player_info's (it omits
            # averageDraftPositionPercentChange and auctionValueAverageChange),
            # so overwriting would drop those two for every rostered player.
            # Where both views carry a key they were verified to agree exactly
            # (percentOwned across all shared players, 2019 and 2024), so which
            # view lands last doesn't change the result.
            incoming = _player_ownership(ownership)
            # Baseline of every key so the emitted object always matches
            # _player_ownership()'s key set, even for a player only ever seen via the
            # subset-carrying mRoster view.
            merged = season.get("ownership") or dict.fromkeys(incoming)
            for name, value in incoming.items():
                if value is not None:
                    merged[name] = value
            season["ownership"] = merged

    def record_roster_day(
        self, raw_player_id: int, year: int, scoring_period: int
    ) -> None:
        """Counts a distinct rostered day without registering the player --
        players.json membership still requires an active day via record(), so
        a season spent entirely rostered-but-inactive keeps leaving no trace."""
        player_id = self.canonical_id(raw_player_id)
        self.roster_day_keys.setdefault(player_id, set()).add((year, scoring_period))

    def record_fantasy_team(
        self, raw_player_id: int, year: int, fantasy_team_id: int | None
    ) -> None:
        """Records the current ESPN fantasy team id (kona onTeamId) for a player
        in a season. 0 is stored as None, since it means free agent."""
        if fantasy_team_id is None or fantasy_team_id == 0:
            return
        player_id = self.canonical_id(raw_player_id)
        season = self.season_fields.setdefault(player_id, {}).setdefault(year, {})
        season["fantasy_team_id"] = fantasy_team_id

    def _career_fields(self, player_id: int) -> dict[str, Any]:
        """Collapses season_fields into the career-level players.json shape:
        eligibility unioned, games summed, bio latest-season-wins. The four bio
        fields (active/pro_team_id/jersey/droppable) describe the player as of
        the most recent season they appear in -- pro_team_id in particular is
        NOT the team they played for in any given past year (for that, use the
        per-year pro_team_id on DraftPick/Keeper; a cross-year merge would be
        wrong). Respects retirement caps so retired players don't inherit
        post-retirement free-agent bio fields from the latest kona player pool."""
        by_year = self.season_fields.get(player_id, {})
        last_active = self.retired.get(player_id)
        slots: set[int] = set()
        games: dict[str, int] = {}
        latest: dict[str, Any] = {}
        for year in sorted(
            by_year
        ):  # ascending, so the last write is the latest season
            if last_active is not None and year > last_active:
                continue
            season = by_year[year]
            slots.update(season.get("eligible_slots", ()))
            for position_id, count in season.get(
                "games_played_by_position", {}
            ).items():
                games[position_id] = games.get(position_id, 0) + count
            for name in ("pro_team_id", "active", "jersey", "droppable"):
                if season.get(name) is not None:
                    latest[name] = season[name]
        return {
            "eligible_slots": sorted(slots),
            "games_played_by_position": dict(
                sorted(games.items(), key=lambda kv: int(kv[0]))
            ),
            "active": latest.get("active"),
            "pro_team_id": latest.get("pro_team_id"),
            "jersey": latest.get("jersey"),
            "droppable": latest.get("droppable"),
        }

    def to_player_seasons(self) -> list[dict[str, Any]]:
        """One row per (player, season) the registry saw -- player_seasons.json.
        Emitted from the same season_fields store that to_sorted_list()
        rolls up, so players.json's career aggregates and player_seasons.json can
        never disagree -- validate.py's player_season_rollup asserts exactly that.

        Field semantics worth keeping: `jersey` is a string, not an int (ESPN
        serves it that way and some are not plain integers), absent entirely
        before 2017 so None means "not reported", never "no number";
        `injury_status` is the status as of ESPN's last update to that season's
        player data (roughly season-end) -- NOT "was injured during this
        season" -- and is None before 2017, where ESPN's payload carries no
        injuryStatus at all (absent and healthy must stay distinguishable).
        """
        latest_year = max(
            (year for by_year in self.season_fields.values() for year in by_year),
            default=None,
        )
        rows = []
        for player_id, by_year in self.season_fields.items():
            player = self.players.get(player_id)
            last_active = self.retired.get(player_id)
            for year, season in by_year.items():
                if last_active is not None and year > last_active:
                    continue
                row = {
                    "year": year,
                    "player_id": player_id,
                    "player_name": player["full_name"] if player else "",
                    "eligible_slots": season.get("eligible_slots", []),
                    "games_played_by_position": season.get(
                        "games_played_by_position", {}
                    ),
                }
                for name in SEASON_ONLY_FIELDS:
                    if name == "fantasy_team_id" and year != latest_year:
                        continue
                    row[name] = season.get(name)
                rows.append(row)
        return sorted(rows, key=lambda r: (r["year"], r["player_id"]))

    def to_season_ownership(self, latest_year: int) -> list[dict[str, Any]]:
        """One row per (player, latest_year) that has ownership data. Latest
        season only — historical ownership is never used by the app."""
        rows = []
        for player_id, by_year in self.season_fields.items():
            season = by_year.get(latest_year)
            if not season:
                continue
            ownership = season.get("ownership")
            if ownership is None:
                continue
            player = self.players.get(player_id)
            rows.append(
                {
                    "year": latest_year,
                    "player_id": player_id,
                    "player_name": player["full_name"] if player else "",
                    **ownership,
                }
            )
        return sorted(rows, key=lambda r: r["player_id"])

    def to_sorted_list(
        self,
        *,
        prune_ghosts: bool = False,
        drafted_ids: set[int] | None = None,
        scored_ids: set[int] | None = None,
    ) -> list[dict[str, Any]]:
        """One row per player in the registry -- players.json.

        When prune_ghosts=True, removes players who were never in a box score
        (empty games_played_by_position), never spent a day on anyone's roster
        in the 2019+ era (roster_days == 0), were never drafted, and never
        scored fantasy points. These are ESPN player-pool snapshots that never
        touched the league.

        Field order mirrors the app's expected players.json shape.
        """
        out = []
        for entry in self.players.values():
            player_id = entry["player_id"]
            career = self._career_fields(player_id)
            last_active = self.retired.get(player_id)
            roster_days = len(self.roster_day_keys.get(player_id, ()))

            if prune_ghosts:
                has_box_scores = bool(career["games_played_by_position"])
                has_roster_days = roster_days > 0
                was_drafted = drafted_ids is not None and player_id in drafted_ids
                scored_points = scored_ids is not None and player_id in scored_ids

                is_ghost = not (
                    has_box_scores or has_roster_days or was_drafted or scored_points
                )
                if is_ghost:
                    continue

            out.append(
                {
                    "player_id": player_id,
                    "full_name": entry["full_name"],
                    "default_position_id": entry["default_position_id"],
                    "eligible_slots": career["eligible_slots"],
                    "games_played_by_position": career["games_played_by_position"],
                    "active": career["active"],
                    "pro_team_id": career["pro_team_id"],
                    "jersey": career["jersey"],
                    "droppable": career["droppable"],
                    "seasons_seen": sorted(
                        y
                        for y in entry["seasons_seen"]
                        if last_active is None or y <= last_active
                    ),
                    "roster_days": roster_days,
                }
            )
        return sorted(out, key=lambda p: p["player_id"])
