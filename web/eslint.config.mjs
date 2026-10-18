import next from "eslint-config-next";

// React-compiler era rules flag the common "fetch in effect -> setState" pattern used across these client pages; kept as warnings.
const config = [
  ...next,
  { rules: { "react-hooks/set-state-in-effect": "warn", "react-hooks/purity": "warn", "react-hooks/refs": "warn", "react-hooks/immutability": "warn" } },
  { ignores: [".next/**", "node_modules/**", "test-results/**", "playwright-report/**", "next-env.d.ts"] },
];
export default config;
