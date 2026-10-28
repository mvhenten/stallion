#!/bin/sh
set -eu

cd "$(dirname "$0")/.."

worker_build_version=0.8.7
worker_build_sha256=70585b85abee6c772de2a43f9c5fa374d537b3174c43f424ae835b9158bd439e
worker_build_url="https://github.com/mvhenten/stallion/releases/download/worker-build-$worker_build_version/worker-build-$worker_build_version-x86_64-unknown-linux-gnu"

cargo_bin="${CARGO_HOME:-$HOME/.cargo}/bin"
PATH="$cargo_bin:$PATH"
export PATH

if ! command -v rustup >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs |
    sh -s -- -y --profile minimal --default-toolchain none --no-modify-path
fi

rustup toolchain install

install_worker_build() {
  download="$cargo_bin/.worker-build.download"
  mkdir -p "$cargo_bin"
  if ! curl --proto '=https' --tlsv1.2 -fsSL -o "$download" "$worker_build_url"; then
    rm -f "$download"
    echo "build-worker: could not download worker-build $worker_build_version, compiling it" >&2
    cargo install --locked --force "worker-build@$worker_build_version"
    return
  fi
  if ! printf '%s  %s\n' "$worker_build_sha256" "$download" | sha256sum -c --status -; then
    rm -f "$download"
    echo "build-worker: worker-build from $worker_build_url does not match the pinned sha256" >&2
    exit 1
  fi
  chmod +x "$download"
  mv "$download" "$cargo_bin/worker-build"
}

installed_version=$(worker-build --version 2>/dev/null || true)
case "$installed_version" in
  *"$worker_build_version") ;;
  *) install_worker_build ;;
esac

cd crates/server
exec worker-build --release
