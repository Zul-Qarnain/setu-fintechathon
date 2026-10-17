/** pino redaction paths (PII / secrets never reach logs). */
export const redactPaths = [
  'req.headers.authorization',
  '*.password',
  '*.totp',
  '*.code',
  '*.account_number',
  '*.to_account_number',
  '*.email',
  '*.token',
  '*.access_token',
];

import { redactPii } from './domain/tokenize.js';

/** Cycle- and depth-safe log redaction: masks account numbers / emails / phones in strings of plain objects & arrays; leaves other instances (req, res, Error) to pino serializers. */
export function redactLog(v: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (typeof v === 'string') return redactPii(v);
  if (v === null || typeof v !== 'object' || depth > 6) return v;
  if (seen.has(v)) return '[Circular]';
  const proto = Object.getPrototypeOf(v) as unknown;
  if (!Array.isArray(v) && proto !== Object.prototype && proto !== null) return v;
  seen.add(v);
  if (Array.isArray(v)) return v.map((x) => redactLog(x, depth + 1, seen));
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, redactLog(x, depth + 1, seen)]));
}
