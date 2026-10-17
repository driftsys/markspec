#!/usr/bin/env bash
# Compile the markspec CLI into the Tauri externalBin location,
# src-tauri/binaries/markspec-<host target triple>, for release bundles.
set -euo pipefail

app_dir="$(cd "$(dirname "$0")/.." && pwd)"
repo_root="$(cd "$app_dir/../.." && pwd)"
triple="$(rustc -vV | sed -n 's/^host: //p')"
suffix=""
case "$triple" in
  *windows*) suffix=".exe" ;;
esac

output="$app_dir/src-tauri/binaries/markspec-$triple$suffix"

mkdir -p "$app_dir/src-tauri/binaries"
# deno compile refuses to overwrite a file it did not produce, such as the
# empty placeholder that lets cargo build without a real sidecar.
rm -f "$output"
cd "$repo_root"
deno run --allow-read --allow-write --allow-run --allow-env \
  scripts/compile_binary.ts \
  --output "$output"
