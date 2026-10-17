"""Reply validator: reject any reply containing numbers absent from tool outputs (anti-hallucination)."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

# digits not glued to letters (so "T3"/"ACCT_7f3a" are ignored); allows 1,234.56 and 1.5
_NUM = re.compile(r"(?<![A-Za-z_\d.])\d[\d,]*(?:\.\d+)?")


_TIER = re.compile(r"\b(?:Tier\s*\d|T\d)\b|[T]\d\s*级")


def _norm(tok: str) -> str:
    t = tok.replace(",", "")
    if "." in t:
        a, b = t.split(".", 1)
        b = b.rstrip("0")
        return f"{int(a)}.{b}" if b else str(int(a))
    return str(int(t))


def numbers_in(text: str) -> set[str]:
    """Numeric tokens, canonicalised (commas/leading+trailing zeros). Tier labels (T3) are ignored."""
    text = _TIER.sub(" ", text)
    return {_norm(m.group(0)) for m in _NUM.finditer(text)}


def allowed_numbers(tool_outputs: list[dict[str, Any]], extra_text: str = "") -> set[str]:
    blob = json.dumps(tool_outputs, ensure_ascii=False, default=str)
    out = numbers_in(blob) | numbers_in(extra_text)
    return out


@dataclass(frozen=True)
class ValidationResult:
    ok: bool
    unsupported: list[str]


def validate_reply(reply: str, tool_outputs: list[dict[str, Any]], user_message: str = "") -> ValidationResult:
    allowed = allowed_numbers(tool_outputs, user_message)
    bad = sorted(n for n in numbers_in(reply) if n not in allowed)
    return ValidationResult(not bad, bad)
