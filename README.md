# Stallion

Stallion is an infinite-zoom drawing board built for tablets. Two or more people can draw on one board at the same time. A Rust Cloudflare Worker syncs each board live.

The live app runs at https://stallion.matthijs-f49.workers.dev. Sign-in is a one-time code sent by email. A board is open to anyone with its link until someone sets a PIN.

## Run it locally

You need Node 24 and the Rust toolchain that `rust-toolchain.toml` names.

```sh
npm ci
npm run dev                                           # client alone; strokes stay in this browser
VITE_SYNC_URL=ws://localhost:8787 npm run serve:sync  # client and Worker together on port 8787
npm test
npm run test:rust
```

Locked boards need a `BOARD_PASS_SECRET` in a gitignored `.dev.vars`. Without it, setting a PIN answers 500.

## More

- `docs/ARCHITECTURE.md` explains how the pieces fit, with diagrams and a map of the code.
- `AGENTS.md` holds the contributor rules, the scripts and the wire protocol.

MIT licence, see `LICENSE`.
