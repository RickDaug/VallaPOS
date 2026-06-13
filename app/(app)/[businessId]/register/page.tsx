/**
 * Register / checkout screen (scaffold).
 *
 * Phase 1 builds the real thing here: a touch cart (client island) with
 * add/qty/remove, per-line modifiers, discounts, tips, server-recomputed
 * totals, cash tender + change, and an offline IndexedDB queue. The prototype's
 * UI is a useful visual reference (preserved in git history).
 */
export default function RegisterPage({ params }: { params: { businessId: string } }) {
  return (
    <section>
      <h1 className="text-2xl font-black md:text-3xl">Register</h1>
      <p className="mt-1 text-sm text-slate-500">Business: {params.businessId}</p>
      <div className="mt-6 rounded-3xl bg-white p-6 shadow-sm">
        <p className="text-slate-600">
          Checkout screen scaffold. The touch cart, modifiers, tender flow, and offline queue are
          built in Phase 1 — see <code>docs/ROADMAP.md</code>.
        </p>
      </div>
    </section>
  );
}
