import type { ReactNode } from "react";
import Link from "next/link";
import { LOCAL_BUSINESS_ID } from "@/lib/edition";
import { LocalStoreBootstrap } from "@/lib/data-store/local-bootstrap";
import { LocalLicenseGate } from "@/features/local-shell/LocalLicenseGate";

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

const NAV: ReadonlyArray<readonly [string, string]> = [
  ["Register", "register"],
  ["Products", "products"],
  ["Orders", "orders"],
  ["Reports", "reports"],
  ["Drawer", "drawer"],
];

export default function LocalBusinessLayout({ children }: { children: ReactNode }) {
  return (
    <LocalLicenseGate>
      <div className="bg-background text-foreground flex min-h-screen flex-col">
        <LocalStoreBootstrap />
        <header className="border-border bg-card/95 sticky top-0 z-10 flex items-center gap-1 border-b px-4 py-2 backdrop-blur">
          <span className="mr-3 text-lg font-black tracking-tight">VallaPOS</span>
          <nav className="flex gap-1">
            {NAV.map(([label, path]) => (
              <Link
                key={path}
                href={`/${LOCAL_BUSINESS_ID}/${path}`}
                className="text-muted-foreground hover:bg-muted hover:text-foreground rounded-lg px-3 py-1.5 text-sm font-medium"
              >
                {label}
              </Link>
            ))}
          </nav>
        </header>
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </LocalLicenseGate>
  );
}
