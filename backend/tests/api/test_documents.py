import io

from tests.conftest import NOTICE_CLEAN, NOTICE_INJECTED, NOTICE_PAYEE_CHANGED


def upload(w, text, who=None):
    return w.client.post("/documents", json={"filename": "n.txt", "text": text}, headers=(who or w.student).h)


def test_upload_clean_parses_fields(world):
    r = upload(world, NOTICE_CLEAN)
    assert r.status_code == 201
    j = r.json()
    assert j["status"] == "pending_confirmation" and j["untrusted"] is True and j["synthetic"] is True
    assert j["parsed"]["amount_cny"] == "18500.00" and j["parsed"]["due_date"] == "2027-03-01"
    assert j["parsed"]["account_masked"] == "****4821"
    assert j["guardian"]["verdict"] == "clean"
    assert j["doc_hash"].startswith("sha256:")


def test_confirm_creates_obligation_with_registry_payee(world):
    d = upload(world, NOTICE_CLEAN).json()
    body = {"amount_cny": "18500.00", "due_date": "2027-03-01", "payee_name": "Shenzhen Example University (SYNTHETIC)"}
    r = world.client.post(f"/documents/{d['id']}/confirm", json=body, headers=world.student.h)
    assert r.status_code == 200
    j = r.json()
    assert j["blocked"] is False and j["obligation"]["payee_id"] == world.payee_id
    assert j["obligation"]["doc_hash"] == d["doc_hash"]
    again = world.client.post(f"/documents/{d['id']}/confirm", json=body, headers=world.student.h)
    assert again.status_code == 409


def test_confirm_amount_mismatch_rejected(world):
    d = upload(world, NOTICE_CLEAN).json()
    body = {"amount_cny": "1850.00", "due_date": "2027-03-01", "payee_name": "x"}
    r = world.client.post(f"/documents/{d['id']}/confirm", json=body, headers=world.student.h)
    assert r.status_code == 409 and r.json()["error"]["code"] == "AMOUNT_MISMATCH"


def test_injected_notice_blocked_and_audited(world):
    d = upload(world, NOTICE_INJECTED).json()
    assert d["status"] == "blocked" and d["guardian"]["verdict"] == "blocked"
    assert "INJECTION_PHRASE" in {f["code"] for f in d["guardian"]["flags"]}
    r = world.client.post(
        f"/documents/{d['id']}/confirm",
        json={"amount_cny": "18500.00", "due_date": "2027-03-01", "payee_name": "x"},
        headers=world.student.h,
    )
    j = r.json()
    assert j["blocked"] is True and j["obligation"] is None
    events = [e["event"] for e in world.client.get("/audit", headers=world.student.h).json()["entries"]]
    assert "guardian.blocked" in events and "document.confirm_blocked" in events


def test_payee_changed_notice_creates_unverified_payee(world):
    d = upload(world, NOTICE_PAYEE_CHANGED).json()
    assert d["guardian"]["verdict"] == "suspicious"
    codes = {f["code"] for f in d["guardian"]["flags"]}
    assert {"PAYEE_CHANGE_NOTICE", "PAYEE_CHANGED"} <= codes
    body = {"amount_cny": "18500.00", "due_date": "2027-03-01", "payee_name": "Shenzhen Example University (SYNTHETIC)"}
    j = world.client.post(f"/documents/{d['id']}/confirm", json=body, headers=world.student.h).json()
    assert j["obligation"]["payee_id"] != world.payee_id
    payees = {p["id"]: p for p in world.client.get("/payees", headers=world.student.h).json()}
    assert payees[j["obligation"]["payee_id"]]["verified"] is False


def test_multipart_upload_txt(world):
    r = world.client.post(
        "/documents",
        files={"file": ("n.txt", io.BytesIO(NOTICE_CLEAN.encode()), "text/plain")},
        headers=world.student.h,
    )
    assert r.status_code == 201 and r.json()["parsed"]["amount_cny"] == "18500.00"


def test_pdf_without_text_layer_rejected(world):
    r = world.client.post(
        "/documents",
        files={"file": ("n.pdf", io.BytesIO(b"%PDF-1.4 not really"), "application/pdf")},
        headers=world.student.h,
    )
    assert r.status_code in (422, 500) and r.status_code == 422


def test_text_layer_pdf_parsed(world):
    from reportlab.pdfgen import canvas

    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    y = 800
    for line in NOTICE_CLEAN.splitlines():
        c.drawString(40, y, line)
        y -= 16
    c.save()
    r = world.client.post(
        "/documents", files={"file": ("n.pdf", io.BytesIO(buf.getvalue()), "application/pdf")}, headers=world.student.h
    )
    assert r.status_code == 201, r.text
    assert r.json()["parsed"]["amount_cny"] == "18500.00"


def test_document_idor_returns_404(world):
    d = upload(world, NOTICE_CLEAN).json()
    body = {"amount_cny": "18500.00", "due_date": "2027-03-01", "payee_name": "x"}
    r = world.client.post(f"/documents/{d['id']}/confirm", json=body, headers=world.other.h)
    assert r.status_code == 404
