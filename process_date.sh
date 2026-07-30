#!/bin/bash

# Script to process a single date for GRQ validation
# Usage: ./process_date.sh YYYY-MM-DD

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Pre-flight guard for the caller-supplied data roots (issue #803). A missing
# helper is itself a fault, so it fails loud rather than skipping the check.
DATA_ROOT_GUARD="$REPO_DIR/scripts/require_data_roots.sh"
if [ ! -f "$DATA_ROOT_GUARD" ]; then
    echo "ERROR: missing data-root guard: $DATA_ROOT_GUARD" >&2
    exit 1
fi
# shellcheck source=scripts/require_data_roots.sh
. "$DATA_ROOT_GUARD"

if [ $# -eq 0 ]; then
    echo "Usage: $0 YYYY-MM-DD"
    echo "Example: $0 2025-06-05"
    exit 1
fi

# Both roots must be configured before anything is built or written.
require_data_roots

DATE=$1

# Validate date format
if [[ ! $DATE =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
    echo "Error: Invalid date format. Use YYYY-MM-DD"
    echo "Example: 2025-06-05"
    exit 1
fi

echo "Processing date: $DATE"
echo "================================"

# Build the project first
echo "Building project..."
if ! cargo build --release; then
    echo "Error: Build failed"
    exit 1
fi

# Process the specific date. The data roots are passed explicitly so the binary
# never guesses (issue #803).
echo "Running processor for $DATE..."
if ./target/release/grq-validation --docs-path docs \
    --market-data-path "$GRQ_MARKET_DATA_PATH" \
    --dividend-data-path "$GRQ_DIVIDEND_DATA_PATH" \
    --date "$DATE"; then
    echo "================================"
    echo "Successfully processed $DATE"
    echo "Check the list view to see the results: http://localhost:8000/list.html"
else
    echo "================================"
    echo "Error processing $DATE"
    exit 1
fi 