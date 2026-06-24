#!/usr/bin/env python3
"""Report score TSV files with missing or header-only market CSVs."""

from __future__ import annotations

from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "docs" / "scores"


def is_day_file(path: Path) -> bool:
    return path.suffix == ".tsv" and path.stem.isdigit()


def csv_status(csv_path: Path) -> str:
    if not csv_path.exists():
        return "missing"
    lines = [line for line in csv_path.read_text().splitlines() if line.strip()]
    if not lines:
        return "empty"
    if len(lines) == 1:
        return "header_only"
    return "ok"


def main() -> int:
    problems: list[tuple[str, Path]] = []
    for tsv in sorted(ROOT.rglob("*.tsv")):
        if not is_day_file(tsv):
            continue
        status = csv_status(tsv.with_suffix(".csv"))
        if status != "ok":
            problems.append((status, tsv.relative_to(ROOT)))

    print(f"Total problematic day CSVs: {len(problems)}")
    for status, path in problems:
        print(f"[{status}] {path}")

    by_month: dict[str, int] = defaultdict(int)
    for _, path in problems:
        if len(path.parts) >= 2:
            by_month[f"{path.parts[0]}/{path.parts[1]}"] += 1

    if by_month:
        print("\nBy year/month:")
        for key, count in sorted(by_month.items(), key=lambda item: (-item[1], item[0])):
            print(f"  {key}: {count}")

    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
