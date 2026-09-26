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
| `npm run demo:duo -- <url> [--board <id>]` | Two 1280x800 browsers on one board: A draws blue, B draws red on top; checks each sees the other's ink and both read Connected. Videos, a side-by-side `combined.mp4` and screenshots land in `~/development/.tmp/stallion-duo/<timestamp>/` |
| `npm run access:env` | Write the Access service token from `tofu output` into `~/.config/stallion/access-env` (mode 600); prints nothing |
| `npm run icons -w @stallion/web` | Regenerate the PWA icons in `apps/web/public/icons` with sharp |
| `npm run serve:sync` | Build `apps/web` against the local worker and serve both with `wrangler dev` on port 8787 |

`wrangler.jsonc` runs the worker from `crates/server/build` and serves `apps/web/dist` as static assets.

## Sync URL

The Worker serves both the assets and the WebSocket, so the client needs no build-time config in production. `syncUrlFor()` in `apps/web/src/sync.ts` picks the sync server once per board:

1. `VITE_SYNC_URL`, when it was set at build time (`npm run serve:sync` sets it to the local worker).
2. Otherwise local only, when the page is on localhost, a private LAN address, a tailnet address (`100.64.0.0/10`) or `*.ts.net`. That is the Vite dev server.
3. Otherwise the page's own origin, `wss://<host>` (or `ws://` over http). `openBoard` appends `/api/boards/<boardId>/ws`.

The deploy workflow builds without `VITE_SYNC_URL`, so the deployed app syncs with the Worker that served it.

## Smoke

After pushing to main, run `npm run smoke -- --pull` and paste its result in the final summary. It fast-forwards `~/development/stallion`, reinstalls, then loads the live dev server (default `http://100.104.44.51:5173/b/default`) headless on a Galaxy Tab S9 viewport in light and dark, draws one touch stroke, reloads and checks the stroke is stored and visible. Any console error or failed request fails it. Screenshots land in `~/development/.tmp/stallion-smoke/<timestamp>/`. A push is not done until the smoke passes.

Against the deployed Worker, run `npm run access:env` once, then `npm run smoke -- https://stallion.matthijs-f49.workers.dev/b/<id>` or `npm run demo:duo -- https://stallion.matthijs-f49.workers.dev/`. Both scripts read `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` from the environment, else from `~/.config/stallion/access-env`, and send them as `CF-Access-Client-Id` and `CF-Access-Client-Secret` on every request of every browser context. The deploy workflow runs the same smoke on `/b/ci-<run id>` after `wrangler deploy`, reading both values from the state outputs; a failing smoke fails the deploy.

## Deploy

`.github/workflows/deploy.yml` runs `wrangler deploy` after `ci` passes on main, and on manual dispatch. `npm run deploy:dry` validates the bundle locally without deploying.

The repository needs two Actions secrets:

- `CLOUDFLARE_API_TOKEN`: create it under My Profile, API Tokens, from the "Edit Cloudflare Workers" template. It must grant Workers Scripts edit and Account Workers Scripts read.
- `CLOUDFLARE_ACCOUNT_ID`: the account ID from the Workers dashboard.

The Worker needs one secret, `BOARD_PASS_SECRET`, the HMAC key for board passes. Set it once per Worker with `wrangler secret put BOARD_PASS_SECRET`, piping 32 random bytes as hex; it survives deploys. For `wrangler dev`, put it in a gitignored `.dev.vars`. Without it, open boards still sync, but setting a PIN or joining a locked board answers 500 `PassSecretMissing`.

## PWA

`vite-plugin-pwa` builds the manifest and a Workbox service worker from `apps/web/pwa.config.ts`. The worker precaches the built shell and assets and serves `index.html` for navigations to `/` and `/b/*`; it has no runtime routes, so `/api/*` and the sync WebSocket always go to the network. `apps/web/public/_headers` sets `Cache-Control: no-cache` on `sw.js` and the manifest.

## Access

Cloudflare Access guards the app. The Worker verifies the RS256 JWT from the `Cf-Access-Jwt-Assertion` header or the `CF_Authorization` cookie on every `/api/*` request: signature against the team keys at `https://<ACCESS_TEAM_DOMAIN>/cdn-cgi/access/certs` (cached for an hour per isolate), `aud` against `ACCESS_AUD`, `iss` and `exp`. Anything else gets a 401. A service token JWT has no email; the Worker uses its `common_name` (the client id) instead, and rejects a token with neither. The verified name reaches the `Board` in the `X-Stallion-User` header, and the server writes it into every awareness state from that socket as `user.name`.

Both vars stay empty in `wrangler.jsonc`, so `wrangler dev` skips the check and logs once that Access is disabled. The deploy workflow passes the OpenTofu outputs to `wrangler deploy --var`: `ACCESS_TEAM_DOMAIN` is `<team>.cloudflareaccess.com` and `ACCESS_AUD` is the application audience tag. Setting only one is an error.

## Infra

OpenTofu in `infra/` manages Cloudflare Access with the `cloudflare/cloudflare` v5 provider: the Zero Trust organization (imported; its name and team domain stay as they are), a one-time PIN identity provider, a self-hosted Access application for the Worker hostname with a 720h session that redirects straight to that provider, an `anyone-with-email` allow policy that includes `everyone`, and a second `non_identity` policy for the `stallion-automation` service token that the smoke and duo demo use. The token lasts 8760h; bump `client_secret_version` to rotate it. Nothing is changed in the dashboard.

Anyone who can receive a one-time PIN at any email address can log in; no email address lives in the repo or the state. Board PINs are the real gate, so the default board should carry one.

The `infra` job in `deploy.yml` runs before the Worker deploy. It plans on pull requests that touch `infra/`; on main it plans, applies and commits `infra/terraform.tfstate` back to main as `github-actions[bot]` with `[skip ci]`. The state is the only record of what exists; never delete or hand-edit it. The state holds the service token client secret in plain text and is committed to this private repo, so anyone who can read the repo can pass Access as the automation token. That is accepted for now.

Locally, `npm run infra:plan` and `npm run infra:apply` run `tofu init` and the command in `infra/`, reading `CLOUDFLARE_API_TOKEN` from `~/.config/stallion/cf-env`. Apply from CI, not locally.

The `CLOUDFLARE_API_TOKEN` secret needs these permissions, as the API token editor names them:

- Account, Access: Organizations, Identity Providers, and Groups, Edit
- Account, Access: Apps and Policies, Edit
- Account, Access: Service Tokens, Edit
- Account, Workers Scripts, Edit
- User, User Details, Read

## Wire protocol

One Durable Object (`Board`) per board, reached at `GET /api/boards/{boardId}/ws` with a WebSocket upgrade. The same object serves the PIN routes below. Sockets use the hibernation API; each socket's subscriptions and awareness client ids live in its attachment. Tile docs load lazily from SQLite (`Storage::sql()` in `worker` 0.8.6, `new_sqlite_classes`) on first use. The `tile` table holds each doc as one compacted yrs update and `object_index` holds each object's bbox as JSON `[minX,minY,maxX,maxY]`; the `schema_migration` table records applied migrations. An alarm flushes dirty tiles 5 s after the first change, then evicts tiles idle for 60 s.

Every message is one binary CBOR map `{tileKey, kind, payload}`. `payload` is a plain byte string (cbor-x `tagUint8Array: false`; the server also accepts tag 64). `encodeFrame` and `decodeFrame` in `packages/schema` are the client codec; `fixtures/frame.cbor.hex` pins the bytes for both sides.

| kind | tileKey | payload | Direction |
| --- | --- | --- | --- |
| `Subscribe` | `level:tx:ty` | empty | client to server; the server replies with `Sync` step 1 |
| `Unsubscribe` | `level:tx:ty` | empty | client to server |
| `Sync` | `level:tx:ty` | one y-protocols sync message (`writeSyncStep1`, `writeSyncStep2` or `writeUpdate`) | both ways |
| `Awareness` | `""` | `encodeAwarenessUpdate` output | both ways, board-wide |
| `View` | `""` | CBOR map `{minX, minY, maxX, maxY, zoom}`: world bounds of the viewport | client to server |
| `Snapshot` | `level:tx:ty` | the tile doc as one yrs update, read-only | server to client |
| `Move` | `""` | CBOR map `{objectId, fromTile, toTile, fromUpdate, toUpdate}`: one Yjs update per tile | client to server |
| `Reject` | the frame's tileKey | UTF-8 reason | server to client |

- A `View` replaces the socket's view. `viewTiles()` from `packages/geometry` splits it into levels; `crates/server/src/view.rs` mirrors that maths, and a cargo test checks both sides use the same constants. The live band (tiles of 64 px and up) is subscribed by range, so a tile that leaves the view is unsubscribed, explicit `Subscribe`s outside the band included. The server flushes dirty tiles, then runs one `object_index` range query per level, coarse first and nearest the centre first, until the view holds 4096 objects. A newly live tile with objects gets `Sync` step 1 and step 2; a finer tile gets a `Snapshot`, resent on every `View`. A live tile cut by the budget stays subscribed and syncs on the client's step 1. Bounds must be finite and at most 16384 px a side on screen.
- A tile key is `tileKey()` from `packages/geometry`, level -40..40. `Sync` on an unsubscribed tile is rejected.
- A tile doc holds one root, the `Y.Map` `objects`, keyed by `objectId`. Each value is the `encode()` CBOR of the object as a `Uint8Array`. The server validates every changed value with serde and rejects the whole update if one fails.
- The server relays accepted step 2 and update messages as `writeUpdate` to the tile's other subscribers. An update with missing dependencies is not applied; the server answers with its own step 1 and the client replies with step 2.
- A `Move` carries an object across a tile or level: `fromUpdate` deletes it from `fromTile`, `toUpdate` sets it in `toTile`. Both tiles must be subscribed. The server validates both updates and applies both or neither, relays each as a `Sync` update, and flushes the dirty set in one synchronous write, which the Durable Object commits as one transaction. `put` in `packages/client-sync` sends a `Move` when an object changes tile; offline, it queues the delete before the insert. `fixtures/move.cbor.hex` pins the payload.
- An object lives in exactly one tile. A move beats a concurrent edit that kept the object in the source tile, and the first of two concurrent moves wins: when an update brings an object into a tile while another tile, loaded or in `object_index`, still holds it, the server deletes the newcomer and sends that delete to every subscriber, the sender included.
- On connect the server sends the board's awareness states; on close it broadcasts their removal.
- A text frame or undecodable CBOR closes the socket with 1003 or 1007.

### Board PIN

A board is open to anyone with its link until a PIN is set. The PIN is 6 digits, stored in the `board_lock` table as `pbkdf2-sha256$<iterations>$<salt>$<hash>` (WebCrypto PBKDF2-SHA256, 100000 iterations, 16-byte salt, base64url) with a `generation` that grows on every change. Every refusal is JSON `{reason, message}`.

| Route | Body | Answers |
| --- | --- | --- |
| `GET /api/boards/{boardId}/ws?pass=<pass>` | | On a locked board, 403 `PinRequired` without a pass or 403 `PassInvalid` with a bad one, before the upgrade check. A plain GET that passes the lock gets 426; the client uses that as its probe after a refused handshake. |
| `POST /api/boards/{boardId}/join` | `{"pin": "123456"}` | 200 `{pinSet, pass, expiresAt}`; 403 `WrongPin`, 400 `InvalidPin`, 429 `RateLimited` with `Retry-After`. Five attempts a minute per client, keyed by the Access email, else `CF-Connecting-IP`, kept in `pin_attempt`. |
| `POST /api/boards/{boardId}/pin` | `{"pin": "123456"}`, or `""` to remove | Allowed on an open board, or with a valid pass in `X-Stallion-Pass`. Setting answers `{pinSet: true, pass, expiresAt}` and closes every socket with 4003, so each reconnects through the lock; removing answers `{pinSet: false}`. |
| `GET /api/boards/{boardId}/pin` | | `{pinSet}` |

A pass is `base64url(JSON {boardId, exp, generation}).base64url(HMAC-SHA256(BOARD_PASS_SECRET, first part))`. `exp` is Unix seconds, 30 days after issue. A pass is valid for its board until it expires or the PIN changes. The client keeps it in `localStorage` under `stallion:pass:<boardId>`, sends it as `?pass=` on the socket, and drops it on `PassInvalid`. After a refused handshake `openBoard` probes the socket URL over HTTP; a 403 lock reason sets status `NeedsPin` and stops retrying until `join()` stores a pass and reconnects.
