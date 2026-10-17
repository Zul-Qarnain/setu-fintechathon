# Contract notes (TypeScript backend)

The web app is unchanged by the backend rewrite. Verified against the TS server on `:8000` (`DEMO_MODE=true`):

- `npm run lint`, `tsc --noEmit`, `vitest` (13) and `next build` pass.
- Playwright smoke (8 tests, real backend, `NEXT_PUBLIC_MOCK=false`) and the EN + zh-CN screenshot run pass; `web/screenshots/` was regenerated from the TS backend.
- Live status+shape diff vs the Python backend: 29/29 requests identical (`server/scripts/contract_diff.ts`).

Known differences (none break the UI):
- PDF upload is not supported by the TS backend (422 `UNSUPPORTED_DOCUMENT`); the Documents page's text/`.txt` path is unaffected.
- `DEMO_MODE` defaults to off in the backend: the demo helpers (`/demo/personas`, `/demo/notices`, `/demo/totp/*`, `/demo/tamper-audit`) need `DEMO_MODE=true` (set in `docker-compose.yml`).
- Test-only: against a real backend the e2e specs can re-seed the DB first with `E2E_RESET_API=http://localhost:8000` (calls `POST /demo/reset`); the zh-CN language smoke accepts either the CNY 1,350 or 18,500 amount because a freshly seeded DB has no tuition obligation until a notice is confirmed.

Run: `cd server && DEMO_MODE=true CORS_ORIGINS=http://localhost:3000,http://localhost:3100 npm start`, then `cd web && npm run build && E2E_RESET_API=http://localhost:8000 npx playwright test --project=smoke`.
