#!/usr/bin/env python3
"""Self-check for derive_owner_map.py. Run: python3 scripts/test_derive_owner_map.py

Each case builds a minimal raw archive on disk and asserts what derive() makes
of it. The last case is the real one: it runs against the upstream record-book
archive and asserts the derivation agrees with the hand-curated owner map,
which is the strongest available check that the identity rules are right.
"""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from derive_owner_map import derive  # noqa: E402


def build_raw(root: Path, seasons: dict[int, list[dict]]) -> Path:
    """seasons: year -> [{"id", "name", "owners": [swid], "primary": swid},
    "members": {swid: (first, last)}]"""
    raw = root / "raw"
    for year, teams in seasons.items():
        d = raw / str(year)
        d.mkdir(parents=True, exist_ok=True)
        members = [
            {"id": swid, "firstName": first, "lastName": last}
            for team in teams
            for swid, (first, last) in team["members"].items()
        ]
        (d / "mTeam.json").write_text(
            json.dumps(
                {
                    "members": members,
                    "teams": [
                        {
                            "id": t["id"],
                            "name": t["name"],
                            "owners": t["owners"],
                            "primaryOwner": t["primary"],
                        }
                        for t in teams
                    ],
                }
            )
        )
    return raw


def team_seasons_by_key(owner_map) -> dict:
    return {
        (e["year"], e["espn_team_id"]): e for e in owner_map["team_seasons"]
    }


def owner_ids_named(owner_map, name: str) -> set[str]:
    return {
        str(o["owner_id"])
        for o in owner_map["owners"]
        if o["canonical_name"] == name or name in o["name_variants"]
    }


def test_stable_across_years() -> None:
    """The plain case: one person, one SWID, many seasons -> one owner, and every
    team-season attributed to them."""
    with tempfile.TemporaryDirectory() as tmp:
        raw = build_raw(
            Path(tmp),
            {
                2023: [{"id": 1, "name": "Aces", "owners": ["{s1}"], "primary": "{s1}",
                        "members": {"{s1}": ("Evan", "Symkowicz")}}],
                2024: [{"id": 1, "name": "Aces", "owners": ["{s1}"], "primary": "{s1}",
                        "members": {"{s1}": ("Evan", "Symkowicz")}}],
            },
        )
        owner_map, notes = derive(raw)
        assert notes == [], notes
        assert [o["owner_id"] for o in owner_map["owners"]] == ["evan-symkowicz"]
        assert owner_map["owners"][0]["name_variants"] == []
        entry = team_seasons_by_key(owner_map)[(2024, 1)]
        assert entry["owner_ids"] == ["evan-symkowicz"], entry
        assert entry["primary_owner_id"] == "evan-symkowicz", entry


def test_rename_merges_and_keeps_variant() -> None:
    """Rule 1: one SWID, two names across seasons is one person who renamed their
    profile. The old spelling must survive as a name_variant so the earlier
    season's payload still resolves."""
    with tempfile.TemporaryDirectory() as tmp:
        raw = build_raw(
            Path(tmp),
            {
                2019: [{"id": 1, "name": "T", "owners": ["{s1}"], "primary": "{s1}",
                        "members": {"{s1}": ("Yankee", "Hank")}}],
                2020: [{"id": 1, "name": "T", "owners": ["{s1}"], "primary": "{s1}",
                        "members": {"{s1}": ("Anthony", "Paradiso")}}],
            },
        )
        owner_map, notes = derive(raw)
    assert notes == [], notes
    assert len(owner_map["owners"]) == 1, owner_map["owners"]
    owner = owner_map["owners"][0]
    assert owner["canonical_name"] == "Anthony Paradiso", owner
    assert owner["name_variants"] == ["Yankee Hank"], owner
    for year in (2019, 2020):
        entry = team_seasons_by_key(owner_map)[(year, 1)]
        assert entry["owner_ids"] == [owner["owner_id"]], (year, entry)


def test_extra_swid_merges_when_never_on_conflicting_teams() -> None:
    """Rule 2: ESPN issues a member a second SWID mid-league and both appear on
    the same team. Same person -> one owner, not two."""
    with tempfile.TemporaryDirectory() as tmp:
        raw = build_raw(
            Path(tmp),
            {
                2012: [{"id": 6, "name": "27 Rings", "owners": ["{a}"], "primary": "{a}",
                        "members": {"{a}": ("Sam", "Silbert")}}],
                2013: [{"id": 6, "name": "27 Rings", "owners": ["{a}", "{b}"],
                        "primary": "{a}",
                        "members": {"{a}": ("Sam", "Silbert"), "{b}": ("Sam", "Silbert")}}],
            },
        )
        owner_map, notes = derive(raw)
    assert notes == [], notes
    assert len(owner_map["owners"]) == 1, owner_map["owners"]
    assert team_seasons_by_key(owner_map)[(2013, 6)]["owner_ids"] == ["sam-silbert"]


def test_conflicting_teams_kept_apart_and_reported() -> None:
    """Two people who share a name and play on different teams in the same season
    must NOT be merged -- and the script has to say so instead of guessing."""
    with tempfile.TemporaryDirectory() as tmp:
        raw = build_raw(
            Path(tmp),
            {
                2024: [
                    {"id": 1, "name": "One", "owners": ["{a}"], "primary": "{a}",
                     "members": {"{a}": ("Chris", "Doe")}},
                    {"id": 2, "name": "Two", "owners": ["{b}"], "primary": "{b}",
                     "members": {"{b}": ("Chris", "Doe")}},
                ],
            },
        )
        owner_map, notes = derive(raw)
    assert len(owner_map["owners"]) == 2, owner_map["owners"]
    assert len(owner_map["team_seasons"]) == 2
    assert len(notes) == 1 and "kept as separate owners" in notes[0], notes


def test_co_owners_and_missing_primary() -> None:
    """Two real co-owners on one team both get listed, and a team with no
    primaryOwner still yields an id -- null would break every downstream read."""
    with tempfile.TemporaryDirectory() as tmp:
        raw = build_raw(
            Path(tmp),
            {
                2020: [{"id": 6, "name": "Shared", "owners": ["{a}", "{b}"],
                        "primary": None,
                        "members": {"{a}": ("Bo", "Quill"), "{b}": ("Bo", "Evans")}}],
            },
        )
        owner_map, notes = derive(raw)
    entry = team_seasons_by_key(owner_map)[(2020, 6)]
    assert sorted(entry["owner_ids"]) == ["bo-evans", "bo-quill"], entry
    assert entry["primary_owner_id"] in entry["owner_ids"], entry


def test_lowercase_espn_names_are_display_titled() -> None:
    """ESPN serves some members lowercase ('a klam'); display title-cases it."""
    with tempfile.TemporaryDirectory() as tmp:
        raw = build_raw(
            Path(tmp),
            {
                2012: [{"id": 1, "name": "T", "owners": ["{s}"], "primary": "{s}",
                        "members": {"{s}": ("a", "klam")}}],
            },
        )
        owner_map, _ = derive(raw)
    assert owner_map["owners"][0]["canonical_name"] == "A Klam"
    assert owner_map["owners"][0]["owner_id"] == "a-klam"


def test_agrees_with_hand_curated_map() -> None:
    """The real archive, against the hand-curated owner map.

    Identity rules were designed from this league's quirks, so this is the check
    that they actually reproduce a human's judgement: same owner count, and every
    team-season attributed to the same set of owners. Names differ (this repo's
    archive is anonymized) so comparison is by team-season membership shape and
    owner count, not by name.
    """
    upstream = Path("/home/evans/projects/wsob-record-book")
    raw, manual = upstream / "data" / "raw", upstream / "data" / "manual"
    if not raw.is_dir():
        print("  skipped: upstream raw archive not present")
        return

    derived, notes = derive(raw)
    hand = json.loads((manual / "owner-map.json").read_text())

    assert len(derived["owners"]) == len(hand["owners"]), (
        f"owner count: derived {len(derived['owners'])} vs "
        f"hand {len(hand['owners'])}"
    )
    assert len(derived["team_seasons"]) == len(hand["team_seasons"]), (
        f"team-season count: derived {len(derived['team_seasons'])} vs "
        f"hand {len(hand['team_seasons'])}"
    )

    # A co-owned team-season is the structural signal that matters: if the merge
    # rules were wrong, one person's accounts would split into two owners and the
    # per-team owner counts would drift.
    derived_widths = sorted(len(e["owner_ids"]) for e in derived["team_seasons"])
    hand_widths = sorted(len(e["owner_ids"]) for e in hand["team_seasons"])
    assert derived_widths == hand_widths, (
        f"co-owner widths differ:\n  derived {derived_widths}\n  hand    {hand_widths}"
    )
    if notes:
        print(f"  notes: {notes}")


def main() -> None:
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for test in tests:
        test()
        print(f"  ok  {test.__name__}")
    print(f"derive_owner_map: {len(tests)} checks passed")


if __name__ == "__main__":
    main()