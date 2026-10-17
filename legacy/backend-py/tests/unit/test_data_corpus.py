import json

import pytest

from app.config import data_dir
from app.domain import costs, fx
from app.seed import load_personas


def test_personas_are_consistent():
    ps = load_personas()
    roles = {p["role"] for p in ps}
    assert roles == {"student", "family_approver", "admin"}
    emails = {p["email"] for p in ps}
    for p in ps:
        if p["role"] == "student":
            assert p["approver_email"] in emails
            assert len(p["verified_payees"]) == 4 and p["obligations"]
        assert p["email"].endswith(".test")  # reserved TLD, never a real mailbox
    import pyotp

    for p in ps:
        pyotp.TOTP(p["totp_secret"]).now()  # valid base32


def test_manifest_covers_every_file_and_languages():
    d = data_dir() / "fee_notices"
    m = json.loads((d / "manifest.json").read_text(encoding="utf-8"))
    assert len(m) >= 30 and {x["file"] for x in m} == {p.name for p in d.glob("*.txt")}
    assert {x["language"] for x in m} >= {"en", "zh", "mixed"}
    assert sum(x["label"] != "clean" for x in m) >= 10
    for x in m:
        assert "SYNTHETIC" in (d / x["file"]).read_text(encoding="utf-8").upper() or "合成" in (
            d / x["file"]
        ).read_text(encoding="utf-8")


def test_messages_labelled():
    ms = json.loads((data_dir() / "messages" / "messages.json").read_text(encoding="utf-8"))
    assert len(ms) >= 10 and {"payee_change", "benign"} <= {m["label"] for m in ms}


def test_fx_fixture_is_labelled_sample():
    f = fx.load_fixture()
    assert "SAMPLE" in json.dumps(f).upper()


def test_channel_costs_sandbox_partner_a_fixed():
    ch = costs.load_channels()
    a = ch[costs.DEFAULT_CHANNEL]
    assert sorted(a.values())  # loaded
    assert "NOT OFFERED" in (data_dir() / "channel_costs.csv").read_text(encoding="utf-8")


@pytest.mark.parametrize("fn", ["en_tuition_aisha.txt"])
def test_example_notice_exists(fn):
    assert (data_dir() / "fee_notices" / fn).exists()
