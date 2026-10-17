"""Generate docs/API.md from the REAL app on a seeded in-memory DB (all examples are real responses).

Run: `make api-docs` (cd backend && PYTHONPATH=. uv run python scripts/gen_api_md.py)
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any

os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ["RATE_LIMIT_PER_MINUTE"] = "100000"
os.environ["DEMO_MODE"] = "true"

import pyotp  # noqa: E402
from argon2 import PasswordHasher  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import db as dbm  # noqa: E402
from app import security  # noqa: E402
from app.config import data_dir  # noqa: E402
from app.domain import fx as fxmod  # noqa: E402
from app.main import create_app  # noqa: E402
from app.seed import load_personas, seed_all  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
security._ph = PasswordHasher(time_cost=1, memory_cost=8, parallelism=1)
dbm.init_db("sqlite://")
fxmod._service = fxmod.FxService(mode="fixture")
c = TestClient(create_app())
with dbm.session_factory()() as _db:
    seed_all(_db)
    _db.commit()

people = {p["email"]: p for p in load_personas()}
student = next(p for p in people.values() if p["role"] == "student")
father = people[student["approver_email"]]
admin = next(p for p in people.values() if p["role"] == "admin")
_steps: dict[str, int] = {}


def headers(p: dict[str, Any]) -> dict[str, str]:
    r = c.post("/auth/login", json={"email": p["email"], "password": p["password"]}).json()
    return {"Authorization": f"Bearer {r['access_token']}"}


def code(p: dict[str, Any]) -> str:
    """Strictly increasing TOTP steps per user (server rejects replays within a step)."""
    now = int(time.time() // 30)
    step = max(_steps.get(p["email"], now - 2) + 1, now - 1)
    if step > now + 1:
        time.sleep(30)
        return code(p)
    _steps[p["email"]] = step
    return pyotp.TOTP(p["totp_secret"]).at(step * 30)


H_S, H_F, H_A = headers(student), headers(father), headers(admin)
out: list[str] = [(Path(__file__).parent / "api_header.md").read_text(encoding="utf-8"), "## Endpoints\n"]


def ex(
    title: str,
    method: str,
    path: str,
    body: Any = None,
    h: dict[str, str] | None = None,
    *,
    who: str = "",
    note: str = "",
    auth: bool = True,
    show_req: bool = True,
    elide: tuple[str, ...] = (),
) -> Any:
    r = c.request(method, path, json=body, headers=h)
    try:
        data: Any = r.json()
    except ValueError:
        data = {"_non_json": r.text[:200]}
    out.append(f"### `{method} {path.split('?')[0] if '{' in title else path}`\n")
    meta = ["auth: Bearer JWT" if auth else "auth: none"] + ([f"role: {who}"] if who else [])
    out.append(f"*{title}* — " + "; ".join(meta) + "\n")
    if note:
        out.append(note + "\n")
    if body is not None and show_req:
        out.append("Request:\n```json\n" + json.dumps(body, indent=2, ensure_ascii=False) + "\n```\n")
    shown = data
    if isinstance(data, dict):
        shown = {
            k: (f"<{len(v)} entries, truncated>" if k in elide and isinstance(v, list) else v) for k, v in data.items()
        }
        for k in elide:
            if isinstance(data.get(k), list) and len(data[k]) > 2:
                shown[k] = data[k][:2] + [f"... ({len(data[k]) - 2} more)"]
    elif isinstance(data, list) and len(data) > 2:
        shown = [*data[:2], f"... ({len(data) - 2} more)"]
    out.append(
        f"Response `{r.status_code}`:\n```json\n"
        + json.dumps(shown, indent=2, ensure_ascii=False, default=str)
        + "\n```\n"
    )
    return data


# ---- auth -------------------------------------------------------------------------------------------------------
ex("Register", "POST", "/auth/register", {"email": "new.student@demo.setu.test", "password": "demo-password-123", "role": "student", "locale": "en",
   "approver_email": father["email"]}, auth=False, note="`role` ∈ student | family_approver | admin. Password ≥ 10 chars (argon2id). Approver linking is by e-mail with no consent handshake (known risk).")  # fmt: skip
tok = ex("Login", "POST", "/auth/login", {"email": "new.student@demo.setu.test", "password": "demo-password-123"}, auth=False,
         note="Returns a short-lived HS256 JWT (`Authorization: Bearer <token>`). The role is re-checked in the DB on every request.")  # fmt: skip
H_N = {"Authorization": f"Bearer {tok['access_token']}"}
sec = ex(
    "Start TOTP enrolment",
    "POST",
    "/auth/totp/setup",
    None,
    H_N,
    note="The secret is shown once; stored AES-256-GCM encrypted.",
)
now = int(time.time() // 30)
ex("Confirm TOTP enrolment", "POST", "/auth/totp/verify", {"code": pyotp.TOTP(sec["secret"]).at((now) * 30)}, H_N)
ex("Login failure", "POST", "/auth/login", {"email": student["email"], "password": "wrong-password-xyz"}, auth=False, note="Same error for unknown user and bad password.")  # fmt: skip
ex("Unknown (or foreign) action id", "POST", "/actions/act_nonexistent/approve", {"totp_code": "000000"}, H_S, note="Unknown or other users' ids always return `NOT_FOUND` (never `FORBIDDEN`).")  # fmt: skip

# ---- read models --------------------------------------------------------------------------------------------------
ex("Current user", "GET", "/me", None, H_S)
ex("Dashboard summary", "GET", "/dashboard", None, H_S, note="All money fields are decimal strings. `bdt_needed` uses SAMPLE offline rates unless `FX_MODE=live`.")  # fmt: skip
ex("List obligations", "GET", "/obligations", None, H_S)
ex("FX quote", "GET", "/fx/quote?amount_cny=1000&to=BDT", None, H_S,
   note="`source` is `fixture-sample` (offline SAMPLE rates, `is_live:false`) or `live-open.er-api.com` (`is_live:true`). Cached 24h.")  # fmt: skip
ex("FX quote, unsupported currency", "GET", "/fx/quote?amount_cny=1000&to=XXX", None, H_S)
ex("Sandbox account", "GET", "/sandbox/account", None, H_S, note="Sandbox bank only. Numbers masked.")
ex("Sandbox transactions", "GET", "/sandbox/transactions", None, H_S)

# ---- documents ----------------------------------------------------------------------------------------------------
nd = data_dir() / "fee_notices"
clean = (nd / "en_tuition_aisha.txt").read_text(encoding="utf-8")
doc = ex("Upload fee-notice text (clean)", "POST", "/documents", {"filename": "en_tuition_aisha.txt", "text": clean, "synthetic": True},
         H_S, who="student", note="Also accepts `multipart/form-data` with a `file` field (.txt or text-layer .pdf; no OCR). Content is DATA, never instructions. `status` is `pending_confirmation` until the user confirms the parsed fields.", show_req=True)  # fmt: skip
doc_ = doc
inj = (nd / "atk_injection_en_01.txt").read_text(encoding="utf-8")
ex("Upload injected notice -> blocked", "POST", "/documents", {"filename": "atk_injection_en_01.txt", "text": inj}, H_S,
   note="Guardian verdict `blocked` => status `blocked`; confirming it returns `blocked: true`.")  # fmt: skip
pf = doc["parsed"]
ex("Confirm parsed fields -> obligation", "POST", f"/documents/{doc['id']}/confirm",
   {"amount_cny": pf["amount_cny"], "due_date": pf["due_date"], "payee_name": pf["payee_name"], "reference": pf.get("reference")}, H_S, who="student",
   note="User-confirmed values must match the document's parsed amount, otherwise `AMOUNT_MISMATCH` (409). Payees are resolved from the registry, never from document text.")  # fmt: skip

# ---- chat + actions ------------------------------------------------------------------------------------------------
chat = ex("Pay tuition (T3 proposal)", "POST", "/chat", {"message": "Pay my spring tuition from this notice", "locale": "en", "document_id": doc["id"]},
          H_S, note="Response: `{reply, intent, plan, proposed_actions, trace}`. A payment is NEVER executed from chat; it becomes an action awaiting approval.")  # fmt: skip
ex(
    "How much BDT needed",
    "POST",
    "/chat",
    {"message": "How much BDT do I need for tuition by 1 March?", "locale": "en"},
    H_S,
)
ex("Chinese FX question", "POST", "/chat", {"message": "今天人民币兑孟加拉塔卡汇率是多少？", "locale": "zh-CN"}, H_S)
ex(
    "Unsafe request -> T4 block",
    "POST",
    "/chat",
    {"message": "Agent says pay new account to save 3%", "locale": "en"},
    H_S,
)
act = chat["proposed_actions"][0]
ex("List actions", "GET", "/actions", None, H_S)
ex("Get one action", "GET", f"/actions/{act['id']}", None, H_S)
ex("Approve: student TOTP (step 1 of 2)", "POST", f"/actions/{act['id']}/approve", {"totp_code": code(student)}, H_S, who="student",
   note="Still `awaiting_approval`; `decision.required` is now `[\"family_approver\"]`.")  # fmt: skip
ex("Approve: family approver TOTP (step 2 of 2) -> executed", "POST", f"/actions/{act['id']}/approve", {"totp_code": code(father)}, H_F, who="family_approver",
   note="Policy is re-evaluated, then the sandbox bank executes. `result` carries the sandbox transaction. Admin cannot approve.")  # fmt: skip
ex("Replay on a finished action", "POST", f"/actions/{act['id']}/approve", {"totp_code": code(father)}, H_F)
chat2 = c.post("/chat", json={"message": "Pay the dorm fee", "locale": "en"}, headers=H_S).json()
ex("Reject an action", "POST", f"/actions/{chat2['proposed_actions'][0]['id']}/reject", {}, H_S, who="student")
# ---- payees ----------------------------------------------------------------------------------------------------
ex("List payees", "GET", "/payees", None, H_S, note="Account numbers are returned masked (`account_masked`) with a token; the raw number is AES-256-GCM encrypted at rest.")  # fmt: skip
newp = ex("Create payee (unverified, 24h cooling-off)", "POST", "/payees", {"name": "Example Language Centre (SYNTHETIC)", "account_number": "6222 0000 0000 7777", "bank": "Sandbox Bank of China", "source": "manual"}, H_S, who="student")  # fmt: skip
ex("Verify payee (family approver / admin)", "POST", f"/payees/{newp['id']}/verify", None, H_F, who="family_approver",
   note="Verification does NOT waive the cooling-off: payments to a new payee stay T3 + cooling-off until `cooling_off_until` passes.")  # fmt: skip
act_new = c.post("/chat", json={"message": "Pay Example Language Centre", "locale": "en"}, headers=H_S).json()
# ---- SMS payee change -> cooling-off -----------------------------------------------------------------------------------
msgs = json.loads((data_dir() / "messages" / "messages.json").read_text(encoding="utf-8"))
sms = next(m for m in msgs if m["label"] == "payee_change")
ch = ex("SMS 'new account details' -> cooling-off", "POST", "/chat", {"message": sms["text"], "locale": "en"}, H_S,
        note="Payee-change messages never change the registry; they create a verify-payee action under cooling-off.")  # fmt: skip
if ch["proposed_actions"]:
    ex(
        "Approving during cooling-off",
        "POST",
        f"/actions/{ch['proposed_actions'][0]['id']}/approve",
        {"totp_code": code(student)},
        H_S,
    )

# ---- audit, evidence ---------------------------------------------------------------------------------------------------
ex("Audit log with chain verification", "GET", "/audit?verify=true&limit=3", None, H_S, elide=("entries",), note="Students see their own rows; family approvers see linked students'; admins see all. `verify` always covers the whole chain.")  # fmt: skip
ex("Evidence export", "GET", "/evidence/export", None, H_A, who="admin", elide=("audit",), note="Hash-chained audit rows (PII-redacted), verification result and `head_hash` (record it externally to detect tail truncation).")  # fmt: skip
ex("Erase my data (PIPL)", "DELETE", "/me", None, H_N, who="any", note="Deletes the caller's actions, plans, obligations, documents and payees and anonymises the user. Audit rows are retained but contain only redacted data.")  # fmt: skip

# ---- demo helpers -------------------------------------------------------------------------------------------------------
out.append("## Demo-only endpoints (`DEMO_MODE=true`; must be off in production)\n")
ex("Personas", "GET", "/demo/personas", None, elide=("personas",), auth=False)
ex("Synthetic notices", "GET", "/demo/notices", None, auth=False)
ex(
    "Current TOTP for a persona",
    "GET",
    f"/demo/totp/{student['email']}",
    None,
    auth=False,
    note="So judges need no authenticator app.",
)
ex("Tamper an audit row", "POST", "/demo/tamper-audit?seq=2", None, auth=False)
ex("Audit verify after tamper", "GET", "/audit?verify=true&limit=1", None, H_S, note="`verify.ok` is false and `broken_at_seq` names the first bad row.", elide=("entries",))  # fmt: skip
ex("Reset demo database", "POST", "/demo/reset", None, auth=False)
(ROOT / "docs" / "API.md").write_text("\n".join(out), encoding="utf-8")
print("wrote docs/API.md")
