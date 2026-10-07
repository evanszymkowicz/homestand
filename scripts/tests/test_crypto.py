#!/usr/bin/env python3
"""Quick self-check for scripts/lib/crypto.py."""

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from lib.crypto import decrypt_value, encrypt_value  # noqa: E402


def main() -> None:
    key = os.urandom(32).hex()
    plaintext = "espn_s2=some-secret-value"
    blob = encrypt_value(plaintext, key)
    recovered = decrypt_value(blob, key)
    assert recovered == plaintext, f"decrypted {recovered!r} != {plaintext!r}"

    # Tampered key should fail
    bad_key = os.urandom(32).hex()
    try:
        decrypt_value(blob, bad_key)
        raise AssertionError("expected decrypt with wrong key to fail")
    except Exception:
        pass

    print("ok")


if __name__ == "__main__":
    main()
