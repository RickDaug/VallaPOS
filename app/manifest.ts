import type { MetadataRoute } from "next";

// PWA manifest. Colors track the "Calm Teal" design tokens in globals.css:
//   theme_color  = --primary  oklch(0.58 0.1 195)  ≈ #1f8a8a
//   background   = --background oklch(0.99 0.004 220) ≈ #fafbfc
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "VallaPOS",
    short_name: "VallaPOS",
    description: "Browser-based point of sale for mobile and local businesses.",
    start_url: "/",
    scope: "/",
    // Launch chrome-less when installed; "minimal-ui" is the graceful fallback
    // where fullscreen isn't honored. A floor plan + register want all the
    // screen they can get, and the in-app button still toggles browser-tab use.
    display: "fullscreen",
    display_override: ["fullscreen", "minimal-ui", "standalone"],
    // Tablets are commonly wall-mounted/landscape for the floor view; don't lock.
    orientation: "any",
    background_color: "#fafbfc",
    theme_color: "#1f8a8a",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
