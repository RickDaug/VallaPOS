# Data Deletion & Access Runbook (interim, manual)

_Addresses the audit finding "no self-service or automated account/personal-data
deletion path in code despite the policy promising one" (docs/audit/security.md,
S2). Until a self-service flow is built, deletion/access requests are honored
**manually** by an operator following this runbook. This document is the record
that the process exists._

## Scope & SLA

- **Channel:** requests arrive at `privacy@vallapos.com` (per the Privacy Statement
  and Do-Not-Sell notice).
- **Rights covered:** access (export), correction, and deletion ("right to be
  forgotten") — CCPA/CPRA (US) and, for Brazilian merchants, LGPD.
- **SLA:** acknowledge within 10 days; complete within 30 days (extendable to 45
  under CCPA with notice). Log every request + fulfillment date for audit.

## What holds PII (delete/export in this order)

Deleting a **business account** cascades most rows via Prisma relations, but verify
each. Tenant-owned rows are keyed by `businessId`; the account owner is a `User`.

1. **`Order` / `OrderLine` / `OrderLineModifier` / `Payment`** — customer receipt
   emails live on receipts; `Payment` holds non-sensitive card metadata (brand +
   last4 only, never PAN). Scoped by `businessId`. Retain aggregate financial
   records only if required by tax law; otherwise delete.
2. **`Membership`** — staff `name` (accountless PIN staff) + linked `User`.
3. **`CashDrawerSession`, `TimeEntry`, `FloorRoom`/`FloorTable`, `CheckoutSession`,
   `License`** — business-scoped operational rows.
4. **`Business`** — the tenant root (deleting it cascades children where the FK is
   `onDelete: Cascade`; confirm in `prisma/schema.prisma`).
5. **`User` + Better Auth `Session`/`Account`/`Verification`** — the login identity.
6. **Off-database PII:**
   - **Upstash Redis** — Better Auth `secondaryStorage` sessions + rate-limit keys
     (they expire, but purge the user's session keys on request).
   - **Offline queue** — encrypted checkout snapshots live in the browser's
     IndexedDB on the merchant's own device; they clear on sign-out and cannot be
     reached server-side. Instruct the merchant to sign out / clear site data.
   - **Resend** — transactional email (receipts, password resets) delivery logs may
     retain the recipient address per Resend's retention; request deletion from
     Resend if in scope.

## Procedure

1. Verify the requester controls the account email (reply-to confirmation).
2. For an **export**: dump the rows above scoped to their `businessId`/`userId` to a
   JSON file and deliver over a secure channel.
3. For a **deletion**: run the deletion against the direct (non-pooled) DB
   connection in a transaction, children→parent, then purge Upstash session keys.
4. Record request date, type, and completion date in the deletion log.

## Follow-up (tracked)

Replace this manual runbook with a self-service **Delete account** action
(`src/features/settings/…`) + an admin export tool, and an LGPD section in the
Privacy Statement (see docs/audit/security.md). Until then, this runbook is the
documented process.
