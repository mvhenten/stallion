# Stallion

An infinite-zoom drawing board. Client: TypeScript, Preact and Vite in `apps/web`, with shared code in `packages/*`. Server: a Rust Cloudflare Worker in `crates/server`, built with `worker-build` for `wasm32-unknown-unknown`.

## Rules

- TypeScript and Rust only. No Python.
- One PR per stage, in issue order.
- npm workspaces with one lockfile at the root. Current major versions of every tool.
- Biome formats and lints TypeScript; `cargo fmt` and `clippy` cover Rust. Run `npm run fix` before every commit.
- Minimal tests, speed over coverage: Vitest with a smoke test per package, `cargo test` for the crate. No coverage thresholds, no Playwright yet.
- CI is one fast job. It is the test runner; push instead of running suites locally.

## Scripts

| Script | Does |
| --- | --- |
| `npm run fix` | Biome and `cargo fmt` rewrite files |
| `npm run lint` / `lint:rust` | Biome check / `cargo fmt --check` and `clippy -D warnings` |
| `npm run typecheck` | `tsc` over every package |
| `npm test` / `test:rust` | Vitest / `cargo test` |
| `npm run build` / `build:worker` | Vite build of `apps/web` / wasm bundle in `crates/server/build` |

`wrangler.jsonc` runs the worker from `crates/server/build` and serves `apps/web/dist` as static assets.

## Deploy

`.github/workflows/deploy.yml` runs `wrangler deploy` after `ci` passes on main, and on manual dispatch. `npm run deploy:dry` validates the bundle locally without deploying.

The repository needs two Actions secrets:

- `CLOUDFLARE_API_TOKEN`: create it under My Profile, API Tokens, from the "Edit Cloudflare Workers" template. It must grant Workers Scripts edit and Account Workers Scripts read.
- `CLOUDFLARE_ACCOUNT_ID`: the account ID from the Workers dashboard.
