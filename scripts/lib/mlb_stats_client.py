"""MLB Stats API client — real-life team/jersey lookups for the trade-detection job.

Public, unauthenticated API (no cookies/config.json involved, unlike espn_client.py).
  - GET /v1/people/search?names={name} -> {"people": [{"id", "fullName", "currentTeam",
    "active", ...}]}. Undocumented in the MCP mlb-stats server's endpoint list but real
    (confirmed via direct curl).
  - GET /v1/people/{personId}?hydrate=transactions -> "TR" (fromTeam/toTeam + date) and
    "NUM" ("changed number to N.") entries -- the only source for a *past* stint's team/
    jersey this season (kona_player_info.json only ever has "right now").
  - GET /v1/people/{personId}/stats?stats=season&group=hitting,pitching&season=Y -> a
    per-team split row (with gamesPlayed) for each team the player actually appeared in a
    real game for -- distinguishes that from a paper-only trade the transaction log alone
    can't (see get_season_teams_with_games).
Team names match scripts/lib/mlb_teams.py's MLB_TEAMS strings exactly -- no separate
statsapi-teamId crosswalk needed.
"""

import time
from typing import Any

import requests

BASE_URL = "https://statsapi.mlb.com/api/v1"
REQUEST_DELAY_SECONDS = 0.5
MAX_RETRIES = 2


def _get(path: str, params: dict[str, Any]) -> dict[str, Any] | None:
    """GET with the same retry-on-429/5xx shape as espn_client.py's request_view,
    minus auth handling — this API takes no cookies/headers."""
    attempt = 0
    while True:
        try:
            response = requests.get(f"{BASE_URL}{path}", params=params, timeout=30)
        except requests.RequestException:
            return None

        if response.status_code == 429 or response.status_code >= 500:
            if attempt >= MAX_RETRIES:
                return None
            attempt += 1
            time.sleep(REQUEST_DELAY_SECONDS * (2**attempt))
            continue

        if response.status_code != 200:
            return None
        return response.json()


def search_people(name: str) -> list[dict[str, Any]]:
    """Name search -> raw `people` list (0, 1, or several matches — common names like
    common names return multiple real players; caller resolves ambiguity)."""
    time.sleep(REQUEST_DELAY_SECONDS)
    payload = _get("/people/search", {"names": name})
    if not payload:
        return []
    return payload.get("people", [])


def get_season_teams_with_games(person_id: int, year: int) -> set[str]:
    """Team names this person actually recorded a real game in during `year` (season-type
    hitting+pitching stat splits, gamesPlayed > 0) -- unlike the transaction log, a team a
    player was traded to/from on paper (e.g. a spring-training DFA) but never played a game
    for doesn't appear here. Ground truth for filtering paper-only stints out of
    build_season_stints's trade-derived team list."""
    time.sleep(REQUEST_DELAY_SECONDS)
    payload = _get(
        f"/people/{person_id}/stats",
        {"stats": "season", "group": "hitting,pitching", "season": year},
    )
    if not payload:
        return set()
    teams = set()
    for block in payload.get("stats", []):
        for split in block.get("splits", []):
            team = split.get("team", {}).get("name")
            if team and split.get("stat", {}).get("gamesPlayed", 0) > 0:
                teams.add(team)
    return teams


def get_season_transactions(person_id: int, year: int) -> list[dict[str, Any]]:
    """This person's Trade ("TR") and Number Change ("NUM") transactions dated within
    `year`, chronological. These two types are all detect_real_trades.py needs to
    reconstruct a season's real team/jersey stints -- every other typeCode (Assigned,
    Status Change, Selected, ...) is minor-league/roster-status noise for this purpose."""
    time.sleep(REQUEST_DELAY_SECONDS)
    payload = _get(f"/people/{person_id}", {"hydrate": "transactions"})
    if not payload:
        return []
    people = payload.get("people") or []
    if not people:
        return []
    txns = people[0].get("transactions") or []
    relevant = [
        t
        for t in txns
        if t.get("typeCode") in ("TR", "NUM")
        and str(t.get("date", "")).startswith(str(year))
    ]
    relevant.sort(key=lambda t: t.get("date", ""))
    return relevant
