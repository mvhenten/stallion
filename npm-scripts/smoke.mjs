#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { routeAccessHeaders } from "./env.mjs";

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

const strokePath = (viewport, left = 0) => {
  const cx = left + (viewport.width - left) * (0.35 + Math.random() * 0.3);
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

const colourRatio = (analyser, png, rgb) =>
  analyser.evaluate(
    async ([b64, target]) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bitmap, 0, 0);
      const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
      let matching = 0;
      for (let i = 0; i < data.length; i += 4) {
        const distance =
          Math.abs(data[i] - target[0]) +
          Math.abs(data[i + 1] - target[1]) +
          Math.abs(data[i + 2] - target[2]);
        if (distance <= 12) matching++;
      }
      return matching / (data.length / 4);
    },
    [png.toString("base64"), rgb],
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
  });
  await routeAccessHeaders(context, new URL(url).origin);
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

const PALETTE = '.toolbar[data-layout="Palette"]';

const smokePalette = async ({ browser, devices, analyser, url, dir }) => {
  const context = await browser.newContext({
    ...devices[DEVICE],
    colorScheme: "light",
  });
  await routeAccessHeaders(context, new URL(url).origin);
  const page = await context.newPage();
  const problems = watchPage(page, url);
  const check = () => {
    if (problems.length > 0) fail(`palette: ${problems[0]}`);
  };
  const shot = async (name, clip) => {
    const path = join(dir, `palette-${name}.png`);
    const buffer = await page.screenshot(clip ? { clip } : {});
    writeFileSync(path, buffer);
    return { path, buffer };
  };
  try {
    await page.goto(url, { waitUntil: "load" });
    await waitForBoard(page);
    const more = page.getByRole("button", { name: "More tools" });
    if (await more.isVisible()) await more.tap();
    await page.locator("[data-toolbar-flip]").tap();
    await page.locator(PALETTE).waitFor({ state: "visible", timeout: 5000 });
    await page.reload({ waitUntil: "load" });
    await waitForBoard(page);
    const palette = page.locator(PALETTE);
    if (!(await palette.isVisible())) fail("palette: the quick bar came back after a reload");
    await palette.getByRole("button", { name: "Large pencil" }).tap();
    await palette.getByRole("button", { name: "Colour 2" }).tap();
    await page.waitForTimeout(500);
    check();
    const viewport = page.viewportSize() ?? fail("no viewport");
    const box = (await palette.boundingBox()) ?? fail("palette: no bounding box");
    const points = strokePath(viewport, box.x + box.width + CLIP_PAD);
    const clip = clipFor(points);
    const rowsBefore = totalRows(await countStoredRows(page));
    const blank = await shot("before", clip);
    await drawWithTouch(page, points);
    await page.waitForTimeout(800);
    const drawn = await shot("drawn", clip);
    const full = await shot("drawn-full");
    const ink = await inkStats(analyser, blank.buffer, drawn.buffer);
    if (ink.changedRatio < MIN_INK_RATIO)
      fail("palette: stroke drawn from the palette did not show");
    check();
    await page.reload({ waitUntil: "load" });
    await waitForBoard(page);
    await page.waitForTimeout(1000);
    const counts = await countStoredRows(page);
    const rowsAfter = totalRows(counts);
    if (rowsAfter === 0) fail("palette: nothing stored in IndexedDB after reload");
    if ((counts.objects ?? 0) > 0 && rowsAfter <= rowsBefore) {
      fail(`palette: stroke not stored, ${rowsBefore} rows before and ${rowsAfter} after`);
    }
    if (!(await page.locator(PALETTE).isVisible())) fail("palette: closed after the second reload");
    const reloaded = await shot("reloaded", clip);
    const kept = await inkStats(analyser, blank.buffer, reloaded.buffer);
    if (kept.changedRatio < MIN_INK_RATIO) fail("palette: stroke gone after reload");
    check();
    return {
      ink: Number(ink.changedRatio.toFixed(3)),
      screenshots: [blank.path, drawn.path, full.path, reloaded.path],
    };
  } finally {
    await context.close();
  }
};

const CUSTOM_HEX = "#123456";
const CUSTOM_RGB = [0x12, 0x34, 0x56];

const smokeCustomColour = async ({ browser, devices, analyser, url, dir }) => {
  const context = await browser.newContext({
    ...devices[DEVICE],
    colorScheme: "light",
  });
  await routeAccessHeaders(context, new URL(url).origin);
  const page = await context.newPage();
  const problems = watchPage(page, url);
  const check = () => {
    if (problems.length > 0) fail(`custom colour: ${problems[0]}`);
  };
  const shot = async (name, clip) => {
    const path = join(dir, `custom-${name}.png`);
    const buffer = await page.screenshot(clip ? { clip } : {});
    writeFileSync(path, buffer);
    return { path, buffer };
  };
  try {
    await page.goto(url, { waitUntil: "load" });
    await waitForBoard(page);
    const more = page.getByRole("button", { name: "More tools" });
    if (await more.isVisible()) await more.tap();
    await page.locator("[data-toolbar-flip]").tap();
    const palette = page.locator(PALETTE);
    await palette.waitFor({ state: "visible", timeout: 5000 });
    await palette.getByRole("button", { name: "Large pencil" }).tap();
    const hex = palette.getByRole("textbox", { name: "Hex colour" });
    await hex.fill(CUSTOM_HEX);
    await hex.press("Enter");
    await palette
      .getByRole("button", { name: `Recent colour ${CUSTOM_HEX}` })
      .waitFor({ state: "visible", timeout: 5000 });
    const picked = await shot("picked");
    check();
    const viewport = page.viewportSize() ?? fail("no viewport");
    const box = (await palette.boundingBox()) ?? fail("custom colour: no palette bounding box");
    const points = strokePath(viewport, box.x + box.width + CLIP_PAD);
    const clip = clipFor(points);
    await drawWithTouch(page, points);
    await page.waitForTimeout(800);
    const drawn = await shot("drawn", clip);
    if ((await colourRatio(analyser, drawn.buffer, CUSTOM_RGB)) < MIN_INK_RATIO) {
      fail(`custom colour: the stroke is not drawn in ${CUSTOM_HEX}`);
    }
    check();
    await page.reload({ waitUntil: "load" });
    await waitForBoard(page);
    await page.waitForTimeout(1000);
    const reloaded = await shot("reloaded", clip);
    const kept = await colourRatio(analyser, reloaded.buffer, CUSTOM_RGB);
    if (kept < MIN_INK_RATIO) fail(`custom colour: ${CUSTOM_HEX} gone after reload`);
    if (!(await page.getByRole("button", { name: `Recent colour ${CUSTOM_HEX}` }).isVisible())) {
      fail("custom colour: the recent colour is gone after reload");
    }
    check();
    return {
      match: Number(kept.toFixed(3)),
      screenshots: [picked.path, drawn.path, reloaded.path],
    };
  } finally {
    await context.close();
  }
};

const WIDTH_STROKES = [
  { width: 1, band: 0.35 },
  { width: 60, band: 0.7 },
];

const bandPath = (viewport, left, band) => {
  const cx = left + (viewport.width - left) / 2;
  const cy = viewport.height * band;
  return Array.from({ length: 24 }, (_, i) => {
    const t = i / 23;
    return { x: cx - 120 + t * 240, y: cy + Math.sin(t * Math.PI * 2) * 40 };
  });
};

const smokeWidth = async ({ browser, devices, analyser, url, dir }) => {
  const context = await browser.newContext({
    ...devices[DEVICE],
    colorScheme: "light",
  });
  await routeAccessHeaders(context, new URL(url).origin);
  const page = await context.newPage();
  const problems = watchPage(page, url);
  const check = () => {
    if (problems.length > 0) fail(`width: ${problems[0]}`);
  };
  const shot = async (name, clip) => {
    const path = join(dir, `width-${name}.png`);
    const buffer = await page.screenshot(clip ? { clip } : {});
    writeFileSync(path, buffer);
    return { path, buffer };
  };
  const ratios = async (strokes, stage) => {
    const measured = [];
    for (const stroke of strokes) {
      const after = await shot(`${stroke.width}px-${stage}`, stroke.clip);
      const ink = await inkStats(analyser, stroke.blank.buffer, after.buffer);
      measured.push(ink.changedRatio);
    }
    return measured;
  };
  const inOrder = ([thin, thick], stage) => {
    if (!(thin > 0)) fail(`width: the 1 px stroke did not show ${stage}`);
    if (!(thick > thin * 4)) {
      fail(
        `width: 60 px ink ${thick.toFixed(3)} is not well above 1 px ink ${thin.toFixed(3)} ${stage}`,
      );
    }
  };
  try {
    await page.goto(url, { waitUntil: "load" });
    await waitForBoard(page);
    const more = page.getByRole("button", { name: "More tools" });
    if (await more.isVisible()) await more.tap();
    await page.locator("[data-toolbar-flip]").tap();
    const palette = page.locator(PALETTE);
    await palette.waitFor({ state: "visible", timeout: 5000 });
    await page.waitForTimeout(500);
    const viewport = page.viewportSize() ?? fail("no viewport");
    const box = (await palette.boundingBox()) ?? fail("width: no palette bounding box");
    const strokes = [];
    for (const { width, band } of WIDTH_STROKES) {
      const points = bandPath(viewport, box.x + box.width + CLIP_PAD, band);
      const clip = clipFor(points);
      const blank = await shot(`${width}px-before`, clip);
      strokes.push({ width, points, clip, blank });
    }
    for (const stroke of strokes) {
      await palette.getByRole("button", { name: `${stroke.width} px pencil` }).tap();
      await drawWithTouch(page, stroke.points);
      await page.waitForTimeout(500);
    }
    await page.waitForTimeout(800);
    const drawn = await ratios(strokes, "drawn");
    const full = await shot("drawn-full");
    inOrder(drawn, "after drawing");
    check();
    await page.reload({ waitUntil: "load" });
    await waitForBoard(page);
    await page.waitForTimeout(1000);
    const reloaded = await ratios(strokes, "reloaded");
    const reloadedFull = await shot("reloaded-full");
    inOrder(reloaded, "after reload");
    check();
    return {
      drawn: drawn.map((ratio) => Number(ratio.toFixed(3))),
      reloaded: reloaded.map((ratio) => Number(ratio.toFixed(3))),
      screenshots: [full.path, reloadedFull.path],
    };
  } finally {
    await context.close();
  }
};

const meanRgb = (analyser, png) =>
  analyser.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0);
    const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
    const sum = [0, 0, 0];
    for (let i = 0; i < data.length; i += 4) {
      sum[0] += data[i];
      sum[1] += data[i + 1];
      sum[2] += data[i + 2];
    }
    const count = data.length / 4;
    return sum.map((channel) => Math.round(channel / count));
  }, png.toString("base64"));

const SAMPLE_PX = 4;
const PAPER_RGB = [0xfb, 0xfa, 0xf7];
const brightness = ([r, g, b]) => r + g + b;

const linePath = (from, to) =>
  Array.from({ length: 24 }, (_, i) => {
    const t = i / 23;
    return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
  });

const siblingBoard = (url) => {
  const parsed = new URL(url);
  parsed.pathname = `/b/${randomBoardId()}`;
  return parsed.toString();
};

const smokeHighlighter = async ({ browser, devices, analyser, url, dir }) => {
  const context = await browser.newContext({
    ...devices[DEVICE],
    colorScheme: "light",
  });
  await routeAccessHeaders(context, new URL(url).origin);
  const page = await context.newPage();
  const problems = watchPage(page, url);
  const check = () => {
    if (problems.length > 0) fail(`highlighter: ${problems[0]}`);
  };
  const shot = async (name) => {
    const path = join(dir, `highlighter-${name}.png`);
    writeFileSync(path, await page.screenshot());
    return path;
  };
  const sample = async (point) =>
    meanRgb(
      analyser,
      await page.screenshot({
        scale: "css",
        clip: {
          x: point.x - SAMPLE_PX / 2,
          y: point.y - SAMPLE_PX / 2,
          width: SAMPLE_PX,
          height: SAMPLE_PX,
        },
      }),
    );
  const measure = async (spots, stage) => {
    const pen = await sample(spots.pen);
    const highlighter = await sample(spots.highlighter);
    const overlap = await sample(spots.overlap);
    const paper = brightness(PAPER_RGB);
    if (brightness(pen) > paper - 60) fail(`highlighter: the pen stroke did not show ${stage}`);
    if (brightness(highlighter) > paper - 30) {
      fail(`highlighter: the highlighter stroke did not show ${stage}`);
    }
    if (!(brightness(overlap) < brightness(pen) - 6)) {
      fail(`highlighter: overlap ${overlap} is not darker than the pen alone ${pen} ${stage}`);
    }
    if (!(brightness(overlap) < brightness(highlighter) - 6)) {
      fail(
        `highlighter: overlap ${overlap} is not darker than the highlighter alone ${highlighter} ${stage}`,
      );
    }
    return { pen, highlighter, overlap };
  };
  try {
    await page.goto(url, { waitUntil: "load" });
    await waitForBoard(page);
    const more = page.getByRole("button", { name: "More tools" });
    if (await more.isVisible()) await more.tap();
    await page.locator("[data-toolbar-flip]").tap();
    const palette = page.locator(PALETTE);
    await palette.waitFor({ state: "visible", timeout: 5000 });
    await page.waitForTimeout(500);
    const viewport = page.viewportSize() ?? fail("no viewport");
    const box = (await palette.boundingBox()) ?? fail("highlighter: no palette bounding box");
    const left = box.x + box.width + CLIP_PAD;
    const cx = Math.round(left + (viewport.width - left) / 2);
    const cy = Math.round(viewport.height * 0.5);
    const spots = {
      pen: { x: cx - 90, y: cy },
      highlighter: { x: cx, y: cy + 80 },
      overlap: { x: cx, y: cy },
    };
    await palette.getByRole("button", { name: "Pen style" }).tap();
    await palette.getByRole("button", { name: "Colour 5" }).tap();
    await palette.getByRole("button", { name: "40 px pencil" }).tap();
    await drawWithTouch(page, linePath({ x: cx - 150, y: cy }, { x: cx + 150, y: cy }));
    await page.waitForTimeout(500);
    await palette.getByRole("button", { name: "Highlighter style" }).tap();
    await palette.getByRole("button", { name: "Colour 3" }).tap();
    await drawWithTouch(page, linePath({ x: cx, y: cy - 150 }, { x: cx, y: cy + 150 }));
    await page.waitForTimeout(1300);
    const drawn = await measure(spots, "after drawing");
    const drawnFull = await shot("drawn");
    check();
    await page.reload({ waitUntil: "load" });
    await waitForBoard(page);
    await page.waitForTimeout(1500);
    const reloaded = await measure(spots, "after reload");
    const reloadedFull = await shot("reloaded");
    check();
    return { drawn, reloaded, screenshots: [drawnFull, reloadedFull] };
  } finally {
    await context.close();
  }
};

const SHAPE_DEVICES = [DEVICE, "Pixel 7"];
const SHAPE_ROWS = 5;
const SHAPE_KINDS = ["Rectangle", "Ellipse", "Line", "Arrow"];
const MOVED_ROW = 4;
const EMPTY_RATIO = 0.002;

const shapeRows = (viewport, left) => {
  const right = viewport.width - 16;
  const top = 16;
  const height = (viewport.height - 90 - top) / SHAPE_ROWS;
  return Array.from({ length: SHAPE_ROWS }, (_, row) => {
    const y = top + row * height;
    const box = {
      from: { x: left + 10, y: y + height * 0.2 },
      to: { x: right - 10, y: y + height * 0.8 },
    };
    return { box, clip: { x: left, y, width: right - left, height } };
  });
};

const smokeShapes = async ({ browser, devices, analyser, url, dir, device }) => {
  const label = `shapes ${device}`;
  const context = await browser.newContext({ ...devices[device], colorScheme: "light" });
  await routeAccessHeaders(context, new URL(url).origin);
  const page = await context.newPage();
  const problems = watchPage(page, url);
  const check = () => {
    if (problems.length > 0) fail(`${label}: ${problems[0]}`);
  };
  const prefix = `shapes-${device.toLowerCase().replace(/\W+/g, "-")}`;
  const shot = async (name, clip) => {
    const path = join(dir, `${prefix}-${name}.png`);
    const buffer = await page.screenshot(clip ? { clip } : {});
    writeFileSync(path, buffer);
    return { path, buffer };
  };
  const inked = async (rows, blanks, stage) => {
    const ratios = [];
    for (const [index, row] of rows.entries()) {
      const after = await shot(`row${index}-${stage}`, row.clip);
      ratios.push((await inkStats(analyser, blanks[index].buffer, after.buffer)).changedRatio);
    }
    return ratios;
  };
  const expectRows = (ratios, filled, stage) => {
    for (const [index, ratio] of ratios.entries()) {
      const want = filled.includes(index);
      if (want && ratio < MIN_INK_RATIO) fail(`${label}: row ${index} is empty ${stage}`);
      if (!want && ratio > EMPTY_RATIO) {
        fail(`${label}: row ${index} should be empty ${stage}, ink ${ratio.toFixed(3)}`);
      }
    }
  };
  try {
    await page.goto(url, { waitUntil: "load" });
    await waitForBoard(page);
    const more = page.getByRole("button", { name: "More tools" });
    if (await more.isVisible()) await more.tap();
    await page.locator("[data-toolbar-flip]").tap();
    const palette = page.locator(PALETTE);
    await palette.waitFor({ state: "visible", timeout: 5000 });
    await page.waitForTimeout(500);
    const viewport = page.viewportSize() ?? fail("no viewport");
    const box = (await palette.boundingBox()) ?? fail(`${label}: no palette bounding box`);
    const rows = shapeRows(viewport, box.x + box.width + CLIP_PAD);
    const blanks = [];
    for (const [index, row] of rows.entries())
      blanks.push(await shot(`row${index}-before`, row.clip));
    const fill = palette.getByRole("button", { name: "Fill shapes" });
    for (const [index, kind] of SHAPE_KINDS.entries()) {
      await palette.getByRole("button", { name: kind, exact: true }).tap();
      const filled = (await fill.getAttribute("aria-pressed")) === "true";
      if (filled !== (index === 0)) await fill.tap();
      await drawWithTouch(page, linePath(rows[index].box.from, rows[index].box.to));
      await page.waitForTimeout(400);
    }
    await page.waitForTimeout(800);
    const drawn = await shot("drawn");
    expectRows(await inked(rows, blanks, "drawn"), [0, 1, 2, 3], "after drawing");
    check();
    await palette.getByRole("button", { name: "Select tool" }).tap();
    const from = {
      x: (rows[0].box.from.x + rows[0].box.to.x) / 2,
      y: (rows[0].box.from.y + rows[0].box.to.y) / 2,
    };
    const to = { x: from.x, y: from.y + (rows[MOVED_ROW].clip.y - rows[0].clip.y) };
    await drawWithTouch(page, linePath(from, to));
    await page.waitForTimeout(1300);
    const moved = await shot("moved");
    expectRows(await inked(rows, blanks, "moved"), [1, 2, 3, MOVED_ROW], "after the move");
    check();
    await page.reload({ waitUntil: "load" });
    await waitForBoard(page);
    await page.waitForTimeout(1500);
    const reloaded = await shot("reloaded");
    const kept = await inked(rows, blanks, "reloaded");
    expectRows(kept, [1, 2, 3, MOVED_ROW], "after reload");
    const counts = await countStoredRows(page);
    if ((counts.tiles ?? 0) === 0) fail(`${label}: no tile stored in IndexedDB after reload`);
    check();
    return {
      ink: kept.map((ratio) => Number(ratio.toFixed(3))),
      screenshots: [drawn.path, moved.path, reloaded.path],
    };
  } finally {
    await context.close();
  }
};

const RESIZE_OBJECTS = ["Rectangle", "Stroke"];
const HANDLE_REACH_PX = 6;
const BBOX_TOLERANCE_PX = 3;
const MIN_GROWTH = 1.8;

const inkBox = (analyser, before, after) =>
  analyser.evaluate(
    async ([beforeB64, afterB64]) => {
      const pixels = async (b64) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(bitmap, 0, 0);
        return {
          width: bitmap.width,
          data: ctx.getImageData(0, 0, bitmap.width, bitmap.height).data,
        };
      };
      const a = await pixels(beforeB64);
      const b = await pixels(afterB64);
      const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
      for (let i = 0; i < b.data.length; i += 4) {
        const distance =
          Math.abs(a.data[i] - b.data[i]) +
          Math.abs(a.data[i + 1] - b.data[i + 1]) +
          Math.abs(a.data[i + 2] - b.data[i + 2]);
        if (distance <= 48) continue;
        const x = (i / 4) % b.width;
        const y = Math.floor(i / 4 / b.width);
        box.minX = Math.min(box.minX, x);
        box.minY = Math.min(box.minY, y);
        box.maxX = Math.max(box.maxX, x);
        box.maxY = Math.max(box.maxY, y);
      }
      return Number.isFinite(box.minX) ? box : undefined;
    },
    [before.toString("base64"), after.toString("base64")],
  );

const touchDrag = async (page, points, midway) => {
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, point) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: point ? [{ x: point.x, y: point.y, id: 1, radiusX: 2, radiusY: 2 }] : [],
    });
  const [first, ...rest] = points;
  await touch("touchStart", first);
  for (const [index, point] of rest.entries()) {
    await touch("touchMove", point);
    if (index === Math.floor(rest.length / 2)) await midway();
  }
  await touch("touchEnd");
  await cdp.detach();
};

const zigzag = (from, to) =>
  Array.from({ length: 13 }, (_, i) => ({
    x: from.x + ((to.x - from.x) * i) / 12,
    y: i % 2 === 0 ? from.y : to.y,
  }));

const smokeResize = async ({ browser, devices, analyser, url, dir, device, object }) => {
  const label = `resize ${object} ${device}`;
  const context = await browser.newContext({ ...devices[device], colorScheme: "light" });
  await routeAccessHeaders(context, new URL(url).origin);
  const page = await context.newPage();
  const problems = watchPage(page, url);
  const check = () => {
    if (problems.length > 0) fail(`${label}: ${problems[0]}`);
  };
  const prefix = `resize-${object.toLowerCase()}-${device.toLowerCase().replace(/\W+/g, "-")}`;
  const shot = async (name, clip) => {
    const path = join(dir, `${prefix}-${name}.png`);
    const buffer = await page.screenshot(clip ? { clip } : {});
    writeFileSync(path, buffer);
    return { path, buffer };
  };
  const measure = async (blank, stage) => {
    const after = await shot(`${stage}-area`, blank.clip);
    return (
      (await inkBox(analyser, blank.buffer, after.buffer)) ?? fail(`${label}: no ink ${stage}`)
    );
  };
  try {
    await page.goto(url, { waitUntil: "load" });
    await waitForBoard(page);
    const more = page.getByRole("button", { name: "More tools" });
    if (await more.isVisible()) await more.tap();
    await page.locator("[data-toolbar-flip]").tap();
    const palette = page.locator(PALETTE);
    await palette.waitFor({ state: "visible", timeout: 5000 });
    await page.waitForTimeout(500);
    const viewport = page.viewportSize() ?? fail("no viewport");
    const box = (await palette.boundingBox()) ?? fail(`${label}: no palette bounding box`);
    const clip = {
      x: box.x + box.width + CLIP_PAD,
      y: 16,
      width: viewport.width - 16 - (box.x + box.width + CLIP_PAD),
      height: viewport.height - 90 - 16,
    };
    const blank = { ...(await shot("before", clip)), clip };
    const from = { x: clip.x + 30, y: clip.y + 30 };
    const size = { x: (clip.width - 80) / 2, y: Math.min(160, (clip.height - 80) / 2) };
    const to = { x: from.x + size.x, y: from.y + size.y };
    if (object === "Rectangle") {
      await palette.getByRole("button", { name: "Rectangle", exact: true }).tap();
      await drawWithTouch(page, linePath(from, to));
    } else {
      await drawWithTouch(page, zigzag(from, to));
    }
    await page.waitForTimeout(800);
    const drawn = await measure(blank, "drawn");
    check();
    await palette.getByRole("button", { name: "Select tool" }).tap();
    await drawWithTouch(page, [
      object === "Rectangle" ? { x: (from.x + to.x) / 2, y: from.y } : from,
    ]);
    await page.waitForTimeout(400);
    const selected = await shot("selected");
    const grab = { x: to.x + HANDLE_REACH_PX, y: to.y + HANDLE_REACH_PX };
    const target = { x: grab.x + size.x, y: grab.y + size.y };
    let middle;
    await touchDrag(page, linePath(grab, target), async () => {
      await page.waitForTimeout(300);
      middle = await shot("mid-drag");
    });
    await page.waitForTimeout(400);
    const resizedSelected = await shot("resized");
    await drawWithTouch(page, [{ x: clip.x + clip.width - 10, y: clip.y + clip.height - 10 }]);
    await page.waitForTimeout(1300);
    const resized = await measure(blank, "resized");
    const growth = {
      x: (resized.maxX - resized.minX) / (drawn.maxX - drawn.minX),
      y: (resized.maxY - resized.minY) / (drawn.maxY - drawn.minY),
    };
    if (growth.x < MIN_GROWTH || growth.y < MIN_GROWTH) {
      fail(`${label}: grew ${growth.x.toFixed(2)}x${growth.y.toFixed(2)}, want about 2`);
    }
    check();
    await page.reload({ waitUntil: "load" });
    await waitForBoard(page);
    await page.waitForTimeout(1500);
    const reloadedShot = await shot("reloaded");
    const reloaded = await measure(blank, "reloaded");
    for (const side of ["minX", "minY", "maxX", "maxY"]) {
      if (Math.abs(reloaded[side] - resized[side]) > BBOX_TOLERANCE_PX) {
        fail(`${label}: ${side} ${reloaded[side]} after reload, ${resized[side]} before`);
      }
    }
    check();
    return {
      growth: [Number(growth.x.toFixed(2)), Number(growth.y.toFixed(2))],
      screenshots: [selected.path, middle?.path, resizedSelected.path, reloadedShot.path],
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
    const palette = await smokePalette({ browser, devices, analyser, url: options.url, dir });
    console.log(`PASS palette: flip kept after reload, ink ${palette.ink}`);
    for (const path of palette.screenshots) console.log(`  ${path}`);
    const custom = await smokeCustomColour({ browser, devices, analyser, url: options.url, dir });
    console.log(`PASS custom colour: ${CUSTOM_HEX} kept after reload, match ${custom.match}`);
    for (const path of custom.screenshots) console.log(`  ${path}`);
    const width = await smokeWidth({ browser, devices, analyser, url: options.url, dir });
    console.log(
      `PASS width: 1 px and 60 px ink ${width.drawn.join(" < ")} drawn, ${width.reloaded.join(" < ")} after reload`,
    );
    for (const path of width.screenshots) console.log(`  ${path}`);
    const highlighter = await smokeHighlighter({
      browser,
      devices,
      analyser,
      url: siblingBoard(options.url),
      dir,
    });
    const rgbText = ({ pen, highlighter: alone, overlap }) =>
      `overlap ${overlap.join(",")} darker than pen ${pen.join(",")} and highlighter ${alone.join(",")}`;
    console.log(
      `PASS highlighter: ${rgbText(highlighter.drawn)} drawn, ${rgbText(highlighter.reloaded)} after reload`,
    );
    for (const path of highlighter.screenshots) console.log(`  ${path}`);
    for (const device of SHAPE_DEVICES) {
      const shapes = await smokeShapes({
        browser,
        devices,
        analyser,
        url: siblingBoard(options.url),
        dir,
        device,
      });
      console.log(
        `PASS shapes ${device}: 4 shapes kept after a move and reload, ink ${shapes.ink.join(" ")}`,
      );
      for (const path of shapes.screenshots) console.log(`  ${path}`);
    }
    for (const device of SHAPE_DEVICES) {
      for (const object of RESIZE_OBJECTS) {
        const resize = await smokeResize({
          browser,
          devices,
          analyser,
          url: siblingBoard(options.url),
          dir,
          device,
          object,
        });
        console.log(
          `PASS resize ${object} ${device}: grew ${resize.growth.join("x")}, bbox kept after reload`,
        );
        for (const path of resize.screenshots) console.log(`  ${path}`);
      }
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
