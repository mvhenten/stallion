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
const state = JSON.parse(readFileSync(join(root, "infra", "terraform.tfstate"), "utf8"));
const output = (name) => {
  const value = state.outputs?.[name]?.value;
  if (!value) {
    console.error(`infra/terraform.tfstate has no ${name} output; run npm run infra:apply`);
    process.exit(1);
  }
  return value;
};

const run = spawnSync(
  "npx",
  [
    "wrangler",
    "deploy",
    "--var",
    `ACCESS_TEAM_DOMAIN:${output("access_team_domain")}`,
    "--var",
    `ACCESS_AUD:${output("access_aud")}`,
  ],
  { cwd: root, stdio: "inherit" },
);
if (run.error) throw run.error;
process.exit(run.status ?? 1);
