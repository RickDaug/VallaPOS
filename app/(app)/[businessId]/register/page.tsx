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
    select: {
      taxRateBps: true,
      currency: true,
      taxInclusive: true,
      qrPayEnabled: true,
      qrPayLabel: true,
      qrPayValue: true,
    },
  });
  if (!business) notFound();

  const catalog = await getRegisterCatalog(businessId);

  // Only surface the QR tender when it's enabled AND has something to encode.
  const qrPay =
    business.qrPayEnabled && business.qrPayValue
      ? { label: business.qrPayLabel, value: business.qrPayValue }
      : null;

  return (
    <section>
      <header className="mb-6">
        <h1 className="text-2xl font-black md:text-3xl">Register</h1>
        <p className="text-sm text-muted-foreground">Tap items to ring up a sale.</p>
      </header>
      <Register
        businessId={businessId}
        catalog={catalog}
        taxRateBps={business.taxRateBps}
        currency={business.currency}
        taxInclusive={business.taxInclusive}
        qrPay={qrPay}
      />
    </section>
  );
}
