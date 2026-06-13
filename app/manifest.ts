import type { MetadataRoute } from "next";

// PWA manifest. Full offline support (service worker) lands in Phase 1.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "VallaPOS",
    short_name: "VallaPOS",
    description: "Browser-based point of sale for mobile and local businesses.",
    start_url: "/",
    display: "standalone",
    background_color: "#f1f5f9",
    theme_color: "#0f172a",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
