# Payroll Tax (provider-agnostic, Check-targeted) — INERT scaffold

This layers **automated tax withholding** on top of [Payroll v1](./PAYROLL.md) via an
**embedded payroll provider** (targeting [Check](https://checkhq.com)). It is a
**provider-agnostic, feature-flagged, DORMANT-by-default** scaffold.

> ## ⚠ Default OFF — additive and inert
>
> With `PAYROLL_TAX_ENABLED` unset **and** `CHECK_*` unset, payroll v1 behaves
> **byte-for-byte as before**: gross / adjustments / pre-tax net + CSV export, and
> the `PayrollTaxNotice` still reads "no tax withholding is calculated." No new UI
> renders, nothing constructs a provider gateway, and the webhook returns 503.
> **Two independent gates** must both be on before any provider figures appear:
> the **platform flag** (`PAYROLL_TAX_ENABLED`) and a **per-business opt-in**
> (`Business.payrollTaxEnabled`).

## Division of labor

| Concern | Owner |
| --- | --- |
| Clocked hours → **gross** pay, adjustments, pay-run lifecycle, orchestration | **VallaPOS** (payroll v1) |
| Statutory **tax withholding** (employee + employer), **net after tax**, **filings + remittance**, tax accounts | **Provider** (Check) |
| **Employer of record**, EIN, state tax accounts, funding bank | **Merchant** |
| The **software** wiring these together | **VallaPOS** — *not* a payroll company or tax advisor |

VallaPOS computes hours + gross and **orchestrates** the run (create company →
onboard → sync employees → preview → approve). The provider computes tax/net and
files/remits. The merchant is the employer of record.

## Architecture (mirrors the Stripe Connect scaffold)

Everything lives under `src/features/payroll/tax/` and mirrors
`src/features/payments/*` (the dormant-integration template):

| File | Role |
| --- | --- |
| `gateway.ts` | The **`PayrollTaxGateway` PORT** + shared types + onboarding-status normalization. No `server-only`, no SDK — freely importable. |
| `tax-fake.ts` | **In-memory FAKE** gateway. Simulates onboarding + a deterministic **stand-in** withholding calc so the whole pipeline is unit-testable / dev-runnable with **no keys**. |
| `tax-check.ts` | **REAL Check gateway** (`server-only`, `fetch`) — the ONLY module touching Check. DORMANT until `CHECK_API_KEY` is set. Every uncertain request/response shape is marked `TODO(check-sandbox)`. |
| `registry.ts` | **Selector**: Check when keyed; the fake in dev when unkeyed; a **disabled** selection in prod when unkeyed. |
| `flags.ts` | `PAYROLL_TAX_ENABLED` platform flag (default OFF). |
| `service.ts` | **Pure orchestration** (onboarding → sync → preview → approve) over injected gateway + store PORTS — the unit-tested core. |
| `mapping.ts` | **Pure** helpers: payslip → provider payroll line; provider preview → payslip mirror figures. |
| `reconcile.ts` | **Pure** webhook event → status update reduction (shared by both gateways). |
| `store.ts` | Prisma-backed `PayrollTaxStore` (`server-only`) + webhook-path helpers keyed by provider id. |
| `actions.ts` | `"use server"`, zod-validated, **`manage_payroll`-gated**, tenant-scoped write actions. |
| `queries.ts` | `server-only` read views (settings + period context). |
| `components/` | `PayrollTaxOnboarding` (Settings → Payroll Tax Beta, with **dormant notice**) + `PayrollTaxRunControls` (period preview/approve). |

Webhook: `app/api/payroll/webhook/route.ts` (signature-verify skeleton via
`gateway.verifyWebhook` → status reconciliation), mirroring `app/api/payments/webhook`.

### The gateway PORT

```ts
interface PayrollTaxGateway {
  createCompany(input): Promise<ProviderCompany>;
  getOnboardingStatus(companyId): Promise<OnboardingStatusResult>;
  upsertEmployee(input): Promise<ProviderEmployee>;
  previewPayroll(input): Promise<PayrollPreview>;   // per-worker withholding + employer tax + net
  approvePayroll(input): Promise<PayrollApproval>;
  verifyWebhook(rawBody, signature): Promise<ProviderEvent>;
  parseEvent(event): ProviderStatusUpdate | null;   // pure
}
```

## Data model (additive migration `…_payroll_tax_provider`)

All columns are **additive + nullable/defaulted** (see the migration; not applied
to Neon yet). **No SSN / bank columns exist** — see the PII boundary below.

| Model | Added |
| --- | --- |
| `Business` | `checkCompanyId String? @unique`, `payrollTaxOnboardingStatus String?`, `payrollTaxEnabled Boolean @default(false)` |
| `Membership` | `checkEmployeeId String? @unique` |
| `PayPeriod` | `checkPayrollId String?`, `checkPayrollStatus String?` |
| `Payslip` | `providerPayslipId String?`, `employeeTaxCents Int?`, `employerTaxCents Int?`, `netPayCents Int?` |

The existing `Payslip.netCents` **stays the pre-tax v1 figure** (gross + additions −
deductions). `netPayCents` is the provider's take-home **net after tax**, mirrored
only when a preview runs. The tenant-isolation guard already covers `payPeriod` /
`payslip` / `membership`; no new tenant models were added.

## PII boundary — no SSN / bank in our DB

**We never store SSNs or bank numbers.** Those are collected by the **provider's
own hosted onboarding** and live **only in the provider, tokenized**. Our DB holds
only **opaque provider ids** (`checkCompanyId`, `checkEmployeeId`, `checkPayrollId`,
`providerPayslipId`) and **integer-cent** mirror figures. Nothing sensitive crosses
the `PayrollTaxGateway` port.

## The fake's stand-in tax (NOT real tax)

`tax-fake.ts` applies **flat** rates purely to exercise the pipeline:

- employee withholding = **18%** of gross (`FAKE_EMPLOYEE_TAX_BPS = 1800`)
- employer-side tax = **7.65%** of gross (`FAKE_EMPLOYER_TAX_BPS = 765`)
- net = gross − employee tax

It ignores jurisdiction, filing status, allowances, wage bases, and YTD caps. It is
**never** reachable in the hosted production build (the registry refuses to fall
back to the fake there) and is **clearly labelled** wherever surfaced. Real numbers
come **only** from the Check gateway.

## Flags & env

| Var | Effect when unset |
| --- | --- |
| `PAYROLL_TAX_ENABLED` | Platform kill switch. Unset → feature fully inert; no new UI. |
| `CHECK_API_KEY` | Provider dormant → registry returns the dev fake (dev) or a disabled state (prod); webhook 503. |
| `CHECK_ENV` | Defaults to `sandbox`. |
| `CHECK_WEBHOOK_SECRET` | `verifyWebhook` throws (fail-closed) so no unsigned event mutates state. |

All degrade to OFF in `src/lib/env.ts` (`.catch(undefined)`) — a malformed value
**never** throws at build, exactly like the Stripe/Upstash/Resend vars.

## Inert vs. live

- **Inert today:** no dependency added; the fake drives all tests; the Check
  gateway is never constructed without a key; webhooks 503 without keys; the flag
  is OFF. `previewPayroll`/`approvePayroll`/`upsertEmployee` request shapes carry
  `TODO(check-sandbox)` markers; `verifyWebhook` in `tax-check.ts` fails closed
  (returns 501) until the real signature scheme is implemented.
- **Live once keyed + flagged:** the registry returns the real Check gateway; the
  Settings CTA onboards a company; the period screen previews + approves runs and
  mirrors provider withholding/net onto payslips.

## Go-live checklist (what still needs Check sandbox/prod)

1. **Merchant** provides: EIN, state tax accounts, and a funding bank (entered in
   Check's hosted onboarding — never in VallaPOS).
2. **Platform**: sign the Check partner/platform agreement; obtain sandbox then
   production API keys + webhook secret.
3. **Verify against a Check SANDBOX** and resolve every `TODO(check-sandbox)` in
   `tax-check.ts` (create-company/employee/payroll shapes, idempotency header,
   preview/approve endpoints) + implement `verifyWebhook`'s HMAC signature scheme
   (use `node:crypto`; no new dependency).
4. Set `PAYROLL_TAX_ENABLED=true`, `CHECK_API_KEY`, `CHECK_ENV`,
   `CHECK_WEBHOOK_SECRET` in Vercel; point the Check webhook at
   `/api/payroll/webhook`.
5. **Apply the migration to Neon** (`prisma migrate deploy` from this branch)
   **before** merging, or authed requests 500 on the missing columns.

## Compliance guardrails

VallaPOS is **software**, not a payroll company or tax advisor. The **provider**
(Check) is the system of record for tax computation, filing, and remittance; the
**merchant** is the **employer of record** and responsible for the accuracy of the
data they enter and the taxes owed. The UI copy (`PayrollTaxNotice` when enabled,
the Settings section, and the onboarding component) states this explicitly.
