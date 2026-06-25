"use client";

import { useState } from "react";
import { Printer, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { emailReceipt } from "@/features/orders/actions";

/**
 * Client island for the (print) receipt controls. Print is fully wired;
 * email is a SAFE scaffold — calling the server action returns
 * `email_not_configured`, so we surface a clear "coming soon" toast instead
 * of a broken send. These controls are hidden from print via `print:hidden`.
 */
export function ReceiptActions({
  businessId,
  orderId,
}: {
  businessId: string;
  orderId: string;
}) {
  const { toast } = useToast();
  const [emailing, setEmailing] = useState(false);
  const [pending, setPending] = useState(false);
  const [email, setEmail] = useState("");

  async function send() {
    setPending(true);
    try {
      const res = await emailReceipt({ businessId, orderId, email });
      if (res.ok) {
        toast({
          title: "Receipt sent",
          description: `Sent to ${email.trim()}.`,
          variant: "success",
        });
        setEmailing(false);
        setEmail("");
      } else if (res.reason === "email_not_configured") {
        toast({
          title: "Emailed receipts aren't enabled yet",
          description: "Set RESEND_API_KEY to turn them on.",
          variant: "default",
        });
      } else if (res.reason === "invalid_email") {
        toast({
          title: "That doesn't look like a valid email address.",
          variant: "error",
        });
      } else if (res.reason === "send_failed") {
        toast({
          title: "Couldn't send the receipt",
          description: "Please try again.",
          variant: "error",
        });
      } else {
        toast({ title: "Order not found.", variant: "error" });
      }
    } catch {
      toast({
        title: "Could not send the receipt.",
        variant: "error",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="print:hidden">
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => window.print()}>
          <Printer size={18} /> Print
        </Button>
        <Button
          variant="outline"
          onClick={() => setEmailing((v) => !v)}
          aria-expanded={emailing}
          aria-controls="receipt-email-panel"
        >
          <Mail size={18} /> Email receipt
        </Button>
      </div>

      {emailing && (
        <div
          id="receipt-email-panel"
          className="mt-3 space-y-2 rounded-lg border border-border bg-muted p-3"
        >
          <label htmlFor="receipt-email" className="block text-sm font-medium">
            Customer email
          </label>
          <input
            id="receipt-email"
            type="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="customer@example.com"
            autoFocus
            className="h-11 w-full rounded-md border border-input bg-card px-3 text-base transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button onClick={send} disabled={pending || email.trim() === ""} className="w-full">
            {pending ? "Sending…" : "Send"}
          </Button>
        </div>
      )}
    </div>
  );
}
