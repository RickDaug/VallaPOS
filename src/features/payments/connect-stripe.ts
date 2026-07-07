import "server-only";

import { env } from "@/lib/env";
import type {
  ConnectGateway,
  ConnectedAccount,
  CreateConnectedAccountInput,
  CreateOnboardingLinkInput,
  OnboardingLink,
} from "./connect-gateway";

/**
 * REAL Stripe Connect gateway (PAYMENTS.md §9) — the only module that talks to
 * Stripe over the network. Implements the `ConnectGateway` port with direct
 * `fetch` calls against the pinned API version, so we don't ride the SDK's
 * still-evolving v2 typings for account creation. The Stripe SDK IS used for the
 * one thing fetch can't safely do by hand: webhook signature verification.
 *
 * Everything degrades to "off" when STRIPE_SECRET_KEY is unset — see
 * `isPaymentsConfigured()`. Constructing the gateway without a key throws, so
 * callers must gate on that flag first (the action does).
 *
 * ⚠ LIVE-VERIFY: the exact v2 request/response shapes below are built to the
 * documented Accounts v2 surface but must be confirmed against a claimed sandbox
 * via `scripts/stripe-connect-smoke.mjs` before this ships. The port isolates
 * any shape fix to this file.
 */

/** Pinned Stripe API version (matches the SDK + docs as of 2026-07-07). */
export const STRIPE_API_VERSION = "2026-06-24.dahlia";

const API_BASE = "https://api.stripe.com";

/** True when integrated payments are configured; false = feature dormant. */
export function isPaymentsConfigured(): boolean {
  return Boolean(env.STRIPE_SECRET_KEY);
}

export class StripeGatewayError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "StripeGatewayError";
  }
}

function requireSecret(): string {
  const key = env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new StripeGatewayError("STRIPE_SECRET_KEY is not configured", 500);
  }
  return key;
}

interface StripeRequest {
  method: "GET" | "POST";
  path: string;
  /** JSON body for v2 endpoints. */
  body?: unknown;
  /** Idempotency-Key — dedupes retried writes (e.g. double-clicked "Connect"). */
  idempotencyKey?: string;
}

async function stripeV2<T>(req: StripeRequest): Promise<T> {
  const secret = requireSecret();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${secret}`,
    "Stripe-Version": STRIPE_API_VERSION,
  };
  if (req.body !== undefined) headers["Content-Type"] = "application/json";
  if (req.idempotencyKey) headers["Idempotency-Key"] = req.idempotencyKey;

  const res = await fetch(`${API_BASE}${req.path}`, {
    method: req.method,
    headers,
    body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
  });

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = (json.error ?? {}) as Record<string, unknown>;
    const message = typeof err.message === "string" ? err.message : `Stripe error ${res.status}`;
    throw new StripeGatewayError(message, res.status, res.headers.get("request-id") ?? undefined);
  }
  return json as T;
}

// --- Response shape (partial) + parsing ------------------------------------

interface V2AccountResponse {
  id?: unknown;
  configuration?: {
    merchant?: { capabilities?: { card_payments?: { status?: unknown } } };
  };
  requirements?: { summary?: { minimum_currently_due?: unknown } };
}

function parseAccount(json: V2AccountResponse): ConnectedAccount {
  const accountId = typeof json.id === "string" ? json.id : "";
  if (!accountId) throw new StripeGatewayError("Stripe account response missing id", 502);

  const cardStatus = json.configuration?.merchant?.capabilities?.card_payments?.status;
  const chargesEnabled = cardStatus === "active";

  // Best-effort: no minimum requirements currently due ⇒ onboarding submitted.
  // Refined once the live requirements shape is confirmed by the smoke script.
  const due = json.requirements?.summary?.minimum_currently_due;
  const detailsSubmitted = chargesEnabled || (Array.isArray(due) && due.length === 0);

  return { accountId, chargesEnabled, detailsSubmitted };
}

// --- The gateway ------------------------------------------------------------

export function createStripeConnectGateway(): ConnectGateway {
  return {
    async createConnectedAccount(input: CreateConnectedAccountInput): Promise<ConnectedAccount> {
      const json = await stripeV2<V2AccountResponse>({
        method: "POST",
        path: "/v2/core/accounts",
        // Idempotent per business so a double "Connect" can't spawn two accounts.
        idempotencyKey: `connect-create-${input.businessId}`,
        body: {
          contact_email: input.email,
          display_name: input.displayName,
          identity: { country: input.country },
          // SaaS / DIRECT charges: connected account is merchant of record and
          // pays Stripe's fees; Stripe owns negative-balance liability. Platform
          // takes NO application fee. See PAYMENTS.md §9.
          dashboard: "full",
          defaults: {
            responsibilities: { fees_collector: "stripe", losses_collector: "stripe" },
          },
          configuration: {
            merchant: { capabilities: { card_payments: { requested: true } } },
          },
          metadata: { businessId: input.businessId },
          include: ["configuration.merchant", "requirements"],
        },
      });
      return parseAccount(json);
    },

    async getAccount(accountId: string): Promise<ConnectedAccount> {
      const json = await stripeV2<V2AccountResponse>({
        method: "GET",
        path: `/v2/core/accounts/${encodeURIComponent(accountId)}?include=configuration.merchant&include=requirements`,
      });
      return parseAccount(json);
    },

    async createOnboardingLink(input: CreateOnboardingLinkInput): Promise<OnboardingLink> {
      // Hosted onboarding redirect. account_links is the established endpoint for
      // Stripe-hosted onboarding; ⚠ LIVE-VERIFY it accepts a v2 account id (the
      // smoke script does exactly this). Form-encoded (v1 endpoint).
      const secret = requireSecret();
      const form = new URLSearchParams({
        account: input.accountId,
        type: "account_onboarding",
        return_url: input.returnUrl,
        refresh_url: input.refreshUrl,
      });
      const res = await fetch(`${API_BASE}/v1/account_links`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret}`,
          "Stripe-Version": STRIPE_API_VERSION,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        const err = (json.error ?? {}) as Record<string, unknown>;
        const message = typeof err.message === "string" ? err.message : `Stripe error ${res.status}`;
        throw new StripeGatewayError(message, res.status, res.headers.get("request-id") ?? undefined);
      }
      return {
        url: typeof json.url === "string" ? json.url : "",
        expiresAt: typeof json.expires_at === "number" ? json.expires_at : null,
      };
    },
  };
}

/**
 * Verify + parse a Connect webhook using the SDK (dynamic import keeps it off any
 * client bundle, per the email.ts convention). Throws on a bad signature or a
 * missing STRIPE_WEBHOOK_SECRET so the route returns 400 and Stripe retries.
 */
export async function constructConnectEvent(
  rawBody: string,
  signature: string,
): Promise<{ type: string; object: unknown }> {
  const secret = requireSecret();
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new StripeGatewayError("STRIPE_WEBHOOK_SECRET is not configured", 500);
  }
  const { default: Stripe } = await import("stripe");
  // apiVersion is irrelevant to signature verification; the SDK default (pinned
  // by the installed version) is fine, and omitting it avoids depending on the
  // SDK's LatestApiVersion literal type.
  const stripe = new Stripe(secret);
  const event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  return { type: event.type, object: event.data.object as unknown };
}
