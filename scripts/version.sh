#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

readonly MEMBERS="sgf-core sgf-gamedata sgf-cli sgf-app"
readonly SEMVER='^[0-9]+\.[0-9]+\.[0-9]+$'

usage() {
	cat >&2 <<'USAGE'
usage: scripts/version.sh <command>

  get              print the version recorded in VERSION
  set <x.y.z>      write the version to VERSION and every manifest
  bump patch|minor|major
                   raise the VERSION number, then behave as set
  check            exit 0 when every manifest agrees with VERSION,
                   otherwise list the disagreements and exit 1
USAGE
	exit 2
}

version_file() {
	tr -d '[:space:]' <VERSION
}

cargo_toml_version() {
	awk -F'"' '/^version = "/ { print $2; exit }' Cargo.toml
}

json_version() {
	node -p "require('./$1').version"
}

lock_version() {
	awk -v want="$1" -F'"' '
		/^\[\[package\]\]/ { name = ""; next }
		/^name = "/ { name = $2; next }
		/^version = "/ { if (name == want) { print $2; exit } }
	' Cargo.lock
}

set_cargo_version() {
	local v="$1" tmp="Cargo.toml.$$"
	awk -v v="$v" '
		!replaced && /^version = "/ {
			sub(/^version = ".*"/, "version = \"" v "\"")
			replaced = 1
		}
		{ print }
	' Cargo.toml >"$tmp" || { rm -f "$tmp"; exit 1; }
	mv "$tmp" Cargo.toml
}

report_if_differs() {
	local label="$1" actual="$2" want="$3"
	[ "$actual" = "$want" ] && return 0
	printf '%s has %s, VERSION has %s\n' "$label" "${actual:-<none>}" "$want" >&2
	return 1
}

cmd_get() {
	printf '%s\n' "$(version_file)"
}

cmd_set() {
	local v="$1"
	[[ "$v" =~ $SEMVER ]] || usage

	printf '%s\n' "$v" >VERSION
	set_cargo_version "$v"
	(cd app && npm version "$v" --no-git-tag-version --allow-same-version >/dev/null)
	cargo update --workspace

	printf '%s\n' "$v"
}

cmd_bump() {
	local part="$1" current major minor patch
	current="$(version_file)"
	[[ "$current" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]] || {
		printf 'VERSION is not x.y.z: %s\n' "$current" >&2
		exit 1
	}
	major="${BASH_REMATCH[1]}"
	minor="${BASH_REMATCH[2]}"
	patch="${BASH_REMATCH[3]}"

	case "$part" in
	patch) patch=$((patch + 1)) ;;
	minor)
		minor=$((minor + 1))
		patch=0
		;;
	major)
		major=$((major + 1))
		minor=0
		patch=0
		;;
	*) usage ;;
	esac

	cmd_set "$major.$minor.$patch"
}

cmd_check() {
	local want member status=0
	want="$(version_file)"

	report_if_differs "Cargo.toml" "$(cargo_toml_version)" "$want" || status=1
	report_if_differs "app/package.json" "$(json_version app/package.json)" "$want" || status=1
	report_if_differs "app/package-lock.json" "$(json_version app/package-lock.json)" "$want" || status=1
	for member in $MEMBERS; do
		report_if_differs "Cargo.lock ($member)" "$(lock_version "$member")" "$want" || status=1
	done

	exit "$status"
}

[ $# -ge 1 ] || usage
command="$1"
shift

case "$command" in
get) [ $# -eq 0 ] || usage; cmd_get ;;
set) [ $# -eq 1 ] || usage; cmd_set "$1" ;;
bump) [ $# -eq 1 ] || usage; cmd_bump "$1" ;;
check) [ $# -eq 0 ] || usage; cmd_check ;;
*) usage ;;
esac
