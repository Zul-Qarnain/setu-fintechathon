"""Guardian: rules + payee registry (no ML). Flags prompt injection, scams, spoofing.

Pure functions; the policy engine (not the guardian) makes the final authorisation decision,
but a `blocked` verdict forces Tier 4.
"""

from __future__ import annotations

import re
import unicodedata

from app import schemas as s
from app.agents.intake import ParsedFields, parse_amount
from app.domain import tokenize

# (code, severity, regex, message)
_RULES: list[tuple[str, str, str, str]] = [
    ("INJECTION_PHRASE", "block",
     r"ignore\s+(?:all\s+|any\s+|the\s+)?(?:previous|prior|above|earlier)\s+(?:instructions?|rules?|prompts?)"
     r"|disregard\s+(?:all\s+|any\s+|the\s+)?(?:previous|prior|above|your)\s+\w*\s*(?:instructions?|rules?)"
     r"|(?:note|message|instruction)s?\s+to\s+(?:the\s+)?(?:ai|assistant|agent|model|llm|bot)"
     r"|system\s*(?:prompt|override|message)\s*[:：]"
     r"|you\s+are\s+now\s+(?:in\s+)?(?:a\s+)?(?:developer|admin|dan|unrestricted)"
     r"|<\s*/?\s*(?:system|assistant|instructions?)\s*>"
     r"|(?:忽略|无视|不要理会)(?:之前|以上|上述|先前|前面)?的?(?:所有|全部|任何)?(?:指令|指示|规则|提示|说明)"
     r"|系统(?:提示|指令|消息)\s*[:：]"
     r"|(?:给|致)(?:AI|人工智能|助手|智能体)(?:的)?(?:备注|说明|指令)",
     "Document contains an instruction aimed at the assistant."),
    ("NO_CONFIRMATION_DEMAND", "block",
     r"(?:do\s+not|don't|never)\s+(?:ask|tell|inform|notify|confirm\s+with|alert)\s+(?:the\s+)?(?:user|student|parent|owner)"
     r"|without\s+(?:asking|confirmation|approval|verification)"
     r"|skip\s+(?:the\s+)?(?:approval|verification|totp|2fa|confirmation)"
     r"|(?:不要|无需|不必|别)(?:询问|告诉|通知|确认|征求)(?:用户|学生|家长|本人)?"
     r"|无需(?:审批|验证|确认|批准)|跳过(?:审批|验证|确认)",
     "Content tells the assistant to bypass user confirmation or approval."),
    ("TOOL_COMMAND_IN_DOC", "block",
     r"\b(?:propose_payment|execute_payment|transfer_funds|send_money|export_all|dump_users)\b"
     r"|(?:立即|马上|现在)(?:向|给).{0,30}(?:转账|汇款|付款)",
     "Document text contains a payment/tool command."),
    ("PERSONAL_ACCOUNT_CHANNEL", "block",
     r"personal\s+(?:wechat|alipay|account|bank\s+card)|(?:pay|transfer)\s+(?:via|to|through)\s+(?:my\s+)?(?:wechat|alipay|whatsapp|telegram)"
     r"|gift\s*cards?|crypto|bitcoin|usdt"
     r"|个人(?:微信|支付宝|账户|账号|银行卡)|私人账户|礼品卡|比特币|虚拟货币",
     "Payment requested to a personal account or untraceable channel."),
    ("URGENCY_SCAM", "warn",
     r"within\s+\d+\s+(?:hours?|minutes?)|visa\s+(?:will\s+be\s+)?(?:cancel|revok|void)|deport|arrest|police|immediately\s+or"
     r"|\d+\s*(?:小时|分钟)内|签证(?:将|会)?(?:被)?(?:取消|吊销|作废)|遣返|逮捕|公安|立即缴费否则|否则.{0,10}(?:取消|冻结)",
     "Urgency / threat wording typical of scams."),
    ("PAYEE_CHANGE_NOTICE", "warn",
     r"(?:bank|account)\s+(?:details?|number|account)?\s*(?:has|have)?\s*(?:been\s+)?(?:changed|updated|moved)"
     r"|new\s+(?:bank\s+)?account|changed\s+(?:our|the)\s+(?:bank\s+)?account|please\s+(?:use|transfer\s+to)\s+(?:the\s+)?new"
     r"|(?:账号|账户|收款(?:账号|账户))(?:已)?(?:变更|更换|更改|调整)|新(?:的)?(?:收款)?(?:账号|账户)|转(?:至|到)新",
     "Notice claims the payee account has changed."),
]
_COMPILED = [(c, sev, re.compile(rx, re.I), msg) for c, sev, rx, msg in _RULES]
_SUMMARY_LINE = re.compile(
    r"(?im)^[ \t]*(?:summary|total payable|total|in words|grand total|合计|总计|大写|摘要)[^:：\n]*[:：]\s*(.+)$"
)


def scan_text(text: str, parsed: ParsedFields | None = None) -> s.GuardianVerdict:
    """Scan untrusted text. Returns clean | suspicious | blocked with machine-readable flags."""
    flags: list[s.GuardianFlag] = []
    seen: set[str] = set()
    norm = unicodedata.normalize("NFKC", text)
    for code, sev, rx, msg in _COMPILED:
        if code not in seen and rx.search(norm):
            seen.add(code)
            flags.append(s.GuardianFlag(code=code, severity=sev, message=msg))  # type: ignore[arg-type]
    if tokenize.has_homoglyphs(text):
        # only flag when lookalikes appear in identity-bearing lines (issuer, payee, account)
        flags.append(s.GuardianFlag(code="HOMOGLYPH", severity="block",
                                    message="Lookalike (non-ASCII) characters in names or account numbers."))  # fmt: skip
    if parsed is not None:
        if parsed.account_raw and not tokenize.is_valid_account(parsed.account_raw):
            if "HOMOGLYPH" not in {f.code for f in flags}:
                flags.append(s.GuardianFlag(code="ACCOUNT_INVALID", severity="warn",
                                            message="Account number is malformed."))  # fmt: skip
        if parsed.amount_cny is not None:
            for m in _SUMMARY_LINE.finditer(text):
                other = parse_amount(m.group(1))
                if other is not None and other != parsed.amount_cny:
                    flags.append(s.GuardianFlag(code="AMOUNT_MISMATCH", severity="block",
                                                message="Summary amount differs from the 'Amount due' line."))  # fmt: skip
                    break
        missing = [n for n, v in (("amount", parsed.amount_cny), ("due_date", parsed.due_date),
                                  ("payee", parsed.payee_name), ("account", parsed.account_raw)) if v is None]  # fmt: skip
        if missing:
            flags.append(s.GuardianFlag(code="FIELDS_MISSING", severity="warn",
                                        message=f"Could not parse: {', '.join(missing)}."))  # fmt: skip
    return _verdict(flags)


def _verdict(flags: list[s.GuardianFlag]) -> s.GuardianVerdict:
    score = 0.0
    for f in flags:
        score += {"block": 0.6, "warn": 0.25, "info": 0.05}[f.severity]
    score = round(min(score, 0.99), 2)
    if any(f.severity == "block" for f in flags):
        verdict = "blocked"
        score = max(score, 0.9)
    elif any(f.severity == "warn" for f in flags):
        verdict = "suspicious"
    else:
        verdict = "clean"
    return s.GuardianVerdict(verdict=verdict, score=score, flags=flags)  # type: ignore[arg-type]


def registry_flags(
    payee_name: str | None, account_number: str | None, registry: list[tuple[str, str, bool]]
) -> list[s.GuardianFlag]:  # fmt: skip
    """Compare a document's payee/account with the owner's registry.

    registry rows: (name, account_hash, verified). Returns flags (never blocks by itself).
    """
    if not payee_name or not account_number:
        return []
    h = tokenize.account_hash(account_number)
    sk = tokenize.name_skeleton(payee_name)
    for name, acct_hash, verified in registry:
        if acct_hash == h:
            if verified:
                return []
            return [s.GuardianFlag(code="PAYEE_UNVERIFIED", severity="warn",
                                   message="Account matches a payee that is not yet verified.")]  # fmt: skip
    for name, _h, verified in registry:
        if tokenize.name_skeleton(name) == sk and verified:
            return [s.GuardianFlag(code="PAYEE_CHANGED", severity="warn",
                                   message="Same payee name but a different account than the verified one.")]  # fmt: skip
    # lookalike name: skeleton close but exact text differs
    for name, _h, verified in registry:
        if verified and tokenize.name_skeleton(name) != sk and _near(sk, tokenize.name_skeleton(name)):
            return [s.GuardianFlag(code="LOOKALIKE_PAYEE", severity="block",
                                   message="Payee name closely resembles a verified payee but differs.")]  # fmt: skip
    return [s.GuardianFlag(code="PAYEE_NOT_IN_REGISTRY", severity="warn",
                           message="Account is not in your payee registry.")]  # fmt: skip


def _near(a: str, b: str) -> bool:
    if not a or not b or abs(len(a) - len(b)) > 2:
        return False
    # Levenshtein distance <= 2
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1] <= 2


def merge(verdict: s.GuardianVerdict, extra: list[s.GuardianFlag]) -> s.GuardianVerdict:
    codes = {f.code for f in verdict.flags}
    return _verdict(verdict.flags + [f for f in extra if f.code not in codes])


def check_message(text: str) -> s.GuardianVerdict:
    """Guardian pass for chat/SMS text (no parsed fields)."""
    return scan_text(text, None)


