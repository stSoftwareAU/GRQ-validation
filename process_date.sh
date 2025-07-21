#!/bin/bash

# Script to process a single date for GRQ validation
# Usage: ./process_date.sh YYYY-MM-DD

if [ $# -eq 0 ]; then
    echo "Usage: $0 YYYY-MM-DD"
    echo "Example: $0 2025-06-05"
    exit 1
fi

DATE=$1

# Validate date format
if [[ ! $DATE =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
    echo "Error: Invalid date format. Use YYYY-MM-DD"
    echo "Example: 2025-06-05"
    exit 1
fi

echo "Processing date: $DATE"
echo "================================"

# Build the project first
echo "Building project..."
cargo build --release

if [ $? -ne 0 ]; then
    echo "Error: Build failed"
    exit 1
fi

# Process the specific date
echo "Running processor for $DATE..."
./target/release/grq-validation --docs-path docs --date $DATE

if [ $? -eq 0 ]; then
    echo "================================"
    echo "Successfully processed $DATE"
    echo "Check the list view to see the results: http://localhost:8000/list.html"
else
    echo "================================"
    echo "Error processing $DATE"
    exit 1
fi 