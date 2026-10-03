#!/usr/bin/env bash
set -uo pipefail

# Tests scripts/changelog.sh in throwaway repos built under a temp folder.

script="$(cd "$(dirname "$0")" && pwd)/changelog.sh"
root="$(mktemp -d)"
trap 'rm -rf "$root"' EXIT

failures=0
fail() {
	printf 'FAIL: %s\n' "$1"
	failures=$((failures + 1))
}
pass() { printf 'ok: %s\n' "$1"; }

# A fresh repo with the script, a changelog holding one Unreleased entry and
# a released section, and an initial commit on main.
new_repo() {
	repo="$root/$1"
	rm -rf "$repo"
	mkdir -p "$repo/scripts" "$repo/changelog.d"
	cp "$script" "$repo/scripts/changelog.sh"
	cat >"$repo/CHANGELOG.md" <<'CHANGELOG'
# Changelog

## [Unreleased]

### Fixed

- Fix an old thing already in Unreleased.

## [1.0.0] - 2026-01-01

### Added

- First release.
CHANGELOG
	printf '# Fragments\n' >"$repo/changelog.d/README.md"
	(
		cd "$repo"
		git init -q -b main
		git config user.email test@example.com
		git config user.name test
		git config commit.gpgsign false
		git config core.autocrlf false
		git add -A
		git commit -q -m base
	)
}

write_sample_fragments() {
	cat >"$repo/changelog.d/b-system-heights.md" <<'FRAGMENT'
### Added

- Add a height to systems.
  - Nested detail.
  - Another detail
    that wraps.

### Changed

- Change how heights show.
FRAGMENT
	cat >"$repo/changelog.d/a-wrapped.md" <<'FRAGMENT'
### Fixed

- Fix a thing that wraps onto
  a second line.

### Added

- Add the wrapped thing.

### Tweaked

- Something under a heading of its own.
FRAGMENT
}

expected_unreleased() {
	cat <<'EXPECTED'
# Changelog

## [Unreleased]

### Added

- Add the wrapped thing.
- Add a height to systems.
  - Nested detail.
  - Another detail
    that wraps.

### Changed

- Change how heights show.

### Fixed

- Fix an old thing already in Unreleased.
- Fix a thing that wraps onto
  a second line.

### Tweaked

- Something under a heading of its own.

## [1.0.0] - 2026-01-01

### Added

- First release.
EXPECTED
}

run() { (cd "$repo" && bash scripts/changelog.sh "$@") >"$root/out" 2>"$root/err"; }

expect_file() {
	local name="$1" want="$2"
	if diff -u <(printf '%s\n' "$want") "$repo/CHANGELOG.md" >"$root/diff"; then
		pass "$name"
	else
		fail "$name"
		cat "$root/diff"
	fi
}

# collect: grouping, order, overlap, wrapped and nested bullets, twice in a row
new_repo collect
write_sample_fragments
if run collect; then
	expect_file "collect folds fragments into Unreleased" "$(expected_unreleased)"
else
	fail "collect exits 0"
	cat "$root/err"
fi
if [ ! -e "$repo/changelog.d/a-wrapped.md" ] && [ -e "$repo/changelog.d/README.md" ]; then
	pass "collect deletes fragments and keeps the README"
else
	fail "collect deletes fragments and keeps the README"
fi
cp "$repo/CHANGELOG.md" "$root/once"
run collect
if cmp -s "$root/once" "$repo/CHANGELOG.md"; then
	pass "collect twice changes nothing"
else
	fail "collect twice changes nothing"
fi

# release folds what is left, then retitles
new_repo release
write_sample_fragments
if run release 2.0.0 2026-02-02; then
	want="$(expected_unreleased | sed 's/^## \[Unreleased\]$/## [Unreleased]\n\n## [2.0.0] - 2026-02-02/')"
	expect_file "release folds fragments and retitles" "$want"
else
	fail "release exits 0"
	cat "$root/err"
fi
if run notes 2.0.0; then
	pass "notes reads the released section"
else
	fail "notes reads the released section"
fi

# release after collect keeps a hand-rewritten Unreleased
new_repo rewrite
write_sample_fragments
run collect
sed -i 's/^- Add the wrapped thing\.$/- Add the thing, rewritten by hand./' "$repo/CHANGELOG.md"
run release 2.0.0 2026-02-02
if grep -q '^- Add the thing, rewritten by hand\.$' "$repo/CHANGELOG.md" &&
	grep -q '^## \[2.0.0\] - 2026-02-02$' "$repo/CHANGELOG.md"; then
	pass "release keeps a rewritten Unreleased"
else
	fail "release keeps a rewritten Unreleased"
fi

# release with nothing at all fails
new_repo empty
printf '# Changelog\n\n## [Unreleased]\n\n## [1.0.0] - 2026-01-01\n\n### Added\n\n- First release.\n' >"$repo/CHANGELOG.md"
if run release 2.0.0 2026-02-02; then
	fail "release with no entries fails"
elif grep -q 'Nothing to release' "$root/err"; then
	pass "release with no entries fails"
else
	fail "release with no entries fails"
fi

# bad fragments stop collect and release and change nothing
bad_case() {
	local name="$1" content="$2" message="$3" cmd
	for cmd in "collect" "release 2.0.0 2026-02-02"; do
		new_repo bad
		write_sample_fragments
		printf '%b' "$content" >"$repo/changelog.d/c-bad.md"
		cp "$repo/CHANGELOG.md" "$root/before"
		# shellcheck disable=SC2086
		if run $cmd; then
			fail "$name: $cmd fails"
		elif grep -q "$message" "$root/err" && grep -q 'c-bad.md' "$root/err"; then
			if cmp -s "$root/before" "$repo/CHANGELOG.md" && [ -e "$repo/changelog.d/a-wrapped.md" ]; then
				pass "$name: $cmd fails and changes nothing"
			else
				fail "$name: $cmd changed files"
			fi
		else
			fail "$name: $cmd message"
			cat "$root/err"
		fi
	done
}
bad_case "bullet before heading" '- Orphan bullet.\n### Added\n\n- Fine.\n' 'bullet before any ### heading'
bad_case "tab" '### Added\n\n- Fine\n\twith a tab.\n' 'tab character'
bad_case "second nested level" '### Added\n\n- Fine\n  - Nested\n    - Too deep\n' 'one nested level'
bad_case "stray prose" '### Added\n\n- Fine\nProse at column 0.\n' 'not a ### heading'
bad_case "no entries" '### Added\n' 'no entries'

# check
new_repo check
git_in() { (cd "$repo" && git "$@") >/dev/null 2>&1; }
check() { run check main; }

git_in checkout -q -b readme-only
printf 'more\n' >>"$repo/changelog.d/README.md"
git_in commit -qam readme
if check; then fail "check fails when only the README changed"; else pass "check fails when only the README changed"; fi

git_in checkout -q -b good main
printf '### Added\n\n- Add a thing.\n' >"$repo/changelog.d/a-thing.md"
git_in add -A
git_in commit -qm fragment
if check; then pass "check passes for a new fragment"; else
	fail "check passes for a new fragment"
	cat "$root/err"
fi

git_in checkout -q -b bad main
printf -- '- Orphan.\n' >"$repo/changelog.d/a-thing.md"
git_in add -A
git_in commit -qm badfragment
if check; then
	fail "check fails for a bad fragment"
elif grep -q 'bullet before any ### heading' "$root/err"; then
	pass "check fails for a bad fragment"
else
	fail "check fails for a bad fragment"
fi

git_in checkout -q -b direct main
printf '\n' >>"$repo/CHANGELOG.md"
git_in commit -qam direct
if check; then pass "check passes when CHANGELOG.md changed"; else fail "check passes when CHANGELOG.md changed"; fi

git_in checkout -q -b none main
printf 'x\n' >"$repo/other.txt"
git_in add -A
git_in commit -qm other
if check; then fail "check fails with no entry"; else pass "check fails with no entry"; fi

if [ "$failures" -ne 0 ]; then
	printf '%d failed\n' "$failures"
	exit 1
fi
printf 'all passed\n'
