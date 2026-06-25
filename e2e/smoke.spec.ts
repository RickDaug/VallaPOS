import { test, expect, type Page } from "@playwright/test";

/**
 * VallaPOS E2E smoke harness — the app's first end-to-end coverage.
 *
 * Prerequisites (see e2e/README.md): a running app at E2E_BASE_URL with the
 * demo data seeded via `npm run db:seed` (creates the owner login + the
 * "Classic Burger" / "Line Up" catalog used below).
 *
 * Selectors lean on roles / accessible names / visible text rather than CSS
 * classes, so they survive styling churn.
 */

const OWNER_EMAIL = "owner@valla.test";
const OWNER_PASSWORD = "supersecret123";

/**
 * Sign in as the seeded owner and land on the register.
 *
 * The seeded owner has NO PIN, so after auth the shared-terminal "operator lock"
 * screen appears and we bootstrap past it with "Continue as …". A staff member
 * WITH a pin would instead get a PIN pad — out of scope for the smoke path.
 */
async function signInAndUnlock(page: Page): Promise<void> {
  await page.goto("/sign-in");

  await page.getByLabel("Email").fill(OWNER_EMAIL);
  await page.getByLabel("Password").fill(OWNER_PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();

  // After auth we get redirected into /{businessId}/... — the operator lock or
  // the register. Bootstrap past the lock if it shows ("Continue as Demo Owner").
  const continueAs = page.getByRole("button", { name: /^Continue as / });
  await expect(continueAs.or(page.getByRole("heading", { name: "Register" }))).toBeVisible();
  if (await continueAs.isVisible().catch(() => false)) {
    await continueAs.click();
  }

  await expect(page).toHaveURL(/\/register$/);
  await expect(page.getByRole("heading", { name: "Register" })).toBeVisible();
}

test.describe("VallaPOS smoke", () => {
  test("sign in, ring up a seeded item, complete a cash checkout", async ({ page }) => {
    await signInAndUnlock(page);

    // Ring up the seeded "Classic Burger". It has a required "Cook" modifier
    // group, so tapping it opens the modifier picker dialog.
    await page.getByText("Classic Burger", { exact: true }).click();

    const picker = page.getByRole("dialog", { name: /Choose options for Classic Burger/ });
    await expect(picker).toBeVisible();
    // "Cook" is required single-select; pick one option, then add. The button's
    // accessible name also carries the price delta ("Medium $0.00"), so match loosely.
    await picker.getByRole("button", { name: /Medium/ }).click();
    await picker.getByRole("button", { name: "Add to cart" }).click();
    await expect(picker).not.toBeVisible();

    // Cart now has the burger and the Charge button reflects the running total.
    const charge = page.getByRole("button", { name: /^Charge / });
    await expect(charge).toBeVisible();
    await charge.click();

    // Cash is the default tender. Tap "Exact" to tender exactly the total, then
    // complete. (Quick-cash chips render "Exact" for the exact-total option.)
    await page.getByRole("button", { name: "Exact" }).click();
    await page.getByRole("button", { name: "Complete sale" }).click();

    // Receipt / success state: order number + "change due" (cash receipt).
    await expect(page.getByRole("heading", { name: "Sale complete" })).toBeVisible();
    await expect(page.getByText(/Order #\d+/)).toBeVisible();
    await expect(page.getByText("change due")).toBeVisible();
    await expect(page.getByRole("button", { name: "New sale" })).toBeVisible();
  });

  test("sign-in page renders and rejects a bad password", async ({ page }) => {
    await page.goto("/sign-in");

    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();

    await page.getByLabel("Email").fill(OWNER_EMAIL);
    await page.getByLabel("Password").fill("definitely-the-wrong-password");
    await page.getByRole("button", { name: "Continue" }).click();

    // A generic, non-enumerating error (role=alert), and we stay on /sign-in.
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page).toHaveURL(/\/sign-in$/);
  });
});
