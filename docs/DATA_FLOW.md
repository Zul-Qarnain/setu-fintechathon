# Data flow

All data in this repository is **SYNTHETIC** (personas, notices, SMS, accounts). Nothing here is a real person, bank or institution. This document describes how data *would* move in a pilot and what the code enforces today.

## 1. Fee notice → proposed payment

```mermaid
sequenceDiagram
  participant S as Student (browser)
  participant API as Fastify API
  participant G as Guardian + registry
  participant P as policy.decide
  participant F as Family approver
  participant B as Sandbox bank
  participant A as Audit chain
  S->>API: POST /documents (pasted text or a .txt file; PDF → 422 UNSUPPORTED_DOCUMENT)
  API->>API: extract text, parse fields, wrap in <untrusted>
  API->>G: scan text + compare payee/account to registry
  G-->>API: clean | suspicious | blocked (+ flags)
  API->>A: document.uploaded (+ guardian.blocked)
  S->>API: POST /documents/{id}/confirm (user-checked fields)
  API->>API: create obligation (payee from registry, amount must match)
  S->>API: POST /chat "Pay my spring tuition"
  API->>P: propose_payment (source = confirmed_obligation)
  P-->>API: T3 REQUIRE_APPROVAL (totp + family_approver)
  S->>API: POST /actions/{id}/approve (student TOTP)
  F->>API: POST /actions/{id}/approve (approver TOTP)
  API->>P: re-evaluate with approvals
  P-->>API: ALLOW
  API->>B: transfer(idempotency_key)
  B-->>API: settled | failed | held
  API->>A: action.executed
```

## 2. What is stored, where, and how it is protected

| Data | Where | Protection | Retention / erasure |
|---|---|---|---|
| Email, display name, locale | `users` | access control by role; IDOR-safe 404s | `DELETE /me` anonymises |
| Password | `users.password_hash` | argon2id | removed with account state |
| TOTP secret | `users.totp_secret_enc` | AES-256-GCM, AAD bound to user id | — |
| Payee account number | `payees.account_enc` | AES-256-GCM (AAD per payee); lookup by keyed HMAC hash; UI shows `****1234` | deleted by `DELETE /me` |
| Uploaded notice text | `documents.text_enc` | AES-256-GCM at rest; size-capped; only a hash is kept in the audit log | deleted by `DELETE /me` |
| Obligations, plans, actions | tables of the same name | owner-scoped queries | deleted by `DELETE /me` |
| Audit log | `audit` | SHA-256 hash chain; **PII redacted before hashing and storing** (accounts → `****1234`, emails/phones → placeholders) | retained (accountability) but holds no raw PII |
| Application logs | stdout (JSON) | pino (JSON) with a PII redaction serializer; request logs contain only method, path, status, request id | ephemeral |
| Sandbox ledger | `sbx_accounts`, `sbx_txns` | synthetic only | reset by `/demo/reset` |

## 3. What may leave the system
| Destination | When | What is sent |
|---|---|---|
| open.er-api.com | only if `FX_MODE=live` | a currency code (public rates). Never user data. Result is labelled `live-open.er-api.com`; failure falls back to a labelled SAMPLE fixture |
| Gemini / Groq | only if `LLM_PROVIDER` is set **and** a key is configured | tokenised text only (account numbers replaced by `ACCT_…` tokens); untested live |
| Nothing else | — | no analytics, no third-party scripts, fonts are self-hosted |

## 4. Cross-border considerations (PIPL / DSL)
The default build keeps everything on the machine that runs it, so no personal information leaves mainland China in the offline configuration. Enabling a foreign LLM provider would be a cross-border transfer of personal information under PIPL and would need a lawful basis (separate consent, a standard contract or security assessment as applicable). See `THREAT_MODEL.md` §4 and `SECURITY_SELF_ASSESSMENT.md` (known risks).
