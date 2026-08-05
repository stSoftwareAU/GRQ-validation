#!/usr/bin/env bash
# Guarded Cargo version-increment helper (issue #818).
#
# Ported from NEAT-AI-scorer's scripts/version-increment.sh (NEAT-AI-scorer#20)
# with this repository's defaults: manifest ./Cargo.toml, base ref origin/main.
#
# Responsibilities:
#   * Read / write the [package].version field of a Cargo.toml manifest.
#   * Detect whether the current git branch has already diverged from its
#     base ref on that version (so re-running CI does not produce duplicate
#     bump commits and a human-authored bump is respected).
#   * Perform a single idempotent patch-level bump on request.
#
# Callable from local shells, from the version-bump CI job
# (.github/workflows/version-bump.yml) and from scripts/needs_rebuild.sh, which
# uses --get-version to judge whether the deployed binary is stale. No network
# or git-push side effects — the workflow handles committing and pushing.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: version-increment.sh <mode> [--manifest PATH] [--base-ref REF] [--repo DIR] [--dry-run]

Modes (exactly one):
  --get-version       Print the current [package].version from the manifest.
  --bump-patch        Increment the patch component of [package].version.
  --already-bumped    Exit 0 if branch version differs from base, else exit 1.
  --run               End-to-end: skip if already bumped (or manually bumped),
                      otherwise bump-patch. Prints a one-line status.

Options:
  --manifest PATH     Cargo.toml to operate on (default: ./Cargo.toml).
  --base-ref REF      Base ref to diff against (default: origin/main).
  --repo DIR          Repository directory for git operations (default: cwd).
  --dry-run           For --bump-patch, print the new version without writing.
  -h, --help          Show this message.
EOF
}

# --- arg parsing -----------------------------------------------------------

MODE=""
MANIFEST="./Cargo.toml"
BASE_REF="origin/main"
REPO_DIR="."
DRY_RUN=0

set_mode() {
  if [[ -n "$MODE" ]]; then
    echo "Usage error: only one mode may be supplied" >&2
    usage >&2
    exit 2
  fi
  MODE="$1"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --get-version)    set_mode get-version;    shift ;;
    --bump-patch)     set_mode bump-patch;     shift ;;
    --already-bumped) set_mode already-bumped; shift ;;
    --run)            set_mode run;            shift ;;
    --manifest)       MANIFEST="$2"; shift 2 ;;
    --base-ref)       BASE_REF="$2"; shift 2 ;;
    --repo)           REPO_DIR="$2"; shift 2 ;;
    --dry-run)        DRY_RUN=1; shift ;;
    -h|--help)        usage; exit 0 ;;
    *)
      echo "Usage error: unknown option '$1'" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -z "$MODE" ]]; then
  echo "Usage error: a mode is required" >&2
  usage >&2
  exit 2
fi

# --- helpers ---------------------------------------------------------------

# awk program extracting the first `version = "X.Y.Z"` beneath [package].
read -r -d '' VERSION_AWK <<'AWK' || true
/^\[package\]/ { in_pkg = 1; next }
/^\[/          { in_pkg = 0 }
in_pkg && /^[[:space:]]*version[[:space:]]*=/ {
  match($0, /"[^"]+"/)
  if (RSTART > 0) {
    print substr($0, RSTART + 1, RLENGTH - 2)
    exit
  }
}
AWK

# Extract the [package].version from a manifest on disk.
extract_version() {
  local manifest="$1"
  if [[ ! -f "$manifest" ]]; then
    echo "Error: manifest '$manifest' not found" >&2
    return 1
  fi
  awk "$VERSION_AWK" "$manifest"
}

# Read the manifest version from a specific git ref (base branch).
extract_version_at_ref() {
  local repo="$1" ref="$2" manifest_rel="$3"
  (
    cd "$repo"
    # Allow the ref to not exist (e.g. shallow fetch) — return empty string
    # so the caller can treat it as "unknown" and default to "not bumped".
    if ! git rev-parse --verify "$ref" >/dev/null 2>&1; then
      return 0
    fi
    git show "${ref}:${manifest_rel}" 2>/dev/null | awk "$VERSION_AWK"
  )
}

# Rewrite the [package].version line in-place.
write_version() {
  local manifest="$1" new_version="$2"
  # Only touch the first version = "..." line under [package].
  awk -v new="$new_version" '
    BEGIN { done = 0 }
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

# Compute the relative manifest path inside the repo (for git show).
manifest_rel_path() {
  local repo="$1" manifest="$2"
  if [[ "$manifest" = /* ]]; then
    # Strip repo prefix + leading slash.
    local abs_repo
    abs_repo="$(cd "$repo" && pwd)"
    local rel="${manifest#"$abs_repo"/}"
    echo "$rel"
  else
    # Drop a leading ./ so `git show <ref>:<path>` resolves the blob.
    echo "${manifest#./}"
  fi
}

bump_patch() {
  local version="$1"
  if [[ ! "$version" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)(.*)$ ]]; then
    echo "Error: version '$version' is not semver X.Y.Z" >&2
    return 1
  fi
  local major="${BASH_REMATCH[1]}"
  local minor="${BASH_REMATCH[2]}"
  local patch="${BASH_REMATCH[3]}"
  local suffix="${BASH_REMATCH[4]}"
  printf '%s.%s.%s%s\n' "$major" "$minor" "$((patch + 1))" "$suffix"
}

# --- modes -----------------------------------------------------------------

case "$MODE" in
  get-version)
    extract_version "$MANIFEST"
    ;;

  bump-patch)
    current="$(extract_version "$MANIFEST")"
    next="$(bump_patch "$current")"
    if [[ "$DRY_RUN" -eq 1 ]]; then
      echo "$next"
    else
      write_version "$MANIFEST" "$next"
      echo "$next"
    fi
    ;;

  already-bumped)
    current="$(extract_version "$MANIFEST")"
    rel="$(manifest_rel_path "$REPO_DIR" "$MANIFEST")"
    base_version="$(extract_version_at_ref "$REPO_DIR" "$BASE_REF" "$rel")"
    if [[ -z "$base_version" ]]; then
      # Base ref unreachable — treat as "not bumped" so CI stays conservative.
      exit 1
    fi
    if [[ "$current" != "$base_version" ]]; then
      exit 0
    else
      exit 1
    fi
    ;;

  run)
    current="$(extract_version "$MANIFEST")"
    rel="$(manifest_rel_path "$REPO_DIR" "$MANIFEST")"
    base_version="$(extract_version_at_ref "$REPO_DIR" "$BASE_REF" "$rel")"

    if [[ -n "$base_version" && "$current" != "$base_version" ]]; then
      echo "skip: version already bumped on branch (base=${base_version}, branch=${current})"
      exit 0
    fi

    next="$(bump_patch "$current")"
    write_version "$MANIFEST" "$next"
    echo "bumped: ${current} -> ${next}"
    ;;
esac
