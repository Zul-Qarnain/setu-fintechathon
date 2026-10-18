import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Noto Sans SC"', "system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      colors: {
        // Semantic tokens: RGB channels live in app/globals.css (:root = light, .dark = dark). All text/surface pairs checked for AA.
        ink: { DEFAULT: "rgb(var(--ink) / <alpha-value>)", 700: "rgb(var(--ink-700) / <alpha-value>)", 600: "rgb(var(--ink-600) / <alpha-value>)", 500: "rgb(var(--ink-500) / <alpha-value>)" },
        paper: "rgb(var(--paper) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        sunken: "rgb(var(--sunken) / <alpha-value>)",
        line: { DEFAULT: "rgb(var(--line) / <alpha-value>)", strong: "rgb(var(--line-strong) / <alpha-value>)" },
        chrome: "rgb(var(--chrome) / <alpha-value>)",
        cta: "rgb(var(--cta) / <alpha-value>)",
        primary: { DEFAULT: "rgb(var(--primary) / <alpha-value>)", hover: "rgb(var(--primary-hover) / <alpha-value>)" },
        danger: "rgb(var(--danger) / <alpha-value>)",
        jade: { 50: "rgb(var(--jade-50) / <alpha-value>)", 100: "rgb(var(--jade-100) / <alpha-value>)", 600: "rgb(var(--jade-600) / <alpha-value>)", 700: "rgb(var(--jade-700) / <alpha-value>)", 800: "rgb(var(--jade-800) / <alpha-value>)" },
        amber: { 50: "rgb(var(--amber-50) / <alpha-value>)", 100: "rgb(var(--amber-100) / <alpha-value>)", 600: "rgb(var(--amber-600) / <alpha-value>)", 700: "rgb(var(--amber-700) / <alpha-value>)" },
        cinnabar: { 50: "rgb(var(--cinnabar-50) / <alpha-value>)", 100: "rgb(var(--cinnabar-100) / <alpha-value>)", 600: "rgb(var(--cinnabar-600) / <alpha-value>)", 700: "rgb(var(--cinnabar-700) / <alpha-value>)" },
        bridge: { 50: "rgb(var(--bridge-50) / <alpha-value>)", 600: "rgb(var(--bridge-600) / <alpha-value>)", 700: "rgb(var(--bridge-700) / <alpha-value>)" },
      },
      boxShadow: { card: "var(--shadow-card)" },
      spacing: { safe: "env(safe-area-inset-bottom)" },
    },
  },
  plugins: [],
};
export default config;
