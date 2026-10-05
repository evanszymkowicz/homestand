#!/usr/bin/env python3
"""Pull sync_live_scoreboard.py's scratch state back out of D1.

Usage:
    python scripts/db/pull_live_state.py --year 2026 --out-dir live-scoreboard-in

The counterpart to publish_d1_delta.py's live_sync_state upserts: materializes
the accumulation files (box_scores/{year}.json, player_season_points.json,
player_team_season_points.json) that earlier lightweight runs published, so
the next sync_live_scoreboard.py run can resume the week day-by-day with
--in-dir. Replaces the old "download today's R2 copies" workflow step --
D1 is the only home this intraday state has since R2's JSON serving went away
(Phase C deprecation).

Reads the remote database through the wrangler CLI (the same transport the
delta publisher writes through), so it needs CLOUDFLARE_API_TOKEN in the
environment -- the workflow steps that invoke this already set it for their
delta publish.

Exit codes: 0 when rows were written OR the table is simply empty/absent
(first run of a season, fresh database -- the caller falls back to the
git-committed copies exactly as it did for a missing R2 object); also 0 under
--tolerate-unavailable when wrangler itself fails (the workflow's lightweight
runs pass it -- the fallback is bounded by that night's heavy rebuild, and
the loud TRANSPORT FAILURE log line keeps the outage visible); 1 on real
failures without the flag (wrangler missing/auth broken/malformed output),
because silently continuing on those would drop accumulated days while
looking healthy.
"""

import argparse
import base64
import json
import subprocess
import sys
import zlib
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parents[1]

# Keep in one place: the workflow pins wrangler@4 via npx elsewhere.
WRANGLER_CMD = [
    "npx",
    "--yes",
    "wrangler@4",
    "d1",
    "execute",
    "wsob-record-book",
    "--remote",
    "--json",
]


def parse_wrangler_output(stdout: str) -> dict[str, list[tuple[int, str]]]:
    """Extract chunked payloads from wrangler d1 execute --json output.

    wrangler prints its JSON result document but may interleave human-readable
    log lines around it, so scan line-blocks for anything parseable rather
    than parsing the whole stream. Returns {key: [(chunk_idx, payload), ...]}
    (chunks unsorted); {} for an empty table."""
    decoder = json.JSONDecoder()
    chunks: dict[str, list[tuple[int, str]]] = {}
    for start in range(len(stdout)):
        if stdout[start] not in "[{":
            continue
        try:
            doc, _ = decoder.raw_decode(stdout[start:])
        except json.JSONDecodeError:
            continue
        candidates = doc if isinstance(doc, list) else [doc]
        for block in candidates:
            results = block.get("results") if isinstance(block, dict) else None
            if isinstance(results, list):
                for row in results:
                    key, payload = row.get("key"), row.get("payload")
                    idx = row.get("chunk_idx")
                    if (
                        isinstance(key, str)
                        and isinstance(payload, str)
                        and isinstance(idx, int)
                    ):
                        chunks.setdefault(key, []).append((idx, payload))
        if chunks or isinstance(doc, (list, dict)):
            # First parseable document wins; wrangler emits exactly one.
            return chunks
    return chunks


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--year", type=int, required=True)
    parser.add_argument("--out-dir", type=Path, required=True)
    parser.add_argument(
        "--tolerate-unavailable",
        action="store_true",
        help="Exit 0 (with a loud warning) when the wrangler call itself "
        "fails, instead of exit 1. For the workflow's lightweight runs: the "
        "sync's committed-copy fallback is bounded by that night's heavy "
        "rebuild, so a transient D1 outage shouldn't fail the run -- but it "
        "must stay visible in the logs, which is why this is a flag and not "
        "a shell '|| true'.",
    )
    args = parser.parse_args()

    def transport_failed(detail: str) -> None:
        print(f"pull_live_state: TRANSPORT FAILURE: {detail}")
        if args.tolerate_unavailable:
            print(
                "pull_live_state: continuing under --tolerate-unavailable; "
                "sync will fall back to the git-committed copies and any "
                "accumulated intraday days NOT already in those copies are "
                "lost from today's patches (bounded by tonight's heavy rebuild)"
            )
            sys.exit(0)
        sys.exit(1)

    keys = ", ".join(
        f"'{k}'"
        for k in (
            f"box_scores/{args.year}.json",
            "player_season_points.json",
            "player_team_season_points.json",
        )
    )
    command = f"SELECT key, chunk_idx, payload FROM live_sync_state WHERE key IN ({keys}) ORDER BY key, chunk_idx"
    try:
        proc = subprocess.run(
            [*WRANGLER_CMD, "--command", command],
            capture_output=True,
            text=True,
            timeout=300,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        transport_failed(f"wrangler invocation failed: {exc}")
    if proc.returncode != 0:
        # wrangler reports query/auth failures on stdout (not stderr), so
        # include both tails or the actual error never reaches the logs.
        transport_failed(
            f"wrangler failed:\n{proc.stderr[-2000:]}\n{proc.stdout[-2000:]}"
        )

    pairs = parse_wrangler_output(proc.stdout)
    if not pairs:
        print(
            "pull_live_state: live_sync_state is empty -- nothing pulled; "
            "sync will fall back to the git-committed copies"
        )
        sys.exit(0)

    args.out_dir.mkdir(parents=True, exist_ok=True)
    written: list[str] = []
    for key in sorted(pairs):
        chunks = sorted(pairs[key])
        # Chunk indexes are dense 0..n-1 by construction; a gap means a
        # partial publish somehow survived, and writing a corrupt file would
        # poison the next sync's resume.
        if [idx for idx, _ in chunks] != list(range(len(chunks))):
            print(
                f"pull_live_state: {key} has non-contiguous chunks "
                f"({[idx for idx, _ in chunks]}) -- skipping; sync will fall "
                "back to the git-committed copy for this file"
            )
            continue
        try:
            text = zlib.decompress(
                base64.b64decode("".join(payload for _, payload in chunks))
            ).decode("utf-8")
        except (ValueError, zlib.error, UnicodeDecodeError) as exc:
            # Same policy as gapped chunks: the stored blob is unusable, but
            # that's a data problem for this one key -- skip it and let the
            # sync fall back to the committed copy rather than failing the
            # whole pull (exit 1 stays reserved for transport failures).
            print(
                f"pull_live_state: {key} failed to decode/decompress: {exc} "
                "-- skipping; sync will fall back to the git-committed copy "
                "for this file"
            )
            continue
        path = args.out_dir / key
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        written.append(key)
    if len(written) < len(pairs):
        print(
            f"pull_live_state: wrote {len(written)} of {len(pairs)} key(s); "
            "skipped keys fall back to the git-committed copies"
        )
    else:
        print(f"pull_live_state: wrote {len(written)} key(s) under {args.out_dir}")
    print(f"pull_live_state: keys: {', '.join(sorted(written))}")


if __name__ == "__main__":
    main()
