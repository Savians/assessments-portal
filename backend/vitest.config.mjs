import { defineConfig } from "vitest/config";

export default defineConfig({
  root: ".",
  test: { environment: "node", globals: true, include: ["src/**/*.test.ts"] }
});

