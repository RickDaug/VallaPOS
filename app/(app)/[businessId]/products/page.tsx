/** Products / catalog (scaffold) — Category → Item → Variation → Modifier CRUD in Phase 1. */
export default function ProductsPage({ params }: { params: { businessId: string } }) {
  return (
    <section>
      <h1 className="text-2xl font-black md:text-3xl">Products</h1>
      <p className="mt-1 text-sm text-slate-500">Business: {params.businessId}</p>
      <div className="mt-6 rounded-3xl bg-white p-6 shadow-sm">
        <p className="text-slate-600">
          Catalog management scaffold. Items have a type (product/service); inventory is off by
          default. Built in Phase 1.
        </p>
      </div>
    </section>
  );
}
