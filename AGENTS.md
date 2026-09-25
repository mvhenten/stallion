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

## Wire protocol

One Durable Object (`Board`) per board, reached at `GET /api/boards/{boardId}/ws` with a WebSocket upgrade. Sockets use the hibernation API; each socket's subscriptions and awareness client ids live in its attachment. Tile docs are held in memory until persistence lands; storage is SQLite (`Storage::sql()` in `worker` 0.8.6, `new_sqlite_classes`).

Every message is one binary CBOR map `{tileKey, kind, payload}`. `payload` is a plain byte string (cbor-x `tagUint8Array: false`; the server also accepts tag 64). `encodeFrame` and `decodeFrame` in `packages/schema` are the client codec; `fixtures/frame.cbor.hex` pins the bytes for both sides.

| kind | tileKey | payload | Direction |
| --- | --- | --- | --- |
| `Subscribe` | `level:tx:ty` | empty | client to server; the server replies with `Sync` step 1 |
| `Unsubscribe` | `level:tx:ty` | empty | client to server |
| `Sync` | `level:tx:ty` | one y-protocols sync message (`writeSyncStep1`, `writeSyncStep2` or `writeUpdate`) | both ways |
| `Awareness` | `""` | `encodeAwarenessUpdate` output | both ways, board-wide |
| `Reject` | the frame's tileKey | UTF-8 reason | server to client |

- A tile key is `tileKey()` from `packages/geometry`, level -40..40. `Sync` on an unsubscribed tile is rejected.
- A tile doc holds one root, the `Y.Map` `objects`, keyed by `objectId`. Each value is the `encode()` CBOR of the object as a `Uint8Array`. The server validates every changed value with serde and rejects the whole update if one fails.
- The server relays accepted step 2 and update messages as `writeUpdate` to the tile's other subscribers. An update with missing dependencies is not applied; the server answers with its own step 1 and the client replies with step 2.
- On connect the server sends the board's awareness states; on close it broadcasts their removal.
- A text frame or undecodable CBOR closes the socket with 1003 or 1007.
