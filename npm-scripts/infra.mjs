import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const envFile = join(homedir(), ".config/stallion/cf-env");
const infraDir = join(dirname(fileURLToPath(import.meta.url)), "..", "infra");
const [command, ...args] = process.argv.slice(2);

if (command !== "plan" && command !== "apply") {
  console.error("usage: node npm-scripts/infra.mjs <plan|apply> [tofu args]");
  process.exit(2);
}

const parseEnv = (text) =>
  Object.fromEntries(
    text
      .split("\n")
      .map((line) => line.replace(/^\s*export\s+/, "").trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const at = line.indexOf("=");
        return [line.slice(0, at), line.slice(at + 1).replace(/^(["'])(.*)\1$/, "$2")];
      }),
  );

const fileEnv = parseEnv(readFileSync(envFile, "utf8"));
if (!fileEnv.CLOUDFLARE_API_TOKEN) {
  console.error(`${envFile} does not set CLOUDFLARE_API_TOKEN`);
  process.exit(1);
}

const env = { ...process.env, CLOUDFLARE_API_TOKEN: fileEnv.CLOUDFLARE_API_TOKEN };
const tofu = (...tofuArgs) => {
  const run = spawnSync("tofu", tofuArgs, { cwd: infraDir, env, stdio: "inherit" });
  if (run.error) throw run.error;
  if (run.status !== 0) process.exit(run.status ?? 1);
};

tofu("init", "-input=false");
tofu(command, "-input=false", ...args);
