import type { VitePWAOptions } from "vite-plugin-pwa";

export const PAPER = "#fbfaf7";

export const pwaOptions: Partial<VitePWAOptions> = {
  registerType: "autoUpdate",
  injectRegister: false,
  includeAssets: ["icons/apple-touch-icon.png"],
  manifest: {
    id: "/",
    name: "Stallion",
    short_name: "Stallion",
    description: "An infinite-zoom drawing board",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    theme_color: PAPER,
    background_color: PAPER,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  },
  workbox: {
    globPatterns: ["**/*.{js,css,html,png,svg,webmanifest}"],
    clientsClaim: true,
    skipWaiting: true,
    cleanupOutdatedCaches: true,
    navigateFallback: "/index.html",
    navigateFallbackAllowlist: [/^\/$/, /^\/b\//],
    navigateFallbackDenylist: [/^\/api\//],
    runtimeCaching: [],
  },
};
