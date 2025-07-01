#!/bin/bash
set -e

echo "🧹 Cleaning previous builds..."
cargo clean

echo "📦 Updating dependencies..."
cargo update

echo "🪄 Auto-formatting code..."
cargo fmt --all

echo "🔍 Checking code formatting..."
cargo fmt --all -- --check

echo "🔧 Running linter..."
cargo clippy --all-targets --all-features -- -D warnings --deny warnings

echo "✅ Running type checks..."
cargo check --all-targets --all-features

# Additional clippy check to ensure no warnings
echo "🔍 Double-checking clippy warnings..."
cargo clippy --all-targets --all-features -- -D warnings || {
    echo "❌ Clippy warnings found! Please fix them before committing."
    exit 1
}

echo "🧪 Running tests..."
cargo test --all-targets --all-features --verbose

echo "📊 Running tests with coverage..."
# Install tarpaulin if not available
if ! command -v cargo-tarpaulin &> /dev/null; then
    echo "Installing cargo-tarpaulin..."
    cargo install cargo-tarpaulin
fi

cargo tarpaulin --out Html --output-dir .coverage || {
    echo "⚠️  Coverage generation failed, continuing..."
}

echo "🏗️ Building release version..."
cargo build --release

echo "🔍 Running DenoJS tests..."
deno test tests/*.ts

echo "📝 Formatting JS, HTML, and CSS files with deno fmt..."
deno fmt docs/*.js docs/*.html docs/*.css tests/*.ts

echo "🔍 Running Deno lint..."
deno lint tests/*.ts

echo "✅ Running Deno check..."
deno check tests/*.ts

echo "✅ Quality checks completed successfully!"
if [ -d ".coverage" ]; then
    echo "📈 Coverage report available in: .coverage/tarpaulin-report.html"
fi 