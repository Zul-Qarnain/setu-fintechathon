import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Noto Sans SC"', "system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      colors: {
        // Setu palette: "bridge" ink-navy + jade, with warm amber/cinnabar signals. All pairs checked for AA on paper/white.
        ink: { DEFAULT: "#0f1b2d", 700: "#26364d", 600: "#3b4d66", 500: "#4f627c" },
        paper: "#f6f4ef",
        line: "#e2ded3",
        jade: { 50: "#e8f5f0", 100: "#cfeadf", 600: "#0b7a5a", 700: "#086247", 800: "#064d38" },
        amber: { 50: "#fff6e0", 100: "#fde9b3", 600: "#9a5b00", 700: "#7c4900" },
        cinnabar: { 50: "#fdecea", 100: "#f9cfc9", 600: "#b3261e", 700: "#8f1d17" },
        bridge: { 50: "#eaf0fa", 600: "#1d4ed8", 700: "#1e40af" },
      },
      boxShadow: { card: "0 1px 2px rgba(15,27,45,.06), 0 4px 16px rgba(15,27,45,.05)" },
    },
  },
  plugins: [],
};
export default config;
