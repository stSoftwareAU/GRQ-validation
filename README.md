# GRQ Validation

A Rust-based system for validating AI predictions against 90-day targets and 10% annual cost of capital.

## Features

- **Performance Tracking**: Calculate 90-day and annualized performance for stock portfolios
- **Market Data Integration**: Fetch and process historical stock data
- **Dividend Tracking**: Calculate dividend income and total returns
- **Web Dashboard**: Interactive charts and tables for performance analysis
- **Automated Processing**: Batch processing of score files with inline performance calculation

## Quick Start

### Prerequisites
- Rust (latest stable)
- Git

### Installation
```bash
git clone <repository-url>
cd GRQ-validation
cargo build --release
```

### Usage
```bash
# Process recent score files (within 180 days)
./run.sh

# Process all score files
./run.sh --process-all

# Process a specific date
./target/release/grq-validation --docs-path docs --date 2025-01-15
```

### Web Interface
```bash
# Start the web server
cd docs
python3 -m http.server 8000
# Or use any static file server
```

Visit `http://localhost:8000` to access the dashboard.

## CI/CD Pipeline

This repository includes comprehensive GitHub Actions workflows for continuous integration and deployment.

### Workflows

1. **CI** (`ci.yml`) - Main continuous integration
   - Code formatting and linting
   - Build and test
   - Security audits
   - Artifact upload

2. **Rust CI** (`rust.yml`) - Extended Rust testing
   - Multi-version testing (stable, 1.75)
   - Additional security checks
   - Documentation generation

3. **Deploy** (`deploy.yml`) - GitHub Pages deployment
   - Automatic deployment on main branch
   - Data processing and web app deployment

4. **Dependencies** (`dependencies.yml`) - Automated dependency updates
   - Weekly dependency checks
   - Automatic PR creation for updates

### Setup
1. Enable GitHub Actions in your repository
2. Configure GitHub Pages (Settings > Pages > Source: GitHub Actions)
3. Set up branch protection rules (recommended)

See [CI_CD_SETUP.md](CI_CD_SETUP.md) for detailed setup instructions.

## Project Structure

```
GRQ-validation/
├── src/                    # Rust source code
│   ├── main.rs            # Main application entry point
│   ├── models.rs          # Data structures
│   ├── utils.rs           # Utility functions
│   └── lib.rs             # Library interface
├── docs/                   # Web application
│   ├── index.html         # Main dashboard
│   ├── list.html          # Score files list
│   ├── list.css           # List page styling
│   ├── list.js            # List page logic
│   ├── app.js             # Main dashboard logic
│   ├── styles.css         # Main dashboard styling
│   └── scores/            # Score files and data
├── tests/                  # Test files
├── .github/workflows/      # GitHub Actions
├── run.sh                  # Main execution script
└── Cargo.toml             # Rust dependencies
```

## Development

### Local Development
```bash
# Format code
cargo fmt

# Run linter
cargo clippy --all-targets --all-features -- -D warnings

# Run tests
cargo test

# Build release
cargo build --release
```

### Testing
```bash
# Run all tests
cargo test

# Run specific test
cargo test test_name

# Run with verbose output
cargo test --verbose
```

## Configuration

### Environment Variables
- `RUST_LOG`: Logging level (default: info)
- `CARGO_TERM_COLOR`: Terminal color output

### Command Line Options
- `--docs-path`: Path to docs directory (default: docs)
- `--process-all`: Process all files, not just recent ones
- `--calculate-performance`: Only calculate performance metrics
- `--date`: Process specific date (YYYY-MM-DD format)
- `--verbose`: Enable verbose logging

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests and linting
5. Submit a pull request

## License

[Add your license information here]

## Support

For issues and questions:
1. Check the [CI_CD_SETUP.md](CI_CD_SETUP.md) for workflow issues
2. Review existing issues
3. Create a new issue with detailed information




