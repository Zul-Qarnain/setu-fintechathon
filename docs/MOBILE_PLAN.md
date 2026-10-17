# Mobile wrapping plan (not built)

Goal: ship the existing Next.js UI + TS API as an installable app without a rewrite.

1. **PWA first (1 day):** add a web manifest + service worker (app shell only; never cache `/auth`, `/actions`, `/audit` responses). Works on Android and iOS home screens; zero store review.
2. **Capacitor wrapper (2–3 days):** `web` is `output: standalone` (SSR middleware for next-intl), so point the Capacitor WebView at the deployed HTTPS origin (`server.url`) rather than bundling static files. Needed plugins: `@capacitor/app` (deep links), `@capacitor/preferences` (token in secure storage instead of `localStorage`), `@capacitor/browser`.
3. **Backend for mobile:** serve the TS API over HTTPS with `CORS_ORIGINS` including `capacitor://localhost` and `https://localhost`; keep `DEMO_MODE=false` outside the demo; set non-default `JWT_SECRET`/`HMAC_KEY`/`AES_KEY_B64` (the server refuses defaults when `NODE_ENV=production`).
4. **Auth hardening before real users:** short-lived access token + refresh token (cut from this rewrite), biometric re-auth before showing TOTP/approvals, certificate pinning, root/jailbreak warning.
5. **Out of scope until reviewed:** PIPL consent screens, push notifications for approvals (APNs/FCM — payload must carry no amounts or account data), real bank/PSP integration.
