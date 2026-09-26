import { describe, expect, it } from "vitest";
import headers from "../public/_headers?raw";
import { PAPER, pwaOptions } from "../pwa.config";
import { PAPER as CANVAS_PAPER } from "./surface";

const publicIcons = Object.keys(import.meta.glob("../public/icons/*.png")).map((path) =>
  path.replace("../public", ""),
);

describe("pwa config", () => {
  const manifest = pwaOptions.manifest || {};

  it("declares an installable standalone app that opens the default board", () => {
    expect(manifest).toMatchObject({
      name: "Stallion",
      short_name: "Stallion",
      display: "standalone",
      orientation: "any",
      start_url: "/b/default",
    });
  });

  it("paints the splash and title bar in the canvas paper colour", () => {
    expect(PAPER).toBe(CANVAS_PAPER);
    expect(manifest.theme_color).toBe(CANVAS_PAPER);
    expect(manifest.background_color).toBe(CANVAS_PAPER);
  });

  it("ships 192, 512 and maskable 512 icons that exist in public", () => {
    const icons = manifest.icons ?? [];
    expect(icons.map((icon) => `${icon.sizes} ${icon.purpose}`)).toEqual([
      "192x192 any",
      "512x512 any",
      "512x512 maskable",
    ]);
    for (const icon of icons) expect(publicIcons).toContain(icon.src);
  });

  it("updates itself and never serves api routes or the socket from the worker", () => {
    expect(pwaOptions.registerType).toBe("autoUpdate");
    expect(pwaOptions.workbox).toMatchObject({ clientsClaim: true, skipWaiting: true });
    expect(pwaOptions.workbox?.runtimeCaching).toEqual([]);
    const allow = pwaOptions.workbox?.navigateFallbackAllowlist ?? [];
    const deny = pwaOptions.workbox?.navigateFallbackDenylist ?? [];
    const fallsBack = (path: string) =>
      allow.some((pattern) => pattern.test(path)) && !deny.some((pattern) => pattern.test(path));
    expect(fallsBack("/b/default")).toBe(true);
    expect(fallsBack("/api/boards/default/ws")).toBe(false);
    expect(fallsBack("/sw.js")).toBe(false);
  });

  it("tells Cloudflare not to cache the worker script or the manifest", () => {
    expect(headers).toMatch(/^\/sw\.js\n {2}Cache-Control: no-cache$/m);
    expect(headers).toMatch(/^\/manifest\.webmanifest\n {2}Cache-Control: no-cache$/m);
  });
});
