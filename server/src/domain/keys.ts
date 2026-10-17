/** Process-wide key material (set once by buildApp from config; defaults = the dev-only keys in .env.example). */
let hmacKey = process.env.HMAC_KEY ?? 'dev-only-hmac-key-change-me-0123456789abcdef';
let aesKeyB64 = process.env.AES_KEY_B64 ?? 'ZGV2LW9ubHktYWVzLWtleS0zMi1ieXRlcy1sb25nISE=';

export function configureKeys(k: { hmacKey?: string; aesKeyB64?: string }): void {
  if (k.hmacKey !== undefined) hmacKey = k.hmacKey;
  if (k.aesKeyB64 !== undefined) aesKeyB64 = k.aesKeyB64;
}
export const getHmacKey = (): string => hmacKey;
export const getAesKeyB64 = (): string => aesKeyB64;
