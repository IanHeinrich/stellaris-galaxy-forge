#!/usr/bin/env bash
set -euo pipefail

# The docs-only list. The paths-ignore lists in .github/workflows/ci.yml and
# release.yml copy it, because a workflow filter cannot read a file.
is_doc() {
	case "$1" in
	*.md | docs/* | LICENSE | .github/pull_request_template.md | .gitattributes | .gitignore) return 0 ;;
	*) return 1 ;;
	esac
}

usage() {
	cat >&2 <<'USAGE'
usage: scripts/docs-only.sh < changed-paths

  Read changed paths, one per line, and exit 0 only when there is at
  least one and every one is on the docs-only list; otherwise name the
  first path that is not and exit 1.
USAGE
	exit 2
}

[ $# -eq 0 ] || usage

count=0
while IFS= read -r path || [ -n "$path" ]; do
	[ -n "$path" ] || continue
	count=$((count + 1))
	if ! is_doc "$path"; then
		printf 'not documentation: %s\n' "$path"
		exit 1
	fi
done
[ "$count" -gt 0 ] || { printf 'no changed paths\n'; exit 1; }
printf 'all %d changed paths are documentation\n' "$count"
