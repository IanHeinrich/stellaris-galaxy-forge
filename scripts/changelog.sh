#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

readonly SEMVER='^[0-9]+\.[0-9]+\.[0-9]+$'
readonly ISO_DATE='^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
readonly UNRELEASED='## [Unreleased]'
readonly FRAGMENT_DIR='changelog.d'
readonly KIND_ORDER='Added Changed Deprecated Removed Fixed Security'

usage() {
	cat >&2 <<'USAGE'
usage: scripts/changelog.sh <command>

  notes <x.y.z>                 print the body of that version's section
  collect                       fold every changelog.d/*.md fragment into
                                Unreleased, grouped by kind, and delete them
  release <x.y.z> [YYYY-MM-DD]  collect any fragments left, then retitle
                                Unreleased as that version and open a fresh
                                Unreleased above it (date defaults to today, UTC)
  check <base-ref>              pass when the diff against the base adds or
                                changes a fragment or CHANGELOG.md, and
                                validate the fragments it adds or changes
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

# Reads entries on stdin and writes one "kind<TAB>bullet" line per top-level
# bullet, the bullet's own lines joined by a unit separator (0x1f). Reports
# the first line the changelog subset does not allow. With require set, a
# source without a bullet is an error too.
parse_entries() {
	local label="$1" require="$2"

	awk -v label="$label" -v require="$require" '
		function fail(msg) {
			printf "%s:%d: %s\n", label, NR, msg > "/dev/stderr"
			failed = 1
			exit 1
		}
		function flush() {
			if (bullet != "") {
				print kind "\t" bullet
				count++
				bullet = ""
			}
		}
		/\r/ { fail("carriage return: the file must use LF line endings") }
		/\t/ { fail("tab character: indent with spaces") }
		/^[ ]*$/ { next }
		/^### / {
			name = substr($0, 5)
			sub(/[ ]+$/, "", name)
			if (name == "") fail("empty ### heading")
			flush()
			kind = name
			next
		}
		/^#/ { fail("only ### headings are allowed here: " $0) }
		/^- / {
			if (kind == "") fail("bullet before any ### heading")
			flush()
			bullet = $0
			next
		}
		/^-/ { fail("a bullet starts with \"- \": " $0) }
		/^  - / {
			if (bullet == "") fail("nested bullet with no bullet above it")
			bullet = bullet SEP $0
			next
		}
		/^   +- / { fail("only one nested level of bullets is allowed") }
		/^  / {
			if (bullet == "") fail("indented line with no bullet above it")
			bullet = bullet SEP $0
			next
		}
		{ fail("not a ### heading, a \"- \" bullet or an indented continuation: " $0) }
		END {
			if (failed) exit 1
			flush()
			if (require && count == 0) {
				printf "%s: no entries; add a ### heading with a \"- \" bullet under it\n", label > "/dev/stderr"
				exit 1
			}
		}
	' SEP=$'\037'
}

# Reads "kind<TAB>bullet" lines and writes the section's headings and
# bullets, kinds in Keep a Changelog order first, then any others in the
# order first seen.
group_entries() {
	awk -F '\t' -v order="$KIND_ORDER" '
		function emit(k,   j, text) {
			print "### " k
			print ""
			for (j = 1; j <= count[k]; j++) {
				text = items[k, j]
				gsub(SEP, "\n", text)
				print text
			}
			print ""
			done[k] = 1
		}
		{
			k = $1
			if (!(k in count)) kinds[++kindCount] = k
			count[k]++
			items[k, count[k]] = $2
		}
		END {
			n = split(order, ranked, " ")
			for (i = 1; i <= n; i++) if (ranked[i] in count) emit(ranked[i])
			for (i = 1; i <= kindCount; i++) if (!(kinds[i] in done)) emit(kinds[i])
		}
	' SEP=$'\037'
}

fragments() {
	local f
	shopt -s nullglob
	for f in "$FRAGMENT_DIR"/*.md; do
		[ "$(basename "$f")" = README.md ] || printf '%s\n' "$f"
	done
}

require_unreleased() {
	if ! grep -q "^## \[Unreleased\]$" CHANGELOG.md; then
		printf 'CHANGELOG.md has no %s heading\n' "$UNRELEASED" >&2
		exit 1
	fi
}

# Folds Unreleased and every fragment into the Unreleased section, grouped
# by kind, then deletes the fragments. Does nothing when no fragment is left.
fold_fragments() {
	local work tmp="CHANGELOG.md.$$" ok=1 f
	local -a files=()

	while IFS= read -r f; do
		files+=("$f")
	done < <(LC_ALL=C fragments)
	if [ "${#files[@]}" -eq 0 ]; then
		printf 'No fragments in %s/ to fold.\n' "$FRAGMENT_DIR"
		return 0
	fi

	work="$(mktemp -d)"
	section_body Unreleased | parse_entries "CHANGELOG.md [Unreleased]" 0 >"$work/entries" || ok=0
	for f in "${files[@]}"; do
		parse_entries "$f" 1 <"$f" >>"$work/entries" || ok=0
	done
	if [ "$ok" -eq 0 ]; then
		rm -rf "$work"
		exit 1
	fi

	group_entries <"$work/entries" >"$work/section"

	awk -v unreleased="$UNRELEASED" -v section="$work/section" '
		$0 == unreleased {
			print
			print ""
			while ((getline line < section) > 0) print line
			skipping = 1
			next
		}
		skipping && /^## / { skipping = 0 }
		!skipping { print }
	' CHANGELOG.md >"$tmp" || { rm -f "$tmp"; rm -rf "$work"; exit 1; }
	mv "$tmp" CHANGELOG.md

	for f in "${files[@]}"; do
		git rm -q -f -- "$f" 2>/dev/null || rm -f -- "$f"
	done

	printf 'CHANGELOG.md: folded %d fragments into %s\n' "${#files[@]}" "$UNRELEASED"
	for f in "${files[@]}"; do
		printf '  folded and removed %s\n' "$f"
	done
	rm -rf "$work"
}

cmd_collect() {
	require_unreleased
	fold_fragments
}

cmd_release() {
	local v="$1" date="$2" tmp="CHANGELOG.md.$$"

	require_unreleased
	if section_body "$v" >/dev/null; then
		printf 'CHANGELOG.md already has a section for %s\n' "$v" >&2
		exit 1
	fi

	fold_fragments

	if [ -z "$(section_body Unreleased | tr -d '[:space:]')" ]; then
		printf 'Nothing to release: Unreleased and %s/ hold no entries\n' "$FRAGMENT_DIR" >&2
		exit 1
	fi

	awk -v heading="## [$v] - $date" -v unreleased="$UNRELEASED" '
		$0 == unreleased { print; print ""; print heading; next }
		{ print }
	' CHANGELOG.md >"$tmp" || { rm -f "$tmp"; exit 1; }
	mv "$tmp" CHANGELOG.md
	printf 'CHANGELOG.md: %s released %s\n' "$v" "$date"
}

cmd_check() {
	local base="$1" path found=0 ok=1

	git rev-parse --verify --quiet "$base^{commit}" >/dev/null || {
		printf 'unknown base ref: %s\n' "$base" >&2
		exit 1
	}

	while IFS= read -r path; do
		[ -n "$path" ] || continue
		case "$path" in
		CHANGELOG.md) found=1 ;;
		"$FRAGMENT_DIR"/README.md) ;;
		"$FRAGMENT_DIR"/*/*) ;;
		"$FRAGMENT_DIR"/*.md)
			found=1
			parse_entries "$path" 1 <"$path" >/dev/null || ok=0
			;;
		esac
	done < <(git -c core.quotepath=off diff --name-only --diff-filter=ACMR "$base...HEAD" -- CHANGELOG.md "$FRAGMENT_DIR")

	[ "$ok" -eq 1 ] || exit 1
	if [ "$found" -eq 0 ]; then
		printf 'No changelog entry: add a file under %s/ or label the PR skip-changelog.\n' "$FRAGMENT_DIR" >&2
		exit 1
	fi
	printf 'Changelog entry found.\n'
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
collect)
	[ $# -eq 0 ] || usage
	cmd_collect
	;;
check)
	[ $# -eq 1 ] || usage
	cmd_check "$1"
	;;
*) usage ;;
esac
