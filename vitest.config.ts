import { defineConfig, configDefaults } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "app/**/*.test.ts"],
    // Playwright E2E specs live in `e2e/` and are driven by `npm run test:e2e`,
    // NOT Vitest. They import `@playwright/test` (a different runner) and would
    // crash under Vitest. The `include` globs above already scope Vitest to
    // src/app, so e2e is excluded by construction; this is explicit defense.
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` is a Next.js build-time guard with no runtime under
      // Vitest's node env. Alias it to an empty stub so server modules that
      // import it (e.g. src/lib/tenant.ts) can be unit/integration tested.
      "server-only": fileURLToPath(new URL("./src/test/server-only-stub.ts", import.meta.url)),
    },
  },
});
