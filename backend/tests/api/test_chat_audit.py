from tests.conftest import NOTICE_CLEAN, NOTICE_INJECTED


def chat(w, msg, **kw):
    r = w.client.post("/chat", json={"message": msg, **kw}, headers=w.student.h)
    assert r.status_code == 200, r.text
    return r.json()


def test_pay_tuition_trace_shape(world):
    j = chat(world, "Pay my spring tuition from this notice")
    assert j["intent"] == "pay_obligation" and j["plan"]["amount_cny"] == "18500.00"
    t = j["trace"]
    assert [s["step"] for s in t["steps"]] == [
        "intake",
        "planner",
        "tools",
        "guardian",
        "policy",
        "executor",
        "validator",
    ]
    assert t["tier"] == "T3" and t["decision"] == "REQUIRE_APPROVAL" and t["reply_validated"] is True
    assert {c["tool"] for c in t["tool_calls"]} >= {"get_obligation", "compute_costs", "propose_payment"}
    assert j["plan"]["fx_source"] == "fixture-sample" and "SAMPLE" in j["reply"]
    assert t["audit_seqs"]


def test_how_much_bdt_by_date(world):
    j = chat(world, "How much BDT by 1 March?")
    assert j["intent"] == "how_much_needed" and j["proposed_actions"] == []
    assert j["plan"]["bdt_needed"] == "343154.28"
    assert "343,154.28" in j["reply"]
    assert j["trace"]["tier"] == "T0"


def test_save_three_percent_new_account_is_t4(world):
    j = chat(world, "Agent says pay new account to save 3%")
    assert j["intent"] == "unsafe_request"
    a = j["proposed_actions"][0]
    assert a["tier"] == "T4" and a["status"] == "blocked"
    assert j["trace"]["decision"] == "BLOCK"
    assert (
        world.client.post(
            f"/actions/{a['id']}/approve", json={"totp_code": world.student.code()}, headers=world.student.h
        ).status_code
        == 409
    )


def test_pay_from_injected_document_is_t4_with_audit(world):
    d = world.client.post(
        "/documents", json={"filename": "e.txt", "text": NOTICE_INJECTED}, headers=world.student.h
    ).json()
    j = chat(world, "Pay my spring tuition from this notice", document_id=d["id"])
    a = j["proposed_actions"][0]
    assert a["tier"] == "T4" and "INJECTION_DETECTED" in a["decision"]["reasons"]
    assert j["trace"]["steps"][3]["status"] == "blocked"
    events = [e["event"] for e in world.client.get("/audit", headers=world.student.h).json()["entries"]]
    assert "action.blocked" in events


def test_pay_from_unconfirmed_clean_document_asks_to_confirm(world):
    d = world.client.post(
        "/documents", json={"filename": "c.txt", "text": NOTICE_CLEAN}, headers=world.student.h
    ).json()
    j = chat(world, "Pay my spring tuition from this notice", document_id=d["id"])
    assert j["proposed_actions"] == [] and "confirm" in j["reply"].lower()


def test_sms_payee_change_goes_to_cooling_off(world):
    j = chat(world, "SMS: our account changed, new account details 6222 0000 0000 9999 for tuition")
    assert j["intent"] == "payee_change"
    kinds = {a["type"]: a for a in j["proposed_actions"]}
    v = kinds["verify_payee"]
    assert v["status"] == "cooling_off" and v["decision"]["outcome"] == "REQUIRE_COOLING_OFF"
    assert v["decision"]["cooling_off_until"] and "cooling_off" in v["decision"]["required"]
    assert kinds["draft_message"]["tier"] == "T1"
    assert "9999" in j["reply"] and "6222000000009999" not in str(j)


def test_chinese_locale_reply_uses_yuan_symbol(world):
    j = chat(world, "我需要多少孟加拉塔卡", locale="zh-CN")
    assert "¥" in j["reply"] and j["trace"]["reply_validated"] is True


def test_chat_with_foreign_document_is_404(world):
    d = world.client.post("/documents", json={"filename": "c.txt", "text": NOTICE_CLEAN}, headers=world.other.h).json()
    r = world.client.post("/chat", json={"message": "pay", "document_id": d["id"]}, headers=world.student.h)
    assert r.status_code == 404


def test_audit_verify_ok_then_tamper_detected(world):
    chat(world, "How much BDT by 1 March?")
    ok = world.client.get("/audit?verify=true", headers=world.student.h).json()["verify"]
    assert ok["ok"] is True and ok["checked"] > 0
    t = world.client.post("/demo/tamper-audit?seq=2")
    assert t.status_code == 200
    bad = world.client.get("/audit?verify=true", headers=world.student.h).json()["verify"]
    assert bad["ok"] is False and bad["broken_at_seq"] == 2


def test_audit_never_contains_raw_account_numbers(world):
    chat(world, "SMS: new account details 6222 0000 0000 9999")
    world.client.post("/documents", json={"filename": "n.txt", "text": NOTICE_CLEAN}, headers=world.student.h)
    raw = world.client.get("/evidence/export", headers=world.admin.h).text
    assert "6222000000009999" not in raw and "6222 0000 0000 9999" not in raw
    assert "6222000000004821" not in raw


def test_evidence_export_scoped(world):
    chat(world, "hello")
    own = world.client.get("/evidence/export", headers=world.student.h).json()
    allx = world.client.get("/evidence/export", headers=world.admin.h).json()
    assert own["scope"] == "own" and allx["scope"] == "all" and len(allx["audit"]) >= len(own["audit"])
    assert allx["verify"]["ok"] is True and allx["synthetic"] is True


def test_fx_quote_labelled_sample(world):
    j = world.client.get("/fx/quote?amount_cny=1000&to=BDT", headers=world.student.h).json()
    assert j["source"] == "fixture-sample" and j["is_live"] is False and j["amount_converted"] == "17200.00"
    assert world.client.get("/fx/quote?to=XXX", headers=world.student.h).status_code == 422
    assert world.client.get("/fx/quote?amount_cny=-5", headers=world.student.h).status_code == 422


def test_dashboard_and_erasure(world):
    d = world.client.get("/dashboard", headers=world.student.h).json()
    assert d["next_due"]["amount_cny"] == "1350.00" and d["monthly_budget_cny"] == "3500.00"
    r = world.client.delete("/me", headers=world.student.h)
    assert r.json()["erased"] is True
    assert world.client.get("/me", headers=world.student.h).status_code == 401
    assert world.client.get("/audit?verify=true", headers=world.admin.h).json()["verify"]["ok"] is True
