#!/bin/bash

# GRQ Validation Processor
# 
# This script builds and runs the GRQ validation program.
# 
# Usage:
#   ./run.sh                    # Process recent files only (within 180 days)
#   ./run.sh --process-all      # Process all available files
#   ./run.sh --full-reload      # Process all files (same as --process-all)
#   ./run.sh --regenerate-empty # Process only missing or header-only market CSVs
#
# The program validates 90-day predictions, so processing files older than 180 days
# is typically not necessary for performance reasons.

# Configuration
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Logging function
log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1"
}
setup_rust_environment() {
    # Set up PATH for Rust/cargo
    local cargo_paths=(
        "$HOME/.cargo/bin"
        "/usr/local/cargo/bin"
        "/opt/cargo/bin"
    )
    
    for path in "${cargo_paths[@]}"; do
        if [[ -d "$path" ]]; then
            export PATH="$path:$PATH"
            break
        fi
    done
    
    # Source cargo environment if it exists
    if [[ -f "$HOME/.cargo/env" ]]; then
        source "$HOME/.cargo/env"
    fi
}


# Pre-flight guard for the caller-supplied data roots (issue #803). A missing
# helper is itself a fault, so it fails loud rather than skipping the check.
DATA_ROOT_GUARD="$REPO_DIR/scripts/require_data_roots.sh"
if [ ! -f "$DATA_ROOT_GUARD" ]; then
    echo "ERROR: missing data-root guard: $DATA_ROOT_GUARD" >&2
    exit 1
fi
# shellcheck source=scripts/require_data_roots.sh
. "$DATA_ROOT_GUARD"

setup_rust_environment
require_data_roots

# Change to repository directory
cd "$REPO_DIR" || exit 1
log "Working directory: $REPO_DIR"

# Always build. The old check diffed HEAD~1..HEAD only, so a sync that
# fast-forwarded several commits at once kept the previously built binary — a
# pre-#803 binary then met a post-#803 caller and rejected --market-data-path
# (issue #816). Cargo's own freshness check makes this a near no-op when the
# binary is already current, and it can never leave a stale one behind.
log "Building Rust program (cargo skips the work when it is already current)"
if ! cargo build --release; then
    log "ERROR: Build failed"
    exit 1
fi
log "Build completed successfully"

# Run the program
log "Running GRQ validation program"

# The data roots are passed explicitly so the binary never guesses (issue #803).
DATA_ROOT_FLAGS=(
    --market-data-path "$GRQ_MARKET_DATA_PATH"
    --dividend-data-path "$GRQ_DIVIDEND_DATA_PATH"
)

# Check for command line arguments
PROCESS_ALL=false
REGENERATE_EMPTY=false
if [[ "$1" == "--process-all" || "$1" == "--full-reload" ]]; then
    PROCESS_ALL=true
    log "Processing all files (including those past 180 days)"
elif [[ "$1" == "--regenerate-empty" ]]; then
    REGENERATE_EMPTY=true
    log "Processing score files with missing or header-only market CSVs"
else
    log "Processing recent files only (within 180 days)"
fi

# Use --process-all to process all dates, --regenerate-empty for broken CSVs,
# or omit for recent dates only (within 180 days)
if [ "$PROCESS_ALL" = true ]; then
    # For full reload, process all files (performance is calculated inline)
    if ./target/release/grq-validation --docs-path docs "${DATA_ROOT_FLAGS[@]}" --process-all; then
        log "Program completed successfully"
    else
        log "ERROR: Program failed"
        exit 1
    fi
elif [ "$REGENERATE_EMPTY" = true ]; then
    if ./target/release/grq-validation --docs-path docs "${DATA_ROOT_FLAGS[@]}" --regenerate-empty; then
        log "Program completed successfully"
    else
        log "ERROR: Program failed"
        exit 1
    fi
else
    # For recent files only, process files (performance is calculated inline)
    if ./target/release/grq-validation --docs-path docs "${DATA_ROOT_FLAGS[@]}"; then
        log "Program completed successfully"
    else
        log "ERROR: Program failed"
        exit 1
    fi
fi

log "Automated run completed successfully" 
