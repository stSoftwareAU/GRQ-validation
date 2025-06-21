#!/bin/bash
set -e

echo "🧹 Cleaning previous builds..."
cargo clean

echo "📦 Updating dependencies..."
cargo update

echo "🔍 Checking code formatting..."
cargo fmt --all -- --check

echo "🔧 Running linter..."
cargo clippy --all-targets --all-features -- -D warnings

echo "✅ Running type checks..."
cargo check --all-targets --all-features

echo "🧪 Running tests..."
cargo test --all-targets --all-features --verbose

echo "📊 Running tests with coverage..."
# Install tarpaulin if not available
if ! command -v cargo-tarpaulin &> /dev/null; then
    echo "Installing cargo-tarpaulin..."
    cargo install cargo-tarpaulin
fi

cargo tarpaulin --out Html --output-dir coverage || {
    echo "⚠️  Coverage generation failed, continuing..."
}

echo "🏗️ Building release version..."
cargo build --release

echo "✅ Quality checks completed successfully!"
if [ -d "coverage" ]; then
    echo "📈 Coverage report available in: coverage/tarpaulin-report.html"
fi 