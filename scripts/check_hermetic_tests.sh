#!/bin/bash

# Hermetic-test gate for the market-data/dividend integration tests (issue #804).
#
# These four tests used to read — and in two cases write — the operator's
# private data checkout, and silently skipped everywhere else, so they were no
# safety net on CI. They now build synthetic fixtures in temporary directories.
# This gate keeps them that way: it runs them with *no* data root configured and
# fails loud if any of them skips, references the private tree, or leaves the
# working tree dirty.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Test binaries that must run without any data root.
HERMETIC_TESTS=(
    create_market_data_csv_test
    create_market_data_long_csv_test
    market_data_tests
    dividend_tests
    picks_sidecar_test
    picks_backfill_test
)

# Private-tree checkout names and the base-path constants deleted in #802.
# Written as an alternation so this gate does not itself spell the checkout
# names — scripts/ must stay free of private-tree literals (issue #805).
PRIVATE_TREE_PATTERN='GRQ-(shareprices|dividends)|MARKET_DATA_BASE_PATH|DIVIDEND_DATA_BASE_PATH'

fail() {
    echo "ERROR: $*" >&2
    exit 1
}

# The repo-wide guard (issue #806) necessarily spells the same names in its own
# pattern definitions; it excludes itself for the same reason, and it covers the
# rest of tests/ — so skipping that one file here loses no coverage.
GUARD_TEST='private_data_root_reference_test.ts'

echo "🔍 Checking tests/ for private data-tree references..."
if grep -rEn --exclude="$GUARD_TEST" "$PRIVATE_TREE_PATTERN" tests/; then
    fail "tests/ must not reference the private data tree or a deleted base-path constant (issue #804)"
fi

# Snapshot the working tree so an unrelated local edit cannot be blamed on the
# test run, and a file written by it cannot hide among them.
status_before="$(git status --porcelain)"

log="$(mktemp)"
trap 'rm -f "$log"' EXIT

test_args=()
for test_name in "${HERMETIC_TESTS[@]}"; do
    test_args+=(--test "$test_name")
done

echo "🧪 Running the hermetic integration tests with no data root configured..."
if ! env -u GRQ_MARKET_DATA_PATH -u GRQ_DIVIDEND_DATA_PATH \
    cargo test "${test_args[@]}" -- --nocapture >"$log" 2>&1 </dev/null; then
    cat "$log" >&2
    fail "the hermetic integration tests must pass with no data root configured (issue #804)"
fi
cat "$log"

if grep -nE '^Skipping |external data repository not available' "$log"; then
    fail "no hermetic integration test may skip — the fixtures are synthetic (issue #804)"
fi

if grep -n 'running 0 tests' "$log"; then
    fail "every hermetic integration test binary must run at least one test (issue #804)"
fi

status_after="$(git status --porcelain)"
if [ "$status_before" != "$status_after" ]; then
    echo "--- git status before ---" >&2
    echo "$status_before" >&2
    echo "--- git status after ---" >&2
    echo "$status_after" >&2
    fail "the tests must leave the working tree unchanged — write to a temp dir (issue #804)"
fi

echo "✅ Hermetic integration tests verified."
