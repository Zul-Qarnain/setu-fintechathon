import pyotp

from tests.conftest import PW


def test_health_public(world):
    j = world.client.get("/health").json()
    assert j["status"] == "ok" and j["synthetic_data"] is True and j["offline_mode"] is True


def test_protected_routes_need_token(world):
    for path in ["/me", "/dashboard", "/payees", "/actions", "/audit", "/obligations", "/evidence/export"]:
        r = world.client.get(path)
        assert r.status_code == 401, path
        assert r.json()["error"]["code"] == "UNAUTHORIZED"


def test_register_login_roundtrip(world):
    c = world.client
    r = c.post(
        "/auth/register", json={"email": "Nusrat@Demo.Setu.Test", "password": "a-long-password-1", "role": "student"}
    )
    assert r.status_code == 201 and r.json()["email"] == "nusrat@demo.setu.test"
    assert (
        c.post("/auth/register", json={"email": "nusrat@demo.setu.test", "password": "a-long-password-1"}).status_code
        == 409
    )
    r = c.post("/auth/login", json={"email": "nusrat@demo.setu.test", "password": "a-long-password-1"})
    assert r.status_code == 200
    tok = r.json()["access_token"]
    assert c.get("/me", headers={"Authorization": f"Bearer {tok}"}).json()["role"] == "student"


def test_login_bad_password_generic_error(world):
    r = world.client.post("/auth/login", json={"email": world.student.email, "password": "wrong-password-xx"})
    assert r.status_code == 401
    r2 = world.client.post("/auth/login", json={"email": "nobody@demo.setu.test", "password": "wrong-password-xx"})
    assert r.json()["error"]["message"] == r2.json()["error"]["message"]


def test_short_password_rejected(world):
    r = world.client.post("/auth/register", json={"email": "x@y.z", "password": "short"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"


def test_totp_enrolment_flow(world):
    c = world.client
    c.post("/auth/register", json={"email": "new@demo.setu.test", "password": PW})
    tok = c.post("/auth/login", json={"email": "new@demo.setu.test", "password": PW}).json()["access_token"]
    h = {"Authorization": f"Bearer {tok}"}
    setup = c.post("/auth/totp/setup", headers=h).json()
    assert setup["otpauth_uri"].startswith("otpauth://totp/")
    assert c.post("/auth/totp/verify", json={"code": "000000"}, headers=h).status_code == 403
    ok = c.post("/auth/totp/verify", json={"code": pyotp.TOTP(setup["secret"]).now()}, headers=h)
    assert ok.status_code == 200 and ok.json()["totp_enabled"] is True
    assert c.get("/me", headers=h).json()["totp_enabled"] is True


def test_register_with_unknown_approver_rejected(world):
    r = world.client.post(
        "/auth/register", json={"email": "z@demo.setu.test", "password": PW, "approver_email": world.student.email}
    )
    assert r.status_code == 422
