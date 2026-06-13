import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireMembership, AuthError, ForbiddenError } from "@/lib/tenant";
import { SignOutButton } from "@/components/SignOutButton";

const NAV = [
  ["register", "Register"],
  ["orders", "Orders"],
  ["products", "Products"],
  ["reports", "Reports"],
  ["settings", "Settings"],
] as const;

export default async function BusinessLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ businessId: string }>;
}) {
  const { businessId } = await params;

  try {
    await requireMembership(businessId);
  } catch (err) {
    if (err instanceof AuthError) redirect("/sign-in");
    if (err instanceof ForbiddenError) notFound();
    throw err;
  }

  const business = await db.business.findUnique({
    where: { id: businessId },
    select: { name: true },
  });
  if (!business) notFound();

  return (
    <div className="flex min-h-screen bg-slate-100 text-slate-950">
      <aside className="hidden w-60 flex-col bg-slate-950 p-5 text-white lg:flex">
        <div className="mb-8">
          <div className="text-2xl font-black tracking-tight">VallaPOS</div>
          <p className="mt-1 truncate text-sm text-slate-300">{business.name}</p>
        </div>
        <nav className="space-y-1 text-sm">
          {NAV.map(([slug, label]) => (
            <Link
              key={slug}
              href={`/${businessId}/${slug}`}
              className="block rounded-2xl px-4 py-3 text-slate-200 hover:bg-white/10"
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto pt-6">
          <SignOutButton />
        </div>
      </aside>
      <main className="flex-1 p-4 md:p-6">{children}</main>
    </div>
  );
}
