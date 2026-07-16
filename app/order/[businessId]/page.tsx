import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublicMenu } from "@/features/online/queries";
import { PublicOrder } from "@/features/online/components/PublicOrder";

/**
 * PUBLIC customer self-order page (QR self-ordering). Lives OUTSIDE the `(app)`
 * membership-guarded route group — NO auth, no login. A customer scans the
 * merchant's QR and lands here. `getPublicMenu` returns null (→ 404) when the
 * business is missing OR online ordering is disabled, so the surface is invisible
 * until a merchant enables it.
 */

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function PublicOrderPage({
  params,
}: {
  params: Promise<{ businessId: string }>;
}) {
  const { businessId } = await params;
  const menu = await getPublicMenu(businessId);
  if (!menu) notFound();

  return <PublicOrder menu={menu} />;
}
