// Test-only stub for the `server-only` package.
//
// `server-only` is a build-time guard provided by the Next.js bundler; it has
// no runtime implementation under Vitest's node environment. Modules like
// `src/lib/tenant.ts` import it as their first line, so we alias `server-only`
// to this empty module in `vitest.config.ts` to let those modules load in tests.
export {};
