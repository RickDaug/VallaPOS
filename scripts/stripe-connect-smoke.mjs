/**
 * Live smoke test for the Stripe Connect onboarding rail (PAYMENTS.md §9, PR-A).
 *
 * Exercises the EXACT HTTP shapes used by src/features/payments/connect-stripe.ts
 * against a real (claimed) sandbox, so we confirm the Accounts v2 request/response
 * and the hosted onboarding link before shipping. The unit tests cover the
 * orchestration with a fake; THIS covers the wire format.
 *
 * Usage (needs a CLAIMED sandbox key with Connect access — the anonymous
 * `stripe sandbox create` key is too limited):
 *
 *   STRIPE_SECRET_KEY=rk_test_... node scripts/stripe-connect-smoke.mjs
 *   # or point at a dotenv file:
 *   node --env-file=.env.local scripts/stripe-connect-smoke.mjs
 *
 * Prints each step + a PASS/FAIL summary. Creates one test connected account
 * (harmless in a sandbox). Never run against a live key.
 */

const API = "https://api.stripe.com";
const VERSION = "2026-06-24.dahlia";

const secret = process.env.STRIPE_SECRET_KEY;
if (!secret) {
  console.error("✗ STRIPE_SECRET_KEY is not set. Claim the sandbox, then export the key.");
  process.exit(2);
}
if (secret.startsWith("sk_live") || secret.startsWith("rk_live")) {
  console.error("✗ Refusing to run against a LIVE key. Use a test/sandbox key.");
  process.exit(2);
}

async function v2(method, path, body) {
  const headers = {
    Authorization: `Bearer ${secret}`,
    "Stripe-Version": VERSION,
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

async function form(path, params) {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Stripe-Version": VERSION,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params).toString(),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

function step(label, ok, detail) {
  console.log(`${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  return ok;
}

async function main() {
  let allOk = true;

  // 1. Create a connected account (SaaS / direct charges, no platform fee).
  const create = await v2("POST", "/v2/core/accounts", {
    contact_email: "smoke@valla.test",
    display_name: "Connect Smoke Test",
    identity: { country: "US" },
    dashboard: "full",
    defaults: { responsibilities: { fees_collector: "stripe", losses_collector: "stripe" } },
    configuration: { merchant: { capabilities: { card_payments: { requested: true } } } },
    metadata: { businessId: "smoke_biz" },
    include: ["configuration.merchant", "requirements"],
  });
  const accountId = create.json?.id;
  allOk =
    step(
      "create v2 connected account",
      create.ok && typeof accountId === "string" && accountId.startsWith("acct_"),
      create.ok ? accountId : `HTTP ${create.status}: ${create.json?.error?.message}`,
    ) && allOk;

  if (!accountId) {
    console.log("\nCannot continue without an account id.");
    console.log(JSON.stringify(create.json, null, 2).slice(0, 1500));
    process.exit(1);
  }

  const cardStatus = create.json?.configuration?.merchant?.capabilities?.card_payments?.status;
  step("  card_payments capability present", cardStatus !== undefined, `status=${cardStatus}`);

  // 2. Retrieve it (the getAccount path).
  const get = await v2(
    "GET",
    `/v2/core/accounts/${encodeURIComponent(accountId)}?include=configuration.merchant&include=requirements`,
  );
  allOk = step("retrieve account", get.ok, get.ok ? "" : `HTTP ${get.status}: ${get.json?.error?.message}`) && allOk;

  // 3. Hosted onboarding link (⚠ the shape most likely to need adjustment).
  const link = await form("/v1/account_links", {
    account: accountId,
    type: "account_onboarding",
    return_url: "https://app.test/settings/payments?connect=return",
    refresh_url: "https://app.test/settings/payments?connect=refresh",
  });
  allOk =
    step(
      "create hosted onboarding link",
      link.ok && typeof link.json?.url === "string",
      link.ok ? link.json.url : `HTTP ${link.status}: ${link.json?.error?.message}`,
    ) && allOk;

  console.log(`\n${allOk ? "PASS" : "FAIL"} — connect onboarding wire format ${allOk ? "matches" : "needs a fix"}.`);
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error("smoke script threw:", err);
  process.exit(1);
});
