import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // No silent escape hatches in code that handles money.
      "@typescript-eslint/ban-ts-comment": "error",
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    // Build artifacts and local tooling — not source. Serwist emits the service
    // worker into public/ at build time (public/sw.js, dev worker shims); the
    // agent harness writes scratch worktrees under .claude/. Linting either is
    // just noise (huge minified files, no fixes to make).
    ignores: [
      ".next/**",
      "node_modules/**",
      "src/generated/**",
      "next-env.d.ts",
      "public/sw.js",
      "public/swe-worker-*.js",
      ".claude/**",
    ],
  },
];

export default eslintConfig;
