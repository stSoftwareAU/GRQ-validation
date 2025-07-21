#!/bin/bash

# GRQ Validation Processor
# 
# This script builds and runs the GRQ validation program.
# 
# Usage:
#   ./run.sh                    # Process recent files only (within 100 days)
#   ./run.sh --process-all      # Process all available files
#   ./run.sh --full-reload      # Process all files (same as --process-all)
# 
# The program validates 90-day predictions, so processing files older than 100 days
# is typically not necessary for performance reasons.

# Configuration
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

SCRIPT_NAME="${BASH_SOURCE[0]##*/}"
MAX_STALE_SECONDS=14400 # Four hours

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

setup_rust_environment

# Change to repository directory
cd "$REPO_DIR" || exit 1
log "Working directory: $REPO_DIR"

# Check if Rust program needs rebuilding
log "Checking if rebuild is needed"
NEED_REBUILD=false

# Check if Cargo.toml or source files changed
if git diff --name-only HEAD~1 HEAD | grep -E "(Cargo\.toml|src/)" > /dev/null; then
    NEED_REBUILD=true
    log "Source files changed, rebuild needed"
fi

# Check if binary doesn't exist
if [ ! -f "target/release/grq-validation" ]; then
    NEED_REBUILD=true
    log "Binary doesn't exist, rebuild needed"
fi

# Build if needed
if [ "$NEED_REBUILD" = true ]; then
    log "Building Rust program"
    if ! cargo build --release; then
        log "ERROR: Build failed"
        exit 1
    fi
    log "Build completed successfully"
else
    log "No rebuild needed, using existing binary"
fi

# Run the program
log "Running GRQ validation program"

# Check for command line arguments
PROCESS_ALL=false
if [[ "$1" == "--process-all" || "$1" == "--full-reload" ]]; then
    PROCESS_ALL=true
    log "Processing all files (including those past 100 days)"
else
    log "Processing recent files only (within 100 days)"
fi

# Use --process-all flag to process all dates, or omit for recent dates only (within 100 days)
if [ "$PROCESS_ALL" = true ]; then
    # For full reload, process all files (performance is calculated inline)
    if ./target/release/grq-validation --docs-path docs --process-all; then
        log "Program completed successfully"
    else
        log "ERROR: Program failed"
        exit 1
    fi
else
    # For recent files only, process files (performance is calculated inline)
    if ./target/release/grq-validation --docs-path docs; then
        log "Program completed successfully"
    else
        log "ERROR: Program failed"
        exit 1
    fi
fi

log "Automated run completed successfully" 
