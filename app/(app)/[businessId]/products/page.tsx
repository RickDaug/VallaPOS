import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/tenant";
import { getManagedCatalog } from "@/features/catalog/queries";
import { ProductsManager } from "@/features/catalog/components/ProductsManager";
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
    select: { currency: true },
  });
  if (!business) notFound();

  const catalog = await getManagedCatalog(businessId);

  return (
    <section>
      <header className="mb-6">
        <h1 className="text-2xl font-black md:text-3xl">Products</h1>
        <p className="text-sm text-muted-foreground">Manage your items and categories.</p>
      </header>
      <ProductsManager businessId={businessId} catalog={catalog} currency={business.currency} />
    </section>
  );
}
