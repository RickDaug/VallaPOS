import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Offline — VallaPOS",
};

// Offline document fallback. Serwist serves this precached page when a
// navigation request can't reach the network and isn't already cached. The
// register itself stays usable once cached (sales queue locally), so this is
// only seen when navigating to a never-visited screen while offline.
export default function OfflinePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-2xl font-black">You&apos;re offline</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        This screen isn&apos;t available without a connection yet. Any sales you ring up on the
        register are saved on this device and sent automatically when you reconnect.
      </p>
    </main>
  );
}
