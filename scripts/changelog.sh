#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

readonly SEMVER='^[0-9]+\.[0-9]+\.[0-9]+$'
readonly ISO_DATE='^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
readonly UNRELEASED='## [Unreleased]'

usage() {
	cat >&2 <<'USAGE'
usage: scripts/changelog.sh <command>

  notes <x.y.z>                 print the body of that version's section
  release <x.y.z> [YYYY-MM-DD]  retitle Unreleased as that version and
                                open a fresh Unreleased above it
                                (date defaults to today, UTC)
USAGE
	exit 2
}

# Exits 3 when the heading is absent, so an empty section reads differently.
section_body() {
	awk -v want="## [$1]" '
		index($0, want) == 1 &&
			(length($0) == length(want) || substr($0, length(want) + 1, 1) == " ") {
			found = 1
			next
		}
		found && /^## / { exit }
		found { print }
		END { if (!found) exit 3 }
	' CHANGELOG.md
}

cmd_notes() {
	local v="$1" body status=0

	body="$(section_body "$v" | sed '/./,$!d')" || status=$?
	if [ "$status" -eq 3 ]; then
		printf 'CHANGELOG.md has no section for %s\n' "$v" >&2
		exit 1
	fi
	[ "$status" -eq 0 ] || exit "$status"

	if [ -z "${body//[[:space:]]/}" ]; then
		printf 'CHANGELOG.md section for %s is empty\n' "$v" >&2
		exit 1
	fi

	printf '%s\n' "$body"
}

cmd_release() {
	local v="$1" date="$2" tmp="CHANGELOG.md.$$"

	if ! grep -q "^## \[Unreleased\]$" CHANGELOG.md; then
		printf 'CHANGELOG.md has no %s heading\n' "$UNRELEASED" >&2
		exit 1
	fi
	if section_body "$v" >/dev/null; then
		printf 'CHANGELOG.md already has a section for %s\n' "$v" >&2
		exit 1
	fi

	awk -v heading="## [$v] - $date" -v unreleased="$UNRELEASED" '
		$0 == unreleased { print; print ""; print heading; next }
		{ print }
	' CHANGELOG.md >"$tmp" || { rm -f "$tmp"; exit 1; }
	mv "$tmp" CHANGELOG.md
	printf 'CHANGELOG.md: %s released %s\n' "$v" "$date"
}

[ $# -ge 1 ] || usage
command="$1"
shift

case "$command" in
notes)
	[ $# -eq 1 ] || usage
	[[ "$1" =~ $SEMVER ]] || usage
	cmd_notes "$1"
	;;
release)
	[ $# -ge 1 ] && [ $# -le 2 ] || usage
	[[ "$1" =~ $SEMVER ]] || usage
	date="${2:-$(date -u +%F)}"
	[[ "$date" =~ $ISO_DATE ]] || usage
	cmd_release "$1" "$date"
	;;
*) usage ;;
esac
