import { API_URL, MOCK } from "./config";
import type {
  ActionOut, AuditResponse, ChatRequest, ChatResponse, ConfirmRequest, ConfirmResponse,
  Dashboard, DemoNotice, DocumentCreate, DocumentOut, FxQuote, Health, LoginResponse,
  Obligation, Payee, PayeeCreate, Persona, RegisterRequest, TotpSetup, TotpVerifyResult, User,
} from "./types";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public requestId?: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type Query = Record<string, string | number | boolean | undefined>;
export type MockHandler = (
  method: string,
  path: string,
  query: Query,
  body: unknown,
  token: string | null,
) => Promise<unknown>;

const TOKEN_KEY = "setu.token";
export const tokenStore = {
  get: (): string | null => (typeof window === "undefined" ? null : window.localStorage.getItem(TOKEN_KEY)),
  set: (t: string) => window.localStorage.setItem(TOKEN_KEY, t),
  clear: () => window.localStorage.removeItem(TOKEN_KEY),
};

async function request<T>(method: string, path: string, opts: { body?: unknown; query?: Query; form?: FormData } = {}): Promise<T> {
  const token = tokenStore.get();
  if (MOCK) {
    const { mockHandler } = await import("./mock/server");
    return (await mockHandler(method, path, opts.query ?? {}, opts.body, token)) as T;
  }
  const qs = opts.query
    ? "?" + new URLSearchParams(Object.entries(opts.query).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString()
    : "";
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}${qs}`, { method, headers, body });
  } catch {
    throw new ApiError(0, "NETWORK", `Cannot reach the Setu API at ${API_URL}. Is the backend running?`);
  }
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (!res.ok) {
    const e = (json as { error?: { code?: string; message?: string; details?: unknown }; request_id?: string; detail?: unknown } | null) ?? {};
    // Backend contract: {error:{code,message,details}, request_id}. FastAPI default {detail} tolerated.
    const msg = e.error?.message ?? (typeof e.detail === "string" ? e.detail : res.statusText);
    throw new ApiError(res.status, e.error?.code ?? `HTTP_${res.status}`, msg, e.request_id, e.error?.details);
  }
  return json as T;
}

export const api = {
  health: () => request<Health>("GET", "/health"),
  register: (b: RegisterRequest) => request<User>("POST", "/auth/register", { body: b }),
  login: (email: string, password: string) => request<LoginResponse>("POST", "/auth/login", { body: { email, password } }),
  me: () => request<User>("GET", "/me"),
  totpSetup: () => request<TotpSetup>("POST", "/auth/totp/setup"),
  totpVerify: (code: string) => request<TotpVerifyResult>("POST", "/auth/totp/verify", { body: { code } }),
  dashboard: () => request<Dashboard>("GET", "/dashboard"),
  obligations: () => request<Obligation[]>("GET", "/obligations"),
  createDocument: (b: DocumentCreate) => request<DocumentOut>("POST", "/documents", { body: b }),
  uploadDocumentFile: async (file: File) => {
    // The backend accepts .txt only (PDF → 422 UNSUPPORTED_DOCUMENT); fail fast with the same message client-side.
    if (/\.pdf$/i.test(file.name)) throw new ApiError(422, "UNSUPPORTED_DOCUMENT", "PDF upload is not supported. Paste the notice text or upload a .txt file.");
    if (MOCK) {
      return request<DocumentOut>("POST", "/documents", { body: { filename: file.name, text: await file.text(), synthetic: true } });
    }
    const form = new FormData();
    form.append("file", file);
    return request<DocumentOut>("POST", "/documents", { form });
  },
  confirmDocument: (id: string, b: ConfirmRequest) => request<ConfirmResponse>("POST", `/documents/${id}/confirm`, { body: b }),
  chat: (b: ChatRequest) => request<ChatResponse>("POST", "/chat", { body: b }),
  fxQuote: (amount_cny: string, to = "BDT") => request<FxQuote>("GET", "/fx/quote", { query: { amount_cny, to } }),
  payees: () => request<Payee[]>("GET", "/payees"),
  createPayee: (b: PayeeCreate) => request<Payee>("POST", "/payees", { body: b }),
  verifyPayee: (id: string) => request<Payee>("POST", `/payees/${id}/verify`),
  actions: () => request<ActionOut[]>("GET", "/actions"),
  action: (id: string) => request<ActionOut>("GET", `/actions/${id}`),
  approve: (id: string, totp_code: string) => request<ActionOut>("POST", `/actions/${id}/approve`, { body: { totp_code } }),
  reject: (id: string, reason: string) => request<ActionOut>("POST", `/actions/${id}/reject`, { body: { reason } }),
  audit: (verify = false) => request<AuditResponse>("GET", "/audit", { query: verify ? { verify: true } : {} }),
  evidenceExport: () => request<unknown>("GET", "/evidence/export"),
  eraseMe: () => request<{ erased: boolean; audit_retained: string }>("DELETE", "/me"),
  // demo helpers (backend DEMO_MODE=true only)
  demoPersonas: () => request<Persona[]>("GET", "/demo/personas"),
  demoNotices: () => request<DemoNotice[]>("GET", "/demo/notices"),
  demoTotp: (email: string) => request<{ email: string; code: string; valid_for_seconds: string }>("GET", `/demo/totp/${encodeURIComponent(email)}`),
  demoTamperAudit: (seq: number) => request<{ tampered_seq: number }>("POST", "/demo/tamper-audit", { query: { seq } }),
};
