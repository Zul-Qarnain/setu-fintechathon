/** Process-wide key material (set once by buildApp from config; defaults = the dev-only keys in .env.example). */
let hmacKey = process.env.HMAC_KEY ?? 'dev-only-hmac-key-change-me-0123456789abcdef';
let aesKeyB64 = process.env.AES_KEY_B64 ?? 'ZGV2LW9ubHktYWVzLWtleS0zMi1ieXRlcy1sb25nISE=';

export function configureKeys(k: { hmacKey?: string; aesKeyB64?: string }): void {
  if (k.hmacKey !== undefined) hmacKey = k.hmacKey;
  if (k.aesKeyB64 !== undefined) aesKeyB64 = k.aesKeyB64;
}
export const getHmacKey = (): string => hmacKey;
export const getAesKeyB64 = (): string => aesKeyB64;

export const DEV_HMAC_KEY = 'dev-only-hmac-key-change-me-0123456789abcdef';
export const DEV_JWT_SECRET = 'dev-only-jwt-secret-change-me-0123456789abcdef';
export const DEV_AES_KEY_B64 = 'ZGV2LW9ubHktYWVzLWtleS0zMi1ieXRlcy1sb25nISE=';

/** Fail fast outside dev: refuse the publicly known dev keys when NODE_ENV=production. */
export function assertNonDefaultKeys(
  c: { HMAC_KEY: string; JWT_SECRET: string; AES_KEY_B64: string },
  nodeEnv = process.env.NODE_ENV
): void {
  if (nodeEnv !== 'production') return;
  if (
    c.HMAC_KEY === DEV_HMAC_KEY ||
    c.JWT_SECRET === DEV_JWT_SECRET ||
    c.AES_KEY_B64 === DEV_AES_KEY_B64
  ) {
    throw new Error(
      'Refusing to start in production with the default dev HMAC_KEY/JWT_SECRET/AES_KEY_B64'
    );
  }
}
