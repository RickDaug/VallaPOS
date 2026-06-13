import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/tenant";
import { getRegisterCatalog } from "@/features/catalog/queries";
import { Register } from "@/features/register/components/Register";

export default async function RegisterPage({
  params,
}: {
  params: Promise<{ businessId: string }>;
}) {
  const { businessId } = await params;
  await requireMembership(businessId); // layout already guards; defense in depth

  const business = await db.business.findUnique({
    where: { id: businessId },
    select: { taxRateBps: true, currency: true },
  });
  if (!business) notFound();

  const catalog = await getRegisterCatalog(businessId);

  return (
    <section>
      <header className="mb-6">
        <h1 className="text-2xl font-black md:text-3xl">Register</h1>
        <p className="text-sm text-slate-500">Tap items to ring up a sale.</p>
      </header>
      <Register
        businessId={businessId}
        catalog={catalog}
        taxRateBps={business.taxRateBps}
        currency={business.currency}
      />
    </section>
  );
}
