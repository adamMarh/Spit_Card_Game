import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["Inter", "ui-sans-serif", "system-ui"],
        card: ["Georgia", "serif"]
      },
      boxShadow: {
        card: "0 18px 40px rgba(0,0,0,0.28)"
      }
    }
  },
  plugins: []
} satisfies Config;
