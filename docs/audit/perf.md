# Performance, Reliability & SEO

**Manager:** Grace, Performance Lead
**Severity counts:** S0 0 · S1 1 · S2 4 · S3 4

## Executive summary

The Performance, Reliability & SEO squad found no ship-blocking (S0) defects. The single most serious item is a reliability risk (S1): PR #115's Neon pooled-connection fix is present in source, but production still exhibited intermittent 503-then-retry-succeeds behavior on register RSC/POST requests (RECON item 9, 2026-07-21), consistent with the manual Vercel `DATABASE_URL` pooler swap never having been applied — meaning serverless checkout requests may still exhaust Neon's direct-connection ceiling under burst (lunch rush). The remaining nine issues are optimizations and hygiene: the marketing homepage ('/') is forced fully dynamic (calls headers()+getSession() unconditionally) so Google's most LCP/SEO-sensitive page can't be edge-cached and pays a serverless+auth round trip per anonymous visit; the 91KB marketing HTML/CSS is double-shipped (inlined in SSR and re-bundled into client JS because MarketingSite is a client component); the Payment table lacks the (businessId, createdAt) composite index its Z-report/CSV-export queries need; and a cluster of SEO metadata/structured-data gaps (auth pages inherit the homepage's title/description with no canonical, robots.txt doesn't cover the /{businessId}/* tree, and SoftwareApplication/BlogPosting JSON-LD miss the properties Google needs for rich results). Every finding below was re-read and confirmed in source; all severities reflect that verification.

## Coverage statement

Domain covered: Core Web Vitals / render path (static vs dynamic rendering, TTFB, LCP inputs), client-bundle weight, caching/CDN headers, next/font and image usage, service-worker caching strategy; DB scale (Prisma indexes, N+1/loop-query patterns, offline-queue replay, connection pooling / Neon PR #115); and SEO/discoverability (root + per-route metadata, canonicals, robots.txt, sitemap, manifest, and JSON-LD structured data for home/auth/blog). Verification was done by re-reading source files at C:/Users/RickD/AndroidStudioProjects/VallaPOS (app/page.tsx, robots.ts, sitemap.ts, prisma/schema.prisma Payment model, src/features/orders/queries.ts, src/features/marketing/MarketingSite.tsx + marketing-content.ts byte size, app/blog/[slug]/page.tsx) and by grepping for auth-page metadata and opengraph-image routes. HONEST GAPS: this lane had no live browser and no Vercel/production env access. Two claims therefore rest on the shared RECON live capture rather than first-hand measurement — (a) whether production `DATABASE_URL` is actually the pooled host (the S1 finding, marked verified:false), and (b) actual field-measured LCP/CLS/TTFB numbers. We confirmed the code-level cause of every finding; we did not run Lighthouse/WebPageTest or query pg_stat_activity in prod.

## Sign-off

Grace, Performance Lead — I attest the Performance, Reliability & SEO domain was fully covered at the source level: render path, bundle weight, caching, DB indexing/pooling, and the full SEO metadata/structured-data surface. All 10 findings were personally re-read and confirmed in the repo; overlapping items were deduped and one severity was corrected downward (forced-dynamic homepage S1→S2) to reflect that it is an optimization, not an availability failure. The one S1 (production connection pooling) and field-measured Web Vitals remain unverifiable without prod/browser access and are flagged as such — everything else is code-confirmed.

## Findings (9)

#### S1 — Neon pooled-connection fix (PR #115) is in source, but production still shows the exact 503-then-retry symptom it was meant to fix — pooler DATABASE_URL swap likely never applied
- **Area:** reliability / db-connection-pooling
- **Auditor:** Zoe, the Load Thinker · **Confidence:** medium · _unverified (auto-consolidated)_
- **Evidence:** `schema.prisma:15-25 has directUrl = env("DIRECT_URL"), confirming the code-level fix is present in HEAD; STATE.md line 175 documents that the fix is inert until an operator manually swaps Vercel Prod DATABASE_URL to the pooled (-pooler, pgbouncer=true) host and redeploys. RECON item 9 (live prod capture 2026-07-21, after #115 landed) shows intermittent HTTP 503 on several /{businessId}/register RSC/POST requests that then 200 on retry. The pooler swap is a manual step the merge does not perform.`
- **Impact:** If Vercel Production DATABASE_URL was never swapped to the pooled host, every serverless register/checkout request consumes a direct Postgres connection against Neon's small max_connections ceiling. Under burst (lunch rush, multiple food-truck cashiers) this yields exactly the flaky 503-then-succeeds pattern RECON captured — cashiers randomly failing to load or submit the register mid-sale.
- **Fix:** Verify via Vercel dashboard / vercel env ls production (or a prod pg_stat_activity query) that DATABASE_URL is the -pooler host with pgbouncer=true and DIRECT_URL is set separately for migrations. If not, apply the STATE.md operator step, redeploy, and re-run prisma/smoke-order-race.ts against prod-shaped load to confirm the 503s stop.

#### S2 — Marketing home ('/') is forced fully dynamic — headers()+getSession() run on every anonymous visit, so the most SEO/LCP-sensitive page can't be edge-cached
- **Area:** Core Web Vitals / render path (TTFB)
- **Auditor:** Max, the Speed Freak · **Confidence:** high
- **Evidence:** `app/page.tsx:73-74 — 'const headerList = await headers(); const session = await auth.api.getSession({ headers: headerList });' run unconditionally before rendering <MarketingSite/>. Calling headers() in a Server Component opts the whole route out of static rendering. No revalidate or experimental.ppr is configured in next.config.ts. Confirmed by direct re-read.`
- **Impact:** The public marketing page Google indexes cannot be served from Vercel's Edge cache; every anonymous visitor pays a full serverless round trip plus a session/auth check to render content that is otherwise 100% static, worsening TTFB and transitively LCP. Severity corrected from the auditor's S1 to S2: it is a genuine perf/SEO optimization gap, but the page renders correctly — no correctness or availability failure.
- **Fix:** Move the session-redirect into a small dynamic wrapper (or a middleware cookie check) and let the marketing content render as a static/ISR segment, or adopt Next 15 Partial Prerendering so the static shell prerenders while only the auth check streams.

#### S2 — 91KB marketing HTML/CSS is double-shipped — inlined into every SSR response AND re-bundled into client JS because MarketingSite is a client component
- **Area:** client-bundle bloat / page weight
- **Auditor:** Max, the Speed Freak · **Confidence:** high
- **Evidence:** `src/features/marketing/marketing-content.ts measured at 91,358 bytes. MarketingSite.tsx:1 is "use client"; line 20 imports MARKETING_CSS + MARKETING_HTML at module scope; lines 266-267 render them via <style dangerouslySetInnerHTML> / <div dangerouslySetInnerHTML>. Because the component is a client component, the 91KB string constants are pulled into the client hydration bundle in addition to being emitted inline in the SSR document. All confirmed by direct re-read.`
- **Impact:** Anonymous visitors download ~91KB of markup/CSS twice (once in the HTML document, once in the hydration JS). The CSS is a runtime-injected <style> string, so it is never extracted into a separate hashed, long-cache stylesheet — it can't be cached independently of the HTML and is re-emitted on every dynamic request (compounding the forced-dynamic finding).
- **Fix:** Split MarketingSite into a server component for the static markup with a small client island only for interactive bits (theme toggle, mobile menu, hash router, count-up); or at minimum move MARKETING_CSS into a real .css file processed by the build pipeline so it is extracted, hashed, and cached separately.

#### S2 — Payment table has no (businessId, createdAt) composite index, but the Z-report / CSV-export queries filter on exactly that pair
- **Area:** scale / db-indexing
- **Auditor:** Zoe, the Load Thinker · **Confidence:** high
- **Evidence:** `prisma/schema.prisma Payment model (verified) has only @@index([businessId]) and @@index([orderId]) — no composite with createdAt. src/features/orders/queries.ts:120-121 getDailyReport runs db.payment.findMany({ where: { businessId, createdAt: { gte: start, lt: end }, order: { businessId } } }). Contrast: the Order model has @@index([businessId, createdAt]).`
- **Impact:** As a tenant's payment history grows (refunds add extra rows), every Reports/Z-report load and CSV export does a businessId-index scan then filters createdAt without index support instead of an index range scan. Latency degrades with total historical payment volume per business rather than with the reporting window — a real, slow-growing reporting-latency regression for busy long-lived tenants.
- **Fix:** Add @@index([businessId, createdAt]) to the Payment model (mirroring Order) and migrate. The report queries already filter on exactly that pair.

#### S2 — Auth pages in the sitemap have no page-level metadata — duplicate title/description with the homepage and no canonical
- **Area:** SEO / metadata
- **Auditor:** Felix, the Discoverability Auditor · **Confidence:** high
- **Evidence:** `grep for export const metadata / generateMetadata across app/(auth)/ returns nothing, and there is no app/(auth)/layout.tsx (verified). app/sitemap.ts:23-24 lists /sign-up (priority 0.6) and /sign-in (priority 0.4) as indexable. With no metadata they inherit app/layout.tsx root defaults verbatim — same title, same description, same OG block — and emit no alternates.canonical (only app/page.tsx:15 sets canonical '/').`
- **Impact:** Three indexable URLs (/, /sign-in, /sign-up) share an identical <title> and meta description, and /sign-in and /sign-up carry no canonical tag. Search engines fold duplicate-title pages and pick their own canonical, which can rank the wrong URL, split link equity, and produce generic low-CTR snippets for the two conversion-critical pages.
- **Fix:** Add a small export const metadata (title, description, alternates.canonical) to each of the four app/(auth)/*/page.tsx files, mirroring app/page.tsx and app/blog/page.tsx.

#### S3 — No explicit Cache-Control on the public marketing surface
- **Area:** caching
- **Auditor:** Max, the Speed Freak · **Confidence:** medium
- **Evidence:** `next.config.ts securityHeaders (applied to /:path*) has no Cache-Control entry; repo-wide grep shows Cache-Control only on 4 webhook routes + reports/export, never on '/' or marketing pages (confirmed). This compounds the forced-dynamic finding.`
- **Impact:** Even setting aside the forced-dynamic issue, there is no explicit cache policy on the pages that would most benefit from CDN/browser caching. Largely subsumed by fixing the forced-dynamic homepage (Vercel then auto-applies Cache-Control).
- **Fix:** Once '/' can be statically/ISR-rendered, Vercel's automatic Cache-Control applies with no manual header. If any public page must stay dynamic, add an explicit s-maxage + stale-while-revalidate Cache-Control.

#### S3 — robots.txt disallow list doesn't cover the authenticated per-business app tree it claims to exclude
- **Area:** SEO / robots
- **Auditor:** Felix, the Discoverability Auditor · **Confidence:** high
- **Evidence:** `app/robots.ts:12 disallow = ["/api/", "/start", "/~offline"] — omits every /{businessId}/* route (register, orders, products, reports, drawer, employees, floor, settings), despite the file's own comment (lines 4-6) stating the intent to keep crawlers out of authenticated per-business routes. No app/(app) page carries a noindex either. Confirmed by direct re-read.`
- **Impact:** Low practical risk today: app/(app)/layout.tsx redirects anonymous crawlers to the public /sign-in, so no tenant data is exposed. But it is an indexability/crawl-budget gap inconsistent with stated intent — any externally-linked or historically-crawled businessId (cuid) URL can still get a bare index entry and wastes crawl budget on 307 chains.
- **Fix:** Broaden the robots.ts disallow to a wildcard covering the authenticated tree, or add robots: { index: false } to the app/(app) layout as defense-in-depth (matching app/desktop/license and app/pay/success).

#### S3 — Homepage SoftwareApplication JSON-LD has no aggregateRating/review — ineligible for Google's Software App rich result
- **Area:** SEO / structured-data
- **Auditor:** Felix, the Discoverability Auditor · **Confidence:** medium
- **Evidence:** `app/page.tsx:40-62 — the SoftwareApplication node sets name/applicationCategory/operatingSystem/description/offers but no aggregateRating or review property (confirmed).`
- **Impact:** The JSON-LD is valid schema.org and passes generic validators, but per Google's docs SoftwareApplication rich results require an aggregateRating (or review) — so the markup is present but inert for search-result enhancement (no star rating / rich card).
- **Fix:** Add a genuine aggregateRating once real reviews exist, or drop the SoftwareApplication type for a plain WebSite/Organization graph until there is rating data.

#### S3 — BlogPosting JSON-LD omits the image property Google expects for Article rich-result eligibility
- **Area:** SEO / structured-data
- **Auditor:** Felix, the Discoverability Auditor · **Confidence:** medium
- **Evidence:** `app/blog/[slug]/page.tsx JSON-LD (BlogPosting) sets headline/datePublished etc. but has no image field (confirmed via grep — image only appears in twitter card config). find app -iname 'opengraph-image*' returns only the single root app/opengraph-image.tsx, and app/blog/[slug]/ contains only page.tsx — no per-post OG image route.`
- **Impact:** Blog posts are less likely to qualify for Google's Article rich result / Discover (which requires a structured-data image), and every post shares one generic OG card on social shares rather than post-specific art — weaker CTR on shared links.
- **Fix:** Add an image array to the BlogPosting JSON-LD (a shared default beats none) and consider a dynamic app/blog/[slug]/opengraph-image.tsx built from the post title, following the root next/og pattern.

