import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist", "node_modules", "**/next.config.js"],
  },
  js.configs.recommended,
  // Keep lint fast and non-type-aware across the monorepo.
  // Type-aware linting requires consistent TS project configuration in every workspace.
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  }
);


