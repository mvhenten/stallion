#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(homedir(), "development", ".tmp", "stallion-duo");
const VIEWPORT = { width: 1280, height: 800 };
const BLUE = { label: "Colour 5", rgb: [0x00, 0x90, 0xff] };
const RED = { label: "Colour 2", rgb: [0xe5, 0x48, 0x4d] };
const B_DELAY_MS = 2000;
const SETTLE_MS = 3000;
const MIN_INK_PIXELS = 200;
const STEP_MS = 12;
const REPO = fileURLToPath(new URL("..", import.meta.url));

class DemoFailure extends Error {}

const fail = (reason) => {
  throw new DemoFailure(reason);
};

const usage = "usage: demo:duo <url> [--board <id>]";

const parseArgs = (argv) => {
  const rest = [...argv];
  let board;
  let url;
  while (rest.length > 0) {
    const arg = rest.shift();
    if (arg === "--board") {
      board = rest.shift() ?? fail(`--board needs an id; ${usage}`);
      continue;
    }
    if (arg.startsWith("--")) fail(`unknown flag ${arg}; ${usage}`);
    if (url) fail(`unexpected argument ${arg}; ${usage}`);
    url = arg;
  }
  if (!url) fail(`missing url; ${usage}`);
  const target = new URL(url);
  target.pathname = `/b/${encodeURIComponent(board ?? `duo-${randomBytes(4).toString("hex")}`)}`;
  return { url: target.toString() };
};

const launch = async (chromium) => {
  const first = await chromium.launch({ headless: true }).then(
    (browser) => ({ browser }),
    (error) => ({ error }),
  );
  if (first.browser) return first.browser;
  if (!/Executable doesn't exist/.test(String(first.error?.message))) throw first.error;
  const install = spawnSync("npx", ["playwright", "install", "chromium-headless-shell", "ffmpeg"], {
    cwd: REPO,
    stdio: "inherit",
  });
  if (install.status !== 0) fail("playwright install failed");
  return chromium.launch({ headless: true });
};

const watchPage = (name, page, url) => {
  const problems = [];
  const origin = new URL(url).origin;
  const isFavicon = (target) => {
    const parsed = new URL(target);
    return parsed.origin === origin && parsed.pathname === "/favicon.ico";
  };
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const location = message.location().url;
    if (location && isFavicon(location) && /404/.test(message.text())) return;
    problems.push(`${name} console error: ${message.text()}`);
  });
  page.on("pageerror", (error) => problems.push(`${name} page error: ${error.message}`));
  page.on("response", (response) => {
    if (response.status() < 400) return;
    if (response.status() === 404 && isFavicon(response.url())) return;
    problems.push(`${name} HTTP ${response.status()}: ${response.url()}`);
  });
  return problems;
};

const openBoard = async (page, url, colour) => {
  await page.goto(url, { waitUntil: "load" });
  await page.locator("canvas.surface").waitFor({ state: "visible", timeout: 15000 });
  await page.getByRole("button", { name: "Large pencil" }).click();
  await page.getByRole("button", { name: colour.label, exact: true }).click();
};

const circle = (cx, cy, r, turns = 1, start = 0) =>
  Array.from({ length: Math.round(90 * turns) + 1 }, (_, i) => {
    const angle = start + (i / 90) * Math.PI * 2;
    return { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r };
  });

const spiral = (cx, cy, from, to, turns) => {
  const count = Math.round(90 * turns);
  return Array.from({ length: count + 1 }, (_, i) => {
    const t = i / count;
    const angle = t * turns * Math.PI * 2;
    const r = from + (to - from) * t;
    return { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r };
  });
};

const square = (cx, cy, half) => {
  const corners = [
    [cx - half, cy - half],
    [cx + half, cy - half],
    [cx + half, cy + half],
    [cx - half, cy + half],
    [cx - half, cy - half],
  ];
  return corners.slice(1).flatMap(([x, y], i) => {
    const [px, py] = corners[i];
    return Array.from({ length: 30 }, (_, j) => ({
      x: px + ((x - px) * (j + 1)) / 30,
      y: py + ((y - py) * (j + 1)) / 30,
    }));
  });
};

const draw = async (page, points) => {
  const [first, ...rest] = points;
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const point of rest) {
    await page.mouse.move(point.x, point.y);
    await page.waitForTimeout(STEP_MS);
  }
  await page.mouse.up();
};

const inkPixels = (page, colour) =>
  page.evaluate(([r, g, b]) => {
    const canvas = document.querySelector("canvas.surface");
    if (!(canvas instanceof HTMLCanvasElement)) return -1;
    const context = canvas.getContext("2d");
    if (!context) return -1;
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      const distance =
        Math.abs(data[i] - r) + Math.abs(data[i + 1] - g) + Math.abs(data[i + 2] - b);
      if (data[i + 3] > 200 && distance < 60) count++;
    }
    return count;
  }, colour.rgb);

const connection = (page) =>
  page
    .locator(".status[data-connection]")
    .getAttribute("data-connection", { timeout: 5000 })
    .then((value) => value ?? "missing");

const combine = (a, b, out) => {
  const which = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" });
  if (which.status !== 0) return undefined;
  const result = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-loglevel",
      "error",
      "-i",
      a,
      "-i",
      b,
      "-filter_complex",
      "[0:v]scale=960:600[l];[1:v]scale=960:600[r];[l][r]hstack=inputs=2,format=yuv420p[v]",
      "-map",
      "[v]",
      "-c:v",
      "libx264",
      "-crf",
      "23",
      out,
    ],
    { stdio: "inherit" },
  );
  return result.status === 0 ? out : undefined;
};

const main = async () => {
  const { url } = parseArgs(process.argv.slice(2));
  const { chromium } = await import("playwright");
  const dir = join(ROOT, new Date().toISOString().replace(/[:.]/g, "-"));
  const raw = join(dir, "raw");
  mkdirSync(raw, { recursive: true });
  const browser = await launch(chromium);
  const failures = [];
  const artifacts = [];
  const contextOptions = { viewport: VIEWPORT, recordVideo: { dir: raw, size: VIEWPORT } };
  const contextA = await browser.newContext(contextOptions);
  const contextB = await browser.newContext(contextOptions);
  const a = await contextA.newPage();
  const b = await contextB.newPage();
  const problemsA = watchPage("A", a, url);
  const problemsB = watchPage("B", b, url);
  const cx = VIEWPORT.width / 2;
  const cy = VIEWPORT.height / 2 + 40;
  try {
    const runA = (async () => {
      await openBoard(a, url, BLUE);
      await draw(a, circle(cx, cy, 280, 1.02, -Math.PI / 2));
      await draw(a, square(cx, cy, 170));
    })();
    const runB = (async () => {
      await b.waitForTimeout(B_DELAY_MS);
      await openBoard(b, url, RED);
      await draw(b, spiral(cx, cy, 20, 300, 3));
    })();
    await Promise.all([runA, runB]);
    await Promise.all([a.waitForTimeout(SETTLE_MS), b.waitForTimeout(SETTLE_MS)]);
    for (const [name, page] of [
      ["a", a],
      ["b", b],
    ]) {
      const path = join(dir, `${name}.png`);
      await page.screenshot({ path });
      artifacts.push(path);
    }
    const redOnA = await inkPixels(a, RED);
    const blueOnB = await inkPixels(b, BLUE);
    if (redOnA < MIN_INK_PIXELS) failures.push(`A shows ${redOnA} red pixels`);
    if (blueOnB < MIN_INK_PIXELS) failures.push(`B shows ${blueOnB} blue pixels`);
    const [statusA, statusB] = await Promise.all([connection(a), connection(b)]);
    if (statusA !== "Connected") failures.push(`A status is ${statusA}`);
    if (statusB !== "Connected") failures.push(`B status is ${statusB}`);
    const own = `blue on A ${await inkPixels(a, BLUE)} px, red on B ${await inkPixels(b, RED)} px`;
    console.log(`ink: red on A ${redOnA} px, blue on B ${blueOnB} px (${own})`);
  } catch (error) {
    failures.push(String(error?.message ?? error).split("\n")[0]);
  } finally {
    await contextA.close();
    await contextB.close();
  }
  const videoA = join(dir, "a.webm");
  const videoB = join(dir, "b.webm");
  await a.video()?.saveAs(videoA);
  await b.video()?.saveAs(videoB);
  await browser.close();
  rmSync(raw, { recursive: true, force: true });
  const combined = combine(videoA, videoB, join(dir, "combined.mp4"));
  failures.push(...problemsA, ...problemsB);
  console.log(`board: ${url}`);
  for (const path of [videoA, videoB, combined, ...artifacts].filter(Boolean)) {
    console.log(`  ${path}`);
  }
  if (failures.length > 0) fail(failures.join("; "));
  console.log(`duo demo passed (${dir})`);
};

main().catch((error) => {
  const reason = error instanceof DemoFailure ? error.message : String(error?.message ?? error);
  console.error(`duo demo failed: ${reason.split("\n")[0]}`);
  process.exit(1);
});
