import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        navy: { 50: "#f3f5fb", 100: "#e5e9f6", 500: "#31468f", 700: "#1d2d68", 800: "#14235c", 900: "#0c1539" },
        gold: { 100: "#fff2cc", 400: "#e7bd52", 500: "#c99b2e", 600: "#a7791e" }
      },
      boxShadow: { card: "0 18px 50px rgba(20, 35, 92, 0.10)" }
    }
  },
  plugins: []
};

export default config;

