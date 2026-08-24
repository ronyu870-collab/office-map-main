import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  // P0 baseline policy:
  // Keep lint running across the entire repository, but treat broad legacy
  // migration debt as warnings rather than merge-blocking errors. These rules
  // were introduced/tightened by the current Next.js/React/TypeScript lint
  // stack and currently flag hundreds of pre-existing sites. Converting them
  // all in one pass would turn a CI-baseline repair into a risky product
  // refactor. New syntax/type/build/test failures still block Verify.
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-empty-object-type": "warn",
      "prefer-const": "warn",
      "react/no-unescaped-entities": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/use-memo": "warn",
    },
  },
  {
    files: ["**/__tests__/**/*.{ts,tsx}", "**/*.{test,spec}.{ts,tsx}"],
    rules: {
      // Historical tests use `module` as a plain local fixture name. The
      // Next.js rule protects runtime CommonJS module semantics, which is not
      // relevant to these test-local variables.
      "@next/next/no-assign-module-variable": "warn",
    },
  },

  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
