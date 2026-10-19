import type { Config } from "tailwindcss";

/** Colors are CSS variables (see globals.css) so light and dark are chosen, not inverted. */
const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        page: v("page"),
        surface: v("surface"),
        raised: v("raised"),
        ink: { DEFAULT: v("ink"), secondary: v("ink-secondary"), muted: v("ink-muted") },
        line: v("line"),
        accent: { DEFAULT: v("accent"), soft: v("accent-soft"), ink: v("accent-ink") },
        good: { DEFAULT: v("good"), ink: v("good-ink"), soft: v("good-soft") },
        warning: { DEFAULT: v("warning"), ink: v("warning-ink"), soft: v("warning-soft") },
        serious: { DEFAULT: v("serious"), ink: v("serious-ink"), soft: v("serious-soft") },
        critical: { DEFAULT: v("critical"), ink: v("critical-ink"), soft: v("critical-soft") },
      },
      fontFamily: { sans: ["system-ui", "-apple-system", "Segoe UI", "sans-serif"] },
      borderRadius: { card: "12px" },
    },
  },
  plugins: [],
} satisfies Config;
