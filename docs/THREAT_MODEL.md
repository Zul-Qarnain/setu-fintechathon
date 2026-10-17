# Threat model

Method: data-flow decomposition (`DATA_FLOW.md`) → STRIDE per trust boundary → mapping to the OWASP Top 10 for LLM Applications (2025 numbering) and to China's PIPL / Data Security Law (DSL). Attack IDs (A01–A17) refer to the executable scenarios in `backend/eval/attacks.py`; results are in `evidence/security_report.md`. This is a builders' analysis, not an independent review.

## 1. Assets and actors
| Asset | Why it matters |
|---|---|
| Student funds and payment instructions | direct financial loss |
| Payee registry (verified accounts) | redirecting it redirects every future payment |
| Personal information (identity, accounts, notices) | PIPL "sensitive personal information" (financial accounts) |
| TOTP secrets, JWT secret, AES/HMAC keys | compromise defeats approvals and encryption |
| Audit log | evidence for disputes and for the approver |

Actors: student (legitimate), family approver (legitimate, higher authority), admin (operator, cannot approve payments), **external attacker** (scammer sending notices/SMS, or a malicious website), **malicious document/SMS author**, **curious/other user**, **insider with DB access**, **compromised or manipulated model**.

## 2. Trust boundaries
1. Browser ↔ API (JWT, TOTP, rate limit).
2. Untrusted content (notice, SMS, chat text) ↔ agent (guardian, `<untrusted>`, schema-checked plans).
3. Agent ↔ policy engine ↔ executor (only `ALLOW` crosses).
4. API ↔ database (encryption, hash chain, redaction).
5. API ↔ optional third parties (FX, LLM): off by default; tokenised/public data only.

## 3. STRIDE

| Cat. | Threat | Mitigation in code | Scenario | Residual risk |
|---|---|---|---|---|
| **S**poofing | Stolen password used to approve payments | TOTP on every approval, replay protection, 5-fail lockout, argon2id | A05, A06 | TOTP secret stored server-side (encrypted); phishing of live codes possible |
| S | Forged / altered JWT (alg=none, role edit, expiry) | pinned HS256, required claims, role re-read from DB | A08 | single shared secret, no rotation |
| S | Fake payee: new account via SMS, lookalike name, homoglyph digits | SMS never edits the registry; payee change = T3 + 24 h cooling-off; skeleton/Levenshtein lookalike block; homoglyph block | A02, A03 | lookalikes beyond edit distance 2 / unknown confusables |
| **T**ampering | Edit stored audit rows, delete or re-link | SHA-256 chain, `verify` reports `broken_at_seq` | A09 | tail truncation undetectable without external `head_hash` |
| T | Tamper with amount between notice and payment | user-confirmed fields must match parsed amount; policy compares action amount with obligation; guardian flags summary-line mismatch | A11 | user confirming a wrong figure is a human error the system cannot detect |
| T | Prompt injection inside a notice steers the agent | `<untrusted>` wrapping, guardian rules, document-sourced actions T4 regardless of verdict, payee/amount resolved server-side | A01, A14 | novel phrasings can evade the guardian but cannot create a payment |
| **R**epudiation | "I never approved that" | each approval is audit-logged with actor, action id, kind; hash-chained; two-person approvals for T3 | A05, A09 | no non-repudiation signature, logs rely on server integrity |
| **I**nformation disclosure | IDOR on actions/payees/documents | owner-scoped queries, 404 for foreign ids | A07, A12 | — |
| I | PII in logs, audit, DB dumps | redaction filter and pre-hash redaction; AES-256-GCM at rest; masked in API | A10 | regex redaction may miss odd formats; dev keys are public |
| I | Bulk export / over-collection | `EXPORT_DATA bulk=True` is T4; evidence export is scoped to own data (admin: all, audit-logged) | A16 | admin is trusted |
| **D**oS | Request flooding, credential stuffing, huge uploads | sliding-window limiter, size caps (413), TOTP lockout | A17, A06 | in-memory, per-process; no WAF |
| **E**levation | Student approves own T3 payment alone; admin approves; cross-role | policy requires distinct `family_approver` approval for T3; admin cannot approve | A04, A13 | approver identity is only as good as the unverified linking step |
| E | Model or code path executes without authorisation | executor refuses anything except `ALLOW`; planner can only call allowlisted, schema-checked tools; `propose_*` never executes | A13, A14 | a code bug in `policy.decide` would be fatal — hence property-based tests |
| E | Structuring: many payments just below CNY 2,000 | 24 h rolling per-payee aggregate escalates to T3 | A04 | different payees / longer windows not aggregated |

## 4. OWASP Top 10 for LLM Applications (2025)

| ID | Risk | Status | How |
|---|---|---|---|
| LLM01 | Prompt injection | mitigated by design | untrusted wrapper, guardian, T4 for document-sourced actions, validated planner output (A01, A02, A14) |
| LLM02 | Sensitive information disclosure | mitigated | tokenisation before any model call, redaction, encryption, masked API (A10) |
| LLM03 | Supply chain | partial | pinned lockfile (`uv.lock`), gitleaks; no SCA/SAST |
| LLM04 | Data and model poisoning | not applicable / low | no training or fine-tuning; static synthetic data |
| LLM05 | Improper output handling | mitigated | model output is only schema-validated JSON tool calls; reply validator; UI should render text, not HTML |
| LLM06 | Excessive agency | mitigated | no tool moves money; propose-then-approve; server policy; executor accepts `ALLOW` only (A04, A13) |
| LLM07 | System prompt leakage | low impact | scripted default has no secret prompt; adapters hold no secrets in prompts; planner output cannot reveal config (A14) |
| LLM08 | Vector and embedding weaknesses | not applicable | no RAG / embeddings |
| LLM09 | Misinformation | mitigated | all numbers computed by deterministic code; reply validator rejects ungrounded numbers; FX labelled SAMPLE vs live (A15) |
| LLM10 | Unbounded consumption | partial | rate limit, size caps, max 6 tool calls per plan; no token budget (adapters untested live) |

## 5. PIPL / Data Security Law mapping

Informational mapping of design choices to obligations; **not legal advice** and not a compliance certification.

| Obligation (article area) | Setu design | Gap |
|---|---|---|
| Lawful basis and informed **consent** for processing (PIPL ch. II; separate consent for sensitive PI and for cross-border transfer) | purpose-limited processing for the payment task; `consent_json` field | **consent screens not implemented** |
| **Minimisation / purpose limitation** | only fields needed for a payment are parsed; no analytics; evidence export scoped | — |
| **Sensitive personal information** (financial accounts) handled with extra protection | AES-256-GCM at rest, masked everywhere else, tokenised toward models | no HSM/KMS, no key rotation |
| **Security measures** (PIPL art. on security; DSL data classification and protection) | classification in `DATA_FLOW.md`; encryption, access control, audit chain, rate limit, redacted logs | no formal classification scheme / DPIA document |
| **Individual rights**: access, correction, **deletion** | `DELETE /me` erases user data and anonymises the account; users can view their data | export-my-data is only the evidence export; no correction endpoint for account fields |
| **Cross-border transfer** of PI (PIPL ch. III) | offline default keeps data local; optional LLM/FX adapters send only tokenised or public data | enabling Gemini/Groq would be a transfer needing a lawful mechanism |
| **Automated decision-making** transparency (PIPL art. 24) | policy decisions carry machine reasons and plain explanations; a human (TOTP, family approver) approves every payment | no formal explanation/appeal channel |
| **Logging / traceability** | hash-chained audit with actor, event, redacted payload | retention policy not defined |
| **Payment licensing / foreign-exchange rules** (PBOC, SAFE) | Setu never holds funds, sandbox only, licensed partners named as the execution layer | any real pilot needs a licensed partner and SAFE-compliant flows; student annual FX quotas are not modelled |
| **Synthetic data** | everything is synthetic and labelled | — |

## 6. Out of scope / not modelled
Device compromise, malicious browser extensions, TLS interception, social engineering of the family approver outside the app, physical access, denial of service at network level, real-world payment rails, side channels.
