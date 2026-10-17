import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
// Mock-mode smoke tests: build with NEXT_PUBLIC_MOCK=true (see `npm run e2e`), then serve on :PORT.
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, channel: process.env.PW_CHANNEL ?? "chrome", viewport: { width: 1280, height: 860 }, trace: "retain-on-failure" },
  projects: [
    { name: "smoke", testMatch: /smoke\.spec\.ts/ },
    { name: "screenshots", testMatch: /screenshots\.spec\.ts/ },
  ],
  webServer: { command: `npx next start -p ${PORT}`, url: `http://localhost:${PORT}/en/login`, reuseExistingServer: true, timeout: 60_000 },
});
