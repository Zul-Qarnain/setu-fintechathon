# Security self-assessment

Scope: the Setu 桥 backend in this repository (Fastify/TypeScript, SQLite, scripted offline agent, sandbox bank). **This is a self-assessment written by the builders. It has not been independently reviewed or penetration-tested.** All results quoted come from `evidence/` and were produced by real runs (`make evidence`).

## 1. Tier table (what the system will and will not do on its own)

| Tier | Action | Conditions | Authorisation required | Enforced by |
|---|---|---|---|---|
| T0 | Read: quotes, fee explanations, budget, dashboards | any authenticated user, own data | none | role + ownership checks |
| T1 | Draft: messages, payment drafts | nothing is sent or executed | none | `policy.decide` → ALLOW, no executor call |
| T2 | Payment ≤ CNY 2,000 | **verified** payee, trusted source, guardian clear, 24 h per-payee aggregate still ≤ cap, no active cooling-off | student **TOTP** | `policy.decide` re-run at propose, approve and execute |
| T3 | Payment > CNY 2,000; split payments exceeding the cap; any payment to a new/changed payee; verifying a payee | as above | student TOTP **+** linked family approver TOTP; **+ 24 h cooling-off** for new/changed payees | same |
| T4 | Blocked | unverified/unregistered payee; action sourced only from document, SMS or model text; guardian block (injection, homoglyph, amount mismatch, lookalike); payee of another user; amount ≠ confirmed obligation; bulk PII export; unknown action type | cannot be approved | same; executor raises `PolicyViolation` for anything but ALLOW |

Admins cannot approve payments. A family approver can only act for students linked to them.

## 2. Evidence summary

| Evidence | Result | File |
|---|---|---|
| Golden tasks (25, EN + 简体中文) | see `evidence/eval_report.md` (all numbers from the real run; the first run failed G19 and was fixed — the report shows the final run) | `evidence/eval_report.md` |
| Synthetic notice corpus (33 notices, 13 attack/negative) through the real upload path | see the "Guardian and parser" section of the eval report | `evidence/eval_report.md` |
| Adversarial scenarios (17) | see `evidence/security_report.md` | `evidence/security_report.md` |
| Sandbox ledger log from the scripted demo | settled, `ACCOUNT_CLOSED`, `RISK_HOLD`, `LIMIT_EXCEEDED`, idempotent replay | `evidence/sandbox_logs.jsonl` |
| Hash-chained audit export + tamper detection | `verify.ok` true, then false with `broken_at_seq` after a simulated DB edit | `evidence/audit_export.json`, `demo_summary.json` |
| Automated tests | `make test` (unit, API, golden, security) | `server/tests/` |

Caveat: the notice corpus and the attack scenarios were written by the same team that wrote the guardian rules. Passing them shows that known patterns are covered; it does **not** show generalisation to attacks we did not think of.

## 3. Controls implemented
- **AuthN**: argon2id; JWT HS256 with the algorithm pinned, `exp/sub/iat` required, role re-read from the database each request; TOTP (RFC 6238, ±1 step) with replay protection and 5-failure / 300 s lockout (`TOTP_LOCKED`).
- **AuthZ**: role checks; owner-scoped queries; cross-user ids return 404 (no existence leak).
- **Crypto at rest**: AES-256-GCM with AAD for payee accounts, TOTP secrets, uploaded text; keyed HMAC for lookups.
- **Input handling**: size caps, text-layer PDFs only (malformed → 422), NFKC normalisation, homoglyph/lookalike detection, `<untrusted>` wrapping.
- **Agent safety**: allowlisted tools, strict schemas, no tool executes money movement, server-side payee/amount resolution, reply validator.
- **Audit**: SHA-256 hash chain, PII redacted before storage; verify endpoint; export with `head_hash`.
- **Privacy**: PII-redacting logs, `DELETE /me` erasure, no third-party scripts, offline by default.
- **Availability**: per-client-IP-and-path sliding-window rate limit, request size caps.

## 4. KNOWN RISKS and limitations (read before trusting this)
1. **Not a licensed payment service.** Setu never holds funds; the bank is a sandbox. No real money movement was tested.
2. **Approver linking has no consent handshake.** A student can name any registered email as approver; a real system needs the approver to accept the link.
3. **Audit chain tail truncation is undetectable** from inside the database (deleting the newest rows leaves a valid chain). Mitigation: export and record `head_hash` externally. Chain and rate limiter are **single-process** (no multi-writer coordination).
4. **In-memory rate limiter** resets on restart and is per-process; behind a proxy, client IP handling needs configuring.
5. **PIPL consent UX is not implemented** (a `consent_json` column exists; no consent screen or withdrawal flow). Erasure is implemented; export-my-data is limited to the evidence export.
6. **LLM adapters (Gemini, Groq) are untested live.** They are optional, receive only tokenised text, and fall back to the scripted planner. Enabling a foreign provider is a cross-border transfer under PIPL.
7. **No OCR.** Scanned or image-only notices are rejected, not read.
8. **Scripted planner coverage is narrow** (EN/ZH regexes). Unusual phrasing becomes `unknown` and gets a capabilities reply. Free-form amounts in chat are deliberately ignored: "Pay the university 5000 yuan" proposes the first open confirmed obligation, not 5000.
9. **Guardian is rule-based.** Novel injection phrasings, other languages, or text hidden in PDF structure can evade it; this is why the policy engine, not the guardian, is the authority (document-sourced actions are T4 regardless of verdict).
10. **Dev-default secrets.** `JWT_SECRET`, `HMAC_KEY`, `AES_KEY_B64` have publicly visible dev defaults so the demo runs with zero setup. They **must** be replaced in any real deployment, and there is no key rotation.
11. **Demo endpoints** (`/demo/*`: TOTP peek, audit tamper, reset) exist when `DEMO_MODE=true` (the default) and would be a serious hole in production. Set `DEMO_MODE=false`.
12. **SQLite**, single node, no backups, no migrations tooling.
13. **TLS and security headers are not handled** by the app; terminate TLS in a proxy. CORS is limited to `http://localhost:3000` by default.
14. **TOTP UX limitation**: replay protection means one user cannot approve two actions within the same 30-second window; the second attempt must wait for the next code.
15. **Fee and FX numbers are illustrative.** Offline rates are SAMPLE values; sandbox channel fees are made up. World Bank RPW rows in `data/channel_costs.csv` are marked VERIFY before citing.
16. **Glossary and Chinese UI strings are drafts** pending native-speaker review.
17. **Dependency and supply-chain scanning** is limited to gitleaks in CI; no SCA, SAST or container scanning. The Docker images were written but not built in the development environment (no Docker daemon available).
18. **Fixed regex-based PII redaction** can miss unusual formats (e.g. spaced phone numbers in other countries).

## 5. What we would do next
Approver consent handshake and notifications; external audit anchoring (periodic head-hash publication); Redis-backed rate limiting; KMS-managed keys with rotation; consent management and data-subject-request tooling; live-tested LLM adapters behind a PIPL-compliant transfer mechanism; OCR with human confirmation; independent penetration test; real licensed partner integration.
