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
    // R-1: Never runtime-cache authenticated, business-scoped app pages. The
    // `(app)/[businessId]/**` routes (e.g. `/<businessId>/register`,
    // `/<businessId>/reports`) render per-user data and are not keyed per-user,
    // so caching them in `pages`/`pages-rsc`/`pages-rsc-prefetch` could serve
    // the previous operator's data after a user switch on a shared register.
    // Send those navigation/RSC requests straight to the network (NetworkOnly);
    // when offline the document fallback below still serves `/~offline`. Public
    // pages (`/`, `/sign-in`, `/sign-up`, `/~offline`) and static assets
    // (`/_next/*`, `/icons/*`) fall through to defaultCache and keep caching.
    {
      matcher: ({ url, request, sameOrigin }) => {
        if (!sameOrigin) return false;
        // Only navigations and RSC/data fetches carry page content.
        const isNavigation =
          request.mode === "navigate" ||
          request.destination === "document" ||
          request.headers.get("RSC") === "1";
        if (!isNavigation) return false;
        const { pathname } = url;
        const isPublic =
          pathname === "/" ||
          pathname === "/sign-in" ||
          pathname === "/sign-up" ||
          pathname === "/~offline";
        const isStatic =
          pathname.startsWith("/_next/static") ||
          pathname.startsWith("/icons");
        return !isPublic && !isStatic;
      },
      handler: new NetworkOnly(),
    },
    // Everything else (the public shell, static assets, and public RSC/data
    // fetches) uses Serwist's tuned Next.js defaults: stale-while-revalidate
    // for static/data, network-first for the public pages.
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
