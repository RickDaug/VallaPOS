"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateBusinessSettings } from "@/features/settings/actions";

const CURRENCIES = ["USD", "CAD", "EUR", "GBP", "AUD"] as const;
type Currency = (typeof CURRENCIES)[number];

export function SettingsForm({
  businessId,
  initial,
}: {
  businessId: string;
  initial: { name: string; taxRateBps: number; currency: string; taxInclusive: boolean };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(initial.name);
  // Edit tax as a percentage; persist as basis points.
  const [taxPercent, setTaxPercent] = useState((initial.taxRateBps / 100).toString());
  const [currency, setCurrency] = useState<Currency>(
    (CURRENCIES as readonly string[]).includes(initial.currency)
      ? (initial.currency as Currency)
      : "USD",
  );
  const [taxInclusive, setTaxInclusive] = useState(initial.taxInclusive);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const taxRateBps = Math.round(parseFloat(taxPercent || "0") * 100);
    if (!Number.isFinite(taxRateBps) || taxRateBps < 0 || taxRateBps > 10_000) {
      setMessage({ kind: "err", text: "Enter a tax rate between 0 and 100%." });
      return;
    }
    startTransition(async () => {
      try {
        await updateBusinessSettings({ businessId, name: name.trim(), taxRateBps, currency, taxInclusive });
        setMessage({ kind: "ok", text: "Settings saved." });
        router.refresh();
      } catch (err) {
        setMessage({ kind: "err", text: err instanceof Error ? err.message : "Could not save." });
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="max-w-lg space-y-5 rounded-3xl bg-white p-5 shadow-sm md:p-6">
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">Business name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none focus:border-slate-950"
        />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Sales tax rate (%)</span>
          <input
            inputMode="decimal"
            value={taxPercent}
            onChange={(e) => setTaxPercent(e.target.value)}
            placeholder="8.25"
            className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none focus:border-slate-950"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Currency</span>
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value as Currency)}
            className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none focus:border-slate-950"
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 px-4 py-3">
        <span>
          <span className="block font-medium text-slate-800">Tax-inclusive pricing</span>
          <span className="text-sm text-slate-500">Prices already include tax (vs. added at checkout).</span>
        </span>
        <input
          type="checkbox"
          checked={taxInclusive}
          onChange={(e) => setTaxInclusive(e.target.checked)}
          className="h-5 w-5"
        />
      </label>

      {message && (
        <p className={`text-sm font-medium ${message.kind === "ok" ? "text-green-600" : "text-red-600"}`}>
          {message.text}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-2xl bg-slate-950 px-6 py-3 font-bold text-white disabled:bg-slate-300"
      >
        {pending ? "Saving…" : "Save settings"}
      </button>
    </form>
  );
}
