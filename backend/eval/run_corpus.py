"""Guardian + parser evaluation on the SYNTHETIC notice corpus (data/fee_notices/manifest.json)."""

from __future__ import annotations

import json
from collections import Counter
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from fastapi.testclient import TestClient

from app import db as dbm
from app import security
from app.config import data_dir
from app.domain import fx as fxmod
from app.main import create_app
from app.seed import load_personas, seed_all


@dataclass
class CorpusResult:
    file: str
    label: str
    expected_guardian: str
    got_guardian: str
    flags: list[str]
    parse_ok: bool

    @property
    def guardian_ok(self) -> bool:
        return self.expected_guardian == self.got_guardian


def run_corpus() -> list[CorpusResult]:
    from argon2 import PasswordHasher

    security._ph = PasswordHasher(time_cost=1, memory_cost=8, parallelism=1)
    dbm.init_db("sqlite://")
    fxmod._service = fxmod.FxService(mode="fixture")
    client = TestClient(create_app())
    with dbm.session_factory()() as db:
        seed_all(db)
        db.commit()
    people = {p["email"]: p for p in load_personas()}
    tokens: dict[str, dict[str, str]] = {}
    for email, p in people.items():
        if p["role"] == "student":
            r = client.post("/auth/login", json={"email": email, "password": p["password"]}).json()
            tokens[email] = {"Authorization": f"Bearer {r['access_token']}"}
    manifest: list[dict[str, Any]] = json.loads(
        (data_dir() / "fee_notices" / "manifest.json").read_text(encoding="utf-8")
    )
    out: list[CorpusResult] = []
    for m in manifest:
        text = (data_dir() / "fee_notices" / m["file"]).read_text(encoding="utf-8")
        d = client.post("/documents", json={"filename": m["file"], "text": text}, headers=tokens[m["persona"]]).json()
        exp = m["expected"]
        pr = d["parsed"]
        amount_ok = pr["amount_cny"] is not None and Decimal(pr["amount_cny"]) == Decimal(exp["amount_cny"])
        parse_ok = amount_ok and pr["due_date"] == exp["due_date"] and pr["payee_name"] == exp["payee_name"]
        out.append(CorpusResult(m["file"], m["label"], m["expected_guardian"], d["guardian"]["verdict"],
                                [f["code"] for f in d["guardian"]["flags"]], parse_ok))  # fmt: skip
    return out


def corpus_markdown(res: list[CorpusResult]) -> list[str]:
    n = len(res)
    g_ok = sum(r.guardian_ok for r in res)
    p_ok = sum(r.parse_ok for r in res)
    attacks = [r for r in res if r.label != "clean"]
    clean = [r for r in res if r.label == "clean"]
    caught = sum(r.got_guardian != "clean" for r in attacks)
    blocked_att = sum(r.got_guardian == "blocked" for r in attacks if r.expected_guardian == "blocked")
    exp_blocked = sum(r.expected_guardian == "blocked" for r in attacks)
    false_pos = sum(r.got_guardian != "clean" for r in clean)
    lines = [
        "## Guardian and parser on the synthetic notice corpus",
        "",
        f"{n} SYNTHETIC notices ({len(clean)} clean, {len(attacks)} attack/negative; EN, 简体中文 and mixed), each uploaded by its persona "
        "through the real `POST /documents` path (rules + payee registry).",
        "",
        f"- Verdict matches label: **{g_ok}/{n}** ({g_ok / n:.0%})",
        f"- Attack/negative notices flagged (not 'clean'): **{caught}/{len(attacks)}**; expected-blocked notices actually blocked: **{blocked_att}/{exp_blocked}**",
        f"- False positives on clean notices: **{false_pos}/{len(clean)}**",
        f"- Field parsing (amount, due date, payee name) correct: **{p_ok}/{n}**",
        f"- By label: {dict(Counter(r.label for r in res))}",
        "",
        "| File | Label | Expected | Got | Flags | Parse |",
        "|---|---|---|---|---|---|",
    ]
    for r in res:
        lines.append(
            f"| {r.file} | {r.label} | {r.expected_guardian} | {r.got_guardian}{'' if r.guardian_ok else ' ✘'} | {', '.join(r.flags) or '-'} | {'✔' if r.parse_ok else '✘'} |"
        )
    lines += [
        "",
        "Caveat: the corpus was written by the same team that wrote the rules, so these numbers show coverage of known patterns, not generalisation to unseen attacks.",
        "",
    ]
    return lines
