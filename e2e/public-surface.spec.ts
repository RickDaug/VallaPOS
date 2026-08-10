import { test, expect, type Page } from "@playwright/test";

/**
 * Public-surface smoke: the acquisition funnel and the deployment's own health.
 *
 * Unlike `smoke.spec.ts`, nothing here needs a seeded database or a login — it
 * only touches signed-out, public routes. That makes it the one E2E suite that
 * can run in CI against a Vercel Preview on every PR, which is why it exists:
 * the audit found `/about` returning 404, every legal policy reachable only by
 * running the hash router, and all six Buy/Subscribe CTAs shipping as inert
 * `#/#pricing` fragments — none of which 1024 unit tests could see, because the
 * defects lived in the routing between pages rather than inside any one module.
 *
 * The rule these tests encode: a visitor must be able to reach every page we
 * link to, and every button that asks for money must go somewhere real.
 */

/** Links we render in the nav/footer that must resolve for a signed-out visitor. */
const PUBLIC_ROUTES = [
  "/",
  "/about",
  "/privacy",
  "/terms",
  "/disputes",
  "/dmca",
  "/do-not-sell",
  "/sign-in",
  "/sign-up",
];

test.describe("public surface", () => {
  for (const path of PUBLIC_ROUTES) {
    test(`${path} responds 200`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status(), `${path} should not be a dead link`).toBe(200);
      // A 200 that renders nothing is still broken. Match a VISIBLE h1 rather
      // than the first in document order — the marketing document carries more
      // than one heading, and which is showing depends on the route.
      await expect(page.locator("h1:visible").first()).toBeVisible();
    });
  }

  test("every internal link on the home page resolves", async ({ page, request }) => {
    await page.goto("/");

    const hrefs = await page.$$eval("a[href]", (as) =>
      as
        .map((a) => a.getAttribute("href") ?? "")
        .filter((h) => h.startsWith("/") && !h.startsWith("//")),
    );
    expect(hrefs.length).toBeGreaterThan(10);

    // Dedupe and strip fragments; /desktop/buy is excluded (it redirects to
    // Stripe or to the unavailable page, both covered by their own test below).
    const paths = [...new Set(hrefs.map((h) => h.split("#")[0] ?? ""))].filter(
      (p) => p !== "" && p !== "/desktop/buy",
    );

    const broken: string[] = [];
    for (const path of paths) {
      const res = await request.get(path, { maxRedirects: 0 });
      if (res.status() >= 400) broken.push(`${path} → ${res.status()}`);
    }
    expect(broken, "home page links to routes that don't exist").toEqual([]);
  });

  test("no link is left as an artifact hash route", async ({ page }) => {
    // `#/about`, `#/#pricing` — the design artifact's SPA routing. If one of
    // these reappears, generate.mjs stopped rewriting and the funnel is inert
    // again until hydration.
    await page.goto("/");
    const hashRoutes = await page.$$eval("a[href]", (as) =>
      as.map((a) => a.getAttribute("href") ?? "").filter((h) => h.startsWith("#/")),
    );
    expect(hashRoutes).toEqual([]);
  });

  test("every money CTA points somewhere real, before any JS runs", async ({ request }) => {
    // Read the SERVER html directly: the CTAs must carry their destinations
    // without hydration, or a tap on a slow connection does nothing.
    const html = await (await request.get("/")).text();
    const ctas = [...html.matchAll(/<a\b[^>]*\bdata-buy="(cloud|offline)"[^>]*>/g)];
    expect(ctas.length, "no purchase CTAs found in the server html").toBeGreaterThanOrEqual(6);

    for (const [tag, kind] of ctas) {
      const href = tag.match(/href="([^"]*)"/)?.[1];
      expect(href, `data-buy="${kind}" CTA href`).toBe(
        kind === "cloud" ? "/sign-up" : "/desktop/buy",
      );
    }
  });

  test("the $99 buy button either sells or says why not — never silently bounces", async ({
    page,
  }) => {
    await page.goto("/desktop/buy");

    const url = page.url();
    if (url.includes("checkout.stripe.com")) {
      // Configured: we reached a real Stripe Checkout. Nothing more to assert.
      return;
    }

    // Unconfigured: the visitor must land somewhere that EXPLAINS it. The old
    // behaviour — a silent 303 back to `/#pricing` — is the regression to catch.
    expect(url, "buy button bounced back to the marketing page with no explanation").toContain(
      "/desktop/unavailable",
    );
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/can't take your payment/i);
    await expect(page.getByRole("link", { name: /back to home/i })).toBeVisible();
  });

  test("about is a real route, not a client-side view swap", async ({ request }) => {
    // Fetch the raw html so hydration can't rescue it: the About content has to
    // be in the server response, or crawlers and no-JS visitors see the home page.
    const html = await (await request.get("/about")).text();
    expect(html).toContain('id="view-about"');
    expect(html).not.toContain('id="view-home"');
  });

  test("reports its own configuration health", async ({ request }) => {
    const res = await request.get("/api/health");
    const body = await res.json();

    // Deliberately NOT asserting ok===true: on a preview (and on production
    // until the Stripe/Resend keys are fixed) it is legitimately 503. What must
    // hold is that the endpoint answers, and answers in a shape an operator and
    // an alert can both read.
    expect([200, 503]).toContain(res.status());
    expect(typeof body.ok).toBe("boolean");
    expect(Array.isArray(body.issues)).toBe(true);
    expect(body.ok).toBe(body.issues.length === 0);

    for (const issue of body.issues) {
      expect(issue.key).toMatch(/^[A-Z0-9_]+$/);
      expect(["malformed", "missing"]).toContain(issue.kind);
      expect(issue.impact.length).toBeGreaterThan(20);
      // Never leak a value — only the variable's name.
      expect(JSON.stringify(issue)).not.toMatch(/sk_(test|live)_|whsec_|re_[A-Za-z0-9]{8}/);
    }
  });

  test("legal policies are linked from the site and listed in the sitemap", async ({
    page,
    request,
  }) => {
    // Stripe and app stores expect a stable, linkable policy URL. These pages
    // existed before the audit but were reachable only through the hash router
    // and absent from the sitemap — present, yet effectively invisible.
    await page.goto("/");
    for (const doc of ["/privacy", "/terms", "/dmca", "/disputes", "/do-not-sell"]) {
      await expect(page.locator(`a[href="${doc}"]`).first()).toHaveCount(1);
    }

    const sitemap = await (await request.get("/sitemap.xml")).text();
    for (const doc of ["/about", "/privacy", "/terms", "/dmca", "/disputes", "/do-not-sell"]) {
      expect(sitemap, `sitemap is missing ${doc}`).toContain(`${doc}</loc>`);
    }
  });

  test("the home page is usable on a phone-sized viewport", async ({ page }) => {
    // The stated ICP sells from a phone. The floor: no horizontal scroll and a
    // reachable primary CTA.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expectNoHorizontalScroll(page);
    // Any VISIBLE route into sign-up. The nav pill is deliberately display:none
    // at this width (the mobile menu replaces it), so don't pin to that one —
    // what matters is that a phone user can still reach sign-up.
    await expect(page.locator('a[href="/sign-up"]:visible').first()).toBeVisible();
  });
});

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "page scrolls sideways on a phone").toBeLessThanOrEqual(1);
}
