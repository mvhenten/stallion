import { accessHeaders } from "./env.mjs";

const [commit, origin = "https://stallion.matthijs-f49.workers.dev"] = process.argv.slice(2);
if (!commit) {
  console.error("usage: node npm-scripts/wait-live.mjs <commit sha> [origin]");
  process.exit(2);
}

const TIMEOUT_MS = 15 * 60_000;
const INTERVAL_MS = 20_000;
const probe = new URL("/api/me/boards", origin);
const deadline = Date.now() + TIMEOUT_MS;
let live = "";

while (Date.now() < deadline) {
  const response = await fetch(probe, { headers: accessHeaders(), redirect: "manual" }).catch(
    (error) => {
      console.log(`${probe} failed: ${error.message}`);
      return undefined;
    },
  );
  live = response?.headers.get("x-stallion-commit") ?? "";
  if (live === commit) {
    console.log(`${origin} serves ${commit}`);
    process.exit(0);
  }
  console.log(
    `${origin} serves ${live || "no x-stallion-commit"} (status ${response?.status}); waiting for ${commit}`,
  );
  await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
}

console.error(
  `${origin} still serves ${live || "no x-stallion-commit"} after 15 minutes, not ${commit}; check the Workers Builds log for the stallion Worker`,
);
process.exit(1);
