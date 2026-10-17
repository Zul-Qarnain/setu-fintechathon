from __future__ import annotations

from fastapi import APIRouter

from app import schemas as s
from app import stubs

router = APIRouter(prefix="/chat", tags=["chat"])


@router.post("", response_model=s.ChatResponse)
def chat(body: s.ChatRequest) -> s.ChatResponse:
    msg = body.message.lower()
    if "save 3%" in msg or "new account" in msg:
        return s.ChatResponse(
            reply="I can't do that. Paying a new, unverified account is blocked (Tier 4).",
            intent="unsafe_request", plan=None,
            proposed_actions=[stubs.action("T4", "blocked")], trace=stubs.trace("T4", blocked=True))
    if "how much" in msg:
        return s.ChatResponse(
            reply="You need about BDT 319,742.00 by 1 March 2027 (sample FX rate 17.2000).",
            intent="how_much_needed", plan=stubs.plan(), proposed_actions=[], trace=stubs.trace("T0"))
    return s.ChatResponse(
        reply="Drafted a payment of CNY 18,500.00. Needs your TOTP and your family approver.",
        intent="pay_obligation", plan=stubs.plan(), proposed_actions=[stubs.action("T3")],
        trace=stubs.trace("T3"))
