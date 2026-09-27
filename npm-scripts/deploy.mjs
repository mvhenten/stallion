import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.env.WORKERS_CI !== "1") {
  console.error(
    "npm run deploy runs only inside Cloudflare Workers Builds; push to main to deploy",
  );
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const vars = JSON.parse(readFileSync(join(root, "infra", "access.json"), "utf8"));
const value = (name) => {
  if (!vars[name]) {
    console.error(`infra/access.json has no ${name}; run npm run infra:apply`);
    process.exit(1);
  }
  return vars[name];
};

const run = spawnSync(
  "npx",
  [
    "wrangler",
    "deploy",
    "--var",
    `ACCESS_TEAM_DOMAIN:${value("ACCESS_TEAM_DOMAIN")}`,
    "--var",
    `ACCESS_AUD:${value("ACCESS_AUD")}`,
  ],
  { cwd: root, stdio: "inherit" },
);
if (run.error) throw run.error;
process.exit(run.status ?? 1);
