#!/usr/bin/env bash
#
# Guarded Cargo version-increment helper (issue #818).
#
# Ported from NEAT-AI-scorer's scripts/version-increment.sh (NEAT-AI-scorer#20)
# so every merged change carries a new [package].version. `run.sh` compares that
# version against the deployed binary's `--version` to decide whether to
# rebuild, so a stale binary can no longer survive a multi-commit pull.
#
# Responsibilities:
#   * Read / write the [package].version field of a Cargo.toml manifest (and
#     keep the matching Cargo.lock entry in step, so `cargo --locked` builds).
#   * Detect whether the current branch has already bumped the version relative
#     to its base ref, so re-running CI never produces a duplicate bump commit
#     and a human-authored bump is respected.
#   * Perform a single idempotent patch-level bump on request.
#
# No git commit/push side-effects — the workflow handles those.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: version_increment.sh <mode> [--manifest PATH] [--base-ref REF] [--repo DIR] [--dry-run]

Modes (exactly one):
  --get-version       Print the current [package].version from the manifest.
  --bump-patch        Increment the patch component of [package].version.
  --already-bumped    Exit 0 if the branch version differs from the base ref,
                      else exit 1.
  --run               End-to-end: skip if already bumped (by CI or by hand),
                      otherwise bump-patch. Prints a one-line status.

Options:
  --manifest PATH     Cargo.toml to operate on (default: Cargo.toml).
  --base-ref REF      Base ref to compare against (default: origin/main).
  --repo DIR          Repository directory for git operations (default: cwd).
  --dry-run           For --bump-patch, print the new version without writing.
  -h, --help          Show this message.
EOF
}

# --- arg parsing -----------------------------------------------------------

MODE=""
MANIFEST="Cargo.toml"
BASE_REF="origin/main"
REPO_DIR="."
DRY_RUN=0

set_mode() {
  if [ -n "$MODE" ]; then
    echo "Usage error: only one mode may be supplied" >&2
    usage >&2
    exit 2
  fi
  MODE="$1"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --get-version)    set_mode get-version;    shift ;;
    --bump-patch)     set_mode bump-patch;     shift ;;
    --already-bumped) set_mode already-bumped; shift ;;
    --run)            set_mode run;            shift ;;
    --manifest)       MANIFEST="${2:-}"; shift 2 ;;
    --base-ref)       BASE_REF="${2:-}"; shift 2 ;;
    --repo)           REPO_DIR="${2:-}"; shift 2 ;;
    --dry-run)        DRY_RUN=1; shift ;;
    -h|--help)        usage; exit 0 ;;
    *)
      echo "Usage error: unknown option '$1'" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [ -z "$MODE" ]; then
  echo "Usage error: a mode is required" >&2
  usage >&2
  exit 2
fi

# --- helpers ---------------------------------------------------------------

# Print the first quoted value of `<key> = "..."` beneath the [package] header
# of a manifest read from stdin. One parser serves both the working-copy and
# the git-ref readers.
package_field() {
  awk -v key="$1" '
    /^\[package\]/ { in_pkg = 1; next }
    /^\[/          { in_pkg = 0 }
    in_pkg && $0 ~ "^[[:space:]]*" key "[[:space:]]*=" {
      match($0, /"[^"]+"/)
      if (RSTART > 0) {
        print substr($0, RSTART + 1, RLENGTH - 2)
        exit
      }
    }
  '
}

# Read a [package] field from the manifest on disk, failing loud when the
# manifest is missing or the field is absent.
read_manifest_field() {
  local manifest="$1" key="$2" value
  if [ ! -f "$manifest" ]; then
    echo "ERROR: manifest '$manifest' not found" >&2
    return 1
  fi
  value="$(package_field "$key" <"$manifest")"
  if [ -z "$value" ]; then
    echo "ERROR: no [package].$key in '$manifest'" >&2
    return 1
  fi
  printf '%s\n' "$value"
}

# Read the manifest version from a git ref. An unreachable ref or path yields
# an empty string, which callers treat as "base unknown".
extract_version_at_ref() {
  local repo="$1" ref="$2" manifest_rel="$3"
  (
    cd "$repo" || return 0
    if ! git rev-parse --verify "$ref" >/dev/null 2>&1; then
      return 0
    fi
    git show "${ref}:${manifest_rel}" 2>/dev/null | package_field version
  )
}

# Rewrite the [package].version line in place.
write_manifest_version() {
  local manifest="$1" new_version="$2"
  awk -v new="$new_version" '
    /^\[package\]/ { in_pkg = 1; print; next }
    /^\[/          { in_pkg = 0 }
    {
      if (in_pkg && !done && $0 ~ /^[[:space:]]*version[[:space:]]*=/) {
        sub(/"[^"]+"/, "\"" new "\"")
        done = 1
      }
      print
    }
  ' "$manifest" >"${manifest}.tmp"
  mv "${manifest}.tmp" "$manifest"
}

# Keep Cargo.lock's own entry for this package aligned with the manifest, so a
# `cargo --locked` build (CI, issue #124) does not fail on a stale lock file.
# Absent lock file: nothing to do.
write_lock_version() {
  local lockfile="$1" package="$2" new_version="$3"
  [ -f "$lockfile" ] || return 0
  awk -v pkg="$package" -v new="$new_version" '
    $0 == "name = \"" pkg "\"" { found = 1; print; next }
    found && /^version[[:space:]]*=/ {
      print "version = \"" new "\""
      found = 0
      next
    }
    { print }
  ' "$lockfile" >"${lockfile}.tmp"
  mv "${lockfile}.tmp" "$lockfile"
}

# Path of the manifest relative to the repository, for `git show <ref>:<path>`.
manifest_rel_path() {
  local repo="$1" manifest="$2" abs_repo
  if [ "${manifest:0:1}" = "/" ]; then
    abs_repo="$(cd "$repo" && pwd)"
    printf '%s\n' "${manifest#"$abs_repo"/}"
  else
    printf '%s\n' "$manifest"
  fi
}

bump_patch() {
  local version="$1"
  if [[ ! "$version" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)(.*)$ ]]; then
    echo "ERROR: version '$version' is not semver X.Y.Z" >&2
    return 1
  fi
  printf '%s.%s.%s%s\n' \
    "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" \
    "$((BASH_REMATCH[3] + 1))" "${BASH_REMATCH[4]}"
}

# Apply a patch bump to both the manifest and the sibling Cargo.lock.
apply_bump() {
  local manifest="$1" next="$2" package
  package="$(read_manifest_field "$manifest" name)"
  write_manifest_version "$manifest" "$next"
  write_lock_version "$(dirname "$manifest")/Cargo.lock" "$package" "$next"
}

# --- modes -----------------------------------------------------------------

case "$MODE" in
  get-version)
    read_manifest_field "$MANIFEST" version
    ;;

  bump-patch)
    current="$(read_manifest_field "$MANIFEST" version)"
    next="$(bump_patch "$current")"
    if [ "$DRY_RUN" -eq 1 ]; then
      echo "$next"
    else
      apply_bump "$MANIFEST" "$next"
      echo "$next"
    fi
    ;;

  already-bumped)
    current="$(read_manifest_field "$MANIFEST" version)"
    rel="$(manifest_rel_path "$REPO_DIR" "$MANIFEST")"
    base_version="$(extract_version_at_ref "$REPO_DIR" "$BASE_REF" "$rel")"
    # Base ref unreachable — treat as "not bumped" so CI stays conservative.
    [ -n "$base_version" ] || exit 1
    [ "$current" != "$base_version" ] || exit 1
    ;;

  run)
    current="$(read_manifest_field "$MANIFEST" version)"
    rel="$(manifest_rel_path "$REPO_DIR" "$MANIFEST")"
    base_version="$(extract_version_at_ref "$REPO_DIR" "$BASE_REF" "$rel")"

    if [ -n "$base_version" ] && [ "$current" != "$base_version" ]; then
      echo "skip: version already bumped on branch (base=${base_version}, branch=${current})"
      exit 0
    fi

    next="$(bump_patch "$current")"
    apply_bump "$MANIFEST" "$next"
    echo "bumped: ${current} -> ${next}"
    ;;
esac
