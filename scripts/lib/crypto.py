"""AES-256-GCM encryption helpers for Python workers.

Matches the Web Crypto AES-GCM format used by the Pages Function functions/lib/crypto.ts:
plaintext is encrypted with a random 12-byte IV and the result is stored as hex IV:ciphertext.
"""

from __future__ import annotations

import binascii
import os
from typing import Union

# AES-GCM uses a 12-byte (96-bit) nonce by convention
IV_SIZE = 12


def _hex_to_bytes(hex_str: str) -> bytes:
    return binascii.unhexlify(hex_str)


def _bytes_to_hex(data: bytes) -> str:
    return binascii.hexlify(data).decode("ascii")


def decrypt_value(encrypted_blob: str, hex_key: str) -> str:
    """Decrypt a hex-encoded IV-prefixed AES-256-GCM blob."""
    try:
        iv_hex, cipher_hex = encrypted_blob.split(":", 1)
    except ValueError as exc:
        raise ValueError("encrypted blob must be IV_hex:ciphertext_hex") from exc

    iv = _hex_to_bytes(iv_hex)
    ciphertext = _hex_to_bytes(cipher_hex)
    key = _hex_to_bytes(hex_key)

    if len(key) != 32:
        raise ValueError(f"key must be 32 bytes (64 hex chars), got {len(key)}")

    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    aesgcm = AESGCM(key)
    plaintext = aesgcm.decrypt(iv, ciphertext, None)
    return plaintext.decode("utf-8")


def encrypt_value(plaintext: str, hex_key: str) -> str:
    """Encrypt plaintext with AES-256-GCM and return IV_hex:ciphertext_hex."""
    key = _hex_to_bytes(hex_key)
    if len(key) != 32:
        raise ValueError(f"key must be 32 bytes (64 hex chars), got {len(key)}")

    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    aesgcm = AESGCM(key)
    iv = os.urandom(IV_SIZE)
    ciphertext = aesgcm.encrypt(iv, plaintext.encode("utf-8"), None)
    return f"{_bytes_to_hex(iv)}:{_bytes_to_hex(ciphertext)}"
