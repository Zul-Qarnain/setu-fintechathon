"""HMAC tokenisation, normalisation and PII redaction.

Account numbers / names are replaced by stable HMAC tokens (ACCT_xxxxxxxxxx) before any text
reaches an LLM adapter, and PII is redacted from logs/audit payloads.
"""

from __future__ import annotations

import hashlib
import hmac
import re
import unicodedata

from app.config import get_settings

# Characters that look like ASCII letters/digits but are not (Cyrillic/Greek/fullwidth etc.).
_CONFUSABLES = {
    "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x", "і": "i", "ј": "j",
    "ѕ": "s", "һ": "h", "ԁ": "d", "ɡ": "g", "ո": "n", "А": "A", "В": "B", "Е": "E", "К": "K",
    "М": "M", "Н": "H", "О": "O", "Р": "P", "С": "C", "Т": "T", "Х": "X", "І": "I", "Ѕ": "S",
    "α": "a", "ο": "o", "ν": "v", "ρ": "p", "Ο": "O", "Α": "A", "Β": "B", "Ε": "E", "Ι": "I",
    "Κ": "K", "Μ": "M", "Ν": "N", "Τ": "T", "Χ": "X", "Υ": "Y", "Ζ": "Z",
}  # fmt: skip
_LOOKALIKE_DIGITS_LETTERS = str.maketrans({"1": "l", "0": "o", "5": "s", "3": "e", "@": "a"})

_ACCT_RE = re.compile(r"(?<![\w])(?:\d[ \-]?){12,19}(?![\w])")
_EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_PHONE_RE = re.compile(r"(?<!\d)(?:\+?86[ -]?)?1[3-9]\d{9}(?!\d)")


def _key() -> bytes:
    return get_settings().hmac_key.encode("utf-8")


def normalize_account(raw: str) -> str:
    """NFKC-fold (fullwidth digits -> ASCII), strip separators. Returns digits/letters only."""
    s = unicodedata.normalize("NFKC", raw)
    return re.sub(r"[\s\-_.]", "", s)


def has_homoglyphs(raw: str) -> bool:
    """True if the string mixes in non-ASCII lookalike characters (before NFKC folding)."""
    if any(ch in _CONFUSABLES for ch in raw):
        return True
    # fullwidth digits/letters are folded by NFKC but are still a spoofing signal
    return any(0xFF10 <= ord(ch) <= 0xFF5A for ch in raw)


def is_valid_account(raw: str) -> bool:
    n = normalize_account(raw)
    return n.isascii() and n.isdigit() and 8 <= len(n) <= 24 and not has_homoglyphs(raw)


def account_token(raw: str) -> str:
    """Stable HMAC token for an account number, e.g. ACCT_7f3a91c2e0."""
    n = normalize_account(raw)
    return "ACCT_" + hmac.new(_key(), b"acct:" + n.encode(), hashlib.sha256).hexdigest()[:10]


def account_hash(raw: str) -> str:
    """Full HMAC-SHA256 (hex) used as the lookup key in the payee registry."""
    n = normalize_account(raw)
    return hmac.new(_key(), b"acct:" + n.encode(), hashlib.sha256).hexdigest()


def name_token(name: str) -> str:
    return "NAME_" + hmac.new(_key(), b"name:" + name_skeleton(name).encode(), hashlib.sha256).hexdigest()[:10]


def mask_account(raw: str) -> str:
    n = normalize_account(raw)
    return "****" + n[-4:] if len(n) >= 4 else "****"


def name_skeleton(name: str) -> str:
    """Confusable-folded, case-folded, punctuation-free form for lookalike comparison."""
    s = "".join(_CONFUSABLES.get(ch, ch) for ch in name)
    s = unicodedata.normalize("NFKC", s).casefold()
    s = re.sub(r"\(.*?\)|（.*?）", "", s)  # drop "(SYNTHETIC)" style suffixes
    s = s.translate(_LOOKALIKE_DIGITS_LETTERS)
    return re.sub(r"[^a-z\u4e00-\u9fff]", "", s)


def tokenize_text(text: str) -> tuple[str, dict[str, str]]:
    """Replace account-number-like sequences with tokens. Returns (text, token->masked map)."""
    mapping: dict[str, str] = {}

    def repl(m: re.Match[str]) -> str:
        tok = account_token(m.group(0))
        mapping[tok] = mask_account(m.group(0))
        return tok

    return _ACCT_RE.sub(repl, text), mapping


def redact_pii(text: str) -> str:
    """Redact account numbers, emails and phone numbers for logs and audit payloads."""
    out = _EMAIL_RE.sub("[EMAIL]", text)
    out = _PHONE_RE.sub("[PHONE]", out)
    return _ACCT_RE.sub(lambda m: mask_account(m.group(0)), out)


def redact_obj(obj: object) -> object:
    """Recursively redact strings in JSON-like structures."""
    if isinstance(obj, str):
        return redact_pii(obj)
    if isinstance(obj, dict):
        return {k: redact_obj(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [redact_obj(v) for v in obj]
    return obj
