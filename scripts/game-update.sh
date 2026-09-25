#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

readonly DEFAULT_AGAINST="testdata/2201.03.25.sav"

usage() {
	cat >&2 <<'USAGE'
usage: scripts/game-update.sh <save> [--against <sav>]

  Run the checks a game update needs on a save from the new version:
  the install parses, the save loads, validates, round-trips byte for
  byte and exports, its key shape is diffed against the sample save
  (or the one --against names), and the workspace tests pass with the
  install required. One PASS/FAIL line per step; exits 1 if any failed.
USAGE
	exit 2
}

save=""
against="$DEFAULT_AGAINST"
while [ $# -gt 0 ]; do
	case "$1" in
	--against)
		[ $# -ge 2 ] || usage
		against="$2"
		shift 2
		;;
	-*) usage ;;
	*)
		[ -z "$save" ] || usage
		save="$1"
		shift
		;;
	esac
done
[ -n "$save" ] || usage
[ -f "$save" ] || { printf 'no such save: %s\n' "$save" >&2; exit 2; }
[ -f "$against" ] || { printf 'no such save: %s\n' "$against" >&2; exit 2; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

failed=0
results=()

# On success the log lines matching the pattern are shown, on failure its tail.
step() {
	local name="$1" pattern="$2" log="$tmp/step.log"
	shift 2
	if "$@" >"$log" 2>&1; then
		results+=("PASS  $name")
		printf 'PASS  %s\n' "$name"
		[ -z "$pattern" ] || grep -E "$pattern" "$log" | sed 's/^/      /' || true
	else
		failed=1
		results+=("FAIL  $name")
		printf 'FAIL  %s\n' "$name"
		tail -n 20 "$log" | sed 's/^/      /'
	fi
}

export_validates() {
	local scenario="$tmp/exported.txt"
	"$sgf" export-scenario "$save" "$scenario" && "$sgf" validate "$scenario"
}

workspace_tests() {
	SGF_REQUIRE_INSTALL=1 cargo test --workspace
}

step "build sgf" "" cargo build --release -q -p sgf-cli
sgf="target/release/sgf"
[ -x "$sgf" ] || sgf="target/release/sgf.exe"
[ -x "$sgf" ] || { printf 'no sgf binary under target/release\n' >&2; exit 1; }

step "gamedata parses" "^version:" "$sgf" gamedata
step "save loads" "^version:" "$sgf" inspect "$save"
step "save validates" "^validate:" "$sgf" validate "$save"
step "save round-trips" "byte-identical" "$sgf" roundtrip "$save" "$tmp/roundtrip.sav" --check
step "save exports" "^validate:" export_validates

printf 'INFO  shape of %s against %s\n' "$save" "$against"
"$sgf" shape "$save" --diff "$against" | sed 's/^/      /'

step "workspace tests" "" workspace_tests

printf '\nsummary\n'
printf '  %s\n' "${results[@]}"
exit "$failed"
