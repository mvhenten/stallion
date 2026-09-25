import preact from "@preact/preset-vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [preact()],
  clearScreen: false,
  server: { host: "0.0.0.0", port: 5173, strictPort: true },
});
