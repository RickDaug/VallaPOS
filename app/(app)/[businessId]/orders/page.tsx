/** Orders (scaffold) — order history, details, refunds/voids in Phase 1+. */
export default async function OrdersPage({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  return (
    <section>
      <h1 className="text-2xl font-black md:text-3xl">Orders</h1>
      <p className="mt-1 text-sm text-slate-500">Business: {businessId}</p>
      <div className="mt-6 rounded-3xl bg-white p-6 shadow-sm">
        <p className="text-slate-600">
          Order history scaffold. Real orders persist to the database (no more mock data) starting in
          Phase 1.
        </p>
      </div>
    </section>
  );
}
