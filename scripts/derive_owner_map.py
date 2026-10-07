#!/usr/bin/env python3
"""Derives an owner map for an arbitrary league from ESPN's own member records.

owner-map.json was hand-curated for one league, so a different league resolved
zero owners and normalize.py refused to guess an attribution. But ESPN carries
enough identity in mTeam.json to derive it:

  - teams[].owners[] lists the member SWIDs on a team, teams[].primaryOwner the
    one ESPN treats as primary.
  - members[] maps each SWID to that season's firstName/lastName.

Neither signal is a stable key on its own, so both are unioned:

  1. Same SWID, different name  -> same person. People rename their ESPN
     profile ("yankee hank" -> "anthony paradiso" between 2019 and 2020).
  2. Same name, two SWIDs, never on conflicting teams -> same person. ESPN
     sometimes issues a member a second SWID mid-league and both then appear
     on the same team. Two *different* people sharing a name is the case this
     could get wrong, so a same-year/different-team collision blocks the merge
     and is reported rather than guessed.

The earliest-seen spelling of each name is kept as a `name_variants` entry so
the name index still resolves an older season's payload, which carries it.

Writes a complete, league-neutral manual directory: the owner map plus empty
stubs for every other hand-maintained file, all of which encode league-specific
facts. Deterministic: same raw archive in, byte-identical directory out.

Usage:
    python3 scripts/derive_owner_map.py --raw-dir data/tenants/<id>/raw \\
                                        --out-dir data/tenants/<id>/manual
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from lib.espn_client import unwrap_league_object  # type: ignore[import-not-found]  # noqa: E402

# Every hand-maintained file the pipeline reads. All of them encode league-
# specific facts (this league's retired owners, its MLB jersey corrections, its
# per-season draft-pick counts), so a tenant's manual dir must carry the key
# with an empty value rather than inheriting the record-book league's answers.
STUBS: dict[str, dict[str, object]] = {
    "season-notes.json": {
        "seasons": {},
        "unresolvable_draft_picks": {"player_ids": []},
        "keeper_validation_exceptions": {},
    },
    "retired-owners.json": {"retired_owner_ids": []},
    "retired-players.json": {"retired_players": {}},
    "player-overrides.json": {"overrides": []},
    "pro-team-overrides.json": {"overrides": []},
    "jersey-history-overrides.json": {"overrides": []},
    "position-overrides.json": {"overrides": []},
}

# The three files the *app* reads through the data proxy rather than through
# normalize.py: app/lib/collections.ts allowlists retired-owners.json,
# jersey-history-overrides.json and position-overrides.json, but all three live
# in data/manual/, not data/processed/. The crawl publishes them next to the
# processed output so the proxy can serve them.
PROXY_SERVED_MANUAL_FILES = (
    "retired-owners.json",
    "jersey-history-overrides.json",
    "position-overrides.json",
)


class _Union:
    """Minimal union-find. Two merge rules only, so this is ~12 lines."""

    def __init__(self) -> None:
        self.parent: dict[str, str] = {}

    def find(self, key: str) -> str:
        self.parent.setdefault(key, key)
        while self.parent[key] != key:
            self.parent[key] = self.parent[self.parent[key]]
            key = self.parent[key]
        return key

    def union(self, a: str, b: str) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return
        # Deterministic tie-break: lexicographic, so the representative never
        # depends on dict insertion order.
        lo, hi = sorted((ra, rb))
        self.parent[hi] = lo


def _slug(name: str) -> str:
    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", ascii_name.lower()).strip("-")


def _display(first: str, last: str) -> str:
    """Title-cases ESPN's lowercase member names ('a klam' -> 'A Klam'). Name
    resolution is case-insensitive, so this is display-only."""
    parts = [p for p in (first.strip(), last.strip()) if p]
    return " ".join(p if p[:1].isupper() else p[:1].upper() + p[1:] for p in parts)


def _observations(raw_dir: Path) -> list[tuple[int, int, str, str, bool]]:
    """(year, espn_team_id, swid, display_name, is_primary) per owner appearance,
    oldest season first. Written to a flat file so derive() can stay a pure
    function of it."""
    rows: list[tuple[int, int, str, str, bool]] = []
    for year_dir in sorted(raw_dir.iterdir()):
        if not (year_dir.is_dir() and year_dir.name.isdigit()):
            continue
        path = year_dir / "mTeam.json"
        if not path.exists():
            continue
        payload = unwrap_league_object(json.loads(path.read_text()))
        members = {
            m["id"]: m for m in payload.get("members", []) if isinstance(m.get("id"), str)
        }
        for team in payload.get("teams", []):
            primary = team.get("primaryOwner")
            for swid in team.get("owners", []):
                member = members.get(swid)
                if member is None:
                    continue
                name = _display(member.get("firstName", ""), member.get("lastName", ""))
                if name:
                    rows.append(
                        (int(year_dir.name), team["id"], swid, name, swid == primary)
                    )
    return rows


def _team_names(raw_dir: Path) -> dict[tuple[int, int], str]:
    """(year, espn_team_id) -> team name. validate.py's independent owner
    re-derivation reads team_name off every team_seasons entry, so the generated
    map has to carry it even though normalize.py itself only uses ESPN's own
    teams[].name."""
    names: dict[tuple[int, int], str] = {}
    for year_dir in sorted(raw_dir.iterdir()):
        if not (year_dir.is_dir() and year_dir.name.isdigit()):
            continue
        path = year_dir / "mTeam.json"
        if not path.exists():
            continue
        payload = unwrap_league_object(json.loads(path.read_text()))
        for team in payload.get("teams", []):
            if isinstance(team.get("name"), str):
                names[(int(year_dir.name), team["id"])] = team["name"]
    return names


def derive(raw_dir: Path) -> tuple[dict[str, object], list[str]]:
    rows = _observations(raw_dir)
    if not rows:
        raise SystemExit(f"derive_owner_map: no team owners found under {raw_dir}")
    team_names = _team_names(raw_dir)

    union = _Union()
    for _year, _team_id, swid, _name, _primary in rows:
        union.find(f"swid:{swid}")

    swids_by_name: dict[str, set[str]] = defaultdict(set)
    teams_by_swid: dict[str, dict[int, set[int]]] = defaultdict(lambda: defaultdict(set))
    for year, team_id, swid, name, _primary in rows:
        swids_by_name[name].add(swid)
        teams_by_swid[swid][year].add(team_id)

    notes: list[str] = []
    for name, swids in swids_by_name.items():
        if len(swids) < 2:
            continue
        by_year: dict[int, set[int]] = defaultdict(set)
        for swid in swids:
            for year, teams in teams_by_swid[swid].items():
                by_year[year] |= teams
        conflicts = sorted(y for y, teams in by_year.items() if len(teams) > 1)
        if conflicts:
            # Same name, two accounts, but on different teams in the same season:
            # two distinct people. Don't merge, and say so rather than guess.
            notes.append(
                f"{name!r} uses {len(swids)} ESPN accounts but appears on different "
                f"teams in {conflicts}; kept as separate owners"
            )
            continue
        ordered = sorted(swids)
        for swid in ordered[1:]:
            union.union(f"swid:{ordered[0]}", f"swid:{swid}")

    # Cluster -> owner_id. Canonical name is the latest season's spelling (ESPN
    # corrects names over time); earlier spellings become name_variants so they
    # still resolve in their own season's payload.
    # name -> the latest season it was seen in. Keying by name (not (year, name))
    # matters: a name that simply persists for 18 seasons must not become 17
    # phantom name_variants.
    names_by_cluster: dict[str, dict[str, int]] = defaultdict(dict)
    for year, _team_id, swid, name, _primary in rows:
        cluster = names_by_cluster[union.find(f"swid:{swid}")]
        cluster[name] = max(cluster.get(name, year), year)

    owners: list[dict[str, object]] = []
    cluster_to_owner: dict[str, str] = {}
    taken: set[str] = set()
    for cluster, seen in names_by_cluster.items():
        # Latest season first; the newest spelling is canonical, the rest are
        # variants. Alphabetical tie-break keeps output deterministic.
        ordered = sorted(seen.items(), key=lambda kv: (-kv[1], kv[0]))
        canonical = ordered[0][0]
        base = _slug(canonical) or "owner"
        owner_id, suffix = base, 1
        while owner_id in taken:
            suffix += 1
            owner_id = f"{base}-{suffix}"
        taken.add(owner_id)
        cluster_to_owner[cluster] = owner_id
        owners.append(
            {
                "owner_id": owner_id,
                "canonical_name": canonical,
                "name_variants": [n for n, _year in ordered[1:]],
            }
        )
    owners.sort(key=lambda o: str(o["owner_id"]))

    team_seasons: dict[tuple[int, int], dict[str, object]] = {}
    for year, team_id, swid, _name, is_primary in rows:
        entry = team_seasons.setdefault(
            (year, team_id), {"owner_ids": [], "primary_owner_id": None}
        )
        owner_id = cluster_to_owner[union.find(f"swid:{swid}")]
        if owner_id not in entry["owner_ids"]:  # type: ignore[operator]
            entry["owner_ids"].append(owner_id)  # type: ignore[union-attr]
        if is_primary:
            entry["primary_owner_id"] = owner_id

    seasons = []
    for key in sorted(team_seasons):
        entry = team_seasons[key]
        entry["year"], entry["espn_team_id"] = key
        entry["team_name"] = team_names.get(key)
        # Sorted, matching mapping.derive_owner_ids_from_raw -- validate.py's
        # independent re-derivation sorts, so an ESPN-order list here would read
        # as drift on every co-owned team-season.
        entry["owner_ids"] = sorted(entry["owner_ids"])  # type: ignore[arg-type]
        # ESPN leaves primaryOwner null for a team nobody manages. Downstream
        # consumers (matchups, draft, keepers) all read primary_owner_id, so fall
        # back to the first owner rather than emit null.
        if entry["primary_owner_id"] is None:
            entry["primary_owner_id"] = entry["owner_ids"][0]  # type: ignore[index]
        seasons.append(entry)

    return (
        {
            "_readme": (
                "Derived by scripts/derive_owner_map.py from this league's own ESPN "
                "member records -- not hand-edited. Regenerate rather than edit: "
                "identities come from members[] joined to teams[].owners[], unioned "
                "across SWID changes and same-name account changes."
            ),
            "owners": owners,
            "team_seasons": seasons,
        },
        notes,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw-dir", required=True)
    parser.add_argument("--out-dir", required=True)
    args = parser.parse_args()

    owner_map, notes = derive(Path(args.raw_dir).resolve())
    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    for filename, stub in STUBS.items():
        (out_dir / filename).write_text(json.dumps(stub, indent=2) + "\n")
    (out_dir / "owner-map.json").write_text(json.dumps(owner_map, indent=2) + "\n")

    print(
        f"derive_owner_map: {len(owner_map['owners'])} owners, "
        f"{len(owner_map['team_seasons'])} team-seasons -> {out_dir}"
    )
    for note in notes:
        print(f"  note: {note}")


if __name__ == "__main__":
    main()