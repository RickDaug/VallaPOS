import { z } from "zod";

export const checkoutSchema = z.object({
  businessId: z.string().min(1),
  // Client-generated UUID — idempotency key for offline-safe checkout.
  clientUuid: z.string().uuid(),
  lines: z
    .array(
      z.object({
        variationId: z.string().min(1),
        quantity: z.number().int().positive().max(999),
        lineDiscountCents: z.number().int().min(0).optional(),
      }),
    )
    .min(1, "Cart is empty"),
  tipCents: z.number().int().min(0).default(0),
  cartDiscountCents: z.number().int().min(0).default(0),
  cashTenderedCents: z.number().int().min(0),
  customerName: z.string().trim().max(80).optional(),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;
