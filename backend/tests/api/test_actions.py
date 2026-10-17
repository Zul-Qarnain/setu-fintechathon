from datetime import UTC, datetime, timedelta

from app import db as dbm
from app.models import Payee
from tests.conftest import pay_action


def approve(w, who, aid, code=None):
    return w.client.post(f"/actions/{aid}/approve", json={"totp_code": code or who.code()}, headers=who.h)


def test_t3_requires_student_totp_then_family_approver(world):
    a = pay_action(world, "Pay my spring tuition")
    assert a["tier"] == "T3" and a["status"] == "awaiting_approval"
    assert a["decision"]["required"] == ["totp", "family_approver"]
    r1 = approve(world, world.student, a["id"])
    assert r1.status_code == 200 and r1.json()["status"] == "awaiting_approval"
    assert r1.json()["decision"]["required"] == ["family_approver"]
    r2 = approve(world, world.approver, a["id"])
    assert r2.status_code == 200
    j = r2.json()
    assert j["status"] == "executed" and j["result"]["state"] == "settled" and j["result"]["sandbox"] is True
    kinds = [x["kind"] for x in j["approvals"]]
    assert kinds == ["totp", "family_approver"]


def test_executed_payment_moves_sandbox_money_once(world):
    a = pay_action(world)
    approve(world, world.student, a["id"])
    approve(world, world.approver, a["id"])
    acct = world.client.get("/sandbox/account", headers=world.student.h).json()["account"]
    assert acct["balance_cny"] == "181500.00"
    obs = world.client.get("/obligations", headers=world.student.h).json()
    assert [o["status"] for o in obs if o["amount_cny"] == "18500.00"] == ["paid"]


def test_t2_within_cap_needs_only_student_totp(world):
    r = world.client.post("/chat", json={"message": "Pay my dorm fee"}, headers=world.student.h)
    # keyword 'dorm' is not special-cased: first open obligation by due date is the dorm fee (CNY 1,350)
    a = r.json()["proposed_actions"][0]
    assert a["params"]["amount_cny"] == "1350.00" and a["tier"] == "T2"
    assert a["decision"]["required"] == ["totp"]
    j = approve(world, world.student, a["id"]).json()
    assert j["status"] == "executed"


def test_wrong_totp_rejected_and_audited(world):
    a = pay_action(world)
    r = approve(world, world.student, a["id"], code="000000")
    assert r.status_code == 403 and r.json()["error"]["code"] == "TOTP_INVALID"
    events = [e["event"] for e in world.client.get("/audit", headers=world.student.h).json()["entries"]]
    assert "totp.failed" in events


def test_student_cannot_approve_as_family_approver(world):
    a = pay_action(world)
    approve(world, world.student, a["id"])
    r = approve(world, world.student, a["id"])  # same user twice
    assert r.status_code in (403, 409)


def test_replayed_approval_after_execution_rejected(world):
    a = pay_action(world)
    approve(world, world.student, a["id"])
    approve(world, world.approver, a["id"])
    r = approve(world, world.approver, a["id"])
    assert r.status_code == 409 and r.json()["error"]["code"] == "INVALID_STATE"


def test_admin_cannot_approve(world):
    a = pay_action(world)
    assert approve(world, world.admin, a["id"]).status_code == 403


def test_reject_action(world):
    a = pay_action(world)
    r = world.client.post(f"/actions/{a['id']}/reject", json={"reason": "not me"}, headers=world.approver.h)
    assert r.status_code == 200 and r.json()["status"] == "rejected"
    assert approve(world, world.student, a["id"]).status_code == 409


def test_actions_scoped_per_user_and_approver(world):
    a = pay_action(world)
    assert world.client.get("/actions", headers=world.other.h).json() == []
    assert world.client.get(f"/actions/{a['id']}", headers=world.other.h).status_code == 404
    assert [x["id"] for x in world.client.get("/actions", headers=world.approver.h).json()] == [a["id"]]


def test_cooling_off_blocks_approval_until_elapsed(world):
    # new payee: approver verifies quickly, cooling-off persists -> payment is T3 + cooling-off
    r = world.client.post(
        "/payees",
        json={"name": "Landlord Li (SYNTHETIC)", "account_number": "6222000000005555", "bank": "B"},
        headers=world.student.h,
    ).json()
    world.client.post(f"/payees/{r['id']}/verify", headers=world.approver.h)
    # craft an action to the new payee through the service layer (user-instruction payment of CNY 500)
    from app import actions_service as svc
    from app.models import User

    with dbm.session_factory()() as db:
        owner = db.get(User, world.student.id)
        row, d = svc.propose(db, owner, "payment", {"amount_cny": "500.00", "payee_id": r["id"]}, "user_instruction")
        db.commit()
        aid = row.id
    assert d.outcome.value == "REQUIRE_COOLING_OFF" and "NEW_PAYEE" in d.reasons
    resp = approve(world, world.student, aid)
    assert resp.status_code == 409 and resp.json()["error"]["code"] == "COOLING_OFF_ACTIVE"
    # time passes
    with dbm.session_factory()() as db:
        p = db.get(Payee, r["id"])
        p.cooling_off_until = (datetime.now(UTC) - timedelta(minutes=1)).replace(tzinfo=None)
        db.commit()
    assert approve(world, world.student, aid).status_code == 200  # now T2 within cap: executes
    got = world.client.get(f"/actions/{aid}", headers=world.student.h).json()
    assert got["status"] in ("executed", "failed")


def test_sandbox_failure_marks_action_failed(world):
    # destination ending 0013 -> ACCOUNT_CLOSED (deterministic)
    r = world.client.post(
        "/payees",
        json={"name": "Closed Co", "account_number": "6222000000000013", "bank": "B"},
        headers=world.student.h,
    ).json()
    from app import actions_service as svc
    from app.models import User

    with dbm.session_factory()() as db:
        db.get(Payee, r["id"]).verified_at = datetime.now(UTC).replace(tzinfo=None)
        db.get(Payee, r["id"]).cooling_off_until = None
        owner = db.get(User, world.student.id)
        row, _ = svc.propose(db, owner, "payment", {"amount_cny": "100.00", "payee_id": r["id"]}, "user_instruction")
        db.commit()
        aid = row.id
    j = approve(world, world.student, aid).json()
    assert j["status"] == "failed" and j["result"]["failure_code"] == "ACCOUNT_CLOSED"
