"""Intake: treat uploaded documents / messages as untrusted DATA; parse notices (no OCR).

Supports typed text and text-layer PDFs (pypdf). Parsed fields must be confirmed by the user.
"""

from __future__ import annotations

import io
import re
import unicodedata
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation

from app.domain import tokenize

MAX_TEXT = 20000

_AMOUNT_LABELS = r"(?:amount due|amount|total due|应缴金额|应付金额|缴费金额|金额)"
_DUE_LABELS = r"(?:due date|deadline|缴费截止日期|截止日期|到期日期|到期日)"
_PAYEE_LABELS = r"(?:payee|beneficiary|pay to|收款单位|收款人|收款方)"
_ACCT_LABELS = r"(?:account(?: number| no\.?)?|账号|账户|银行账号)"
_REF_LABELS = r"(?:reference|ref\.?|缴费编号|编号|参考号)"
_ITEM_LABELS = r"(?:item|description|项目|缴费项目)"
_SEP = r"\s*[:：]\s*"

_MONTHS = {m: i for i, m in enumerate(
    ["january", "february", "march", "april", "may", "june", "july", "august", "september",
     "october", "november", "december"], start=1)}  # fmt: skip


@dataclass(frozen=True)
class ParsedFields:
    amount_cny: Decimal | None
    due_date: date | None
    payee_name: str | None
    account_number: str | None  # normalised digits as found (may be invalid / homoglyph-laden)
    account_raw: str | None
    reference: str | None
    item: str | None
    issuer: str | None
    language: str  # en | zh | mixed | unknown


def extract_text(filename: str, data: bytes) -> str:
    """Text-layer extraction only. .txt decoded as UTF-8; .pdf via pypdf (no OCR)."""
    if filename.lower().endswith(".pdf"):
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(data))
        text = "\n".join((p.extract_text() or "") for p in reader.pages)
        if not text.strip():
            raise ValueError("PDF has no text layer (OCR is not supported)")
        return text[:MAX_TEXT]
    return data.decode("utf-8", errors="replace")[:MAX_TEXT]


def detect_language(text: str) -> str:
    zh = len(re.findall(r"[\u4e00-\u9fff]", text))
    en = len(re.findall(r"[A-Za-z]", text))
    if zh == 0 and en == 0:
        return "unknown"
    if zh and en and min(zh * 3, en) > 0.15 * max(zh * 3, en):
        return "mixed" if zh > 8 and en > 40 else ("zh" if zh * 3 > en else "en")
    return "zh" if zh * 3 > en else "en"


def parse_amount(s: str) -> Decimal | None:
    m = re.search(r"(\d[\d,，]*(?:\.\d{1,2})?)", unicodedata.normalize("NFKC", s))
    if not m:
        return None
    try:
        return Decimal(m.group(1).replace(",", "").replace("，", ""))
    except InvalidOperation:
        return None


def parse_date(s: str) -> date | None:
    s = unicodedata.normalize("NFKC", s)
    m = re.search(r"(\d{4})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})", s)
    if not m:
        m = re.search(r"(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?", s)
    if m:
        try:
            return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError:
            return None
    m = re.search(r"(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})", s)
    if m and m.group(2).lower() in _MONTHS:
        try:
            return date(int(m.group(3)), _MONTHS[m.group(2).lower()], int(m.group(1)))
        except ValueError:
            return None
    return None


def _field(text: str, labels: str) -> str | None:
    m = re.search(rf"(?im)^[ \t]*{labels}{_SEP}(.+?)\s*$", text)
    return m.group(1).strip() if m else None


def parse_notice(text: str) -> ParsedFields:
    """Label-based parser for the structured notices Setu supports. Never executes anything."""
    amount_s = _field(text, _AMOUNT_LABELS)
    due_s = _field(text, _DUE_LABELS)
    acct_raw = _field(text, _ACCT_LABELS)
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    issuer = None
    for ln in lines:
        if "SYNTHETIC" in ln.upper() and len(ln) < 90 and ("NOT A REAL" in ln.upper() or "合成" in ln):
            continue
        if "合成样例" in ln:
            continue
        issuer = re.sub(r"\s*[-–—]\s*Finance Office.*$", "", ln)
        issuer = re.sub(r"\s*财务处.*$", "", issuer)
        break
    acct_norm = tokenize.normalize_account(acct_raw) if acct_raw else None
    return ParsedFields(
        amount_cny=parse_amount(amount_s) if amount_s else None,
        due_date=parse_date(due_s) if due_s else None,
        payee_name=_field(text, _PAYEE_LABELS),
        account_number=acct_norm,
        account_raw=acct_raw,
        reference=_field(text, _REF_LABELS),
        item=_field(text, _ITEM_LABELS),
        issuer=issuer,
        language=detect_language(text),
    )


def wrap_untrusted(text: str) -> str:
    """Wrap DATA so downstream prompts can never confuse it with instructions."""
    safe = text.replace("</untrusted>", "[/untrusted]")
    return f'<untrusted source="document">\n{safe}\n</untrusted>'
