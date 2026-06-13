import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { NetworkOnly, Serwist } from "serwist";

// Injected by @serwist/next at build time: the precache manifest (app shell +
// static assets). Typed via the standard Serwist global augmentation.
declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  // Precache the app shell + build-time static assets.
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    // Money writes must NEVER be served from cache. Checkout (and the rest of
    // the Better Auth + server-action surface) goes straight to the network;
    // when offline, the register's IndexedDB queue takes over (it does not rely
    // on the SW replaying the POST). Match the auth/sync API and POSTs.
    {
      matcher: ({ url, request }) =>
        request.method !== "GET" || url.pathname.startsWith("/api/"),
      handler: new NetworkOnly(),
    },
    // Everything else (the app shell, RSC/data fetches, static assets, and
    // catalog reads, which are server-rendered pages) uses Serwist's tuned
    // Next.js defaults: stale-while-revalidate for static/data, network-first
    // for pages — so a cached register screen still boots offline.
    ...defaultCache,
  ],
  fallbacks: {
    entries: [
      {
        // Serve the precached offline page for failed navigations.
        url: "/~offline",
        matcher: ({ request }) => request.destination === "document",
      },
    ],
  },
});

serwist.addEventListeners();
