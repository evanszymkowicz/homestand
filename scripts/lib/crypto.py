"""AES-256-GCM encryption helpers for Python workers.

Matches the Web Crypto AES-GCM format used by the Pages Function functions/lib/crypto.ts:
plaintext is encrypted with a random 12-byte IV and the result is stored as hex IV:ciphertext.
"""

from __future__ import annotations

import os

# AES-GCM uses a 12-byte (96-bit) nonce by convention
IV_SIZE = 12


def decrypt_value(encrypted_blob: str, hex_key: str) -> str:
    """Decrypt a hex-encoded IV-prefixed AES-256-GCM blob."""
    try:
        iv_hex, cipher_hex = encrypted_blob.split(":", 1)
    except ValueError as exc:
        raise ValueError("encrypted blob must be IV_hex:ciphertext_hex") from exc

    iv = bytes.fromhex(iv_hex)
    ciphertext = bytes.fromhex(cipher_hex)
    key = bytes.fromhex(hex_key)

    if len(key) != 32:
        raise ValueError(f"key must be 32 bytes (64 hex chars), got {len(key)}")

    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    aesgcm = AESGCM(key)
    plaintext = aesgcm.decrypt(iv, ciphertext, None)
    return plaintext.decode("utf-8")


def encrypt_value(plaintext: str, hex_key: str) -> str:
    """Encrypt plaintext with AES-256-GCM and return IV_hex:ciphertext_hex."""
    key = bytes.fromhex(hex_key)
    if len(key) != 32:
        raise ValueError(f"key must be 32 bytes (64 hex chars), got {len(key)}")

    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    aesgcm = AESGCM(key)
    iv = os.urandom(IV_SIZE)
    ciphertext = aesgcm.encrypt(iv, plaintext.encode("utf-8"), None)
    return f"{iv.hex()}:{ciphertext.hex()}"
