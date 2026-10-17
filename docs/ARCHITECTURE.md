# Architecture

> **Implementation note (TS rewrite).** The backend is now TypeScript (`server/src`, Fastify + Zod + better-sqlite3). Module names below use the original Python file names (`domain/fx.py`, `agents/graph.py`, …); the TypeScript twins are the same paths in camelCase (`domain/fx.ts`, `agents/graph.ts`, `sandboxBank/ledger.ts`). The design, tiers and flow are unchanged. See [ARCHITECTURE_TS](ARCHITECTURE_TS.md) for what differs.

Setu 桥 is a guarded agent for cross-border student finance. **All data is SYNTHETIC, the bank is a SANDBOX, FX defaults to labelled SAMPLE rates, and Setu never holds funds.**

## Design principles
1. **The LLM interprets; deterministic code computes.** Every number a user sees (fees, BDT needed, rates, dates) comes from deterministic code (`domain/fx.py`, `costs.py`, `budget.py`). A reply validator rejects any reply containing a number that is not in a tool output or the user's own message.
2. **The server decides, never the model.** One pure function, `policy.decide(action, ctx)`, authorises every action. It is evaluated when an action is proposed, again on every approval, and a last time inside the executor. The executor accepts only `ALLOW`.
3. **Documents and SMS are DATA.** They are wrapped in `<untrusted>`, scanned by the guardian, and can never be the *source* of a payment, a payee or an amount. Payees and amounts are resolved server-side from the payee registry or a user-confirmed obligation.
4. **Default deny, smallest blast radius.** Unknown action types, unregistered/unverified payees, document-sourced actions and bulk exports are T4 (blocked).
5. **Tamper-evident accountability.** Every material event is appended to a SHA-256 hash-chained audit log with PII redacted before hashing.
6. **Works offline.** The default planner is a deterministic scripted adapter; no keys, no network, no model are needed for `make test`, `make demo` or the API.

## Component map

```mermaid
flowchart LR
  subgraph Web["web/ (Next.js, EN / 简体中文)"]
    UI[Dashboard · Upload · Chat · Approvals · Audit]
  end
  subgraph API["server/src (Fastify + Zod)"]
    R[routes/*: auth, documents, chat, actions, payees, fx, audit, evidence, dashboard, demo]
    AG[agents/graph.py: plain state machine]
    POL[domain/policy.py: decide()]
    DOM[domain/: fx, costs, budget, crypto, tokenize, audit]
    SBX[sandbox_bank/ledger.py]
    DB[(SQLite via better-sqlite3)]
  end
  UI -->|JSON over HTTP, JWT| R
  R --> AG
  AG --> DOM
  AG --> POL
  R -->|approve| POL
  POL -->|ALLOW only| EX[agents/executor.py]
  EX --> SBX
  R --> DB
  SBX --> DB
  DOM -->|audit chain| DB
  FX[(data/fx_rates_sample.json  SAMPLE)] --> DOM
  LIVE[open.er-api.com  optional] -.-> DOM
  LLM[Gemini / Groq  optional, tokenised text only] -.-> AG
```

## Agent flow (`agents/graph.py`, no framework)

`intake → planner → tools → guardian → policy → executor | await_approval → validator`

| Step | What it does | Trust boundary |
|---|---|---|
| intake | Reads an uploaded `.txt` or pasted text (**no OCR; PDF upload is not supported in the TS build**), parses fields with regexes (EN + 简体中文), tokenises account numbers (`ACCT_…`), wraps text in `<untrusted>` | document text is untrusted |
| planner | Emits **only** `ToolCall` JSON from an allowlist (`get_obligation`, `list_obligations_due`, `fx_quote`, `compute_costs`, `budget_summary`, `propose_payment`, `propose_verify_payee`, `draft_message`). Schema, tool name and per-tool arguments are validated (`extra=forbid`); invalid plans are rejected | model output is untrusted |
| tools | Deterministic code. `propose_*` only *creates* an action row; nothing executes | server code |
| guardian | Regex rules (EN/ZH) + registry checks: injection phrases, "don't ask the user", personal-account channels, urgency scams, homoglyphs, amount mismatch, payee changed / unverified / lookalike / not in registry | rule-based |
| policy | `decide()` returns `ALLOW / REQUIRE_APPROVAL / REQUIRE_COOLING_OFF / BLOCK` plus tier T0–T4 and machine reasons | the only authority |
| executor / await_approval | `ALLOW` → sandbox bank transfer (idempotent). Otherwise the action waits for TOTP / family approver / cooling-off | accepts `ALLOW` only |
| validator | Every number in the reply must be grounded in tool outputs or the user message, else a safe fallback reply is used | output check |

The `trace` object returned by `POST /chat` exposes these seven steps so the UI can show them live.

## Policy tiers
| Tier | Meaning | Needs |
|---|---|---|
| T0 | read (quotes, explanations) | nothing |
| T1 | draft (messages, payment drafts) | nothing, nothing is sent |
| T2 | payment ≤ CNY 2,000 to a **verified** payee | student TOTP |
| T3 | payment > CNY 2,000, or split payments adding up past the cap (24 h rolling per payee), or new/changed payee | student TOTP **and** linked family approver's TOTP; + 24 h cooling-off for new/changed payees |
| T4 | blocked | unverified/unregistered payee, document- or message- or model-only source, guardian block, cross-user payee, amount ≠ confirmed obligation, bulk PII export |

Payee lifecycle: `create (unverified, T4 for payments)` → `verify by linked family approver / admin` → payments become T3 until `cooling_off_until` (created + 24 h) passes → then T2/T3 by amount. Seeded institutions (university, dorm, insurance, provider) are verified and have no cooling-off.

## Modules
- `domain/crypto.py` AES-256-GCM with AAD (`enc:v1:` prefix) for payee accounts and TOTP secrets.
- `domain/tokenize.py` NFKC normalisation, homoglyph detection, name skeletons, HMAC tokens, `redact_pii` for logs/audit.
- `domain/audit.py` hash-chain compute/verify. `models.py:append_audit/verify_audit` persist it.
- `domain/fx.py` FX service: fixture (labelled SAMPLE) or live adapter, 24 h cache, injectable clock, live-failure fallback that is labelled as fixture.
- `domain/costs.py`, `budget.py` fee model (sandbox "licensed partner A": USD 3.00 fixed + 0.40 % FX margin, **illustrative**), budget summaries.
- `security.py`, `deps.py` argon2id passwords, JWT (HS256 pinned, `exp/sub/iat` required, role re-checked in DB), TOTP with ±1 step, replay protection, lockout; in-memory rate limiter.
- `sandbox_bank/` double-entry-less toy ledger with idempotency keys and deterministic failures (see below).
- `seed.py`, `demo.py`, `eval/` seeding, the scripted demo, golden tasks and attack scenarios.

## Sandbox bank behaviour (deterministic, for demos and tests)
| Trigger | Result |
|---|---|
| destination ends `0013` | `failed` / `ACCOUNT_CLOSED` |
| amount > CNY 50,000 | `failed` / `LIMIT_EXCEEDED` |
| amount with cents `.99` | `held` / `RISK_HOLD` |
| balance < amount | `failed` / `INSUFFICIENT_FUNDS` |
| same idempotency key, same parameters | returns the original transaction (no double spend) |
| same key, different parameters | rejected (`IdempotencyMismatch`) |

## Persistence
SQLite (in-memory for tests and `make demo`; a file or Docker volume for `make api`). Tables: `users, payees, documents, obligations, plans, actions, audit, sbx_accounts, sbx_txns`. Money columns are `Numeric`; the API serialises `Decimal` as JSON strings.

## LLM adapters
`ScriptedAdapter` (default) classifies intent with deterministic EN/ZH regexes in the order payee-change, unsafe, FX, how-much, pay, fees, budget. Optional Gemini and Groq adapters receive **only tokenised text** and fall back to scripted on any error. They are **not tested live in this entry** (no keys were available); the adapter contract is covered by the same planner validation as the scripted one.

## Deployment
`docker compose up --build` starts the backend (`:8000`) and the web app (`:3000`, built from `./web`). Natively: `make install && make api`. See the README.
