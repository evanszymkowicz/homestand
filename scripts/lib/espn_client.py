"""ESPN Fantasy Baseball API client — shared HTTP/auth/fallback logic.

Promoted from scripts/audit.py's probe-quality implementation (Phase 0) into a reusable
module for scripts/extract.py (Phase 1). Game key is "flb" (baseball); most examples found
online use "ffl" (football).
"""

import json
import re
import time
from pathlib import Path
from typing import Any

import requests

GAME_KEY = "flb"
BASE_URL = "https://lm-api-reads.fantasy.espn.com/apis/v3/games"
VIEWS = [
    "mSettings",
    "mTeam",
    "mStandings",
    "mMatchup",
    "mMatchupScore",
    "mDraftDetail",
    "mRoster",
    "kona_player_info",
]
MODERN_ERA_START_YEAR = 2018
# ESPN purged (or never serves) per-period transaction ledgers before 2019 —
# both endpoint eras return a stub. Verified in the Phase 0 probe (data/audit/).
TRANSACTION_ERA_START_YEAR = 2019
# 2018's mBoxscore responses carry no player detail; that season's player-level data is
# served only via per-period leagueHistory mRoster (probed 2026-07-16 — see
# context/research/data-audit-findings.md). Note: those responses always carry the
# season-end roster; only the per-day stat window varies with scoringPeriodId.
ROSTER_PERIOD_HARVEST_YEARS = (2018,)
# First season the daily job (scripts/sync_live_scoreboard.py) captures a
# pending trade's mTransactions2 proposal before ESPN purges it on execution
# -- see the Phase 8 trade-capture spec. Trades executed before this year can
# only resolve trades.json's player exchange when the proposal happened to
# survive purging on its own (rare -- 2 of 12 executed 2019-2025 trades).
TRADE_CAPTURE_START_YEAR = 2026
# ESPN's "Fantasy Achievements" trophies era (launched 2026-02-04, probed
# 2026-09-01 -- endpoint traps and the no-backfill rule live in
# skills/espn-extraction/SKILL.md and the espn-trophies-activity-tray spec).
ACHIEVEMENTS_ERA_START_YEAR = 2026
REQUEST_DELAY_SECONDS = 0.75
MAX_RETRIES = 2

# Pattern for any of the credential forms that must never reach logs, error
# messages, or stdout: SWIDs (the bare cookie value) and espn_s2 (the other
# cookie). Both can appear inside request URLs, response headers, network-level
# exception strings, or MappingError messages.
SWID_PATTERN = re.compile(
    r"\{[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\}"
)
ESPN_S2_HINT = re.compile(r"espn_s2=[^&\s\"]+")


def redact_swid(text: str) -> str:
    """Replace every SWID-shaped GUID and espn_s2 cookie in `text` with a
    fixed-length placeholder. Used by callers (extract.py's print path,
    request_view's exception note, MappingError messages) so credentials
    never leak to stdout/stderr even when the upstream library stringifies
    a RequestException with the URL inline."""
    if not text:
        return text
    text = SWID_PATTERN.sub("<member-swid>", text)
    text = ESPN_S2_HINT.sub("espn_s2=<redacted>", text)
    return text


class ConfigError(SystemExit):
    """A missing/invalid config.json — raised as SystemExit for a loud, clear exit."""


def load_config(config_path: Path) -> dict[str, Any]:
    if not config_path.exists():
        raise ConfigError(
            f"{config_path} not found. Copy config.json.example to config.json "
            "and fill in league_id/espn_s2/swid/year_start/year_end."
        )
    config = json.loads(config_path.read_text())
    required = ["league_id", "espn_s2", "swid", "year_start", "year_end"]
    missing = [key for key in required if not config.get(key)]
    if missing:
        raise ConfigError(f"{config_path} is missing values for: {', '.join(missing)}")
    swid = config["swid"]
    if not (swid.startswith("{") and swid.endswith("}")):
        raise ConfigError(
            "config.json's swid must include its curly braces, e.g. "
            "{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX} — got a value missing them."
        )
    return config


def build_url(
    year: int,
    view: str,
    league_id: int,
    scoring_period: int | None = None,
    legacy: bool | None = None,
) -> str:
    if legacy is None:
        legacy = year < MODERN_ERA_START_YEAR
    if not legacy:
        url = (
            f"{BASE_URL}/{GAME_KEY}/seasons/{year}/segments/0/leagues/"
            f"{league_id}?view={view}"
        )
    else:
        url = f"{BASE_URL}/{GAME_KEY}/leagueHistory/{league_id}?seasonId={year}&view={view}"
    if scoring_period is not None:
        url += f"&scoringPeriodId={scoring_period}"
    return url


def request_view(
    url: str,
    cookies: dict[str, str],
    view: str,
    *,
    kona_limit: int = 6000,
) -> tuple[int | None, bytes | None, str]:
    """Fetch a view. Retries on 429/5xx with backoff; a 401/403 is treated as
    persistent (per the espn-extraction skill) and returned immediately."""
    headers = {"Accept": "application/json"}
    if view == "kona_player_info":
        # limit is set well above the full player universe ESPN tracks for this
        # game (~3,900 as of 2026-08-06, confirmed live) so the percOwned sort
        # never truncates it -- every player with a season stat line (positive or
        # negative) is captured, not just the top N by ownership. A capped limit
        # previously cut off low-ownership players who were rostered briefly,
        # accumulated points, and were later dropped.
        headers["X-Fantasy-Filter"] = json.dumps(
            {
                "players": {
                    "limit": kona_limit,
                    "sortPercOwned": {"sortAsc": False, "sortPriority": 1},
                }
            }
        )

    attempt = 0
    while True:
        try:
            response = requests.get(url, cookies=cookies, headers=headers, timeout=30)
        except requests.RequestException as exc:
            return None, None, f"request error: {redact_swid(str(exc))}"

        if response.status_code in (401, 403):
            return response.status_code, response.content, "auth error (not retried)"

        if response.status_code == 429 or response.status_code >= 500:
            if attempt >= MAX_RETRIES:
                return (
                    response.status_code,
                    response.content,
                    f"gave up after {attempt + 1} attempts",
                )
            attempt += 1
            time.sleep(REQUEST_DELAY_SECONDS * (2**attempt))
            continue

        return response.status_code, response.content, ""


def is_auth_error(status_code: int | None, content: bytes | None) -> bool:
    """True when a response is an ESPN auth failure — either a 401/403 or unauthorized league auth result"""
    if status_code in (401, 403):
        return True
    if not content:
        return False
    try:
        payload = json.loads(content)
    except json.JSONDecodeError:
        return False
    if isinstance(payload, list):
        payload = payload[0] if payload else {}
    if not isinstance(payload, dict):
        return False
    details = payload.get("details")
    if not isinstance(details, list) or not details:
        return False
    return any(
        isinstance(d, dict) and d.get("type") == "AUTH_LEAGUE_NOT_VISIBLE"
        for d in details
    )


def fetch_with_fallback(
    year: int,
    view: str,
    league_id: int,
    cookies: dict[str, str],
    scoring_period: int | None = None,
    legacy: bool | None = None,
    *,
    kona_limit: int = 6000,
) -> tuple[int | None, bytes | None, str]:
    """On an auth-shaped failure, retry the opposite endpoint era before giving up —
    needed because 2018 only serves via leagueHistory despite being a "modern" year.
    Pass legacy explicitly to skip the doomed first attempt when the right era is
    already known (e.g. 2018 per-period loops)."""
    if legacy is None:
        legacy = year < MODERN_ERA_START_YEAR
    url = build_url(year, view, league_id, scoring_period, legacy=legacy)
    status_code, content, note = request_view(url, cookies, view, kona_limit=kona_limit)

    if is_auth_error(status_code, content):
        time.sleep(REQUEST_DELAY_SECONDS)
        alt_url = build_url(year, view, league_id, scoring_period, legacy=not legacy)
        alt_status, alt_content, _ = request_view(alt_url, cookies, view)
        if alt_content is not None and not is_auth_error(alt_status, alt_content):
            fallback_name = "seasons" if legacy else "leagueHistory"
            return alt_status, alt_content, f"via {fallback_name} fallback"

    return status_code, content, note


def fetch_member_achievements(
    year: int, league_id: int, swid: str, cookies: dict[str, str]
) -> tuple[int | None, bytes | None, str]:
    """One member's achievements template from the dedicated sub-path (not a
    view: no view param, no era fallback). `swid` is mTeam's members[].id --
    it travels in the request URL and the archived response body only, never
    in filenames, logs, or processed data."""
    url = (
        f"{BASE_URL}/{GAME_KEY}/seasons/{year}/segments/0/leagues/"
        f"{league_id}/members/{swid}/achievements"
    )
    return request_view(url, cookies, "mAchievements")


def save_raw(
    base_dir: Path, year: int, filename: str, content: bytes, force: bool = False
) -> Path | None:
    """Writes verbatim response bytes to base_dir/{year}/{filename}. Refuses to
    overwrite an existing file unless force=True — the archive is write-once by
    default. Returns None if the write was skipped."""
    path = base_dir / str(year) / filename
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and not force:
        return None
    path.write_bytes(content)
    return path


def unwrap_league_object(payload: Any) -> dict[str, Any]:
    """leagueHistory responses are list-wrapped; the modern endpoint isn't."""
    if isinstance(payload, list):
        payload = payload[0] if payload else {}
    return payload if isinstance(payload, dict) else {}


def classify_signal(view: str, payload: Any) -> tuple[str, str]:
    """Cheap heuristic: does this payload look like real data, or an
    empty/stub shape? Status codes alone prove nothing (the 200-with-empty
    trap) so every view gets a shape check too.
    """
    payload = unwrap_league_object(payload)
    if not payload:
        return "empty", "response is not a league object"

    if "messages" in payload and "details" in payload:
        details = payload.get("details") or [{}]
        error_type = details[0].get("type", "")
        message = "; ".join(payload.get("messages", []))
        return "error", f"{error_type}: {message}".strip(": ")

    if view == "mSettings":
        return ("ok", "") if payload.get("settings") else ("empty", "no settings key")

    if view in ("mTeam", "mStandings", "mRoster"):
        teams = payload.get("teams", [])
        if len(teams) == 10:
            return "ok", ""
        if teams:
            return "empty", f"only {len(teams)} teams (expected 10)"
        return "empty", "no teams"

    if view in ("mMatchup", "mMatchupScore"):
        schedule = payload.get("schedule", [])
        return (
            ("ok", f"{len(schedule)} matchups")
            if schedule
            else ("empty", "no schedule entries")
        )

    if view == "mDraftDetail":
        picks = payload.get("draftDetail", {}).get("picks", [])
        return ("ok", f"{len(picks)} picks") if picks else ("empty", "no draft picks")

    if view == "kona_player_info":
        players = payload.get("players", [])
        return ("ok", f"{len(players)} players") if players else ("empty", "no players")

    if view == "mTransactions2":
        transactions = payload.get("transactions")
        if transactions is None:
            return "empty", "no transactions key"
        # A quiet day is a real (empty) ledger, not a stub — report ok.
        return "ok", f"{len(transactions)} transactions"

    if view == "mBoxscore":
        schedule = payload.get("schedule", [])
        return (
            ("ok", f"{len(schedule)} boxscore entries")
            if schedule
            else ("empty", "no boxscore entries")
        )

    if view == "mAchievements":
        # Zero earned slots is real data, not a stub -- only a missing
        # template shape reads as empty.
        achievements = payload.get("achievements")
        if isinstance(achievements, list) and "member" in payload and "team" in payload:
            earned = sum(1 for slot in achievements if slot)
            return "ok", f"{len(achievements)} slots ({earned} earned)"
        return "empty", "no achievements template"

    return "empty", "no heuristic for this view"


def determine_final_scoring_period(settings_payload: Any) -> int | None:
    """Full season length from mSettings — never hardcode (2020 was 8 weeks, not 21)."""
    settings_payload = unwrap_league_object(settings_payload)
    status = settings_payload.get("status", {})
    return status.get("finalScoringPeriod") or status.get("latestScoringPeriod")


def determine_latest_scoring_period(settings_payload: Any) -> int | None:
    """How far the season has actually progressed. Unlike
    determine_final_scoring_period()'s finalScoringPeriod (a fixed MLB-calendar
    constant that's set from day one regardless of season progress — see
    determine_season_status()'s docstring), this reflects real elapsed days only.
    extract.py uses this to cap its per-period box-score/transaction fetch loops so
    it never writes an empty placeholder file for a day that hasn't happened yet."""
    settings_payload = unwrap_league_object(settings_payload)
    status = settings_payload.get("status", {})
    return status.get("latestScoringPeriod")


def determine_season_status(
    settings_payload: Any, matchupscore: Any | None = None
) -> str:
    """ "final" once ESPN has advanced currentMatchupPeriod through the last
    scheduled matchup period (regular season + playoffs) and that last period's
    active matchups are all decided; "in_progress" otherwise.

    During the playoff window, ESPN advances currentMatchupPeriod to the final
    scheduled period while the championship/consolation games are still live and
    rankCalculatedFinal has not been populated yet. Passing the mMatchupScore
    payload lets us keep the season "in_progress" until those games actually
    finish.

    finalScoringPeriod is NOT this signal — it's a fixed MLB-calendar constant
    (~180-188), unrelated to whether the fantasy season itself has ended."""
    settings_payload = unwrap_league_object(settings_payload)
    status = settings_payload.get("status", {})
    schedule_settings = settings_payload.get("settings", {}).get("scheduleSettings", {})
    total_periods = len(schedule_settings.get("matchupPeriods", {}))
    current_period = status.get("currentMatchupPeriod", 0)
    if not total_periods:
        return "in_progress"
    if current_period < total_periods:
        return "in_progress"
    if current_period > total_periods:
        return "final"
    # current_period == total_periods: the last scheduled period is now active.
    # If we have the matchup score payload, stay in_progress until every active
    # matchup in that final period has a decided winner. Bye weeks (one side is
    # null) are treated as decided.
    if matchupscore is not None:
        payload = unwrap_league_object(matchupscore)
        for m in payload.get("schedule", []) or []:
            if m.get("matchupPeriodId") != total_periods:
                continue
            if m.get("winner", "UNDECIDED") != "UNDECIDED":
                continue
            home = m.get("home")
            away = m.get("away")
            if home is not None and away is not None:
                return "in_progress"
    return "final"


def determine_current_week(settings_payload: Any) -> int:
    """ESPN's authoritative "current" matchup week -- the week a scoreboard
    should default to. Distinct from "the last week with any matchup rows":
    ESPN pre-generates the full season's pairings upfront, so every future
    week already has a placeholder (0-0, UNDECIDED) matchup row before it's
    played, which would make that a wrong signal for "current" during an
    in-progress season."""
    settings_payload = unwrap_league_object(settings_payload)
    status = settings_payload.get("status", {})
    return status.get("currentMatchupPeriod", 1)


def decided_week_periods(
    matchupscore_payload: Any, matchup_payload: Any | None = None
) -> dict[int, set[int]]:
    """Fully-decided matchup weeks mapped to their scoring days.

    Reads mMatchupScore's schedule[]: entries carry matchupPeriodId (the week),
    playoffTierType, winner, and per-side pointsByScoringPeriod keyed by the
    exact scoring-period ids that week spanned. A week qualifies only when
    EVERY one of its matchups has a winner -- a single UNDECIDED game means
    the week is still live (or ESPN hasn't finalized it yet) and its captures
    must not be treated as final.

    During the playoff window, mMatchupScore can lag mMatchup.json on winner
    status (the scoreboard view stays UNDECIDED while the schedule view already
    reports HOME/AWAY). Pass the optional mMatchup payload so a week is treated
    as decided if either view reports a winner for every active game.

    extract.py's --refresh-decided-weeks uses this to re-fetch a just-finished
    week's per-period files: those were captured as live snapshots day by day,
    so late MLB stat revisions leave them short of the official scores
    validate.py's pf_box_score_reconciliation reconciles against. Playoff weeks
    are included so an in-progress season's decided playoff rounds are also
    healed."""
    score_payload = unwrap_league_object(matchupscore_payload)
    games_by_week: dict[int, list[dict[str, Any]]] = {}
    for m in score_payload.get("schedule") or []:
        if not isinstance(m, dict):
            continue
        week = m.get("matchupPeriodId")
        if isinstance(week, int):
            games_by_week.setdefault(week, []).append(m)

    # Winner override from mMatchup when mMatchupScore lags.
    matchup_winners: dict[int, str] = {}
    if matchup_payload is not None:
        mu_payload = unwrap_league_object(matchup_payload)
        for m in mu_payload.get("schedule") or []:
            if not isinstance(m, dict):
                continue
            game_id = m.get("id")
            if isinstance(game_id, int):
                matchup_winners[game_id] = m.get("winner", "UNDECIDED")

    def _winner(g: dict[str, Any]) -> str:
        return matchup_winners.get(g.get("id"), g.get("winner", "UNDECIDED"))

    decided: dict[int, set[int]] = {}
    for week, games in sorted(games_by_week.items()):
        if any(_winner(g) == "UNDECIDED" for g in games):
            continue
        periods: set[int] = set()
        for g in games:
            for side_key in ("home", "away"):
                side = g.get(side_key) or {}
                by_period = side.get("pointsByScoringPeriod") or {}
                for key in by_period:
                    try:
                        periods.add(int(key))
                    except (TypeError, ValueError):
                        continue
        decided[week] = periods
    return decided
