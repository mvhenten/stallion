import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const CONFIG_DIR = join(homedir(), ".config", "stallion");
export const CF_ENV = join(CONFIG_DIR, "cf-env");
export const ACCESS_ENV = join(CONFIG_DIR, "access-env");
export const TFSTATE = join(CONFIG_DIR, "terraform.tfstate");
export const TOFU_INIT = [
  "init",
  "-input=false",
  "-reconfigure",
  `-backend-config=path=${TFSTATE}`,
];

export const parseEnv = (text) =>
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

export const readEnvFile = (path) => (existsSync(path) ? parseEnv(readFileSync(path, "utf8")) : {});

export const accessHeaders = () => {
  const file = readEnvFile(ACCESS_ENV);
  const id = process.env.CF_ACCESS_CLIENT_ID || file.CF_ACCESS_CLIENT_ID;
  const secret = process.env.CF_ACCESS_CLIENT_SECRET || file.CF_ACCESS_CLIENT_SECRET;
  if (!id || !secret) return {};
  return { "CF-Access-Client-Id": id, "CF-Access-Client-Secret": secret };
};

export const routeAccessHeaders = async (context, origin) => {
  const headers = accessHeaders();
  if (Object.keys(headers).length === 0) return;
  await context.route(
    (url) => url.origin === origin,
    (route) => route.continue({ headers: { ...route.request().headers(), ...headers } }),
  );
};
