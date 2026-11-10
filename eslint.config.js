import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "_forge/**", "design/**", "**/playwright-report/**", "**/test-results/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": "error",
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
  {
    // Node scripts; `window` only appears inside page.waitForFunction callbacks that run in the browser.
    files: ["client/scripts/**/*.mjs", "scripts/**/*.mjs"],
    languageOptions: { globals: { process: "readonly", URL: "readonly", console: "readonly", setTimeout: "readonly", window: "readonly" } },
  },
);
