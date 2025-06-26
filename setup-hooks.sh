#!/bin/bash

# Setup script for Git hooks
echo "Setting up Git hooks..."

# Create scripts directory if it doesn't exist
mkdir -p scripts

# Copy the pre-commit hook from shared location to .git/hooks
cp scripts/pre-commit .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit

echo "✅ Pre-commit hook installed successfully!"
echo "The hook will automatically increment version when docs files are committed." 