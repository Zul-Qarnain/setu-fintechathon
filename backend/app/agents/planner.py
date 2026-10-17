"""Planner contract: the model may emit ONLY ToolCall JSON from an allowlist, schema-validated."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

INTENTS = ("pay_obligation", "quote_fx", "how_much_needed", "payee_change", "explain_fees",
           "unsafe_request", "unknown")  # fmt: skip


class _Args(BaseModel):
    model_config = ConfigDict(extra="forbid")


class GetObligationArgs(_Args):
    obligation_id: str | None = None
    document_id: str | None = None
    keyword: str | None = None


class ListDueArgs(_Args):
    by: str | None = None  # ISO date


class FxQuoteArgs(_Args):
    amount_cny: str | None = None
    quote: str = "BDT"


class ComputeCostsArgs(_Args):
    amount_cny: str
    channel: str | None = None


class BudgetArgs(_Args):
    pass


class ProposePaymentArgs(_Args):
    obligation_id: str | None = None
    document_id: str | None = None
    amount_cny: str | None = None
    payee_account: str | None = None  # a hint only; resolved against the registry server-side
    origin: Literal["user", "document", "message", "model"] = "user"


class ProposeVerifyPayeeArgs(_Args):
    name: str | None = None
    account_number: str | None = None
    payee_id: str | None = None


class DraftMessageArgs(_Args):
    to: Literal["university", "family"] = "university"
    purpose: Literal["confirm_account", "request_extension"] = "confirm_account"


ARG_MODELS: dict[str, type[_Args]] = {
    "get_obligation": GetObligationArgs,
    "list_obligations_due": ListDueArgs,
    "fx_quote": FxQuoteArgs,
    "compute_costs": ComputeCostsArgs,
    "budget_summary": BudgetArgs,
    "propose_payment": ProposePaymentArgs,
    "propose_verify_payee": ProposeVerifyPayeeArgs,
    "draft_message": DraftMessageArgs,
}
# The ONLY tools that may create actions are propose_*; none of them executes anything.
READ_TOOLS = frozenset({"get_obligation", "list_obligations_due", "fx_quote", "compute_costs",
                        "budget_summary"})  # fmt: skip


class ToolCall(BaseModel):
    model_config = ConfigDict(extra="forbid")
    tool: str
    args: dict[str, Any] = Field(default_factory=dict)


class PlannerOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    intent: Literal["pay_obligation", "quote_fx", "how_much_needed", "payee_change", "explain_fees",
                    "unsafe_request", "unknown"]  # fmt: skip
    tool_calls: list[ToolCall] = Field(default_factory=list, max_length=6)


class PlanRejected(Exception):
    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def validate_plan(raw: Any) -> PlannerOutput:
    """Validate model output: JSON schema, tool allowlist, per-tool arg schema. Raises PlanRejected."""
    try:
        out = PlannerOutput.model_validate(raw)
    except ValidationError as e:
        raise PlanRejected(f"schema: {e.errors()[0]['msg']}") from None
    for tc in out.tool_calls:
        model = ARG_MODELS.get(tc.tool)
        if model is None:
            raise PlanRejected(f"tool not in allowlist: {tc.tool}")
        try:
            model.model_validate(tc.args)
        except ValidationError as e:
            raise PlanRejected(f"args for {tc.tool}: {e.errors()[0]['msg']}") from None
    return out
