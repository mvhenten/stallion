#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { accessHeaders } from "./env.mjs";

const DEV_ORIGIN = "http://100.104.44.51:5173";

const randomBoardId = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value.toString(36).padStart(25, "0");
};
const CHECKOUT = join(homedir(), "development", "stallion");
const SHOTS_ROOT = join(homedir(), "development", ".tmp", "stallion-smoke");
const DEVICE = "Galaxy Tab S9";
const SCHEMES = ["light", "dark"];
const CLIP_PAD = 24;
const MIN_INK_RATIO = 0.01;

class SmokeFailure extends Error {}

const fail = (reason) => {
  throw new SmokeFailure(reason);
};

const run = (command, args, cwd) => {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.status !== 0) {
    fail(`${command} ${args.join(" ")} exited ${result.status ?? result.signal}`);
  }
};

const pull = () => {
  run("git", ["fetch", "origin"], CHECKOUT);
  run("git", ["merge", "--ff-only", "origin/main"], CHECKOUT);
  run("npm", ["ci", "--prefer-offline"], CHECKOUT);
};

const parseArgs = (argv) => {
  const flags = argv.filter((arg) => arg.startsWith("--"));
  const unknown = flags.filter((flag) => flag !== "--pull");
  if (unknown.length > 0) fail(`unknown flag ${unknown.join(", ")}; usage: smoke [--pull] [url]`);
  const [url = `${DEV_ORIGIN}/b/${randomBoardId()}`] = argv.filter((arg) => !arg.startsWith("--"));
  return { url, pull: flags.includes("--pull") };
};

const REPO = fileURLToPath(new URL("..", import.meta.url));

const launch = async (chromium) => {
  const missing = await chromium.launch({ headless: true }).then(
    (browser) => ({ browser }),
    (error) => ({ error }),
  );
  if (missing.browser) return missing.browser;
  if (!/Executable doesn't exist/.test(String(missing.error?.message))) throw missing.error;
  run("npx", ["playwright", "install", "chromium-headless-shell"], REPO);
  return chromium.launch({ headless: true });
};

const strokePath = (viewport) => {
  const cx = viewport.width * (0.35 + Math.random() * 0.3);
  const cy = viewport.height * (0.45 + Math.random() * 0.25);
  return Array.from({ length: 24 }, (_, i) => {
    const t = i / 23;
    return { x: cx - 120 + t * 240, y: cy + Math.sin(t * Math.PI * 2) * 40 };
  });
};

const clipFor = (points) => {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs) - CLIP_PAD;
  const y = Math.min(...ys) - CLIP_PAD;
  return {
    x,
    y,
    width: Math.max(...xs) + CLIP_PAD - x,
    height: Math.max(...ys) + CLIP_PAD - y,
  };
};

const drawWithTouch = async (page, points) => {
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, point) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: point ? [{ x: point.x, y: point.y, id: 1, radiusX: 2, radiusY: 2 }] : [],
    });
  const [first, ...rest] = points;
  await touch("touchStart", first);
  for (const point of rest) await touch("touchMove", point);
  await touch("touchEnd");
  await cdp.detach();
};

const countStoredRows = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open("stallion");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const stores = [...db.objectStoreNames];
          if (stores.length === 0) {
            db.close();
            resolve({});
            return;
          }
          const tx = db.transaction(stores, "readonly");
          const counts = {};
          for (const name of stores) {
            const count = tx.objectStore(name).count();
            count.onsuccess = () => {
              counts[name] = count.result;
            };
          }
          tx.oncomplete = () => {
            db.close();
            resolve(counts);
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );

const totalRows = (counts) => Object.values(counts).reduce((sum, n) => sum + n, 0);

const inkStats = (analyser, before, after) =>
  analyser.evaluate(
    async ([beforeB64, afterB64]) => {
      const pixels = async (b64) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(bitmap, 0, 0);
        return ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
      };
      const a = await pixels(beforeB64);
      const b = await pixels(afterB64);
      const distance = (p, i, q, j) =>
        Math.abs(p[i] - q[j]) + Math.abs(p[i + 1] - q[j + 1]) + Math.abs(p[i + 2] - q[j + 2]);
      let changed = 0;
      let offFirst = 0;
      for (let i = 0; i < b.length; i += 4) {
        if (distance(a, i, b, i) > 48) changed++;
        if (distance(b, 0, b, i) > 48) offFirst++;
      }
      return { changedRatio: changed / (b.length / 4), uniform: offFirst === 0 };
    },
    [before.toString("base64"), after.toString("base64")],
  );

const watchPage = (page, url) => {
  const problems = [];
  const origin = new URL(url).origin;
  const isFavicon404 = (target, status) => {
    const parsed = new URL(target);
    return status === 404 && parsed.origin === origin && parsed.pathname === "/favicon.ico";
  };
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const location = message.location().url;
    if (location && isFavicon404(location, 404) && /404/.test(message.text())) return;
    problems.push(`console error: ${message.text()}`);
  });
  page.on("pageerror", (error) => problems.push(`page error: ${error.message}`));
  page.on("requestfailed", (request) => {
    if (new URL(request.url()).pathname === "/favicon.ico") return;
    problems.push(`request failed: ${request.url()} (${request.failure()?.errorText})`);
  });
  page.on("response", (response) => {
    if (response.status() < 400 || isFavicon404(response.url(), response.status())) return;
    problems.push(`HTTP ${response.status()}: ${response.url()}`);
  });
  return problems;
};

const waitForBoard = async (page) => {
  await page.locator("canvas.surface").waitFor({ state: "visible", timeout: 15000 });
  await page.waitForFunction(() => {
    const element = document.querySelector("canvas.surface");
    return element instanceof HTMLCanvasElement && element.width > 0 && element.height > 0;
  });
  const alert = page.locator("[role=alert]");
  if (await alert.isVisible()) fail(`board shows an error: ${(await alert.innerText()).trim()}`);
};

const smokeScheme = async ({ browser, devices, analyser, url, scheme, dir }) => {
  const context = await browser.newContext({
    ...devices[DEVICE],
    colorScheme: scheme,
    extraHTTPHeaders: accessHeaders(),
  });
  const page = await context.newPage();
  const problems = watchPage(page, url);
  const shot = async (name, clip) => {
    const path = join(dir, `${scheme}-${name}.png`);
    const buffer = await page.screenshot(clip ? { clip } : {});
    writeFileSync(path, buffer);
    return { path, buffer };
  };
  const check = () => {
    if (problems.length > 0) fail(`${scheme}: ${problems[0]}`);
  };
  try {
    await page.goto(url, { waitUntil: "load" });
    await waitForBoard(page);
    await page.waitForTimeout(500);
    check();
    const viewport = page.viewportSize() ?? fail("no viewport");
    const points = strokePath(viewport);
    const clip = clipFor(points);
    const rowsBefore = totalRows(await countStoredRows(page));
    const blank = await shot("before", clip);

    await drawWithTouch(page, points);
    await page.waitForTimeout(800);
    const drawn = await shot("drawn", clip);
    const full = await shot("drawn-full");
    const drawnInk = await inkStats(analyser, blank.buffer, drawn.buffer);
    if (drawnInk.uniform) fail(`${scheme}: canvas is one colour after drawing (invisible ink)`);
    if (drawnInk.changedRatio < MIN_INK_RATIO) fail(`${scheme}: stroke did not show on the canvas`);
    check();

    await page.reload({ waitUntil: "load" });
    await waitForBoard(page);
    await page.waitForTimeout(1000);
    const counts = await countStoredRows(page);
    const rowsAfter = totalRows(counts);
    if (rowsAfter === 0) fail(`${scheme}: nothing stored in IndexedDB after reload`);
    if ((counts.objects ?? 0) > 0 && rowsAfter <= rowsBefore) {
      fail(`${scheme}: stroke not stored, ${rowsBefore} rows before and ${rowsAfter} after`);
    }
    const reloaded = await shot("reloaded", clip);
    const reloadedInk = await inkStats(analyser, blank.buffer, reloaded.buffer);
    if (reloadedInk.changedRatio < MIN_INK_RATIO) fail(`${scheme}: stroke gone after reload`);
    check();
    return {
      scheme,
      rows: counts,
      ink: Number(drawnInk.changedRatio.toFixed(3)),
      screenshots: [blank.path, drawn.path, full.path, reloaded.path],
    };
  } finally {
    await context.close();
  }
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  if (options.pull) pull();
  const { chromium, devices } = await import("playwright");
  const dir = join(SHOTS_ROOT, new Date().toISOString().replace(/[:.]/g, "-"));
  mkdirSync(dir, { recursive: true });
  const browser = await launch(chromium);
  try {
    const analyser = await browser.newPage();
    for (const scheme of SCHEMES) {
      const result = await smokeScheme({
        browser,
        devices,
        analyser,
        url: options.url,
        scheme,
        dir,
      });
      console.log(`PASS ${result.scheme}: ink ${result.ink}, rows ${JSON.stringify(result.rows)}`);
      for (const path of result.screenshots) console.log(`  ${path}`);
    }
  } finally {
    await browser.close();
  }
  console.log(`smoke passed: ${options.url} (${dir})`);
};

main().catch((error) => {
  const reason = error instanceof SmokeFailure ? error.message : String(error?.message ?? error);
  console.error(`smoke failed: ${reason.split("\n")[0]}`);
  process.exit(1);
});
