import pytest

from eval.attacks import ATTACKS


@pytest.mark.parametrize("attack", ATTACKS, ids=[a.__name__ for a in ATTACKS])
def test_attack_is_blocked(attack):
    r = attack()
    assert r.blocked, f"{r.id} {r.name} NOT blocked:\n" + "\n".join(r.evidence)
    assert r.evidence
