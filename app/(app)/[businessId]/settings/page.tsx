/** Settings (scaffold) — business info, tax rate, currency, receipt, team in Phase 1+. */
export default function SettingsPage({ params }: { params: { businessId: string } }) {
  return (
    <section>
      <h1 className="text-2xl font-black md:text-3xl">Settings</h1>
      <p className="mt-1 text-sm text-slate-500">Business: {params.businessId}</p>
      <div className="mt-6 rounded-3xl bg-white p-6 shadow-sm">
        <p className="text-slate-600">
          Settings scaffold. Tax rate is per-business and configurable (stored as basis points) — no
          more hardcoded tax. Built in Phase 1.
        </p>
      </div>
    </section>
  );
}
