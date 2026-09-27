# Stallion

Stallion is an infinite-zoom drawing board built for tablets. Boards sync live between devices through a Rust Cloudflare Worker with one Durable Object per board; the client is TypeScript and Preact. It runs at https://stallion.matthijs-f49.workers.dev behind Cloudflare Access.

Run it locally with Node 24 and the Rust toolchain from `rust-toolchain.toml`: `npm ci`, then `npm run dev` for the client alone, or `npm run serve:sync` to build the client and serve it with the Worker on port 8787. `AGENTS.md` covers the scripts, the wire protocol, infra and deploy.

Licensed under the [MIT licence](LICENSE).
