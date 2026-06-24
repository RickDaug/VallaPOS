import { z } from "zod";

/**
 * PIN length bounds live here (not in `pin.ts`) so client components can import
 * them for input limits without pulling `pin.ts` — and its `node:crypto`
 * dependency — into the browser bundle.
 */
export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 8;

/**
 * Zod schemas for employee/PIN/clock writes. Kept in their own (non-`server-only`)
 * module so the validation rules can be unit tested without importing the server
 * action file. The actions in `actions.ts` import and `.parse()` these.
 *
 * IDs are cuids (Prisma `@default(cuid())`) — validated as non-empty strings.
 * The `pin` field is validated here but NEVER logged or echoed back.
 */
const businessIdSchema = z.string().min(1);
const idSchema = z.string().min(1);

const roleSchema = z.enum(["OWNER", "MANAGER", "CASHIER"]);

const pinSchema = z
  .string()
  .regex(/^\d+$/, "PIN must be digits only.")
  .min(PIN_MIN_LENGTH, `PIN must be at least ${PIN_MIN_LENGTH} digits.`)
  .max(PIN_MAX_LENGTH, `PIN must be at most ${PIN_MAX_LENGTH} digits.`);

/** Add an existing user (by email) to this business as a member with a role. */
export const addMemberSchema = z.object({
  businessId: businessIdSchema,
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  role: roleSchema,
});
export type AddMemberInput = z.infer<typeof addMemberSchema>;

/**
 * Add a PIN-only staff member with NO login account — just a display name, a
 * role, and a PIN. The PIN is hashed server-side; capabilities are seeded from
 * the role default.
 */
export const addStaffMemberSchema = z.object({
  businessId: businessIdSchema,
  name: z.string().trim().min(1, "Enter a name.").max(60),
  role: roleSchema,
  pin: pinSchema,
});
export type AddStaffMemberInput = z.infer<typeof addStaffMemberSchema>;

/** Rename a member (display name; used for PIN-only staff). */
export const updateMemberNameSchema = z.object({
  businessId: businessIdSchema,
  membershipId: idSchema,
  name: z.string().trim().min(1, "Enter a name.").max(60),
});
export type UpdateMemberNameInput = z.infer<typeof updateMemberNameSchema>;

/** Set a member's granular capability grants (OWNER-only). */
export const setPermissionsSchema = z.object({
  businessId: businessIdSchema,
  membershipId: idSchema,
  permissions: z.array(z.string().min(1)).max(50),
});
export type SetPermissionsInput = z.infer<typeof setPermissionsSchema>;

/** Change an existing member's role. */
export const changeRoleSchema = z.object({
  businessId: businessIdSchema,
  membershipId: idSchema,
  role: roleSchema,
});
export type ChangeRoleInput = z.infer<typeof changeRoleSchema>;

/** Set or reset a member's PIN. The plaintext PIN is hashed server-side. */
export const setPinSchema = z.object({
  businessId: businessIdSchema,
  membershipId: idSchema,
  pin: pinSchema,
});
export type SetPinInput = z.infer<typeof setPinSchema>;

/** Activate or deactivate a member. */
export const setActiveSchema = z.object({
  businessId: businessIdSchema,
  membershipId: idSchema,
  active: z.boolean(),
});
export type SetActiveInput = z.infer<typeof setActiveSchema>;

/** Clear a member's PIN. */
export const clearPinSchema = z.object({
  businessId: businessIdSchema,
  membershipId: idSchema,
});
export type ClearPinInput = z.infer<typeof clearPinSchema>;

/** Verify a PIN for a membership (cashier-switch / clock flow). */
export const verifyPinSchema = z.object({
  businessId: businessIdSchema,
  membershipId: idSchema,
  pin: pinSchema,
});
export type VerifyPinInput = z.infer<typeof verifyPinSchema>;

/** Business-scoped action with no other input (lock, become-self-operator). */
export const businessScopeSchema = z.object({ businessId: businessIdSchema });
export type BusinessScopeInput = z.infer<typeof businessScopeSchema>;

/**
 * Clock in or clock out. Self-service: the action derives the membership from
 * the authenticated tenant context, so the client only sends the businessId
 * (never a membershipId it could forge to clock someone else in/out).
 */
export const clockSchema = z.object({
  businessId: businessIdSchema,
});
export type ClockInput = z.infer<typeof clockSchema>;
