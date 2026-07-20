import type { ReactNode } from "react";
import { LOCAL_BUSINESS_ID } from "@/lib/edition";

/**
 * Offline-edition app shell (docs/EDITIONS.md §5b). Single-tenant, so NO server
 * auth / operator lock / billing gate (the cloud layout's server-only work, all
 * banned under `output:'export'`). The local PIN/license gate is added later.
 *
 * `generateStaticParams` pins the one local business id so the `[businessId]`
 * dynamic segment pre-renders for the static export. The staging build swaps this
 * over `layout.tsx` for local; cloud is untouched.
 */
export function generateStaticParams() {
  return [{ businessId: LOCAL_BUSINESS_ID }];
}

export default function LocalBusinessLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <main className="flex-1 p-4 md:p-6">{children}</main>
    </div>
  );
}
