import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/tenant";
import { getManagedCatalog } from "@/features/catalog/queries";
import { ProductsManager } from "@/features/catalog/components/ProductsManager";
import { BulkItemEntry } from "@/features/catalog/components/BulkItemEntry";
import { pageHasCapability } from "@/lib/operator-guard";
import { NoAccess } from "@/components/no-access";

export default async function ProductsPage({
  params,
}: {
  params: Promise<{ businessId: string }>;
}) {
  const { businessId } = await params;
  await requireMembership(businessId);
  if (!(await pageHasCapability(businessId, "manage_products"))) return <NoAccess what="products" />;

  const business = await db.business.findUnique({
    where: { id: businessId },
    select: { currency: true, mode: true },
  });
  if (!business) notFound();

  const catalog = await getManagedCatalog(businessId);
  const defaultPreset = business.mode === "RESTAURANT" ? "menu" : "retail";
  const categoryNames = catalog.categories.map((c) => c.name);

  return (
    <section>
      <header className="mb-6">
        <h1 className="text-2xl font-black md:text-3xl">Products</h1>
        <p className="text-sm text-muted-foreground">Manage your items and categories.</p>
      </header>

      {/* Fast, spreadsheet-style bulk entry — collapsed by default so the manager
          below stays the primary view. */}
      <details className="group mb-6 rounded-xl border border-border bg-card shadow-sm">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-4 font-semibold">
          <span>➕ Bulk add items (paste or type many at once)</span>
          <span className="text-xs text-muted-foreground group-open:hidden">Show</span>
          <span className="hidden text-xs text-muted-foreground group-open:inline">Hide</span>
        </summary>
        <div className="border-t border-border p-4">
          <BulkItemEntry
            businessId={businessId}
            defaultPreset={defaultPreset}
            categoryNames={categoryNames}
          />
        </div>
      </details>

      <ProductsManager businessId={businessId} catalog={catalog} currency={business.currency} />
    </section>
  );
}
