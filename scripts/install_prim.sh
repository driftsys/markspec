#!/usr/bin/env bash
# Install the pinned prim release (formatter for Markdown, JSON, YAML, TOML).
# Used by ./bootstrap and CI. Verifies the SHA-256 published with the release.
set -euo pipefail

# Exact pin. prim and `markspec fmt` (embedded dprint-markdown, ADR-029) both
# format Markdown, so a prim upgrade can make them disagree on the same file.
# When changing this version, run `prim fmt --check .` and `markspec check`
# and confirm that neither reports new drift (MSL-F010).
PRIM_VERSION="0.9.1"
INSTALL_DIR="${PRIM_INSTALL_DIR:-$HOME/.local/bin}"

die() { printf 'error: %s\n' "$1" >&2; exit 1; }

if command -v prim >/dev/null 2>&1 \
  && [ "$(prim --version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')" = "$PRIM_VERSION" ]; then
  exit 0
fi

case "$(uname -s)/$(uname -m)" in
  Linux/x86_64)  target="x86_64-unknown-linux-musl" ;;
  Linux/aarch64) target="aarch64-unknown-linux-musl" ;;
  Darwin/x86_64) target="x86_64-apple-darwin" ;;
  Darwin/arm64)  target="aarch64-apple-darwin" ;;
  *) die "unsupported platform: $(uname -s)/$(uname -m)" ;;
esac

base="prim-$target"
url="https://github.com/driftsys/prim/releases/download/v$PRIM_VERSION/$base.tar.gz"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

curl -sSfL "$url" -o "$tmp_dir/$base.tar.gz" || die "download failed: $url"
curl -sSfL "$url.sha256" -o "$tmp_dir/$base.tar.gz.sha256" \
  || die "checksum download failed"
(
  cd "$tmp_dir"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum -c "$base.tar.gz.sha256"
  else
    shasum -a 256 -c "$base.tar.gz.sha256"
  fi
) || die "checksum verification failed"

tar -xzf "$tmp_dir/$base.tar.gz" -C "$tmp_dir"
mkdir -p "$INSTALL_DIR"
mv "$tmp_dir/prim" "$INSTALL_DIR/prim"
chmod +x "$INSTALL_DIR/prim"
printf 'installed prim %s to %s/prim\n' "$PRIM_VERSION" "$INSTALL_DIR"
