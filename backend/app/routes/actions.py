from __future__ import annotations

from fastapi import APIRouter

from app import schemas as s
from app import stubs

router = APIRouter(prefix="/actions", tags=["actions"])


@router.get("", response_model=list[s.ActionOut])
def list_actions(status: str | None = None) -> list[s.ActionOut]:
    return [stubs.action("T3"), stubs.action("COOL", "cooling_off")]


@router.get("/{action_id}", response_model=s.ActionOut)
def get_action(action_id: str) -> s.ActionOut:
    return stubs.action("T3")


@router.post("/{action_id}/approve", response_model=s.ActionOut)
def approve(action_id: str, body: s.ApproveRequest) -> s.ActionOut:
    a = stubs.action("T3", "executed")
    a.approvals = [s.ApprovalRecord(approver_id=stubs.USER.id, role="student", at=stubs.NOW,
                                    kind="totp"),
                   s.ApprovalRecord(approver_id=stubs.APPROVER.id, role="family_approver",
                                    at=stubs.NOW, kind="family_approver")]
    a.result = {"bank_txn_id": "sbx_txn_000123", "state": "settled", "sandbox": True}
    return a


@router.post("/{action_id}/reject", response_model=s.ActionOut)
def reject(action_id: str, body: s.RejectRequest) -> s.ActionOut:
    return stubs.action("T3", "rejected")
