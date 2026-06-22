#!/bin/bash
# Regenerate the PWA / favicon icon set in docs/icons/ from docs/logo.png with a
# fully transparent background (issue #419). The robot artwork keeps the same
# ~80% safe-area scale used by the original set (issue #221); only the previously
# solid #667eea background becomes transparent.
#
# Uses macOS `sips` only (no Node tooling — this stays a Deno/Rust repo):
#   1. scale the largest edge to 80% of the target size (preserving aspect and
#      the logo's existing alpha channel);
#   2. pad onto an N×N square — with no --padColor, sips fills the padding with
#      transparent pixels because the source already carries an alpha channel.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/docs/logo.png"
OUT_DIR="$ROOT/docs/icons"

SIZES=(16 32 72 96 128 144 152 167 180 192 384 512)

if [[ ! -f "$SRC" ]]; then
  echo "error: source logo not found at $SRC" >&2
  exit 1
fi

if ! command -v sips >/dev/null 2>&1; then
  echo "error: this generator requires macOS 'sips'" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

for n in "${SIZES[@]}"; do
  inner=$(( (n * 8 + 5) / 10 )) # round(n * 0.8)
  sips -Z "$inner" "$SRC" --out "$TMP/inner-$n.png" >/dev/null
  sips -p "$n" "$n" "$TMP/inner-$n.png" --out "$OUT_DIR/icon-${n}x${n}.png" >/dev/null
  echo "generated docs/icons/icon-${n}x${n}.png"
done

echo "done — regenerated ${#SIZES[@]} icons with transparent backgrounds"
