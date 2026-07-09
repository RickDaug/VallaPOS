import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { PwaInstall } from "@/components/pwa-install";

/**
 * Authenticated area guard. Any unauthenticated request to the POS is bounced
 * to sign-in. The per-business shell (sidebar, membership check) lives one level
 * down in [businessId]/layout.tsx where the tenant is known.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  return (
    <>
      {children}
      {/* PWA "Add to Home Screen" affordance (audit R4 #5). Mounted at the app
          shell so it rides along on every authenticated screen and self-hides
          when already installed / dismissed. */}
      <PwaInstall />
    </>
  );
}
