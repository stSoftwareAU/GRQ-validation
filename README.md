# GRQ Score Validation

A Rust application for processing and analyzing daily stock scores from TSV files, with a web dashboard for visualization.

## Project Structure

```
GRQ-validation/
├── src/
│   ├── main.rs          # Main application entry point
│   ├── models.rs        # Data structures for stock records
│   ├── processor.rs     # TSV file processing logic
│   └── utils.rs         # Utility functions
├── docs/
│   ├── index.html       # Web dashboard (GitHub Pages)
│   └── scores/          # TSV files organized by date
├── Cargo.toml           # Rust project configuration
└── README.md           # This file
```

## Features

- **TSV Processing**: Read and write stock data from TSV files
- **Data Analysis**: Calculate summaries and identify undervalued stocks
- **Web Dashboard**: Beautiful HTML/JS interface for viewing data
- **Date-based Organization**: Files organized by year/month/day
- **Error Handling**: Robust error handling with detailed logging

## Prerequisites

- Rust (latest stable version)
- Git
- Deno

## Installation

1. Clone the repository:
```bash
git clone <your-repo-url>
cd GRQ-validation
```

2. Build the project:
```bash
cargo build
```

3. Run the application:
```bash
cargo run
```

## Usage

### Basic Usage

Process all TSV files in the docs directory:
```bash
cargo run -- --docs-path docs --recursive
```

Process a specific file:
```bash
cargo run -- --file docs/scores/2025/June/20.tsv
```

Enable verbose logging:
```bash
cargo run -- --verbose
```

### Command Line Options

- `--docs-path, -d`: Path to the docs directory (default: "docs")
- `--recursive, -r`: Process all TSV files recursively
- `--file, -f`: Process a specific TSV file
- `--verbose, -v`: Enable verbose logging

### Web Dashboard

The web dashboard is located at `docs/index.html` and will be served by GitHub Pages. It provides:

- Date-based navigation through stock data
- Summary statistics (total stocks, average score, undervalued count)
- Interactive table with sorting and filtering
- Visual indicators for stock performance

**🌐 Live Dashboard**: [https://stsoftwareau.github.io/GRQ-validation/](https://stsoftwareau.github.io/GRQ-validation/)

## TSV File Format

The application expects TSV files with the following columns:

| Column | Type | Description |
|--------|------|-------------|
| Stock | String | Stock symbol (e.g., "NYSE:AAPL") |
| Score | Float | Stock score (0.0 to 1.0) |
| Target | Float | Target price |
| ExDividendDate | Date | Ex-dividend date (optional) |
| DividendPerShare | Float | Dividend per share (optional) |
| Notes | String | Additional notes (optional) |
| intrinsicValuePerShareBasic | Float | Basic intrinsic value |
| intrinsicValuePerShareAdjusted | Float | Adjusted intrinsic value |

## Development

### Adding New Features

1. **Data Models**: Add new fields to `StockRecord` in `src/models.rs`
2. **Processing Logic**: Implement new analysis in `src/processor.rs`
3. **Web Interface**: Update the HTML/JS in `docs/index.html`

### Testing

Run the test suite:
```bash
cargo test
```

### Building for Production

Build an optimized release:
```bash
cargo build --release
```

## License

This project is licensed under the MIT License - see the LICENSE file for details.




