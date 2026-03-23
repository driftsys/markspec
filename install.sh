#!/bin/bash
# Install markspec — downloads the latest release binary for the current platform.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/driftsys/markspec/main/install.sh | bash
#
# Environment variables:
#   MARKSPEC_INSTALL_DIR  Installation directory (default: $HOME/.local/bin)
#   MARKSPEC_VERSION      Version to install (default: latest)

set -euo pipefail

REPO="driftsys/markspec"
INSTALL_DIR="${MARKSPEC_INSTALL_DIR:-$HOME/.local/bin}"
BINARY="markspec"

detect_target() {
  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"

  case "$os" in
    Linux)
      case "$arch" in
        x86_64) echo "x86_64-unknown-linux-gnu" ;;
        *) echo "error: unsupported architecture: $arch" >&2; exit 1 ;;
      esac
      ;;
    Darwin)
      case "$arch" in
        x86_64) echo "x86_64-apple-darwin" ;;
        arm64)  echo "aarch64-apple-darwin" ;;
        *) echo "error: unsupported architecture: $arch" >&2; exit 1 ;;
      esac
      ;;
    *) echo "error: unsupported OS: $os" >&2; exit 1 ;;
  esac
}

get_version() {
  if [ -n "${MARKSPEC_VERSION:-}" ]; then
    echo "$MARKSPEC_VERSION"
  else
    gh release view --repo "$REPO" --json tagName -q .tagName 2>/dev/null \
      || curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
           | grep '"tag_name"' | head -1 | cut -d'"' -f4
  fi
}

main() {
  local target version tarball url checksum_url
  target="$(detect_target)"
  version="$(get_version)"
  tarball="markspec-${target}.tar.gz"
  url="https://github.com/$REPO/releases/download/$version/$tarball"
  checksum_url="${url}.sha256"

  echo "Installing markspec $version ($target)" >&2
  echo "  to: $INSTALL_DIR" >&2

  local tmpdir
  tmpdir="$(mktemp -d)"
  trap 'rm -rf "$tmpdir"' EXIT

  curl -fsSL "$url" -o "$tmpdir/$tarball"
  curl -fsSL "$checksum_url" -o "$tmpdir/$tarball.sha256"

  echo "Verifying checksum..." >&2
  (cd "$tmpdir" && shasum -a 256 -c "$tarball.sha256")

  tar xzf "$tmpdir/$tarball" -C "$tmpdir"

  mkdir -p "$INSTALL_DIR"
  mv "$tmpdir/$BINARY" "$INSTALL_DIR/$BINARY"
  chmod +x "$INSTALL_DIR/$BINARY"

  echo "Installed $INSTALL_DIR/$BINARY" >&2

  if ! echo "$PATH" | tr ':' '\n' | grep -qx "$INSTALL_DIR"; then
    echo "" >&2
    echo "Add to your PATH:" >&2
    echo "  export PATH=\"$INSTALL_DIR:\$PATH\"" >&2
  fi
}

main
