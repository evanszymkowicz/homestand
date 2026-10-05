"""Name -> MLB Stats API personId resolution for this project's own player_id space.

No MLB-person-ID field exists anywhere in data/processed/ -- players.json/player_seasons.json
only carry ESPN's own player_id (see context/features/phase-8-jersey-trade-detection-spec.md).
This resolves by name search, deferring to data/manual/mlb-player-id-overrides.json whenever
automatic disambiguation can't land on exactly one confident match. Never guesses: a player who
can't be resolved automatically or via override is skipped and reported, not silently mismatched.
"""

import json
from pathlib import Path
from typing import Any

from .mlb_stats_client import search_people


def load_overrides(path: Path) -> dict[int, int]:
    """our player_id -> mlb_person_id, from data/manual/mlb-player-id-overrides.json."""
    raw = json.loads(path.read_text())
    return {o["player_id"]: o["mlb_person_id"] for o in raw.get("overrides", [])}


def load_cache(path: Path) -> dict[int, int]:
    """player_id -> mlb_person_id, previously confirmed live-search resolutions.

    Missing file (no confirmed resolutions banked yet) means an empty cache --
    never an error. Human entries always win: the overrides file is consulted
    first in resolve_person_id, so a stale cache entry can never shadow one."""
    if not path.exists():
        return {}
    raw = json.loads(path.read_text())
    return {int(pid): mid for pid, mid in raw.get("resolved", {}).items()}


def resolve_person_id(
    player_id: int,
    player_name: str,
    overrides: dict[int, int],
    cache: dict[int, int] | None = None,
) -> tuple[int | None, str]:
    """(mlb_person_id or None, reason). reason is "override", "cache",
    "unique_match", "unique_active_match", or "unresolved: <why>" -- callers log
    unresolved players so a human can add an override entry rather than the
    script guessing."""
    if player_id in overrides:
        return overrides[player_id], "override"
    if cache is not None and player_id in cache:
        return cache[player_id], "cache"

    matches = search_people(player_name)
    if not matches:
        return None, "unresolved: no name-search matches"
    if len(matches) == 1:
        return matches[0]["id"], "unique_match"

    active = [m for m in matches if m.get("active")]
    if len(active) == 1:
        return active[0]["id"], "unique_active_match"

    candidate_ids = [m["id"] for m in matches]
    return (
        None,
        f"unresolved: {len(matches)} name matches, {len(active)} active ({candidate_ids})",
    )


def resolve_pool(
    players: list[dict[str, Any]],
    overrides_path: Path,
    cache: dict[int, int] | None = None,
) -> tuple[dict[int, int], list[dict[str, Any]], dict[int, int], int]:
    """players: [{"player_id": ..., "player_name": ...}, ...] for the current season's pool.
    Returns (player_id -> mlb_person_id, [unresolved player dicts with a "reason"
    key], newly_resolved, cache_hits). newly_resolved holds only live-search
    resolutions ("unique_match" / "unique_active_match") -- confirmed facts safe
    to persist to the cache; override and cache hits are already pinned
    elsewhere and are never re-banked."""
    overrides = load_overrides(overrides_path)
    cache = cache if cache is not None else {}
    resolved: dict[int, int] = {}
    unresolved: list[dict[str, Any]] = []
    newly_resolved: dict[int, int] = {}
    cache_hits = 0
    for p in players:
        person_id, reason = resolve_person_id(
            p["player_id"], p["player_name"], overrides, cache
        )
        if person_id is not None:
            resolved[p["player_id"]] = person_id
            if reason == "cache":
                cache_hits += 1
            elif reason in ("unique_match", "unique_active_match"):
                newly_resolved[p["player_id"]] = person_id
        else:
            unresolved.append({**p, "reason": reason})
    return resolved, unresolved, newly_resolved, cache_hits
