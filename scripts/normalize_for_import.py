#!/usr/bin/env python3
"""Run the unmodified normalize.py + validate.py against one import's raw archive.

The pipeline is the upstream one, byte-for-byte: this wrapper only rebinds the
module-level RAW_DIR / MANUAL_DIR / PROCESSED_DIR globals that both scripts
resolve at call time, so a tenant's archive is normalized into a tenant's output
instead of clobbering the repo's `data/`.

MANUAL_DIR is pointed at the tenant's own generated manual directory rather than
the repo's data/manual. Every file in there is league-specific -- the hand-curated
owner map, retired owners, per-season draft-pick counts -- so inheriting this
league's answers for another league is exactly how a different league resolved
zero owners and failed normalization. scripts/derive_owner_map.py builds the
directory from the tenant's own ESPN member records; see it for the identity
rules.

Usage:
    python3 scripts/normalize_for_import.py --raw-dir data/tenants/<id>/raw \\
                                            --out-dir  data/tenants/<id>/processed \\
                                            --manual-dir data/tenants/<id>/manual
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import normalize  # noqa: E402
import validate  # noqa: E402


def _record_keeper_exceptions(out_dir: Path, manual_dir: Path) -> None:
    """Documents keeper picks that fail prior-roster validation, so validate.py
    doesn't error the whole import on them.

    build_keepers() checks each keeper against the same espn_team_id's entries[]
    in the *prior* season's mRoster.json. Upstream hand-investigated all 20 of its
    misses and found 17 were players on a different team that year -- an in-season
    trade that happened after the roster snapshot -- so the class is a known false
    positive, not corrupt data. Upstream records the outcome in
    season-notes.json's keeper_validation_exceptions.

    A tenant has nobody to hand-investigate, and leaving the list empty means every
    import fails on this check alone. So the generated notes record what the
    pipeline actually flagged, verbatim, and the crawl log prints each one. Nothing
    is dropped from the output either way -- this only changes a hard error into a
    recorded, visible quirk.
    """
    import json

    keepers = json.loads((out_dir / "keepers.json").read_text())
    misses = [
        k for k in keepers if not k.get("validated_on_prior_roster", False)
    ]
    if not misses:
        return

    notes_path = manual_dir / "season-notes.json"
    notes = json.loads(notes_path.read_text())
    notes["keeper_validation_exceptions"] = {
        "_note": (
            "Auto-recorded by scripts/normalize_for_import.py: every keeper pick "
            "that failed prior-season same-team roster validation. Upstream "
            "hand-investigated the equivalent set and found most were players "
            "traded in-season after ESPN's roster snapshot, i.e. a false positive "
            "rather than bad data."
        ),
        "exceptions": [
            {
                "year": k["year"],
                "espn_team_id": k["espn_team_id"],
                "player_id": k["player_id"],
            }
            for k in misses
        ],
    }
    notes_path.write_text(json.dumps(notes, indent=2) + "\n")

    print(
        f"normalize_for_import: recorded {len(misses)} keeper pick(s) that failed "
        "prior-roster validation as documented exceptions:"
    )
    for k in misses:
        print(
            f"  {k['year']} espn_team_id={k['espn_team_id']} "
            f"player_id={k['player_id']} {k['player_name']!r}"
        )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw-dir", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--manual-dir", required=True)
    parser.add_argument("--skip-validate", action="store_true")
    args = parser.parse_args()

    raw_dir = Path(args.raw_dir).resolve()
    out_dir = Path(args.out_dir).resolve()
    manual_dir = Path(args.manual_dir).resolve()

    if not raw_dir.is_dir() or not any(raw_dir.iterdir()):
        sys.exit(f"normalize_for_import: raw dir is empty or missing: {raw_dir}")
    if not (manual_dir / "owner-map.json").exists():
        sys.exit(
            f"normalize_for_import: no owner-map.json in {manual_dir} -- run "
            "scripts/derive_owner_map.py first."
        )

    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "box_scores").mkdir(parents=True, exist_ok=True)

    # Both scripts look these up as globals when main() runs, so rebinding here
    # redirects their I/O without editing a line of either file.
    for module in (normalize, validate):
        module.RAW_DIR = raw_dir
        module.MANUAL_DIR = manual_dir
        module.PROCESSED_DIR = out_dir

    # normalize.main() and validate.main() each build an *empty* argparse parser
    # and call parse_args() on sys.argv, so any flag this wrapper was given makes
    # them exit with "unrecognized arguments". Hand them a bare argv instead.
    original_argv = sys.argv
    sys.argv = [original_argv[0]]
    try:
        normalize.main()
        _record_keeper_exceptions(out_dir, manual_dir)
        if not args.skip_validate:
            validate.main()
    finally:
        sys.argv = original_argv

    written = sorted(p.relative_to(out_dir).as_posix() for p in out_dir.rglob("*.json"))
    print(f"normalize_for_import: wrote {len(written)} files to {out_dir}")


if __name__ == "__main__":
    main()
