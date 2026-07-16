"use client";

import { useEffect, useState, useTransition } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Copy, ExternalLink } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { updateOnlineOrdering } from "@/features/online/actions";

/**
 * Settings → Online ordering. `manage_settings`-gated by the page. Toggles the
 * public /order/[businessId] surface on/off, sets pickup instructions, and shows a
 * scannable QR + copyable link for the merchant to print/share.
 */
export function OnlineOrderingSettings({
  businessId,
  initial,
}: {
  businessId: string;
  initial: { onlineOrderingEnabled: boolean; onlineOrderInstructions: string | null };
}) {
  const { toast } = useToast();
  const [enabled, setEnabled] = useState(initial.onlineOrderingEnabled);
  const [instructions, setInstructions] = useState(initial.onlineOrderInstructions ?? "");
  const [pending, startTransition] = useTransition();

  // The public link needs the real page origin — resolved on the client so it's
  // correct on any deployment/domain.
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const orderUrl = origin ? `${origin}/order/${businessId}` : `/order/${businessId}`;

  function save() {
    startTransition(async () => {
      try {
        await updateOnlineOrdering({
          businessId,
          onlineOrderingEnabled: enabled,
          onlineOrderInstructions: instructions.trim() || null,
        });
        toast({ title: "Online ordering saved", variant: "success" });
      } catch (err) {
        toast({
          title: "Couldn't save",
          description: err instanceof Error ? err.message : undefined,
          variant: "error",
        });
      }
    });
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(orderUrl);
      toast({ title: "Link copied", variant: "success" });
    } catch {
      toast({ title: "Couldn't copy the link", variant: "error" });
    }
  }

  return (
    <div className="max-w-2xl space-y-6 rounded-xl border border-border bg-card p-6 shadow-sm">
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="mt-1 size-4"
        />
        <span>
          <span className="block font-semibold">Enable online ordering</span>
          <span className="block text-sm text-muted-foreground">
            Let customers scan a QR and order from their phone — no app, no login. Orders arrive on
            your Online screen to accept and fulfill.
          </span>
        </span>
      </label>

      <label className="block">
        <span className="mb-1 block text-sm font-medium">Pickup instructions (optional)</span>
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          maxLength={500}
          rows={3}
          placeholder="e.g. Pick up at the front counter. We'll call your number when it's ready."
          className="w-full rounded-lg border border-border bg-background p-3 text-sm"
        />
        <span className="mt-1 block text-xs text-muted-foreground">
          Shown to the customer on their order confirmation.
        </span>
      </label>

      <button
        type="button"
        onClick={save}
        disabled={pending}
        className="inline-flex h-11 items-center rounded-xl bg-primary px-6 font-semibold text-primary-foreground active:scale-[0.98] disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save"}
      </button>

      {enabled && (
        <div className="border-t border-border pt-6">
          <p className="mb-3 text-sm font-semibold">Your ordering QR &amp; link</p>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="w-fit rounded-lg bg-white p-3">
              <QRCodeSVG value={orderUrl} size={148} />
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <p className="text-sm text-muted-foreground">
                Print this QR for your counter/table, or share the link. Customers scan it to open
                your menu.
              </p>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-3 py-2 text-xs">
                  {orderUrl}
                </code>
                <button
                  type="button"
                  onClick={copyLink}
                  aria-label="Copy link"
                  className="grid size-9 shrink-0 place-items-center rounded-md border border-border hover:bg-muted"
                >
                  <Copy size={16} />
                </button>
                <a
                  href={orderUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Open ordering page"
                  className="grid size-9 shrink-0 place-items-center rounded-md border border-border hover:bg-muted"
                >
                  <ExternalLink size={16} />
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
