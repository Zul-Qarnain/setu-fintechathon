def new_payee(w, acct="6222000000005555", name="Landlord Li (SYNTHETIC)"):
    return w.client.post(
        "/payees", json={"name": name, "account_number": acct, "bank": "Sandbox Bank"}, headers=w.student.h
    )


def test_create_payee_unverified_with_cooling_off(world):
    r = new_payee(world)
    assert r.status_code == 201
    j = r.json()
    assert j["verified"] is False and j["cooling_off_until"] is not None
    assert j["account_masked"] == "****5555" and j["account_token"].startswith("ACCT_")
    assert "6222000000005555" not in r.text


def test_invalid_and_homoglyph_accounts_rejected(world):
    for bad in ["12ab", "６２２２００００００００５５５５", "6222 0000 0000 55x5"]:
        r = world.client.post(
            "/payees", json={"name": "X", "account_number": bad, "bank": "B"}, headers=world.student.h
        )
        assert r.status_code == 422, bad


def test_student_cannot_verify_own_payee(world):
    pid = new_payee(world).json()["id"]
    r = world.client.post(f"/payees/{pid}/verify", headers=world.student.h)
    assert r.status_code == 403


def test_linked_approver_verifies(world):
    pid = new_payee(world).json()["id"]
    r = world.client.post(f"/payees/{pid}/verify", headers=world.approver.h)
    assert r.status_code == 200 and r.json()["verified"] is True
    # cooling-off stays active after quick verification
    assert r.json()["cooling_off_until"] is not None


def test_unlinked_approver_gets_404(world):
    c = world.client
    c.post(
        "/auth/register",
        json={"email": "stranger@demo.setu.test", "password": "a-long-password-1", "role": "family_approver"},
    )
    tok = c.post("/auth/login", json={"email": "stranger@demo.setu.test", "password": "a-long-password-1"}).json()[
        "access_token"
    ]
    pid = new_payee(world).json()["id"]
    r = c.post(f"/payees/{pid}/verify", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 404


def test_payee_changed_flag_for_same_name_new_account(world):
    r = new_payee(world, acct="6222000000007777", name="Shenzhen Example University (SYNTHETIC)")
    assert r.status_code == 201 and r.json()["verified"] is False


def test_cross_user_payee_not_listed(world):
    new_payee(world)
    mine = world.client.get("/payees", headers=world.other.h).json()
    assert mine == []
