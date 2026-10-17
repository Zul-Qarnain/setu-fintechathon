import pytest
from hypothesis import given
from hypothesis import strategies as st

from app.domain import crypto, tokenize

KEY2 = "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVowMTIzNDU="  # 32 bytes, different key


def test_encrypt_roundtrip_and_prefix():
    tok = crypto.encrypt("6222000000004821", aad="payee:1")
    assert tok.startswith("enc:v1:") and "6222" not in tok
    assert crypto.decrypt(tok, aad="payee:1") == "6222000000004821"


def test_nonce_random_per_call():
    assert crypto.encrypt("x") != crypto.encrypt("x")


def test_wrong_aad_or_key_or_tamper_fails():
    tok = crypto.encrypt("secret", aad="a")
    with pytest.raises(crypto.CryptoError):
        crypto.decrypt(tok, aad="b")
    with pytest.raises(crypto.CryptoError):
        crypto.decrypt(tok, aad="a", key_b64=KEY2)
    flipped = tok[:-4] + ("AAAA" if not tok.endswith("AAAA") else "BBBB")
    with pytest.raises(crypto.CryptoError):
        crypto.decrypt(flipped, aad="a")
    with pytest.raises(crypto.CryptoError):
        crypto.decrypt("plain text")


def test_bad_key_length_rejected():
    with pytest.raises(crypto.CryptoError):
        crypto.encrypt("x", key_b64="c2hvcnQ=")


@given(st.text(max_size=200))
def test_roundtrip_property(s):
    assert crypto.decrypt(crypto.encrypt(s, aad="p"), aad="p") == s


def test_normalize_account_folds_fullwidth_and_separators():
    assert tokenize.normalize_account("6222 0000-0000_4821") == "6222000000004821"
    assert tokenize.normalize_account("６２２２００００") == "62220000"


def test_account_token_stable_and_format():
    a = tokenize.account_token("6222 0000 0000 4821")
    assert a == tokenize.account_token("6222000000004821") and a.startswith("ACCT_") and len(a) == 15
    assert a != tokenize.account_token("6222000000004822")


def test_account_hash_is_keyed(monkeypatch):
    h1 = tokenize.account_hash("6222000000004821")
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "hmac_key", "another-key-0123456789abcdef0123456789")
    assert tokenize.account_hash("6222000000004821") != h1


def test_mask_and_name_token():
    assert tokenize.mask_account("6222 0000 0000 4821") == "****4821"
    assert tokenize.mask_account("12") == "****"
    assert tokenize.name_token("Shenzhen Example University") == tokenize.name_token(
        "shenzhen example university (SYNTHETIC)"
    )


def test_has_homoglyphs():
    assert tokenize.has_homoglyphs("Exam\u0440le") and tokenize.has_homoglyphs("６２２２")
    assert not tokenize.has_homoglyphs("账号：6222 0000") and not tokenize.has_homoglyphs("Example")


def test_is_valid_account():
    assert tokenize.is_valid_account("6222 0000 0000 4821")
    for bad in ["123", "6222 0000 0000 48x1", "６２２２００００００００４８２１", "6222" * 8]:
        assert not tokenize.is_valid_account(bad)


def test_name_skeleton_folds_lookalikes():
    assert tokenize.name_skeleton("Shenzhen Examp1e University") == tokenize.name_skeleton(
        "Shenzhen Example University (SYNTHETIC)"
    )
    assert tokenize.name_skeleton("Shenzhen Exam\u0440le University") == tokenize.name_skeleton(
        "Shenzhen Example University"
    )
    assert tokenize.name_skeleton("深圳示例大学（合成）") == "深圳示例大学"


def test_tokenize_text_replaces_accounts_only():
    out, m = tokenize.tokenize_text("pay 6222 0000 0000 4821 CNY 18500 by 2027-03-01 ref 2027-SPRING-0042")
    assert "6222" not in out and "18500" in out and "2027-03-01" in out
    assert list(m.values()) == ["****4821"]


def test_redact_pii():
    s = tokenize.redact_pii("a@b.com 13800138000 6222 0000 0000 4821 ok")
    assert "[EMAIL]" in s and "[PHONE]" in s and "****4821" in s and "6222" not in s


def test_redact_obj_nested():
    o = tokenize.redact_obj({"a": ["x 6222000000004821"], "b": {"c": "m@e.io"}, "n": 5})
    assert o == {"a": ["x ****4821"], "b": {"c": "[EMAIL]"}, "n": 5}


@given(st.from_regex(r"[0-9]{12,19}", fullmatch=True))
def test_redacted_text_never_contains_raw_long_numbers(num):
    assert num not in tokenize.redact_pii(f"acct {num} end")
