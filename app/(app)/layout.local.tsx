import type { ReactNode } from "react";

/**
 * Offline-edition `(app)` group layout. The cloud one is a server SESSION guard
 * (`auth.api.getSession` + `headers()` + `redirect`) — all banned under
 * `output:'export'`. The desktop app is single-tenant with no cloud accounts, so
 * this is a pass-through; the local PIN/license gate is added later. Swapped over
 * `app/(app)/layout.tsx` for the local build only.
 */
export default function LocalAppGroupLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
