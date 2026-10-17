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
