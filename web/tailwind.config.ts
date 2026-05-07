import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        parchment: "#f3ede0",
        surface: "#ebe3d2",
        ink: "#1a1612",
        muted: "#6e6557",
        redline: "#b91528",
        tobacco: "#8b6f47",
        gold: "#b89455",
        sage: "#5a6e4f",
      },
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
        body: ["var(--font-body)", "Georgia", "serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      letterSpacing: {
        widest: "0.22em",
      },
      animation: {
        "draw-underline": "draw 700ms cubic-bezier(0.16, 1, 0.3, 1) forwards",
        "rise": "rise 700ms cubic-bezier(0.16, 1, 0.3, 1) both",
      },
      keyframes: {
        draw: {
          "0%": { backgroundSize: "0% 2px" },
          "100%": { backgroundSize: "100% 2px" },
        },
        rise: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
};
export default config;
