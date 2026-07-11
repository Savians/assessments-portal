import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

const config = tseslint.config(
  {
    ignores: [
      "dist/**",
      "cdk.out/**",
      "node_modules/**",
      "generated/**",
      "**/*.config.mjs",
      "eslint.config.mjs"
    ]
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": "error"
    }
  }
);

export default config;
