#!/usr/bin/env bash
set -uo pipefail

# Tests the selection in scripts/test-shard.sh on a made-up list of names.

script="$(cd "$(dirname "$0")" && pwd)/test-shard.sh"
root="$(mktemp -d)"
trap 'rm -rf "$root"' EXIT

failures=0
fail() {
	printf 'FAIL: %s\n' "$1"
	failures=$((failures + 1))
}
pass() { printf 'ok: %s\n' "$1"; }

n=0
: >"$root/names"
for module in alpha beta gamma delta; do
	i=0
	while [ "$i" -lt 25 ]; do
		printf '%s::test_%03d\n' "$module" "$i" >>"$root/names"
		i=$((i + 1))
		n=$((n + 1))
	done
done
printf 'zeta::only\n' >>"$root/names"
n=$((n + 1))
LC_ALL=C sort "$root/names" >"$root/sorted"

for count in 1 2 3 4; do
	: >"$root/union"
	min=$n
	max=0
	index=1
	while [ "$index" -le "$count" ]; do
		bash "$script" --select "$index" "$count" <"$root/names" >"$root/shard.$index"
		size=$(wc -l <"$root/shard.$index" | tr -d ' ')
		[ "$size" -lt "$min" ] && min=$size
		[ "$size" -gt "$max" ] && max=$size
		cat "$root/shard.$index" >>"$root/union"
		index=$((index + 1))
	done
	if [ "$(LC_ALL=C sort "$root/union" | uniq -d | wc -l | tr -d ' ')" -eq 0 ]; then
		pass "count $count: shards are disjoint"
	else
		fail "count $count: shards are disjoint"
	fi
	if [ "$(LC_ALL=C sort "$root/union")" = "$(cat "$root/sorted")" ]; then
		pass "count $count: union is the full list"
	else
		fail "count $count: union is the full list"
	fi
	if [ $((max - min)) -le 1 ]; then
		pass "count $count: sizes differ by at most one"
	else
		fail "count $count: sizes differ by at most one"
	fi
done

if [ "$(bash "$script" --select 1 3 <"$root/names" | head -n 1)" = "alpha::test_000" ]; then
	pass "shard 1 starts at the first sorted name"
else
	fail "shard 1 starts at the first sorted name"
fi

if printf 'CRLF::a\r\nCRLF::b\r\n' | bash "$script" --select 1 1 | grep -q "$(printf '\r')"; then
	fail "carriage returns are stripped"
else
	pass "carriage returns are stripped"
fi

for args in "0 3" "4 3" "1 0" "x 3"; do
	# shellcheck disable=SC2086
	if bash "$script" --select $args <"$root/names" >/dev/null 2>&1; then
		fail "'$args' is refused"
	else
		pass "'$args' is refused"
	fi
done

if [ "$failures" -ne 0 ]; then
	printf '%d failed\n' "$failures"
	exit 1
fi
printf 'all passed\n'
