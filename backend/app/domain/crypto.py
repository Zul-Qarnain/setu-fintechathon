"""AES-256-GCM field encryption for data at rest (PII columns, TOTP secrets)."""

from __future__ import annotations

import base64
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.config import get_settings

NONCE_LEN = 12
PREFIX = "enc:v1:"


class CryptoError(Exception):
    """Raised on decrypt failure (wrong key, tamper, malformed)."""


def _key(key_b64: str | None = None) -> bytes:
    raw = base64.b64decode(key_b64 or get_settings().aes_key_b64)
    if len(raw) != 32:
        raise CryptoError("AES key must be 32 bytes (base64)")
    return raw


def encrypt(plaintext: str, *, aad: str = "", key_b64: str | None = None) -> str:
    """Encrypt to `enc:v1:<b64(nonce||ct||tag)>`. `aad` binds ciphertext to a context (row id)."""
    nonce = os.urandom(NONCE_LEN)
    ct = AESGCM(_key(key_b64)).encrypt(nonce, plaintext.encode("utf-8"), aad.encode("utf-8"))
    return PREFIX + base64.b64encode(nonce + ct).decode("ascii")


def decrypt(token: str, *, aad: str = "", key_b64: str | None = None) -> str:
    if not token.startswith(PREFIX):
        raise CryptoError("not an encrypted value")
    try:
        raw = base64.b64decode(token[len(PREFIX) :])
        nonce, ct = raw[:NONCE_LEN], raw[NONCE_LEN:]
        return AESGCM(_key(key_b64)).decrypt(nonce, ct, aad.encode("utf-8")).decode("utf-8")
    except CryptoError:
        raise
    except Exception as exc:  # InvalidTag, binascii.Error, ...
        raise CryptoError("decryption failed") from exc
