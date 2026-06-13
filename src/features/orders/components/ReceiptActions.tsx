"use client";

import { useState } from "react";
import { Printer, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { emailReceipt } from "@/features/orders/actions";

/**
 * Client island for the (print) receipt controls. Print is fully wired;
 * email is a SAFE scaffold — calling the server action returns
 * `email_not_configured`, so we surface a clear "coming soon" notice instead
 * of a broken send. These controls are hidden from print via `print:hidden`.
 */
export function ReceiptActions({
  businessId,
  orderId,
}: {
  businessId: string;
  orderId: string;
}) {
  const [emailing, setEmailing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [email, setEmail] = useState("");

  async function send() {
    setPending(true);
    setNotice(null);
    try {
      const res = await emailReceipt({ businessId, orderId, email });
      if (res.ok) {
        setNotice("Receipt sent.");
        setEmailing(false);
      } else if (res.reason === "email_not_configured") {
        setNotice("Emailed receipts are coming soon — no email provider is configured yet.");
      } else {
        setNotice("Order not found.");
      }
    } catch {
      setNotice("Could not send the receipt.");
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
        <Button variant="outline" onClick={() => setEmailing((v) => !v)}>
          <Mail size={18} /> Email receipt
        </Button>
      </div>

      {emailing && (
        <div className="mt-3 space-y-2 rounded-lg border border-border bg-muted p-3">
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
            className="h-11 w-full rounded-md border border-input bg-card px-3 text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button onClick={send} disabled={pending || email.trim() === ""} className="w-full">
            {pending ? "Sending…" : "Send"}
          </Button>
        </div>
      )}

      {notice && (
        <p className="mt-2 text-sm text-muted-foreground" role="status" aria-live="polite">
          {notice}
        </p>
      )}
    </div>
  );
}
