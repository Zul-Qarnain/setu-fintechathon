import type Database from 'better-sqlite3';

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  role: string;
  locale: string;
  totp_secret_enc: string | null;
  totp_enabled: number;
  totp_last_step: number;
  totp_failures: number;
  totp_locked_until: string | null;
  approver_id: string | null;
  display_name: string | null;
  monthly_budget_cny: string;
  consent_json: string | null;
  erased: number;
  created_at: string;
}

export interface PayeeRow {
  id: string;
  owner_id: string;
  name: string;
  name_skeleton: string;
  account_hash: string;
  account_enc: string;
  account_masked: string;
  account_token: string;
  bank: string;
  source: string;
  verified_at: string | null;
  cooling_off_until: string | null;
  changed_from_id: string | null;
  created_at: string;
}

export interface DocumentRow {
  id: string;
  owner_id: string;
  filename: string;
  doc_hash: string;
  text_enc: string;
  parsed_json: string;
  guardian_json: string;
  status: string;
  synthetic: number;
  created_at: string;
}

export interface ObligationRow {
  id: string;
  user_id: string;
  title: string | null;
  amount_cny: string;
  due_date: string;
  payee_id: string | null;
  doc_hash: string | null;
  reference: string | null;
  status: string;
}

export interface PlanRow {
  id: string;
  obligation_id: string | null;
  owner_id: string;
  channel: string;
  bdt_needed: string;
  fees: string;
  fx_rate: string;
  plan_json: string;
  created_at: string;
}

export interface ActionRow {
  id: string;
  owner_id: string;
  plan_id: string | null;
  type: string;
  tier: string;
  params_json: string;
  status: string;
  approvals_json: string;
  decision_json: string;
  result_json: string | null;
  source: string;
  idempotency_key: string;
  created_at: string;
}

export interface AuditRow {
  seq: number;
  ts: string;
  actor: string;
  event: string;
  payload_hash: string;
  prev_hash: string;
  hash: string;
  payload_json: string | null;
}

export interface BankAccountRow {
  id: string;
  owner_id: string | null;
  account_number: string;
  holder: string;
  balance_cny: string;
  closed: number;
}

export interface BankTxnRow {
  id: string;
  idempotency_key: string;
  request_hash: string;
  from_account: string;
  to_account_number: string;
  amount_cny: string;
  reference: string | null;
  state: string;
  failure_code: string | null;
  created_at: string;
}

export function createSchema(db: Database.Database): void {

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      locale TEXT DEFAULT 'en',
      totp_secret_enc TEXT,
      totp_enabled INTEGER DEFAULT 0,
      totp_last_step INTEGER DEFAULT 0,
      totp_failures INTEGER DEFAULT 0,
      totp_locked_until DATETIME,
      approver_id TEXT,
      display_name TEXT,
      monthly_budget_cny TEXT DEFAULT '0.00',
      consent_json TEXT,
      erased INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (approver_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_users_approver ON users(approver_id);

    CREATE TABLE IF NOT EXISTS payees (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      name TEXT NOT NULL,
      name_skeleton TEXT NOT NULL,
      account_hash TEXT NOT NULL,
      account_enc TEXT NOT NULL,
      account_masked TEXT NOT NULL,
      account_token TEXT NOT NULL,
      bank TEXT NOT NULL,
      source TEXT DEFAULT 'manual',
      verified_at DATETIME,
      cooling_off_until DATETIME,
      changed_from_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (owner_id) REFERENCES users(id),
      FOREIGN KEY (changed_from_id) REFERENCES payees(id)
    );

    CREATE INDEX IF NOT EXISTS idx_payees_owner ON payees(owner_id);
    CREATE INDEX IF NOT EXISTS idx_payees_name_skeleton ON payees(name_skeleton);
    CREATE INDEX IF NOT EXISTS idx_payees_account_hash ON payees(account_hash);

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      doc_hash TEXT NOT NULL,
      text_enc TEXT NOT NULL,
      parsed_json TEXT NOT NULL,
      guardian_json TEXT NOT NULL,
      status TEXT NOT NULL,
      synthetic INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (owner_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_documents_owner ON documents(owner_id);

    CREATE TABLE IF NOT EXISTS obligations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT,
      amount_cny TEXT NOT NULL,
      due_date DATE NOT NULL,
      payee_id TEXT,
      doc_hash TEXT,
      reference TEXT,
      status TEXT DEFAULT 'open',
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (payee_id) REFERENCES payees(id)
    );

    CREATE INDEX IF NOT EXISTS idx_obligations_user ON obligations(user_id);

    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY,
      obligation_id TEXT,
      owner_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      bdt_needed TEXT NOT NULL,
      fees TEXT NOT NULL,
      fx_rate TEXT NOT NULL,
      plan_json TEXT DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (obligation_id) REFERENCES obligations(id),
      FOREIGN KEY (owner_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_plans_obligation ON plans(obligation_id);
    CREATE INDEX IF NOT EXISTS idx_plans_owner ON plans(owner_id);

    CREATE TABLE IF NOT EXISTS actions (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      plan_id TEXT,
      type TEXT NOT NULL,
      tier TEXT NOT NULL,
      params_json TEXT NOT NULL,
      status TEXT NOT NULL,
      approvals_json TEXT DEFAULT '[]',
      decision_json TEXT DEFAULT '{}',
      result_json TEXT,
      source TEXT DEFAULT 'user_instruction',
      idempotency_key TEXT UNIQUE NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (owner_id) REFERENCES users(id),
      FOREIGN KEY (plan_id) REFERENCES plans(id)
    );

    CREATE INDEX IF NOT EXISTS idx_actions_owner ON actions(owner_id);
    CREATE INDEX IF NOT EXISTS idx_actions_plan ON actions(plan_id);

    CREATE TABLE IF NOT EXISTS audit (
      seq INTEGER PRIMARY KEY,
      ts DATETIME NOT NULL,
      actor TEXT NOT NULL,
      event TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      prev_hash TEXT NOT NULL,
      hash TEXT NOT NULL,
      payload_json TEXT
    );

    CREATE TABLE IF NOT EXISTS sbx_accounts (
      id TEXT PRIMARY KEY,
      owner_id TEXT,
      account_number TEXT UNIQUE NOT NULL,
      holder TEXT NOT NULL,
      balance_cny TEXT DEFAULT '0.00',
      closed INTEGER DEFAULT 0,
      FOREIGN KEY (owner_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_sbx_accounts_owner ON sbx_accounts(owner_id);

    CREATE TABLE IF NOT EXISTS sbx_txns (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT UNIQUE NOT NULL,
      request_hash TEXT NOT NULL,
      from_account TEXT NOT NULL,
      to_account_number TEXT NOT NULL,
      amount_cny TEXT NOT NULL,
      reference TEXT,
      state TEXT NOT NULL CHECK(state IN ('settled', 'failed', 'held')),
      failure_code TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_sbx_txns_idempotency ON sbx_txns(idempotency_key);
  `);
}

export default createSchema;
