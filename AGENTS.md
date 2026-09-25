# Stallion

An infinite-zoom drawing board. Client: TypeScript, Preact and Vite in `apps/web`, with shared code in `packages/*`. Server: a Rust Cloudflare Worker in `crates/server`, built with `worker-build` for `wasm32-unknown-unknown`.

## Rules

- TypeScript and Rust only. No Python.
- One PR per stage, in issue order.
- npm workspaces with one lockfile at the root. Current major versions of every tool.
- Biome formats and lints TypeScript; `cargo fmt` and `clippy` cover Rust. Run `npm run fix` before every commit.
- Minimal tests, speed over coverage: Vitest with a smoke test per package, `cargo test` for the crate. No coverage thresholds; Playwright only drives `npm run smoke`.
- CI is one fast job. It is the test runner; push instead of running suites locally.

## Scripts

| Script | Does |
| --- | --- |
| `npm run fix` | Biome and `cargo fmt` rewrite files |
| `npm run lint` / `lint:rust` | Biome check / `cargo fmt --check` and `clippy -D warnings` |
| `npm run typecheck` | `tsc` over every package |
| `npm test` / `test:rust` | Vitest / `cargo test` |
| `npm run build` / `build:worker` | Vite build of `apps/web` / wasm bundle in `crates/server/build` |
| `npm run smoke -- [--pull] [url]` | One real page load on a touch tablet, light and dark: draw, reload, check the stroke |
| `npm run serve:sync` | Build `apps/web` against the local worker and serve both with `wrangler dev` on port 8787 |

`wrangler.jsonc` runs the worker from `crates/server/build` and serves `apps/web/dist` as static assets.

## Smoke

After pushing to main, run `npm run smoke -- --pull` and paste its result in the final summary. It fast-forwards `~/development/stallion`, reinstalls, then loads the live dev server (default `http://100.104.44.51:5173/b/default`) headless on a Galaxy Tab S9 viewport in light and dark, draws one touch stroke, reloads and checks the stroke is stored and visible. Any console error or failed request fails it. Screenshots land in `~/development/.tmp/stallion-smoke/<timestamp>/`. A push is not done until the smoke passes.

## Deploy

`.github/workflows/deploy.yml` runs `wrangler deploy` after `ci` passes on main, and on manual dispatch. `npm run deploy:dry` validates the bundle locally without deploying.

The repository needs two Actions secrets:

- `CLOUDFLARE_API_TOKEN`: create it under My Profile, API Tokens, from the "Edit Cloudflare Workers" template. It must grant Workers Scripts edit and Account Workers Scripts read.
- `CLOUDFLARE_ACCOUNT_ID`: the account ID from the Workers dashboard.

## Access

Cloudflare Access guards the app. The Worker verifies the RS256 JWT from the `Cf-Access-Jwt-Assertion` header or the `CF_Authorization` cookie on every `/api/*` request: signature against the team keys at `https://<ACCESS_TEAM_DOMAIN>/cdn-cgi/access/certs` (cached for an hour per isolate), `aud` against `ACCESS_AUD`, `iss` and `exp`. Anything else gets a 401. The verified email reaches the `Board` in the `X-Stallion-User` header, and the server writes it into every awareness state from that socket as `user.name`.

Both vars live in `wrangler.jsonc`. Set `ACCESS_TEAM_DOMAIN` to `<team>.cloudflareaccess.com` and `ACCESS_AUD` to the application audience tag. Leave both empty for `wrangler dev`: the check is skipped and the Worker logs once that Access is disabled. Setting only one is an error.

## Wire protocol

One Durable Object (`Board`) per board, reached at `GET /api/boards/{boardId}/ws` with a WebSocket upgrade. Sockets use the hibernation API; each socket's subscriptions and awareness client ids live in its attachment. Tile docs load lazily from SQLite (`Storage::sql()` in `worker` 0.8.6, `new_sqlite_classes`) on first use. The `tile` table holds each doc as one compacted yrs update and `object_index` holds each object's bbox as JSON `[minX,minY,maxX,maxY]`; the `schema_migration` table records applied migrations. An alarm flushes dirty tiles 5 s after the first change, then evicts tiles idle for 60 s.

Every message is one binary CBOR map `{tileKey, kind, payload}`. `payload` is a plain byte string (cbor-x `tagUint8Array: false`; the server also accepts tag 64). `encodeFrame` and `decodeFrame` in `packages/schema` are the client codec; `fixtures/frame.cbor.hex` pins the bytes for both sides.

| kind | tileKey | payload | Direction |
| --- | --- | --- | --- |
| `Subscribe` | `level:tx:ty` | empty | client to server; the server replies with `Sync` step 1 |
| `Unsubscribe` | `level:tx:ty` | empty | client to server |
| `Sync` | `level:tx:ty` | one y-protocols sync message (`writeSyncStep1`, `writeSyncStep2` or `writeUpdate`) | both ways |
| `Awareness` | `""` | `encodeAwarenessUpdate` output | both ways, board-wide |
| `View` | `""` | CBOR map `{minX, minY, maxX, maxY, zoom}`: world bounds of the viewport | client to server |
| `Snapshot` | `level:tx:ty` | the tile doc as one yrs update, read-only | server to client |
| `Reject` | the frame's tileKey | UTF-8 reason | server to client |

- A `View` replaces the socket's view. `viewTiles()` from `packages/geometry` splits it into levels; `crates/server/src/view.rs` mirrors that maths, and a cargo test checks both sides use the same constants. The live band (tiles of 64 px and up) is subscribed by range, so a tile that leaves the view is unsubscribed, explicit `Subscribe`s outside the band included. The server flushes dirty tiles, then runs one `object_index` range query per level, coarse first and nearest the centre first, until the view holds 4096 objects. A newly live tile with objects gets `Sync` step 1 and step 2; a finer tile gets a `Snapshot`, resent on every `View`. A live tile cut by the budget stays subscribed and syncs on the client's step 1. Bounds must be finite and at most 16384 px a side on screen.
- A tile key is `tileKey()` from `packages/geometry`, level -40..40. `Sync` on an unsubscribed tile is rejected.
- A tile doc holds one root, the `Y.Map` `objects`, keyed by `objectId`. Each value is the `encode()` CBOR of the object as a `Uint8Array`. The server validates every changed value with serde and rejects the whole update if one fails.
- The server relays accepted step 2 and update messages as `writeUpdate` to the tile's other subscribers. An update with missing dependencies is not applied; the server answers with its own step 1 and the client replies with step 2.
- On connect the server sends the board's awareness states; on close it broadcasts their removal.
- A text frame or undecodable CBOR closes the socket with 1003 or 1007.
