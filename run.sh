#!/bin/bash
set -e

# Configuration
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

SCRIPT_NAME="${BASH_SOURCE[0]##*/}"
PID_FILE="$REPO_DIR/.${SCRIPT_NAME/.sh/.pid}"
MAX_STALE_SECONDS=14400 # Four hours

# Logging function
log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1"
}

# Check if already running using PID-based locking
if [ -s "${PID_FILE}" ]; then
    pid="$(cat "${PID_FILE}")"
    if [[ "${pid}" -gt 0 ]]; then
        now=$(date +%s)
        modTS=$(date -r "${PID_FILE}" +%s)
        ((age_in_seconds=now-modTS))

        if ps "${pid}" >/dev/null && [ $age_in_seconds -lt $MAX_STALE_SECONDS ]; then
            log "Process ${pid} is already running, exiting"
            exit 0
        fi

        # Process is stale or dead, clean it up
        log "Stale/dead process ${pid} detected (age: ${age_in_seconds}s), cleaning up"
        if [[ -n "${pid}" ]]; then
            # Try to kill the process tree if it still exists
            if ps "${pid}" >/dev/null 2>&1; then
                pkill -P "${pid}" >/dev/null 2>&1 || true
                kill "${pid}" >/dev/null 2>&1 || true
            fi
        fi
        rm -f "${PID_FILE}"
    fi
fi

# Set up cleanup trap
cleanup() {
    log "Cleaning up PID file"
    rm -f "${PID_FILE}"
}

trap cleanup EXIT SIGINT SIGTERM

# Create PID file with current process ID
PID=$$
echo "${PID}" > "${PID_FILE}"
log "Starting automated run (PID: ${PID})"

# Function to check if PID file still belongs to us
check_pid() {
    if [[ ! -f "${PID_FILE}" ]] || [[ ! -s "${PID_FILE}" ]]; then
        log "ERROR: PID file missing or empty"
        exit 1
    fi

    CURRENT_PID=$(cat "${PID_FILE}")
    if [[ "${PID}" != "${CURRENT_PID}" ]]; then
        log "ERROR: PID changed ${PID} != ${CURRENT_PID}"
        exit 1
    fi

    touch "${PID_FILE}"
}

# Change to repository directory
cd "$REPO_DIR"
log "Working directory: $REPO_DIR"

# Git operations
log "Starting git operations"
check_pid

# Stash any local changes to avoid conflicts
if ! git diff --quiet; then
    log "Stashing local changes"
    git stash push -m "Auto-stash before pull $(date)"
fi

# Fetch latest changes
log "Fetching latest changes"
git fetch origin

# Check if we're behind remote
if [ "$(git rev-list HEAD..origin/main --count)" -gt 0 ]; then
    log "Local is behind remote, pulling changes"
    
    # Reset to match remote (clean repo approach)
    git reset --hard origin/main
    git clean -fd
    
    log "Successfully updated to latest version"
else
    log "Already up to date"
fi

check_pid

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
    cargo build --release
    log "Build completed successfully"
else
    log "No rebuild needed, using existing binary"
fi

check_pid

# Run the program
log "Running GRQ validation program"
if ./target/release/grq-validation --docs-path docs; then
    log "Program completed successfully"
else
    log "ERROR: Program failed"
    exit 1
fi

check_pid

# Check if there are changes to commit
if git diff --quiet; then
    log "No changes to commit"
else
    log "Changes detected, committing results"
    
    # Add all changes
    git add .
    
    # Commit with timestamp
    COMMIT_MSG="Auto-update stock scores $(date '+%Y-%m-%d %H:%M:%S')"
    if git commit -m "$COMMIT_MSG"; then
        log "Changes committed successfully"
        
        # Push to remote
        log "Pushing to remote"
        if git push origin main; then
            log "Successfully pushed to remote"
        else
            log "ERROR: Failed to push to remote"
            exit 1
        fi
    else
        log "ERROR: Failed to commit changes"
        exit 1
    fi
fi

log "Automated run completed successfully" 