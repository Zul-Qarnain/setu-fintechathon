from __future__ import annotations

from collections.abc import Iterator

import pytest

from eval.world import (  # noqa: F401
    NOTICE_CLEAN,
    NOTICE_INJECTED,
    NOTICE_PAYEE_CHANGED,
    PW,
    UNIV_ACCT,
    UNIV_NAME,
    Persona,
    World,
    build_world,
    pay_action,
)


@pytest.fixture()
def world() -> Iterator[World]:
    with build_world() as w:
        yield w
