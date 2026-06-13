/** Reports (scaffold) — Z-report / end-of-day + sales breakdowns in Phase 1+. */
export default async function ReportsPage({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  return (
    <section>
      <h1 className="text-2xl font-black md:text-3xl">Reports</h1>
      <p className="mt-1 text-sm text-slate-500">Business: {businessId}</p>
      <div className="mt-6 rounded-3xl bg-white p-6 shadow-sm">
        <p className="text-slate-600">
          Reporting scaffold. First report is the daily Z-report (net sales, tax collected,
          payment-method split, cash expected-vs-counted). Built in Phase 1.
        </p>
      </div>
    </section>
  );
}
