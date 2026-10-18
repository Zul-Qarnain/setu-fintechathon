import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Noto Sans SC"', "system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      colors: {
        // Semantic design tokens (CSS var based for light/dark)
        canvas: "var(--canvas)",
        surface: "var(--surface)",
        ink: { DEFAULT: "var(--ink)", 2: "var(--ink-2)" },
        line: { DEFAULT: "var(--line)" },
        jade: { 
          DEFAULT: "var(--jade)", 
          light: "var(--jade-light)",
          50: "#ecfdf5", 
          100: "#cfeadf", 
          600: "#0b7a5a", 
          700: "#086247", 
          800: "#064d38" 
        },
        bridge: { 
          DEFAULT: "var(--bridge)",
          light: "var(--bridge-light)",
          50: "#eaf0fa", 
          600: "#1d4ed8", 
          700: "#1e40af" 
        },
        amber: { 
          DEFAULT: "var(--amber)",
          light: "var(--amber-light)",
          50: "#fff6e0", 
          100: "#fde9b3", 
          600: "#9a5b00", 
          700: "#7c4900" 
        },
        cinnabar: { 
          DEFAULT: "var(--cinnabar)",
          light: "var(--cinnabar-light)",
          50: "#fdecea", 
          100: "#f9cfc9", 
          600: "#b3261e", 
          700: "#8f1d17" 
        },
        // Tier pill colors
        tier: {
          0: { bg: "var(--tier-0-bg)", border: "var(--tier-0-border)", text: "var(--tier-0-text)" },
          1: { 
            bg: "var(--tier-1-bg)", 
            border: "var(--tier-1-border)", 
            text: "var(--tier-1-text)",
            bgDark: "var(--tier-1-bg-dark)",
            borderDark: "var(--tier-1-border-dark)",
            textDark: "var(--tier-1-text-dark)"
          },
          2: { 
            bg: "var(--tier-2-bg)", 
            border: "var(--tier-2-border)", 
            text: "var(--tier-2-text)",
            bgDark: "var(--tier-2-bg-dark)",
            borderDark: "var(--tier-2-border-dark)",
            textDark: "var(--tier-2-text-dark)"
          },
          3: { 
            bg: "var(--tier-3-bg)", 
            border: "var(--tier-3-border)", 
            text: "var(--tier-3-text)",
            bgDark: "var(--tier-3-bg-dark)",
            borderDark: "var(--tier-3-border-dark)",
            textDark: "var(--tier-3-text-dark)"
          },
          4: { 
            bg: "var(--tier-4-bg)", 
            border: "var(--tier-4-border)", 
            text: "var(--tier-4-text)",
            bgDark: "var(--tier-4-bg-dark)",
            borderDark: "var(--tier-4-border-dark)",
            textDark: "var(--tier-4-text-dark)"
          },
        },
      },
      boxShadow: { card: "0 1px 2px rgba(15,27,45,.06), 0 4px 16px rgba(15,27,45,.05)" },
      borderRadius: {
        DEFAULT: '0.25rem',
        lg: '0.5rem',
        xl: '0.75rem',
        card: '0.75rem', // 12px for cards
        control: '0.5rem', // 8px for controls
        pill: '0.375rem', // 6px for pills
      },
      spacing: {
        gutter: '1rem',
        gutterMobile: '0.75rem',
      },
    },
  },
  plugins: [],
};
export default config;
