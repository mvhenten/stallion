import preact from "@preact/preset-vite";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { pwaOptions } from "./pwa.config";

export default defineConfig({
  plugins: [preact(), VitePWA(pwaOptions)],
  cacheDir: ".vite",
  clearScreen: false,
  server: { host: "0.0.0.0", port: 5173, strictPort: true },
});
