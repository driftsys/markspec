#!/usr/bin/env bash
# Check that a compiled markspec binary can serve the MarkDesk API.
#
# Starts `<binary> desk --serve --port 0 --root <root> --exit-on-stdin-eof`
# with stdin connected to a pipe, requires a handshake line with
# "apiVersion":3 on stdout within 30 s, then closes stdin and requires the
# process to exit with code 0 within 10 s.
#
# Usage: scripts/check_desk_binary.sh [binary] [product-root]
set -euo pipefail

binary="${1:-dist/markspec}"
root="${2:-tests/fixtures/desk-project}"
handshake_timeout=30
exit_timeout=10

work="$(mktemp -d)"
pid=""
cleanup() {
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then kill "$pid" || true; fi
  rm -rf "$work"
}
trap cleanup EXIT

mkfifo "$work/stdin"
"$binary" desk --serve --port 0 --root "$root" --exit-on-stdin-eof \
  <"$work/stdin" >"$work/stdout" 2>"$work/stderr" &
pid=$!
# Keep the write end of the stdin pipe open until the check closes it.
exec 3>"$work/stdin"

waited=0
until grep -q '"apiVersion":3' "$work/stdout" 2>/dev/null; do
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "error: markspec desk exited before its handshake" >&2
    cat "$work/stderr" >&2
    exit 1
  fi
  if [ "$waited" -ge $((handshake_timeout * 10)) ]; then
    echo "error: no handshake within ${handshake_timeout} s" >&2
    cat "$work/stderr" >&2
    exit 1
  fi
  sleep 0.1
  waited=$((waited + 1))
done
echo "handshake: $(head -n 1 "$work/stdout")"

# Close stdin: the server must stop on its own.
exec 3>&-
waited=0
while kill -0 "$pid" 2>/dev/null; do
  if [ "$waited" -ge $((exit_timeout * 10)) ]; then
    echo "error: markspec desk still running ${exit_timeout} s after stdin closed" >&2
    exit 1
  fi
  sleep 0.1
  waited=$((waited + 1))
done
status=0
wait "$pid" || status=$?
pid=""
if [ "$status" -ne 0 ]; then
  echo "error: markspec desk exited with code $status after stdin closed" >&2
  cat "$work/stderr" >&2
  exit 1
fi
echo "markspec desk exited after stdin closed"
