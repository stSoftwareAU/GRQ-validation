#!/bin/bash
set -e

# Configuration
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="$REPO_DIR/run.log"
LOCK_FILE="$REPO_DIR/run.lock"

# Logging function
log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a "$LOG_FILE"
}

# Cleanup function
cleanup() {
    if [ -f "$LOCK_FILE" ]; then
        rm -f "$LOCK_FILE"
    fi
}

# Set up trap to cleanup on exit
trap cleanup EXIT

# Check if already running
if [ -f "$LOCK_FILE" ]; then
    log "ERROR: Script already running (lock file exists)"
    exit 1
fi

# Create lock file
touch "$LOCK_FILE"

log "Starting automated run"

# Change to repository directory
cd "$REPO_DIR"
log "Working directory: $REPO_DIR"

# Git operations
log "Starting git operations"

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

# Run the program
log "Running GRQ validation program"
if ./target/release/grq-validation --docs-path docs; then
    log "Program completed successfully"
else
    log "ERROR: Program failed"
    exit 1
fi

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