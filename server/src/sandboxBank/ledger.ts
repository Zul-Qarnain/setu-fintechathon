/**
 * Sandbox bank ledger (SYNTHETIC). Port of backend/app/sandbox_bank/ledger.py.
 * Deterministic failures: dest ending "0013" -> ACCOUNT_CLOSED; > CNY 50,000.00 -> LIMIT_EXCEEDED;
 * cents == .99 -> RISK_HOLD (held, funds not moved); balance < amount -> INSUFFICIENT_FUNDS.
 */
import { createHash } from 'node:crypto';
import { Decimal, HALF_EVEN } from '../domain/money.js';
import type { Db } from '../db/connection.js';
import { nowTs } from '../domain/audit.js';
import { normalizeAccount } from '../domain/tokenize.js';
import { newId } from '../ids.js';

export const PER_TXN_LIMIT = new Decimal('50000.00');

export class IdempotencyMismatch extends Error {}
export class UnknownAccount extends Error {}

export interface AccountRow {
  id: string;
  owner_id: string | null;
  account_number: string;
  holder: string;
  balance_cny: string;
  closed: number;
}
export interface TxnRow {
  id: string;
  idempotency_key: string;
  request_hash: string;
  from_account: string;
  to_account_number: string;
  amount_cny: string;
  reference: string | null;
  state: 'settled' | 'failed' | 'held';
  failure_code: string | null;
  created_at: string;
}

export interface TransferResult {
  txn_id: string;
  state: string;
  failure_code: string | null;
  amount_cny: string;
  from_account: string;
  to_account_number: string;
  idempotent_replay: boolean;
}

export function transferResultDict(r: TransferResult) {
  return {
    bank_txn_id: r.txn_id,
    state: r.state,
    failure_code: r.failure_code,
    amount_cny: r.amount_cny,
    sandbox: true,
    idempotent_replay: r.idempotent_replay,
  };
}

/** `amount` must already be quantized (HALF_EVEN, 2dp) so the hash matches Python's f"{amount:.2f}". */
const reqHash = (
  from: string,
  to: string,
  amount: Decimal,
  reference: string | null | undefined
): string =>
  createHash('sha256')
    .update(`${from}|${to}|${amount.toFixed(2)}|${reference ?? ''}`, 'utf8')
    .digest('hex');

const toDecimal = (v: string | Decimal): Decimal => {
  if (typeof v === 'number')
    throw new TypeError('money must be a decimal string or Decimal, never a JS number');
  return new Decimal(v);
};

export function openAccount(
  db: Db,
  accountNumber: string,
  holder: string,
  balance: string | Decimal = '0',
  ownerId: string | null = null
): AccountRow {
  const n = normalizeAccount(accountNumber);
  const existing = getAccount(db, n);
  if (existing) return existing;
  const row: AccountRow = {
    id: newId('sba'),
    owner_id: ownerId,
    account_number: n,
    holder,
    balance_cny: toDecimal(balance).toFixed(2),
    closed: 0,
  };
  db.prepare(
    'INSERT INTO sbx_accounts (id, owner_id, account_number, holder, balance_cny, closed) VALUES (@id,@owner_id,@account_number,@holder,@balance_cny,@closed)'
  ).run(row);
  return row;
}

export function getAccount(db: Db, accountNumber: string): AccountRow | undefined {
  return db
    .prepare('SELECT * FROM sbx_accounts WHERE account_number = ?')
    .get(normalizeAccount(accountNumber)) as AccountRow | undefined;
}

export function getAccountByOwner(db: Db, ownerId: string): AccountRow | undefined {
  return db
    .prepare('SELECT * FROM sbx_accounts WHERE owner_id = ? ORDER BY rowid LIMIT 1')
    .get(ownerId) as AccountRow | undefined;
}

/** Atomic (single sqlite transaction). Same idempotency key + same params => stored result. */
export function transfer(
  db: Db,
  idempotencyKey: string,
  fromAccountNumber: string,
  toAccountNumber: string,
  amountCny: string | Decimal,
  reference: string | null = null
): TransferResult {
  return db
    .transaction((): TransferResult => {
      const srcN = normalizeAccount(fromAccountNumber);
      const dstN = normalizeAccount(toAccountNumber);
      const amount = toDecimal(amountCny).toDecimalPlaces(2, HALF_EVEN); // Python quantize default
      const rh = reqHash(srcN, dstN, amount, reference);
      const prior = db
        .prepare('SELECT * FROM sbx_txns WHERE idempotency_key = ?')
        .get(idempotencyKey) as TxnRow | undefined;
      if (prior) {
        if (prior.request_hash !== rh)
          throw new IdempotencyMismatch('idempotency key reused with different parameters');
        return {
          txn_id: prior.id,
          state: prior.state,
          failure_code: prior.failure_code,
          amount_cny: prior.amount_cny,
          from_account: prior.from_account,
          to_account_number: prior.to_account_number,
          idempotent_replay: true,
        };
      }
      const src = getAccount(db, srcN);
      if (!src) throw new UnknownAccount('source account not found');
      const dst = getAccount(db, dstN);
      let state: TxnRow['state'] = 'settled';
      let code: string | null = null;
      if (amount.lte(0)) [state, code] = ['failed', 'INVALID_AMOUNT'];
      else if (dstN.endsWith('0013') || (dst && dst.closed))
        [state, code] = ['failed', 'ACCOUNT_CLOSED'];
      else if (amount.gt(PER_TXN_LIMIT)) [state, code] = ['failed', 'LIMIT_EXCEEDED'];
      else if (amount.mod(1).eq('0.99')) [state, code] = ['held', 'RISK_HOLD'];
      else if (new Decimal(src.balance_cny).lt(amount))
        [state, code] = ['failed', 'INSUFFICIENT_FUNDS'];
      if (state === 'settled') {
        db.prepare('UPDATE sbx_accounts SET balance_cny = ? WHERE account_number = ?').run(
          new Decimal(src.balance_cny).minus(amount).toFixed(2),
          srcN
        );
        if (dst)
          db.prepare('UPDATE sbx_accounts SET balance_cny = ? WHERE account_number = ?').run(
            new Decimal(dst.balance_cny).plus(amount).toFixed(2),
            dstN
          );
      }
      const txn: TxnRow = {
        id: newId('sbx_txn'),
        idempotency_key: idempotencyKey,
        request_hash: rh,
        from_account: srcN,
        to_account_number: dstN,
        amount_cny: amount.toFixed(2),
        reference,
        state,
        failure_code: code,
        created_at: nowTs(),
      };
      db.prepare(
        'INSERT INTO sbx_txns (id, idempotency_key, request_hash, from_account, to_account_number, amount_cny, reference, state, failure_code, created_at) VALUES (@id,@idempotency_key,@request_hash,@from_account,@to_account_number,@amount_cny,@reference,@state,@failure_code,@created_at)'
      ).run(txn);
      return {
        txn_id: txn.id,
        state,
        failure_code: code,
        amount_cny: txn.amount_cny,
        from_account: srcN,
        to_account_number: dstN,
        idempotent_replay: false,
      };
    })
    .immediate();
}

export function listTransactions(db: Db, accountNumber: string): TxnRow[] {
  const n = normalizeAccount(accountNumber);
  return db
    .prepare(
      'SELECT * FROM sbx_txns WHERE from_account = ? OR to_account_number = ? ORDER BY created_at, rowid'
    )
    .all(n, n) as TxnRow[];
}
