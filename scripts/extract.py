#!/usr/bin/env python3
"""Extraction pipeline: pulls every accessible season into the permanent raw archive.

Usage:
    python scripts/extract.py
    python scripts/extract.py --years 2009-2012
    python scripts/extract.py --years 2018 --force
    python scripts/extract.py --incremental --refresh-decided-weeks

Reads config.json (copy config.json.example to config.json and fill in
league_id/espn_s2/swid/year_start/year_end).

Writes data/raw/{year}/{view}.json, data/raw/{year}/mBoxscore-period{N}.json, (2019+
only — ESPN serves no earlier ledger) data/raw/{year}/mTransactions2-period{N}.json, and
(2018 only — its mBoxscore carries no player detail; see
context/research/data-audit-findings.md's 2018 probe) data/raw/2018/mRoster-period{N}.json, plus
(2026+ only — the "Fantasy Achievements" trophies era; see
context/features/espn-trophies-activity-tray-spec.md) data/raw/{year}/achievements-member{NN}.json —
byte-for-byte ESPN responses. No parsing or transformation happens here (Phase 2's job).
Idempotent by default: existing files are skipped unless --force is passed. --incremental
keeps that rule except for season-level views (always refreshed), the current period's
mTransactions2 on an in-progress season (force-refetched — the direct trade-capture path
that replaced the R2 relay), and the per-member achievements capture (force-refetched
while the season is in progress — trophies are awarded as they are earned).
"""

import argparse
import json
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lib.espn_client import (
    ACHIEVEMENTS_ERA_START_YEAR,
    REQUEST_DELAY_SECONDS,
    ROSTER_PERIOD_HARVEST_YEARS,
    TRANSACTION_ERA_START_YEAR,
    VIEWS,
    ConfigError,
    classify_signal,
    decided_week_periods,
    determine_final_scoring_period,
    determine_latest_scoring_period,
    determine_season_status,
    fetch_member_achievements,
    fetch_with_fallback,
    load_config,
    redact_swid,
    save_raw,
)

REPO_ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = REPO_ROOT / "config.json"
RAW_DIR = REPO_ROOT / "data" / "raw"

FetchStatus = str  # "fetched" | "skipped" | "failed"


@dataclass
class FetchOutcome:
    year: int
    label: str
    status: FetchStatus
    note: str = ""


def parse_year_range(spec: str) -> tuple[int, int]:
    if "-" in spec:
        start, end = spec.split("-", 1)
        return int(start), int(end)
    year = int(spec)
    return year, year


def sanity_check(league_id: int, cookies: dict[str, str], probe_year: int) -> None:
    """One known-good call before looping every year — fail fast on bad
    cookies instead of burning the whole range on auth errors."""
    status_code, content, note = fetch_with_fallback(
        probe_year, "mTeam", league_id, cookies
    )
    if content is None:
        sys.exit(
            f"Sanity check failed: {note}. Check config.json's cookies and league_id."
        )
    try:
        payload = json.loads(content)
    except json.JSONDecodeError:
        sys.exit("Sanity check failed: mTeam response was not valid JSON.")
    signal, signal_note = classify_signal("mTeam", payload)
    if signal != "ok":
        sys.exit(
            f"Sanity check failed on {probe_year} mTeam ({signal}: {signal_note}). "
            "Check config.json's espn_s2/swid — cookies may be expired or truncated."
        )
    print(f"Sanity check ok: {probe_year} mTeam returned 10 teams.\n")


def save_and_classify(
    year: int,
    label: str,
    status_code: int | None,
    content: bytes,
    note: str,
    view: str,
    force: bool,
) -> FetchOutcome:
    """The shared save→classify→outcome tail of every fetch_*_and_save path:
    archive the response verbatim (even a non-200 body -- failures self-heal
    on the next force-refetch), then classify its data signal."""
    saved = save_raw(RAW_DIR, year, f"{label}.json", content, force=force)
    if saved is None:
        return FetchOutcome(year, label, "skipped")

    if status_code != 200:
        return FetchOutcome(year, label, "failed", note or f"HTTP {status_code}")

    try:
        payload = json.loads(content)
    except json.JSONDecodeError:
        return FetchOutcome(year, label, "failed", "response is not valid JSON")

    signal, signal_note = classify_signal(view, payload)
    if signal == "error":
        return FetchOutcome(year, label, "failed", signal_note)
    if signal == "empty":
        return FetchOutcome(year, label, "fetched", f"saved but empty: {signal_note}")
    return FetchOutcome(year, label, "fetched", signal_note)


def fetch_and_save(
    year: int,
    label: str,
    url_view: str,
    league_id: int,
    cookies: dict[str, str],
    force: bool,
    scoring_period: int | None = None,
    legacy: bool | None = None,
) -> FetchOutcome:
    filename = f"{label}.json"
    existing = RAW_DIR / str(year) / filename
    if existing.exists() and not force:
        return FetchOutcome(year, label, "skipped")

    status_code, content, note = fetch_with_fallback(
        year, url_view, league_id, cookies, scoring_period=scoring_period, legacy=legacy
    )
    time.sleep(REQUEST_DELAY_SECONDS)

    if content is None:
        return FetchOutcome(year, label, "failed", note)

    return save_and_classify(year, label, status_code, content, note, url_view, force)


def fetch_year_achievements(
    year: int,
    league_id: int,
    cookies: dict[str, str],
    force: bool,
) -> list[FetchOutcome]:
    """One year's per-member achievements capture. SWIDs come from this run's
    freshly saved mTeam.json; filenames index members by mTeam position (a
    SWID must never appear in a filename). Failures are recorded per member
    and never abort the year -- this capture is a standing probe, not
    load-bearing (the endpoint may never fill; see the spec)."""
    outcomes: list[FetchOutcome] = []
    mteam_path = RAW_DIR / str(year) / "mTeam.json"
    try:
        members = json.loads(mteam_path.read_bytes()).get("members", [])
    except (json.JSONDecodeError, OSError):
        members = []
    if not members:
        outcomes.append(
            FetchOutcome(
                year,
                "achievements-member*",
                "failed",
                "no members parsed from mTeam.json",
            )
        )
        return outcomes
    for member_index, member in enumerate(members, start=1):
        swid = member.get("id")
        label = f"achievements-member{member_index:02d}"
        if not isinstance(swid, str) or not swid:
            outcomes.append(FetchOutcome(year, label, "failed", "member has no id"))
            continue
        outcomes.append(
            fetch_achievements_and_save(
                year,
                f"achievements-member{member_index:02d}",
                swid,
                league_id,
                cookies,
                force,
            )
        )
    return outcomes


def fetch_achievements_and_save(
    year: int,
    label: str,
    swid: str,
    league_id: int,
    cookies: dict[str, str],
    force: bool,
) -> FetchOutcome:
    """Fetch one member's achievements and save verbatim -- the sub-path shape
    of fetch_and_save (not a view, so no era fallback; achievements are 2026+
    only and a legacy attempt would just 404)."""
    existing = RAW_DIR / str(year) / f"{label}.json"
    if existing.exists() and not force:
        return FetchOutcome(year, label, "skipped")

    status_code, content, note = fetch_member_achievements(
        year, league_id, swid, cookies
    )
    # The request URL carries the SWID and network-level exception strings can
    # embed it; notes print to the run log, so redact before they get there.
    note = redact_swid(note)
    time.sleep(REQUEST_DELAY_SECONDS)

    if content is None:
        return FetchOutcome(year, label, "failed", note)

    return save_and_classify(
        year, label, status_code, content, note, "mAchievements", force
    )


def extract_year(
    year: int,
    league_id: int,
    cookies: dict[str, str],
    force: bool,
    incremental: bool = False,
    refresh_decided_weeks: bool = False,
) -> list[FetchOutcome]:
    """Extract one year. `incremental` force-fetches season-level views but
    leaves per-period files skip-if-exists (only new periods are fetched --
    except the current period's mTransactions2 on an in-progress season,
    which is force-refetched; see below) -- used by the consolidated
    in-season job's daily heavy pass to avoid re-fetching the ~130+
    completed periods that haven't changed since the last heavy run.

    `refresh_decided_weeks` (composable with `incremental`) force-refetches the
    per-period files of every fully-decided regular-season week of an
    in-progress season. Those weeks were captured as live snapshots day by
    day, and ESPN revises stats after capture (late Sunday games, post-game
    corrections) -- so the moment a week flips UNDECIDED -> decided, its stale
    captures fall short of the official scores validate.py reconciles against.
    Re-fetching against finals heals exactly those weeks. Gated to in-progress
    seasons: a completed season's weeks are ALL decided and must not be swept."""
    outcomes: list[FetchOutcome] = []
    settings_payload: Any = None

    # --incremental implies --force for season-level views (they have fixed
    # filenames and need refreshing); per-period files below stay skip-if-exists.
    season_force = force or incremental

    for view in VIEWS:
        outcome = fetch_and_save(year, view, view, league_id, cookies, season_force)
        outcomes.append(outcome)
        if view == "mSettings":
            settings_path = RAW_DIR / str(year) / "mSettings.json"
            if settings_path.exists():
                try:
                    settings_payload = json.loads(settings_path.read_bytes())
                except json.JSONDecodeError:
                    settings_payload = None

    # Load mMatchupScore once for the season-status checks below (playoff
    # weeks can be live while currentMatchupPeriod equals the last scheduled
    # period; see determine_season_status's matchup-aware logic).
    matchupscore_path = RAW_DIR / str(year) / "mMatchupScore.json"
    matchupscore_payload: Any = None
    if matchupscore_path.exists():
        try:
            matchupscore_payload = json.loads(matchupscore_path.read_bytes())
        except json.JSONDecodeError:
            matchupscore_payload = None

    # Load mMatchup as a winner-status fallback for --refresh-decided-weeks.
    # mMatchupScore can lag the schedule view during the playoff window, so
    # honoring either view keeps decided-week refresh from skipping weeks that
    # are already finalized in mMatchup.
    matchup_path = RAW_DIR / str(year) / "mMatchup.json"
    matchup_payload: Any = None
    if matchup_path.exists():
        try:
            matchup_payload = json.loads(matchup_path.read_bytes())
        except json.JSONDecodeError:
            matchup_payload = None

    # Achievements capture (2026+): force-refetched while the season is in
    # progress (trophies land as earned), skip-if-exists once final -- the
    # last capture stands, and only a --force rebuild re-captures a completed
    # season. Skipped entirely when mSettings failed, since the year's status
    # can't be read.
    if year >= ACHIEVEMENTS_ERA_START_YEAR and settings_payload is not None:
        achievements_force = force or (
            determine_season_status(settings_payload, matchupscore_payload)
            == "in_progress"
        )
        outcomes.extend(
            fetch_year_achievements(year, league_id, cookies, achievements_force)
        )

    final_period = determine_final_scoring_period(settings_payload)
    if not final_period:
        outcomes.append(
            FetchOutcome(
                year,
                "mBoxscore-*",
                "failed",
                "could not determine final scoring period from mSettings; box scores skipped",
            )
        )
        return outcomes

    # finalScoringPeriod is a fixed MLB-calendar constant set from day one
    # (~180-188), not how far the season has actually progressed -- looping box
    # scores/transactions all the way to it for an in-progress season would fetch
    # periods that haven't happened yet and permanently archive them as empty
    # placeholders (save_raw() is skip-if-exists, so a stub written today never
    # gets refreshed once that day's real data exists). Cap at whatever ESPN
    # reports as actually elapsed; a completed season's latestScoringPeriod
    # already covers its whole real run, so this is a no-op there.
    latest_period = determine_latest_scoring_period(settings_payload)
    box_period_cap = min(final_period, latest_period) if latest_period else final_period

    # --incremental: per-period files are skip-if-exists (only new periods fetch)
    # EXCEPT the current period's mTransactions2 on an in-progress season, which is
    # force-refetched: transactions accumulate intraday (overnight waiver
    # processing) and nothing else would land them in the archive until
    # --refresh-decided-weeks fires after the week decides. This is the direct
    # replacement for the retired R2 relay of mTransactions2-daily-*.json
    # captures (2026-08). Box scores stay skip-if-exists for the current
    # period: the live scoreboard path (sync_live_scoreboard.py) owns intraday
    # box-score state, and re-fetching provisional snapshots daily would churn
    # the archive with capture-regime noise.
    # --force: per-period files are re-fetched (full rebuild).
    # default: per-period files are skip-if-exists.
    # --refresh-decided-weeks additionally forces the periods of fully-decided
    # weeks (in-progress seasons only), re-capturing them against ESPN's
    # post-revision finals.
    refresh_periods: set[int] = set()
    if (
        refresh_decided_weeks
        and not force
        and settings_payload is not None
        and determine_season_status(settings_payload, matchupscore_payload)
        == "in_progress"
    ):
        for week, periods in sorted(
            decided_week_periods(matchupscore_payload, matchup_payload).items()
        ):
            in_cap = {p for p in periods if p <= box_period_cap}
            refresh_periods |= in_cap
            print(
                f"  {year}: refreshing decided week {week} "
                f"({len(in_cap)} scoring periods)"
            )

    def period_force(period: int) -> bool:
        return force or period in refresh_periods

    # --incremental keeps the current period's mTransactions2 fresh for an
    # in-progress season (see the flag comment above): it is the direct
    # replacement for the retired R2 daily-capture relay.
    transactions_refresh_period: int | None = None
    if (
        incremental
        and not force
        and settings_payload is not None
        and determine_season_status(settings_payload, matchupscore_payload)
        == "in_progress"
        and latest_period is not None
        and latest_period <= box_period_cap
    ):
        transactions_refresh_period = latest_period
        print(
            f"  {year}: force-refetching current period {latest_period} "
            f"mTransactions2 (direct trade capture, replaces the R2 relay)"
        )

    for period in range(1, box_period_cap + 1):
        label = f"mBoxscore-period{period}"
        outcome = fetch_and_save(
            year,
            label,
            "mBoxscore",
            league_id,
            cookies,
            period_force(period),
            scoring_period=period,
        )
        outcomes.append(outcome)

    if year >= TRANSACTION_ERA_START_YEAR:
        for period in range(1, box_period_cap + 1):
            label = f"mTransactions2-period{period}"
            outcome = fetch_and_save(
                year,
                label,
                "mTransactions2",
                league_id,
                cookies,
                period_force(period) or period == transactions_refresh_period,
                scoring_period=period,
            )
            outcomes.append(outcome)

    if year in ROSTER_PERIOD_HARVEST_YEARS:
        # Player-level data for this year lives only in per-period leagueHistory
        # mRoster responses — legacy=True skips the modern endpoint's guaranteed 401.
        for period in range(1, final_period + 1):
            label = f"mRoster-period{period}"
            outcome = fetch_and_save(
                year,
                label,
                "mRoster",
                league_id,
                cookies,
                period_force(period),
                scoring_period=period,
                legacy=True,
            )
            outcomes.append(outcome)

    return outcomes


def tally_periods(
    all_outcomes: list[FetchOutcome], year: int, label_prefix: str
) -> str:
    period_outcomes = [
        o for o in all_outcomes if o.year == year and o.label.startswith(label_prefix)
    ]
    if not period_outcomes:
        return "-"
    fetched = sum(1 for o in period_outcomes if o.status == "fetched")
    skipped = sum(1 for o in period_outcomes if o.status == "skipped")
    failed = sum(1 for o in period_outcomes if o.status == "failed")
    return f"{fetched}F/{skipped}S/{failed}X"


def print_summary(all_outcomes: list[FetchOutcome]) -> None:
    years = sorted({o.year for o in all_outcomes})

    header = (
        ["Year"]
        + VIEWS
        + ["boxscores", "transactions", "roster-periods", "achievements"]
    )
    print(" | ".join(header))
    print("-|-".join("-" * len(h) for h in header))

    status_letter = {"fetched": "F", "skipped": "S", "failed": "X"}

    for year in years:
        by_label = {o.label: o for o in all_outcomes if o.year == year}
        row = [str(year)]
        for view in VIEWS:
            outcome = by_label.get(view)
            row.append(status_letter.get(outcome.status, "?") if outcome else "-")

        row.append(tally_periods(all_outcomes, year, "mBoxscore-period"))
        row.append(tally_periods(all_outcomes, year, "mTransactions2-period"))
        row.append(tally_periods(all_outcomes, year, "mRoster-period"))
        row.append(tally_periods(all_outcomes, year, "achievements-member"))
        print(" | ".join(row))

    total_fetched = sum(1 for o in all_outcomes if o.status == "fetched")
    total_skipped = sum(1 for o in all_outcomes if o.status == "skipped")
    total_failed = sum(1 for o in all_outcomes if o.status == "failed")
    print(
        f"\nTotal: {total_fetched} fetched, {total_skipped} skipped, "
        f"{total_failed} failed across {len(years)} years."
    )

    failures = [o for o in all_outcomes if o.status == "failed"]
    if failures:
        print("\nFailures:")
        for o in failures:
            print(f"  {o.year} / {o.label}: {redact_swid(o.note)}")

    empties = [o for o in all_outcomes if o.status == "fetched" and "empty" in o.note]
    if empties:
        print("\nFetched but flagged empty (saved verbatim — needs a human look):")
        for o in empties:
            print(f"  {o.year} / {o.label}: {redact_swid(o.note)}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--years",
        help="Year or range to extract, e.g. 2019 or 2009-2025. Defaults to config.json's year_start-year_end.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-fetch and overwrite files that already exist. Off by default (idempotent).",
    )
    parser.add_argument(
        "--incremental",
        action="store_true",
        help="Force-fetch season-level views but skip already-existing per-period "
        "files (only new periods are fetched; the current period's mTransactions2 "
        "on an in-progress season is force-refetched). For the consolidated "
        "in-season job's daily heavy pass -- avoids re-fetching ~130+ completed "
        "periods that haven't changed. Cannot be combined with --force.",
    )
    parser.add_argument(
        "--refresh-decided-weeks",
        action="store_true",
        help="Force-refetch the per-period files of every fully-decided "
        "regular-season week of an in-progress season, so live day-by-day "
        "captures are re-taken against ESPN's post-revision finals before "
        "normalize/validate reconcile them. In-progress seasons only. Cannot "
        "be combined with --force.",
    )
    args = parser.parse_args()

    if args.force and args.incremental:
        sys.exit("--force and --incremental are mutually exclusive.")
    if args.force and args.refresh_decided_weeks:
        sys.exit("--force and --refresh-decided-weeks are mutually exclusive.")

    try:
        config = load_config(CONFIG_PATH)
    except ConfigError as exc:
        sys.exit(str(exc))

    league_id = config["league_id"]
    cookies = {"espn_s2": config["espn_s2"], "SWID": config["swid"]}

    if args.years:
        year_start, year_end = parse_year_range(args.years)
    else:
        year_start, year_end = config["year_start"], config["year_end"]

    sanity_check(league_id, cookies, year_end)

    all_outcomes: list[FetchOutcome] = []
    for year in range(year_start, year_end + 1):
        print(f"Extracting {year}...")
        all_outcomes.extend(
            extract_year(
                year,
                league_id,
                cookies,
                args.force,
                args.incremental,
                args.refresh_decided_weeks,
            )
        )

    print()
    print_summary(all_outcomes)


if __name__ == "__main__":
    main()
