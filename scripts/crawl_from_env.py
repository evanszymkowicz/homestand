#!/usr/bin/env python3
"""Import pipeline for one tenant: ESPN crawl -> normalize -> validate -> R2 -> D1.

This is the step that actually makes an import usable. Before it existed the crawl
stopped after uploading raw responses and nothing ever set `imports.status` to
`completed`, so the data proxy 404'd every collection and the account saw an
empty dashboard forever.

Usage:
  python3 scripts/crawl_from_env.py

Expected env vars:
  ESPN_IMPORT_ID            The import row this run belongs to (required)
  ESPN_S2_ENCRYPTED         AES-256-GCM encrypted espn_s2 cookie (iv:ciphertext hex)
  ESPN_SWID_ENCRYPTED       AES-256-GCM encrypted SWID cookie (iv:ciphertext hex)
  CREDENTIALS_ENCRYPTION_KEY   64-hex-char key used to encrypt the cookies
  ESPN_LEAGUE_ID            League ID to crawl
  ESPN_YEAR_START           First season year (inclusive)
  ESPN_YEAR_END             Last season year (inclusive)

Raw ESPN responses land under data/tenants/{importId}/raw. Owner identity is then
derived from that league's own member records into data/tenants/{importId}/manual
(the repo's data/manual is hand-curated for the record-book league and resolves
zero owners for anyone else), normalized into data/tenants/{importId}/processed,
uploaded to R2 under `processed/{importId}/`, and finally the D1 import row is
marked completed. Any failure marks it failed with the reason, so the UI stops
saying "queued".
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from lib.crypto import decrypt_value  # type: ignore[import-not-found]

# Imported rather than redeclared: derive_owner_map.py is what writes these files,
# so the list of which ones the proxy needs stays in one place.
sys.path.insert(0, str(ROOT / "scripts"))
from derive_owner_map import PROXY_SERVED_MANUAL_FILES  # noqa: E402

R2_BUCKET = "homestand-raw-archive"
APP_DIR = ROOT / "app"

# ESPN_TARGET=local (default) keeps every D1/R2 call on the throwaway local
# emulator. ESPN_TARGET=remote talks to the real database and bucket -- which is
# the only thing that makes a production run mean anything.
TARGET = os.environ.get("ESPN_TARGET", "local")
if TARGET not in ("local", "remote"):
    sys.exit(f"ESPN_TARGET must be 'local' or 'remote', got {TARGET!r}")
LOCAL_FLAG = ["--local"] if TARGET == "local" else []


def _set_status(import_id: str, status: str, detail: str | None = None) -> None:
    """Best-effort D1 update. Never raises -- a status write that fails must not
    mask the real crawl result."""
    sql = f"UPDATE imports SET status = '{status}' WHERE id = '{import_id}'"
    if detail:
        safe = detail.replace("'", "")[:200]
        sql += f" -- {safe}"
    try:
        subprocess.run(
            ["npx", "wrangler", "d1", "execute", "homestand-db", *LOCAL_FLAG, "--command", sql],
            cwd=str(APP_DIR),
            check=True,
            capture_output=True,
        )
    except Exception as exc:  # noqa: BLE001
        print(f"warning: could not set import status to {status}: {exc}", file=sys.stderr)


def _upload(src_dir: Path, key_prefix: str) -> int:
    count = 0
    for path in sorted(src_dir.rglob("*.json")):
        rel = path.relative_to(src_dir).as_posix()
        subprocess.run(
            [
                "npx", "wrangler", "r2", "object", "put",
                f"{R2_BUCKET}/{key_prefix}/{rel}",
                "--file", str(path),
                *LOCAL_FLAG,
            ],
            cwd=str(APP_DIR),
            check=True,
        )
        count += 1
    return count


def _upload_proxy_served_manual(manual_dir: Path, key_prefix: str) -> int:
    """Publishes the manual files the app fetches through the data proxy.

    app/lib/collections.ts allowlists retired-owners.json,
    jersey-history-overrides.json and position-overrides.json, but they live in
    data/manual/ rather than data/processed/, so uploading only the processed
    output left all three 404ing for every tenant. For a tenant they are the empty
    stubs derive_owner_map.py generated, which is correct -- a league we have no
    hand-curated overrides for genuinely has none.
    """
    count = 0
    for name in PROXY_SERVED_MANUAL_FILES:
        path = manual_dir / name
        if not path.exists():
            continue
        subprocess.run(
            [
                "npx", "wrangler", "r2", "object", "put",
                f"{R2_BUCKET}/{key_prefix}/{name}",
                "--file", str(path),
                *LOCAL_FLAG,
            ],
            cwd=str(APP_DIR),
            check=True,
        )
        count += 1
    return count


def main() -> None:
    import_id = os.environ.get("ESPN_IMPORT_ID")
    if not import_id:
        sys.exit("ESPN_IMPORT_ID is required")

    encrypted_s2 = os.environ.get("ESPN_S2_ENCRYPTED")
    encrypted_swid = os.environ.get("ESPN_SWID_ENCRYPTED")
    key = os.environ.get("CREDENTIALS_ENCRYPTION_KEY")
    league_id = os.environ.get("ESPN_LEAGUE_ID")
    year_start = os.environ.get("ESPN_YEAR_START")
    year_end = os.environ.get("ESPN_YEAR_END")

    missing = [name for name, value in {
        "ESPN_S2_ENCRYPTED": encrypted_s2,
        "ESPN_SWID_ENCRYPTED": encrypted_swid,
        "CREDENTIALS_ENCRYPTION_KEY": key,
        "ESPN_LEAGUE_ID": league_id,
        "ESPN_YEAR_START": year_start,
        "ESPN_YEAR_END": year_end,
    }.items() if not value]
    if missing:
        sys.exit(f"Missing required env vars: {', '.join(missing)}")

    assert key is not None and encrypted_s2 is not None and encrypted_swid is not None
    assert league_id is not None and year_start is not None and year_end is not None

    espn_s2 = decrypt_value(encrypted_s2, key)
    swid = decrypt_value(encrypted_swid, key)

    import json

    tenant_dir = ROOT / "data" / "tenants" / import_id
    raw_dir = tenant_dir / "raw"
    processed_dir = tenant_dir / "processed"
    manual_dir = tenant_dir / "manual"

    import_id_clean = import_id.replace("'", "")
    _set_status(import_id_clean, "running")

    # extract.py writes to data/raw -- move the result into the tenant's dir so
    # two crawls can never interleave into one shared archive.
    import shutil

    config_path = ROOT / "config.json"
    config_path.write_text(json.dumps({
        "league_id": int(league_id),
        "year_start": int(year_start),
        "year_end": int(year_end),
        "espn_s2": espn_s2,
        "swid": swid,
    }, indent=2))

    try:
        # Start from a clean tenant raw dir; extract.py is idempotent and would
        # otherwise skip files left over from a previous failed attempt.
        if raw_dir.exists():
            shutil.rmtree(raw_dir)

        try:
            subprocess.run(
                [sys.executable, str(ROOT / "scripts" / "extract.py")],
                cwd=str(ROOT),
                check=True,
            )
        except subprocess.CalledProcessError as exc:
            _set_status(import_id_clean, "failed", f"extract failed: {exc}")
            sys.exit("extract.py failed; aborting import crawl.")

        repo_raw = ROOT / "data" / "raw"
        if not repo_raw.is_dir():
            _set_status(import_id_clean, "failed", "extract produced no raw archive")
            sys.exit(f"Expected raw output at {repo_raw}, but it was not created.")
        raw_dir.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(repo_raw), str(raw_dir))

        uploaded_raw = _upload(raw_dir, f"raw/{import_id_clean}")

        # Owner identity has to come from this league's own ESPN member records --
        # the repo's data/manual/owner-map.json is hand-curated for the
        # record-book league and resolves zero owners for anyone else, which
        # failed normalization outright.
        try:
            subprocess.run(
                [
                    sys.executable, str(ROOT / "scripts" / "derive_owner_map.py"),
                    "--raw-dir", str(raw_dir),
                    "--out-dir", str(manual_dir),
                ],
                cwd=str(ROOT),
                check=True,
            )
        except subprocess.CalledProcessError as exc:
            _set_status(import_id_clean, "failed", f"owner derivation failed: {exc}")
            sys.exit("derive_owner_map.py failed; import marked failed.")

        try:
            subprocess.run(
                [
                    sys.executable, str(ROOT / "scripts" / "normalize_for_import.py"),
                    "--raw-dir", str(raw_dir),
                    "--out-dir", str(processed_dir),
                    "--manual-dir", str(manual_dir),
                ],
                cwd=str(ROOT),
                check=True,
            )
        except subprocess.CalledProcessError as exc:
            _set_status(import_id_clean, "failed", f"normalize/validate failed: {exc}")
            sys.exit("normalize.py or validate.py failed; import marked failed.")

        uploaded_processed = _upload(processed_dir, f"processed/{import_id_clean}")
        uploaded_manual = _upload_proxy_served_manual(
            manual_dir, f"processed/{import_id_clean}"
        )
        _set_status(import_id_clean, "completed")

        print(
            f"Import {import_id_clean} completed: "
            f"{uploaded_raw} raw + {uploaded_processed} processed + "
            f"{uploaded_manual} manual objects uploaded to R2."
        )
    finally:
        # Never leave decrypted ESPN cookies on disk.
        config_path.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
