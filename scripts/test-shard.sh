#!/usr/bin/env bash
set -uo pipefail

# Runs one shard of sgf-core's integration tests, so CI can split the binary across jobs.
#   test-shard.sh <index> <count>           run shard <index> of <count> (index 1..count)
#   test-shard.sh --select <index> <count>  read test names from stdin, print the shard's names

batch_size=150

usage() {
	printf 'usage: test-shard.sh [--select] <index> <count>\n' >&2
	exit 2
}

check_args() {
	case "$1$2" in
	*[!0-9]* | "") usage ;;
	esac
	if [ "$2" -lt 1 ] || [ "$1" -lt 1 ] || [ "$1" -gt "$2" ]; then
		printf 'index must be between 1 and count\n' >&2
		exit 2
	fi
}

# Sorted names, every count-th one from index, so each module's tests spread across the shards.
select_names() {
	LC_ALL=C sort | awk -v i="$1" -v c="$2" '(NR - 1) % c == i - 1'
}

if [ "${1:-}" = "--select" ]; then
	[ $# -eq 3 ] || usage
	check_args "$2" "$3"
	tr -d '\r' | select_names "$2" "$3"
	exit 0
fi

[ $# -eq 2 ] || usage
check_args "$1" "$2"

list="$(cargo test -p sgf-core --test integration -- --list --format terse)" || {
	printf 'listing the tests failed\n' >&2
	exit 1
}
names="$(printf '%s\n' "$list" | tr -d '\r' | sed -n 's/: test$//p' | select_names "$1" "$2")"
if [ -z "$names" ]; then
	printf 'shard %s of %s selected no tests\n' "$1" "$2" >&2
	exit 1
fi
printf 'shard %s of %s: %s tests\n' "$1" "$2" "$(printf '%s\n' "$names" | wc -l | tr -d ' ')"

status=0
batch=()
run_batch() {
	if ! cargo test -p sgf-core --test integration -- --exact "${batch[@]}"; then
		status=1
	fi
	batch=()
}
while IFS= read -r name; do
	batch+=("$name")
	if [ "${#batch[@]}" -ge "$batch_size" ]; then
		run_batch
	fi
done <<EOF_NAMES
$names
EOF_NAMES
if [ "${#batch[@]}" -gt 0 ]; then
	run_batch
fi
exit "$status"
