#!/bin/sh
# Exercise the release installer's checksum verification without downloads.
set -eu

repo_dir=$(CDPATH='' cd "$(dirname "$0")/.." && pwd)
shell=$(command -v sh)
shasum_path=$(command -v shasum)
export TEST_SHASUM_PATH="$shasum_path"
# Homebrew names GNU sha256sum gsha256sum; use it to match Linux CI.
sha256sum_path=$(command -v gsha256sum || command -v sha256sum)
test_dir=$(mktemp -d)
trap 'rm -rf "$test_dir"' 0

# Load the real functions without starting an installation.
sed '/^main$/d' "$repo_dir/install.sh" > "$test_dir/functions.sh"
mkdir "$test_dir/sha256sum-only" "$test_dir/both" "$test_dir/neither"
ln -s "$sha256sum_path" "$test_dir/sha256sum-only/sha256sum"
cat > "$test_dir/both/shasum" <<'SH'
#!/bin/sh
if [ "$#" -ne 4 ] || [ "$1" != -a ] || [ "$2" != 256 ] || [ "$3" != -c ]; then
  echo "unexpected shasum arguments: $*" >&2
  exit 1
fi
exec "$TEST_SHASUM_PATH" "$@"
SH
chmod +x "$test_dir/both/shasum"
# If the preferred tool fails, verification must fail rather than try this.
printf '#!/bin/sh\nprintf "unexpected fallback\\n" >&2\nexit 0\n' > "$test_dir/both/sha256sum"
chmod +x "$test_dir/both/sha256sum"

cd "$test_dir"
printf abc > archive.tar.gz
printf '%s  archive.tar.gz\n' \
  ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad \
  > archive.tar.gz.sha256

run_verification() {
  # These variables are expanded by the child shell.
  # shellcheck disable=SC2016
  PATH="$1" "$shell" -c '
    . "$1"
    verify_checksum archive.tar.gz.sha256
    printf "verified\n"
  ' sh "$test_dir/functions.sh"
}

run_installation() {
  # Replace downloads with corrupt local content and guard extraction.
  # shellcheck disable=SC2016
  PATH="$1" "$shell" -c '
    . "$1"
    fixture_dir=$2
    detect_target() { printf "fixture\n"; }
    get_version() { printf "v0.0.0\n"; }
    mktemp() { printf "%s\n" "$fixture_dir"; }
    rm() { :; }
    curl() {
      case "$4" in
        *.sha256)
          printf "%s  markspec-fixture.tar.gz\n" \
            ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad > "$4"
          ;;
        *) printf corrupt > "$4" ;;
      esac
    }
    tar() { printf "unexpected extraction\n" >&2; exit 88; }
    main
  ' sh "$test_dir/functions.sh" "$test_dir"
}

expect_success() {
  if ! run_verification "$2" > "$test_dir/output" 2>&1; then
    cat "$test_dir/output" >&2
    echo "FAIL: $1" >&2
    exit 1
  fi
  grep -qx verified "$test_dir/output"
  if grep -q 'unexpected fallback' "$test_dir/output"; then
    echo "FAIL: $1 used sha256sum instead of shasum" >&2
    exit 1
  fi
  echo "PASS: $1"
}

expect_failure() {
  if "${3:-run_verification}" "$2" > "$test_dir/output" 2>&1; then
    echo "FAIL: $1 accepted an unverified archive" >&2
    exit 1
  fi
  if grep -Eq 'verified|unexpected fallback|unexpected extraction' "$test_dir/output"; then
    echo "FAIL: $1 continued after verification failed" >&2
    exit 1
  fi
  echo "PASS: $1"
}

expect_success 'sha256sum alone verifies the archive' "$test_dir/sha256sum-only"
expect_success 'shasum takes precedence over sha256sum' "$test_dir/both"
expect_failure 'neither tool is available' "$test_dir/neither"
grep -q 'error:.*shasum.*sha256sum' "$test_dir/output"

printf corrupt > archive.tar.gz
expect_failure 'sha256sum rejects a corrupt archive' "$test_dir/sha256sum-only"
expect_failure 'shasum rejects corruption without falling back' "$test_dir/both"
printf abc > archive.tar.gz
printf 'invalid checksum\n' > archive.tar.gz.sha256
expect_failure 'sha256sum rejects a malformed checksum file' "$test_dir/sha256sum-only"
rm archive.tar.gz.sha256
expect_failure 'sha256sum rejects a missing checksum file' "$test_dir/sha256sum-only"

expect_failure 'installer stops before extraction on corruption' "$test_dir/sha256sum-only" run_installation
expect_failure 'installer stops before extraction without a checksum tool' "$test_dir/neither" run_installation
grep -q 'error:.*shasum.*sha256sum' "$test_dir/output"
