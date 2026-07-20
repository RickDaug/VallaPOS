/**
 * Persistence PORT for desktop-license fulfilment. The pure issuance service
 * (`issue-service.ts`) depends on this interface, not on Prisma — so it's
 * unit-testable with an in-memory fake and the real Prisma impl
 * (`prisma-store.ts`, `server-only`) stays out of the tested path.
 */
export type LicenseStatus = "ACTIVE" | "REVOKED";

export interface LicenseRecord {
  id: string;
  sku: string;
  stripeSessionId: string;
  email: string;
  /** The signed, distributable .vallalicense blob (the product). */
  licenseKey: string;
  status: LicenseStatus;
}

export interface CreateLicenseInput {
  sku: string;
  stripeSessionId: string;
  email: string;
  licenseKey: string;
}

export interface DesktopLicenseStore {
  /** The existing license for a paid Checkout session, or null. */
  findByStripeSession(stripeSessionId: string): Promise<LicenseRecord | null>;
  /**
   * Persist a new license. MUST be idempotent on the unique `stripeSessionId`:
   * if a concurrent create already won, return that winning row rather than
   * throwing (so a re-delivered webhook never errors or double-issues).
   */
  create(input: CreateLicenseInput): Promise<LicenseRecord>;
}
