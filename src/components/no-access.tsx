/** Shown on a page when the active operator lacks the capability to view it. */
export function NoAccess({ what }: { what?: string }) {
  return (
    <div className="mx-auto mt-10 max-w-md rounded-xl border border-border bg-card p-6 text-center">
      <p className="font-semibold">No access</p>
      <p className="mt-1 text-sm text-muted-foreground">
        You don&apos;t have permission to use {what ?? "this screen"}. Ask an owner to grant it on the Team
        screen.
      </p>
    </div>
  );
}
