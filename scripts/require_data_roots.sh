#!/bin/bash

# Shared pre-flight guard for the caller-supplied data roots (issue #803).
#
# The processor reads share prices and dividend history from directories the
# operator supplies — this repository ships none. Sourced by run.sh and
# process_date.sh so both entry points fail loud, before any build or write,
# with identical guidance.

# Exits 1 naming every unset variable when either data root is missing.
require_data_roots() {
    local missing=""

    if [ -z "${GRQ_MARKET_DATA_PATH:-}" ]; then
        missing="GRQ_MARKET_DATA_PATH"
    fi

    if [ -z "${GRQ_DIVIDEND_DATA_PATH:-}" ]; then
        if [ -n "$missing" ]; then
            missing="$missing, GRQ_DIVIDEND_DATA_PATH"
        else
            missing="GRQ_DIVIDEND_DATA_PATH"
        fi
    fi

    if [ -n "$missing" ]; then
        echo "ERROR: unset data root(s): $missing" >&2
        echo "Set each variable (or pass the matching --market-data-path /" >&2
        echo "--dividend-data-path flag) to a directory holding a" >&2
        echo "data/<UPPERCASE-FIRST-LETTER>/<SYMBOL>.json tree, for example:" >&2
        echo "  export GRQ_MARKET_DATA_PATH=/path/to/market-data" >&2
        echo "  export GRQ_DIVIDEND_DATA_PATH=/path/to/dividend-history" >&2
        exit 1
    fi
}
