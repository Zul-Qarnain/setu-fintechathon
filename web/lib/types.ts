// Types mirror docs/API.md (backend contract v0.1). Money = decimal STRINGS.
export type Role = "student" | "family_approver" | "admin";
export type Tier = "T0" | "T1" | "T2" | "T3" | "T4";
export type DecisionOutcome =
  | "ALLOW"
  | "REQUIRE_APPROVAL"
  | "REQUIRE_COOLING_OFF"
  | "BLOCK";
export type ActionStatus =
  | "draft"
  | "awaiting_approval"
  | "cooling_off"
  | "approved"
  | "executed"
  | "failed"
  | "rejected"
  | "blocked";

export interface User {
  id: string;
  email: string;
  role: Role;
  locale: string;
  totp_enabled: boolean;
  approver_id: string | null;
  synthetic: boolean;
}
export interface RegisterRequest {
  email: string;
  password: string;
  role: Role;
  locale?: string;
  approver_email?: string;
}
export interface LoginResponse {
  access_token: string;
  token_type: "bearer";
  expires_in: number;
  user: User;
}
export interface TotpSetup {
  secret: string;
  otpauth_uri: string;
}
export interface TotpVerifyResult {
  verified: boolean;
  totp_enabled: boolean;
}

export interface Obligation {
  id: string;
  amount_cny: string;
  due_date: string;
  payee_id: string;
  payee_name: string;
  doc_hash: string | null;
  status: string;
}
export interface FxQuote {
  pair: string;
  base: string;
  quote: string;
  rate: string;
  amount_cny: string;
  amount_converted: string;
  source: string;
  is_live: boolean;
  as_of: string;
  cached: boolean;
  disclaimer: string;
}
export interface Dashboard {
  user: User;
  obligations: Obligation[];
  next_due: Obligation | null;
  bdt_needed_next: string | null;
  pending_actions: number;
  monthly_budget_cny: string;
  spent_this_month_cny: string;
  fx: FxQuote;
  synthetic: boolean;
}

export interface ParsedFields {
  amount_cny: string | null;
  due_date: string | null;
  payee_name: string | null;
  account_masked: string | null;
  reference: string | null;
  language: string;
}
export interface GuardianFlag {
  code: string;
  severity: "info" | "warn" | "block";
  message: string;
}
export interface GuardianResult {
  verdict: "clean" | "suspicious" | "blocked";
  score: number;
  flags: GuardianFlag[];
}
export interface DocumentOut {
  id: string;
  filename: string;
  doc_hash: string;
  status: "pending_confirmation" | "confirmed" | "blocked";
  parsed: ParsedFields;
  guardian: GuardianResult;
  untrusted: boolean;
  synthetic: boolean;
  created_at: string;
}
export interface DocumentCreate {
  filename: string;
  text: string;
  synthetic?: boolean;
}
export interface ConfirmRequest {
  amount_cny: string;
  due_date: string;
  payee_name: string;
  account_number?: string;
  reference?: string;
}
export interface ConfirmResponse {
  document: DocumentOut;
  obligation: Obligation | null;
  guardian: GuardianResult;
  blocked: boolean;
  audit_seq: number;
}

export interface Decision {
  outcome: DecisionOutcome;
  tier: Tier;
  reasons: string[];
  required: string[];
  cooling_off_until: string | null;
  explanation: string;
}
export interface Approval {
  approver_id: string;
  role: Role;
  at: string;
  kind: string;
}
export interface ActionOut {
  id: string;
  plan_id: string | null;
  type: "payment" | "draft_message" | "verify_payee" | "export_data" | "read";
  tier: Tier;
  status: ActionStatus;
  params: Record<string, string | number | null | undefined>;
  decision: Decision;
  approvals: Approval[];
  created_at: string;
  result: Record<string, unknown> | null;
}

export interface PlanFee {
  label: string;
  amount_cny: string;
}
export interface Plan {
  channel: string;
  amount_cny: string;
  fx_rate: string;
  fx_source: string;
  fees: PlanFee[];
  total_fees_cny: string;
  fee_pct: string;
  bdt_needed: string;
  due_date: string | null;
  notes: string[];
}
export type TraceStepName =
  | "intake"
  | "planner"
  | "tools"
  | "guardian"
  | "policy"
  | "executor"
  | "validator";
export interface TraceStep {
  step: TraceStepName;
  status: "ok" | "blocked" | "skipped" | "rejected";
  duration_ms: number;
  detail: Record<string, unknown>;
}
export interface ToolCall {
  tool: string;
  args: Record<string, unknown>;
  output: Record<string, unknown>;
  ok: boolean;
}
export interface Trace {
  trace_id: string;
  llm_mode: string;
  steps: TraceStep[];
  tool_calls: ToolCall[];
  tier: Tier;
  decision: DecisionOutcome;
  reply_validated: boolean;
  audit_seqs: number[];
}
export interface ChatRequest {
  message: string;
  locale?: string;
  document_id?: string;
}
export interface ChatResponse {
  reply: string;
  intent: string;
  plan: Plan | null;
  proposed_actions: ActionOut[];
  trace: Trace;
}

export interface Payee {
  id: string;
  owner_id: string;
  name: string;
  account_masked: string;
  account_token: string;
  bank: string;
  verified: boolean;
  verified_at: string | null;
  cooling_off_until: string | null;
  created_at: string;
}
export interface PayeeCreate {
  name: string;
  account_number: string;
  bank: string;
  source?: string;
}

export interface AuditEntry {
  seq: number;
  ts: string;
  actor: string;
  event: string;
  payload_hash: string;
  prev_hash: string;
  hash: string;
  payload: Record<string, unknown>;
}
export interface AuditVerify {
  ok: boolean;
  checked: number;
  broken_at_seq: number | null;
  reason: string | null;
}
export interface AuditResponse {
  entries: AuditEntry[];
  verify: AuditVerify | null;
}

export interface Persona {
  email: string;
  password: string;
  role: Role;
  name: string;
  locale?: string;
  synthetic?: boolean;
}
export interface DemoNotice {
  id: string;
  label: string;
  text: string;
}
export interface Health {
  status: string;
  offline_mode: boolean;
  llm_provider: string;
  fx_mode: string;
  synthetic_data: boolean;
  version: string;
}
