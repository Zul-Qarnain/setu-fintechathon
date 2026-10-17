from fastapi.testclient import TestClient

from app.main import app

c = TestClient(app)


def test_health() -> None:
    assert c.get("/health").json()["status"] == "ok"


def test_cors_for_web_origin() -> None:
    r = c.options(
        "/health",
        headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": "GET"},
    )
    assert r.headers["access-control-allow-origin"] == "http://localhost:3000"


def test_error_format() -> None:
    r = c.post("/auth/register", json={"email": "x"})
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "validation_error"
    assert r.json()["request_id"]
