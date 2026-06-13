import { z } from "zod";

export const emailReceiptSchema = z.object({
  businessId: z.string().min(1),
  orderId: z.string().min(1),
  // Customer email to send the receipt to.
  email: z.string().trim().email(),
});

export type EmailReceiptInput = z.infer<typeof emailReceiptSchema>;
