import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist",
      "node_modules",
      ".next",
      "**/.next/**",
      "**/next.config.js",
      ".wrangler",
      "**/.wrangler/**",
      ".wrangler-dist",
      "**/.wrangler-dist/**",
      ".wrangler-dist2",
      "**/.wrangler-dist2/**",
      "**/.wrangler-dist*/**",
    ],
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


