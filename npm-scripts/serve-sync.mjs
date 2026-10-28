#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const WRANGLER = join(REPO, "node_modules", ".bin", "wrangler");
const READY_TIMEOUT_MS = 180_000;
const OUTPUT_TAIL = 60;

const run = (command, args, env = process.env) => {
  const result = spawnSync(command, args, { cwd: REPO, env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited ${result.status ?? result.signal}`);
  }
};

const freePort = (host) =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, host, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });

const prepare = ({ host, port, syncUrl }) => {
  const env = { ...process.env, VITE_SYNC_URL: syncUrl ?? `ws://${host}:${port}` };
  run("npm", ["run", "build", "-w", "@stallion/web"], env);
  run("npm", ["run", "build:worker"]);
};

const wranglerArgs = (host, port) => ["dev", "--ip", host, "--port", String(port)];

const signalGroup = (pid, signal) => {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
};

const answers = async (origin) => {
  const response = await fetch(origin, { signal: AbortSignal.timeout(2_000) }).catch(() => null);
  return response?.ok === true;
};

export const startServer = async ({ host = "127.0.0.1", port, syncUrl } = {}) => {
  const chosen = port ?? (await freePort(host));
  prepare({ host, port: chosen, syncUrl });
  const origin = `http://${host}:${chosen}`;
  const child = spawn(WRANGLER, wranglerArgs(host, chosen), {
    cwd: REPO,
    detached: true,
    env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = [];
  const keep = (chunk) => {
    output.push(...chunk.toString().split("\n").filter(Boolean));
    output.splice(0, Math.max(0, output.length - OUTPUT_TAIL));
  };
  child.stdout.on("data", keep);
  child.stderr.on("data", keep);
  const exited = new Promise((resolve) =>
    child.once("exit", (code, signal) => resolve({ code, signal })),
  );
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    if (child.exitCode === null && child.signalCode === null) {
      signalGroup(child.pid, "SIGTERM");
      const killer = setTimeout(() => signalGroup(child.pid, "SIGKILL"), 5_000);
      await exited;
      clearTimeout(killer);
    }
    signalGroup(child.pid, "SIGKILL");
  };
  const failure = (reason) =>
    new Error(`${reason}\n--- wrangler dev output ---\n${output.join("\n")}`);

  const deadline = Date.now() + READY_TIMEOUT_MS;
  let early;
  exited.then((result) => {
    early = result;
  });
  while (!(await answers(origin))) {
    if (early) {
      await stop();
      throw failure(`wrangler dev exited ${early.code ?? early.signal} before ${origin} answered`);
    }
    if (Date.now() > deadline) {
      await stop();
      throw failure(`wrangler dev did not answer on ${origin} within ${READY_TIMEOUT_MS / 1000}s`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return { origin, stop };
};

const serve = () => {
  const host = process.env.SERVE_HOST || "127.0.0.1";
  const port = Number(process.env.SERVE_PORT || 8787);
  prepare({ host, port, syncUrl: process.env.VITE_SYNC_URL || undefined });
  const result = spawnSync(WRANGLER, wranglerArgs(host, port), { cwd: REPO, stdio: "inherit" });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
};

if (process.argv[1] === fileURLToPath(import.meta.url)) serve();
