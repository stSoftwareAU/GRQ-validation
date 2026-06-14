## Summary

Closes #182.

Fixed a low-severity path-traversal weakness in the dividend-data path. The
`stock` ticker field of a score TSV is attacker-influenceable (a contributor, a
compromised upstream data step, or a malicious pull request against the data
set), and `calculate_dividends_for_period` (called at `src/utils.rs:807` and
`:988`) passed the raw `record.stock` ticker straight through `read_dividend_data`
into `get_dividend_data_path`. That helper interpolated the ticker into a
`format!` template, so `..` segments survived into the path handed to
`File::open`, letting a crafted ticker such as `X/../../../../../../etc/some`
escape the intended `../GRQ-dividends/data/` tree.

The market-data path already neutralises this via `extract_symbol_from_ticker`,
and the score-file path already rejects `..`/absolute segments in
`build_score_file_path`. This change gives the dividend path the same
defence-in-depth at the central sink.

### Change

`get_dividend_data_path` now builds the path with `Path::join` over **validated
components** instead of plain string interpolation, mirroring
`build_score_file_path`:

- Any `Component::ParentDir` (`..`) segment → rejected.
- Any `Component::RootDir`/`Component::Prefix` (absolute) segment → rejected.
- `.` is ignored; normal segments extend the path.

The function now returns `Result<String>`; `read_dividend_data` propagates the
error with `?`. Both existing callers already treat a read error as "no dividend
data" (the CSV writer logs and skips; `calculate_dividends_for_period` returns
`0.0`), so a rejected traversal ticker simply yields zero dividends rather than
reading an out-of-tree `.json` file. Legitimate tickers (including
exchange-prefixed ones like `NYSE:SEM`) resolve exactly as before.

```mermaid
flowchart LR
    A[score TSV record.stock] --> B[calculate_dividends_for_period]
    B --> C[read_dividend_data]
    C --> D[get_dividend_data_path]
    D -->|"`..` or absolute segment"| E[Err -> 0.0 dividends]
    D -->|normal segments only| F[../GRQ-dividends/data/L/TICKER.json]
```

## Evidence

Backend/CLI change only — no web interface to screenshot. Verified via
`cargo test` and the full `./quality.sh` gate, both passing.

New regression tests (all green):

- `test_get_dividend_data_path_rejects_parent_dir_traversal` — a ticker
  containing `..` returns `Err`.
- `test_get_dividend_data_path_rejects_absolute_ticker` — an absolute ticker
  returns `Err`.
- `test_read_dividend_data_rejects_traversal_ticker` — the read fails at the
  path-validation stage instead of opening an out-of-tree file.
- `test_calculate_dividends_for_period_safe_on_traversal_ticker` — the
  vulnerable call site returns `0.0` for a crafted traversal ticker.
- `test_get_dividend_data_path_allows_plain_ticker_with_exchange_prefix` —
  legitimate `NYSE:SEM` still resolves to `.../data/N/NYSE:SEM.json`.

The existing `test_get_dividend_data_path` was updated to unwrap the new
`Result` return (no behavioural change for valid tickers).

## Test Plan

- `cargo test --lib dividend` — 8 passed.
- `./quality.sh` — passes cleanly (fmt, clippy, Rust tests, Deno suite).
