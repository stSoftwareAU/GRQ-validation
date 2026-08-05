#!/bin/bash

# Staleness check for the compiled release binary (issue #818).
#
# run.sh used to decide whether to rebuild by diffing HEAD~1..HEAD for changes
# under src/ or Cargo.toml. A pull that lands several commits at once reuses the
# stale binary whenever the newest commit misses those paths — which is how
# GRQ-3 kept running a binary that predated --market-data-path and failed every
# cycle (#816 recurring as #818).
#
# The check now compares the version the built binary reports with the
# [package].version in Cargo.toml. CI bumps that version on every pull request
# (.github/workflows/version-bump.yml), so any deployed change forces a rebuild
# regardless of how many commits arrived together. Sourced by run.sh.

# Directory of this helper, used to locate the manifest-version reader.
NEEDS_REBUILD_HELPER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERSION_INCREMENT_SH="$NEEDS_REBUILD_HELPER_DIR/version-increment.sh"

# Human-readable explanation of the last needs_rebuild verdict.
REBUILD_REASON=""

# needs_rebuild <binary> <manifest>
#
# Returns 0 when <binary> must be rebuilt: it is missing, it cannot answer
# --version (a binary predating clap's version flag), or the version it reports
# differs from [package].version in <manifest>. Returns 1 when the built binary
# already matches the manifest.
#
# An unreadable manifest or a missing helper is a fault rather than a rebuild
# trigger: it exits 1 loudly instead of being masked as a completed check.
#
# REBUILD_REASON is read by the sourcing script (run.sh), which ShellCheck
# cannot see from here.
# shellcheck disable=SC2034
needs_rebuild() {
    local binary="$1"
    local manifest="$2"
    local manifest_version binary_output binary_version

    if [ ! -f "$VERSION_INCREMENT_SH" ]; then
        echo "ERROR: missing version helper: $VERSION_INCREMENT_SH" >&2
        exit 1
    fi

    if ! manifest_version="$(bash "$VERSION_INCREMENT_SH" --get-version --manifest "$manifest")" ||
        [ -z "$manifest_version" ]; then
        echo "ERROR: could not read [package].version from $manifest" >&2
        exit 1
    fi

    if [ ! -x "$binary" ]; then
        REBUILD_REASON="binary $binary is missing"
        return 0
    fi

    if ! binary_output="$("$binary" --version 2>/dev/null)"; then
        REBUILD_REASON="binary $binary does not report a --version (built before the version flag)"
        return 0
    fi

    # clap prints "<name> <version>"; take the version from the first line.
    binary_version="$(printf '%s\n' "$binary_output" | awk 'NF { print $NF; exit }')"
    if [ -z "$binary_version" ]; then
        REBUILD_REASON="binary $binary reported no version"
        return 0
    fi

    if [ "$binary_version" != "$manifest_version" ]; then
        REBUILD_REASON="binary version $binary_version does not match Cargo.toml version $manifest_version"
        return 0
    fi

    REBUILD_REASON="binary version $binary_version matches Cargo.toml"
    return 1
}
