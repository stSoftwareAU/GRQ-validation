# CI/CD Setup Guide

This repository includes GitHub Actions workflows for continuous integration and deployment.

## Workflows

### 1. CI (`ci.yml`)
**Triggers:** Push to main/master, Pull requests to main/master

**What it does:**
- ✅ Checks code formatting with `cargo fmt`
- ✅ Runs linting with `cargo clippy`
- ✅ Builds the project in debug and release modes
- ✅ Runs all tests
- ✅ Checks for security vulnerabilities with `cargo audit`
- ✅ Uploads build artifacts

### 2. Rust CI (`rust.yml`)
**Triggers:** Push to main/master/develop, Pull requests, Weekly security checks

**What it does:**
- ✅ All CI checks above
- ✅ Tests against multiple Rust versions (stable, 1.75)
- ✅ Additional security checks
- ✅ Dependency outdated checks
- ✅ Documentation generation and deployment

### 3. Deploy (`deploy.yml`)
**Triggers:** Push to main/master, Manual dispatch

**What it does:**
- ✅ Builds the Rust project
- ✅ Processes data with the latest score files
- ✅ Deploys the web application to GitHub Pages

## Setup Instructions

### 1. Enable GitHub Actions
1. Go to your repository on GitHub
2. Click on "Actions" tab
3. Click "Enable Actions" if not already enabled

### 2. Set up GitHub Pages
1. Go to repository Settings
2. Scroll down to "Pages" section
3. Under "Source", select "GitHub Actions"
4. The deploy workflow will automatically handle deployments

### 3. Configure Repository Secrets (Optional)
For enhanced security, you can add these secrets:

```bash
# Go to Settings > Secrets and variables > Actions
# Add these secrets if needed:

RUST_LOG=info
CARGO_REGISTRY_TOKEN=your_cargo_token
```

### 4. Branch Protection (Recommended)
1. Go to Settings > Branches
2. Add rule for `main` branch:
   - ✅ Require status checks to pass before merging
   - ✅ Require branches to be up to date before merging
   - ✅ Select the CI workflow as required

## Workflow Details

### CI Pipeline
```yaml
# Triggers on every push/PR
on:
  push:
    branches: [ main, master ]
  pull_request:
    branches: [ main, master ]

# Steps:
1. Checkout code
2. Install Rust toolchain
3. Cache dependencies
4. Check formatting (cargo fmt)
5. Run linter (cargo clippy)
6. Build project
7. Run tests
8. Build release version
9. Security audit
10. Upload artifacts
```

### Deployment Pipeline
```yaml
# Triggers on push to main/master
on:
  push:
    branches: [ main, master ]

# Steps:
1. Checkout code
2. Setup GitHub Pages
3. Build Rust project
4. Process data files
5. Upload to GitHub Pages
6. Deploy
```

## Local Development

### Pre-commit Checks
Before pushing, run these locally:

```bash
# Format code
cargo fmt

# Run linter
cargo clippy --all-targets --all-features -- -D warnings

# Run tests
cargo test

# Check for security issues
cargo audit

# Build release version
cargo build --release
```

### Testing Locally
```bash
# Run all tests
cargo test

# Run specific test
cargo test test_name

# Run with verbose output
cargo test --verbose

# Run integration tests
cargo test --test '*'
```

## Troubleshooting

### Common Issues

1. **Workflow fails on formatting**
   ```bash
   cargo fmt
   git add .
   git commit -m "Format code"
   ```

2. **Workflow fails on clippy**
   ```bash
   cargo clippy --all-targets --all-features -- -D warnings
   # Fix any warnings, then commit
   ```

3. **Security audit fails**
   ```bash
   cargo audit
   # Update dependencies if needed
   cargo update
   ```

4. **Tests fail**
   ```bash
   cargo test --verbose
   # Check test output for specific failures
   ```

### Performance Tips

1. **Use dependency caching** (already configured)
2. **Run tests in parallel** (Rust does this automatically)
3. **Use release builds for deployment**

### Monitoring

- Check Actions tab for workflow status
- Review logs for detailed error information
- Monitor GitHub Pages deployment status
- Check security alerts in repository

## Customization

### Adding New Checks
Edit `.github/workflows/ci.yml`:

```yaml
- name: Custom check
  run: |
    # Your custom commands here
    echo "Running custom check"
```

### Modifying Triggers
Change the `on` section:

```yaml
on:
  push:
    branches: [ main, master, develop ]
  pull_request:
    branches: [ main, master ]
  schedule:
    - cron: '0 2 * * 1'  # Weekly on Monday at 2 AM
```

### Environment Variables
Add to workflow:

```yaml
env:
  RUST_LOG: info
  CARGO_TERM_COLOR: always
```

## Security

- All workflows run in isolated environments
- Secrets are encrypted and not logged
- Dependencies are cached securely
- Security audits run automatically
- GitHub Pages uses HTTPS by default

## Support

If you encounter issues:

1. Check the Actions tab for detailed logs
2. Review this documentation
3. Check GitHub Actions documentation
4. Open an issue with workflow logs attached 