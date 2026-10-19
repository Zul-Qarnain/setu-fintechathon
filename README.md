# Setu 桥 — a guarded cross-border finance agent for students

*2026 Shenzhen FinTechathon · International Track · Topic C: cross-border and student finance*

South Asian students in China pay tuition, dorm fees and insurance across borders, get notices in Chinese they cannot fully read, and are a prime target for "the account number changed" scams. **Setu reads the notice, explains it in English or 简体中文, shows the real total cost, and prepares the payment, but never moves money on a model's say-so.** A deterministic policy engine plus a family approver decide, and every step is written to a tamper-evident audit log.

> **Honesty box.** All data is **SYNTHETIC** (personas, notices, SMS, accounts). The bank is a **SANDBOX**. Setu **never holds funds**. Offline FX rates are labelled **SAMPLE** (not live). Channel fees are illustrative. Optional LLM adapters are **untested live**; the default planner is a deterministic scripted one. Chinese strings and the glossary are drafts awaiting native review. See [KNOWN RISKS](docs/SECURITY_SELF_ASSESSMENT.md#4-known-risks-and-limitations-read-before-trusting-this).

Source: https://github.com/Zul-Qarnain/setu-fintechathon

## FinTechathon submission summary
- **Track:** International AI Track · Topic C — Cross-border & Student Finance Assistant
- **Team name:** [TEAM NAME]
- **Project name:** Setu 桥
- **One-line summary:** Setu reads a fee notice, explains it in English or 简体中文, shows the real total cost and prepares the payment — but never moves money on a model's say-so.
- **GitHub repository:** https://github.com/Zul-Qarnain/setu-fintechathon
- **Demo video:** https://github.com/Zul-Qarnain/setu-fintechathon/blob/main/submission/Setu_Demo.mp4 (3 min 26 s)
- **Live demo:** not hosted; run locally with `make install && make demo` (offline, no keys)

## How it is safe (one paragraph)
The LLM (or the scripted planner) may only emit JSON calls to an allowlist of tools. Every number comes from deterministic code, never the model. Fee notices and SMS are *data*: they are wrapped as untrusted, scanned by a rule-based guardian, and can never be the source of a payee or amount. One pure function, `policy.decide`, assigns tiers T0–T4 and is re-run at propose, approve and execute time; the executor accepts only `ALLOW`. Payments over CNY 2,000, or to new/changed payees, need the student's TOTP **and** the family approver's TOTP (plus 24 h cooling-off for new payees). Details: [ARCHITECTURE](docs/ARCHITECTURE.md).

| Tier | What | Needs |
|---|---|---|
| T0 | read / explain / quote | nothing |
| T1 | draft | nothing, nothing is sent |
| T2 | ≤ CNY 2,000 to a **verified** payee | student TOTP |
| T3 | > CNY 2,000, split payments, new/changed payee | student TOTP + family approver TOTP (+ 24 h cooling-off for new payees) |
| T4 | unverified payee, document-only source, bulk PII export, injection | **blocked** |

## System architecture
```mermaid
flowchart LR
  UI["web/ Next.js (EN / 简体中文)"] -->|JSON + JWT| API["Fastify API (server/src/routes)"]
  API --> AG["agents/graph.ts: intake → planner → tools → guardian"]
  AG --> POL["policy.decide (T0–T4)"]
  API -->|approve with TOTP| POL
  POL -->|ALLOW only| EX[executor] --> SBX[(sandbox bank)]
  API --> DB[(SQLite: AES-256-GCM fields, hash-chained audit)]
```
- **Models:** deterministic scripted planner (default, offline); optional Gemini / Groq adapters behind the same allowlist (tokenised text only, untested live).
- **Tools (allowlist):** get_obligation, list_obligations_due, fx_quote, compute_costs, budget_summary, propose_payment, propose_verify_payee, draft_message — none moves money.
- **Data sources:** `data/` — SYNTHETIC personas, 33 fee notices, 12 SMS, SAMPLE FX fixture, illustrative channel costs.
- **External services:** none by default; optional live FX (open.er-api.com, `FX_MODE=live`).

## Environment and dependencies
- **Operating system:** Linux x86_64 (Debian-based, kernel 6.12; tested 19 Oct 2026 with Node 20.19.2 / npm 11.21). macOS and WSL2 are expected to work but were not tested.
- **Runtime:** Node 20+ (`.nvmrc` = 20); no Python, no API keys, no network needed
- **Server:** TypeScript (strict), Fastify, Zod, better-sqlite3 12.4.1, decimal.js, jose, @node-rs/argon2, pino; tests: vitest
- **Web:** Next.js 16.4.2, React 19, next-intl 4; tests: vitest, Playwright
- **Environment variables:** copy `.env.example` to `.env`; `JWT_SECRET`, `HMAC_KEY`, `AES_KEY_B64` ship with public dev defaults and must be replaced outside a demo. Never commit real secrets.

## Installation and execution (clean environment)
```bash
git clone https://github.com/Zul-Qarnain/setu-fintechathon && cd setu-fintechathon
cp .env.example .env            # optional; defaults run offline
make install                    # or: (cd server && npm ci) && (cd web && npm install)
make api                        # or: cd server && DEMO_MODE=true npm start   → http://localhost:8000
make web                        # or: cd web && npm run dev                   → http://localhost:3000
```
Sign in as `aisha@demo.setu.test` / `demo-password-123` (SYNTHETIC).

## Run it (one command)

> **Backend rewrite.** The backend is now **TypeScript (Node 20 + Fastify)** in `server/`, with the same HTTP contract as before (`docs/API.md`; `web/` is unchanged). The original Python/FastAPI implementation is kept in `legacy/backend-py/` for reference and as the source of the differential test vectors. See [ARCHITECTURE_TS](docs/ARCHITECTURE_TS.md).

Prerequisites: Node 20+ (no Python, no API keys, no network needed). No `make`? Every target is a thin wrapper over `cd server && npm run …`.

```bash
make install && make demo        # seeds synthetic personas, runs the scripted end-to-end scenario, writes evidence/
make test                        # unit, differential-vs-Python, API, golden (25 tasks), attack scenarios
make api                         # backend on http://localhost:8000 (DEMO_MODE=true for the web demo helpers)
make web                         # Next.js UI on http://localhost:3000
```

`DEMO_MODE` now defaults to **off** (the `/demo/*` helpers return 404 unless `DEMO_MODE=true` or a valid `X-Admin-Token`). Set `DEMO_MODE=true` for the judges' demo (`docker-compose.yml` does). `.env.example` ships with `DEMO_MODE=true`, so copying it to `.env` turns the demo helpers on; the code default stays off.

Docker (not available where this was developed, so **the images were written by reading but never built here**; please report any issue):

```bash
docker compose up --build        # api :8000, web :3000, offline, no keys
```

| Target | What it does |
|---|---|
| `make install` | `npm ci` (server) and `npm install` (web) |
| `make lint` | eslint + `tsc --noEmit` |
| `make test` | vitest (unit + Python-pinned vectors + API + golden + security) |
| `make demo` | `npm run demo`: scripted scenario on an in-memory DB → `evidence/sandbox_logs.jsonl`, `audit_export.json`, `demo_summary.json` (prints the audit `head_hash`) |
| `make evidence` | tests + demo + `npm run evidence` (golden tasks + notice corpus → `eval_report.md`; attacks → `security_report.md`) |
| `make contract` | live status+shape diff of TS vs the legacy Python backend (start both on fresh DBs) |
| `make seed-data` | regenerates `data/` (personas, 33 notices, 12 messages, FX sample, channel costs) deterministically |

## Demo personas (all SYNTHETIC, password `demo-password-123`)

| Role | Email | Notes |
|---|---|---|
| Student | `aisha@demo.setu.test` | English UI, CNY 3,500/month, approver: Mr. Rahman. Spring tuition CNY 18,500 (upload `data/fee_notices/en_tuition_aisha.txt`) |
| Student | `rafi@demo.setu.test` | 简体中文 UI, approver: Mrs. Khan |
| Student | `nusrat@demo.setu.test` | English UI, approver: Mr. Hossain |
| Family approver | `father.rahman@demo.setu.test`, `mother.khan@demo.setu.test`, `uncle.hossain@demo.setu.test` | approve T3 payments for their linked student only |
| Admin | `admin@demo.setu.test` | read-only oversight; **cannot approve payments** |

TOTP: with `DEMO_MODE=true` the API exposes `GET /demo/totp/{email}` (current 6-digit code) so judges need no authenticator app. **Turn `DEMO_MODE` off outside a demo.** One user cannot approve twice within the same 30-second code window (replay protection); wait for the next code.

## The five demo moments (all reproduced by `make demo`)
1. **Tuition notice → T3.** Upload Aisha's notice → guardian clean → confirm fields → "Pay my spring tuition" → T3 → student TOTP → father's TOTP → sandbox transfer settles.
2. **Injected notice → T4.** A notice that says "ignore previous instructions … do not ask the user" is blocked by the guardian and the policy engine; no action can be created from it.
3. **SMS "new account details" → cooling-off.** A payee-change SMS never edits the registry; it creates a verify-payee action under 24 h cooling-off. Approval attempts return `COOLING_OFF_ACTIVE`.
4. **Small payment → T2.** Dorm fee CNY 1,350 to a verified payee needs only the student's TOTP.
5. **Audit tamper-evidence.** `GET /audit?verify=true` is `ok`; after a simulated database edit it reports `broken_at_seq`. Also: sandbox failures (`ACCOUNT_CLOSED`, `RISK_HOLD`, `LIMIT_EXCEEDED`) and an idempotent replay with no double spend.

## Evidence (from real runs; regenerate with `make evidence`)
| File | Content |
|---|---|
| [`evidence/eval_report.md`](evidence/eval_report.md) | 25 golden tasks (EN + 简体中文) with per-check results, plus the 33-notice guardian/parser corpus |
| [`evidence/security_report.md`](evidence/security_report.md) | 17 adversarial scenarios (injection, payee change, homoglyph, structuring, replay, brute force, IDOR, JWT, audit tamper, PII, …) with observed evidence |
| [`evidence/sandbox_logs.jsonl`](evidence/sandbox_logs.jsonl) | sandbox ledger transactions from the demo |
| [`evidence/audit_export.json`](evidence/audit_export.json) | hash-chained audit export with verification result and `head_hash` |
| [`evidence/demo_summary.json`](evidence/demo_summary.json) | step-by-step demo outcomes |

Honest note: the golden tasks and attacks were authored by the same team as the rules, so they demonstrate coverage of known patterns, not generalisation. During development G19 (zh-CN FX question) failed on its first run and was fixed; the report shows the final run.

## Testing
| Command | Expected result (latest run) |
|---|---|
| `cd server && npx vitest run` (= `make test`) | 24 test files, 524 tests passed (19 Oct 2026) |
| `make evidence` → `evidence/eval_report.md` | 25/25 golden tasks passed; notice corpus 33/33 verdicts, 33/33 field parsing |
| `make evidence` → `evidence/security_report.md` | 17/17 adversarial scenarios blocked |
| `make demo` → `evidence/audit_export.json` | `verify.ok = true`; prints the audit `head_hash` |
Web: `cd web && npm run lint && npx tsc --noEmit && npx vitest run && npx playwright test --project=smoke` → lint 0 errors, 16 vitest tests, 9/9 Playwright smoke (needs the API on :8000 with `DEMO_MODE=true`).
Test suites: `server/tests/unit`, `api`, `golden`, `security`, `parity`.

## Repository map
```
server/src/        Fastify app: routes/, domain/ (policy, fx, costs, crypto, audit), agents/, sandboxBank/, evalkit/ (golden + attacks)
server/tests/      unit/, api/, golden/, security/, parity/ (vitest)
server/eval/       golden tasks (tasks.yaml)
legacy/backend-py/ the original Python implementation (reference + differential vectors)
data/               SYNTHETIC personas, 33 fee notices (EN/ZH/mixed, 13 attack/negative), 12 SMS, FX SAMPLE rates, channel costs
docs/               API.md, ARCHITECTURE.md, DATA_FLOW.md, THREAT_MODEL.md, SECURITY_SELF_ASSESSMENT.md, GLOSSARY_EN_ZH.md
evidence/           generated reports and logs
web/                Next.js front end (EN / 简体中文)
```

## Configuration (`.env.example`)
`ALLOW_OFFLINE=true` (default), `LLM_PROVIDER=scripted|gemini|groq`, `FX_MODE=fixture|live` (live = open.er-api.com, fixture fallback is always labelled), `DEMO_MODE`, `JWT_SECRET`, `HMAC_KEY`, `AES_KEY_B64` (**dev defaults are public; replace them**), `DATABASE_URL`, `CORS_ORIGINS`.

## Documents
[API](docs/API.md) · [Architecture](docs/ARCHITECTURE.md) · [Data flow](docs/DATA_FLOW.md) · [Threat model](docs/THREAT_MODEL.md) · [Security self-assessment + known risks](docs/SECURITY_SELF_ASSESSMENT.md) · [EN↔ZH glossary](docs/GLOSSARY_EN_ZH.md)

## Security notes
### Data handling
AES-256-GCM (with AAD) at rest for payee account numbers, TOTP secrets and notice text; HMAC-SHA256 account tokens so plaintext accounts never reach a planner; PII redacted in logs and before audit hashing; `DELETE /me` erasure; offline by default, no third-party scripts. Known risks: docs/SECURITY_SELF_ASSESSMENT.md §4.

### Production checklist
`NODE_ENV=production`, `DEMO_MODE=false`, fresh `JWT_SECRET` / `HMAC_KEY` / `AES_KEY_B64`, TLS at a reverse proxy, `CORS_ORIGINS` restricted to the web origin, persistent and backed-up SQLite volume, periodic publication of the audit `head_hash`.

## Limitations (short list)
No OCR and no PDF upload in the TypeScript backend (typed/pasted text and .txt only; PDF uploads return 422) · no real payments · scripted planner has narrow EN/ZH coverage and ignores free-form amounts in chat · guardian is rule-based · approver linking has no consent handshake · PIPL consent screens not built · single-process SQLite, in-memory rate limiter · Docker images not built in the dev environment. Full list: [SECURITY_SELF_ASSESSMENT](docs/SECURITY_SELF_ASSESSMENT.md).
