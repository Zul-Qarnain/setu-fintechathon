# Setu 桥 — HTTP API (v0.1)

Base URL: `http://localhost:8000`. CORS allows `http://localhost:3000`. All data is **SYNTHETIC**; the bank is a **sandbox**; Setu never holds funds.
OpenAPI: `GET /openapi.json`, Swagger UI: `GET /docs`.

> Examples below are REAL responses captured from the running app on a seeded synthetic database (`make api-docs`).

## Conventions
- **Auth**: `Authorization: Bearer <JWT>` from `/auth/login`. Roles: `student`, `family_approver`, `admin`.
- **Money**: decimal **strings** (`"18500.00"`), never floats. Fields are suffixed `_cny`; `bdt_needed` is BDT. Format in the UI with `Intl.NumberFormat` (zh-CN renders `¥18,500.00`).
- **Time**: ISO-8601 UTC (`2026-10-17T05:00:00Z`); dates `YYYY-MM-DD`.
- **IDs**: prefixed strings (`usr_`, `doc_`, `obl_`, `pay_`, `plan_`, `act_`, `trc_`).
- **Request IDs**: every response has `x-request-id`; errors echo it.

## Error format
Every non-2xx response:
```json
{
  "error": {"code": "TOTP_INVALID", "message": "Invalid or expired TOTP code", "details": {}},
  "request_id": "req_3fa91c2e0b17"
}
```
Codes in use: `UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `validation_error` (422), `UNSUPPORTED_DOCUMENT` (422, e.g. malformed/blank PDF), `UNSUPPORTED_PAIR` (422), `TOO_LARGE` (413), `TOTP_INVALID` (403), `TOTP_NOT_ENABLED` (403), `TOTP_NOT_STARTED` / `TOTP_ALREADY_ENABLED` (409), `TOTP_LOCKED` (429, 5 failures → 300 s), `COOLING_OFF_ACTIVE` (409), `INVALID_STATE` (409, e.g. approving a terminal action), `ALREADY_APPROVED` / `ALREADY_CONFIRMED` (409), `AMOUNT_MISMATCH` (409), `EMAIL_EXISTS` (409), `POLICY_BLOCKED` (403), `RATE_LIMITED` (429).
(Cross-user resource access returns `NOT_FOUND`, never `FORBIDDEN`, to avoid leaking existence.)

## Tier labels
| Tier | Meaning | `decision.outcome` | `decision.required` |
|---|---|---|---|
| `T0` | Read-only (quotes, explanations) | `ALLOW` | `[]` |
| `T1` | Draft only (messages, payment drafts) | `ALLOW` | `[]` |
| `T2` | Payment ≤ CNY 2,000 to a **verified** payee | `ALLOW` | `["totp"]` |
| `T3` | Payment > CNY 2,000, or new/changed payee | `REQUIRE_APPROVAL` / `REQUIRE_COOLING_OFF` | `["totp","family_approver"]` (+ `"cooling_off"` for new payees, 24h) |
| `T4` | Blocked: unverified payee, action sourced only from document text, bulk PII export | `BLOCK` | `[]` |

`decision.reasons` are machine codes, e.g. `WITHIN_T2_CAP`, `OVER_T2_CAP`, `PAYEE_VERIFIED`, `PAYEE_UNVERIFIED`, `NEW_PAYEE`, `PAYEE_CHANGED`, `DOC_ONLY_SOURCE`, `INJECTION_DETECTED`, `BULK_PII_EXPORT`, `SPLIT_PAYMENT_SUSPECTED`, `AMOUNT_MISMATCH`.

## Action status lifecycle
`draft` → `awaiting_approval` → (`cooling_off` →) `approved` → `executed` | `failed`; or `rejected` / `blocked` (T4, terminal).

## The `trace` object (agent live view)
`POST /chat` returns `trace` so the UI can render **intent → plan → tools → guardian → policy → tier**:
- `steps[]`: ordered, `step` ∈ `intake|planner|tools|guardian|policy|executor|validator`, `status` ∈ `ok|blocked|skipped|rejected`, `duration_ms`, free-form `detail`.
- `tool_calls[]`: `{tool, args, output, ok}` — outputs are deterministic Python results (the only source of numbers in `reply`).
- `tier`, `decision` (final), `reply_validated` (reply-validator passed: every digit in the reply appears in tool outputs), `audit_seqs` (audit rows written during this turn).
- `llm_mode`: `scripted-offline` by default.

## `proposed_actions[]` shape
`ActionOut`: `{id, plan_id, type, tier, status, params, decision{outcome,tier,reasons,required,cooling_off_until,explanation}, approvals[], created_at, result}`. `type` ∈ `payment|draft_message|verify_payee|export_data|read`. Payment `params`: `{amount_cny, payee_id, payee_name, reference, idempotency_key}`.

