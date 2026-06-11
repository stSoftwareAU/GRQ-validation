#!/bin/bash
set -e

echo "🔍 Checking bash script syntax..."
find . -name "*.sh" -type f -exec bash -n {} \;

echo "🧹 Cleaning previous builds..."
cargo clean

echo "📦 Updating dependencies..."
cargo update

echo "🪄 Auto-formatting code..."
cargo fmt --all

echo "🔍 Checking code formatting..."
cargo fmt --all -- --check

echo "🔧 Running linter..."
cargo clippy --all-targets --all-features -- -D warnings -D clippy::uninlined_format_args

# Also run clippy on test files specifically
echo "🔍 Checking test files for clippy warnings..."
cargo clippy --tests --all-features -- -D warnings -D clippy::uninlined_format_args

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

cargo tarpaulin --out Html --output-dir .coverage || {
    echo "⚠️  Coverage generation failed, continuing..."
}

echo "🏗️ Building release version..."
cargo build --release

echo "🔍 Running DenoJS tests..."
deno test --allow-read tests/*.ts

echo "📝 Formatting JS, HTML, and CSS files with deno fmt..."
deno fmt docs/*.js docs/*.html docs/*.css helpers/*.ts tests/*.ts

echo "🔍 Running Deno lint..."
deno lint helpers/*.ts tests/*.ts

echo "✅ Running Deno check..."
deno check helpers/*.ts tests/*.ts

echo "✅ Quality checks completed successfully!"
if [ -d ".coverage" ]; then
    echo "📈 Coverage report available in: .coverage/tarpaulin-report.html"
fi 