#!/bin/sh
set -eu

cd "$(dirname "$0")/.."

worker_build_version=0.8.7

cargo_bin="${CARGO_HOME:-$HOME/.cargo}/bin"
PATH="$cargo_bin:$PATH"
export PATH

if ! command -v rustup >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs |
    sh -s -- -y --profile minimal --default-toolchain none --no-modify-path
fi

rustup toolchain install

installed_version=$(worker-build --version 2>/dev/null || true)
case "$installed_version" in
  *"$worker_build_version") ;;
  *)
    # No prebuilt Linux binary is published, so compile it unoptimised except for the archive crates it unpacks downloads with.
    cargo install --locked --force --debug \
      --config 'profile.dev.package.miniz_oxide.opt-level=3' \
      --config 'profile.dev.package.adler2.opt-level=3' \
      --config 'profile.dev.package.crc32fast.opt-level=3' \
      --config 'profile.dev.package.flate2.opt-level=3' \
      --config 'profile.dev.package.tar.opt-level=3' \
      "worker-build@$worker_build_version"
    ;;
esac

cd crates/server
exec worker-build --release
