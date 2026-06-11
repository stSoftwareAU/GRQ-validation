# Auto-Format Workflow

## Overview
The auto-format workflow automatically formats Rust code and commits the changes back to pull requests, ensuring consistent code formatting across the project.

## Workflows

### 1. Auto-Format Workflow (`auto-format.yml`)
**Triggers:** Pull requests to main/master/develop, Manual dispatch

**What it does:**
- ✅ Automatically formats Rust code using `cargo fmt`
- ✅ Commits and pushes formatting changes back to the PR
- ✅ Focused solely on formatting (no duplicate checks)
- ✅ Avoids conflicts with main CI workflow

### 2. Enhanced CI Workflow (`ci.yml`)
**Triggers:** Push to main/master, Pull requests

**What it does:**
- ✅ All previous CI checks
- ✅ Enhanced type checking and validation
- ✅ Project structure validation
- ✅ Documentation quality checks
- ✅ Binary permissions verification
- ✅ Format checking (cargo fmt --check)
- ✅ Linting (cargo clippy)
- ✅ Security auditing (cargo audit)

## How Auto-Format Works

### 1. **Trigger**
- Automatically runs on every pull request
- Can be manually triggered via workflow dispatch

### 2. **Formatting Process**
```yaml
- name: Format Code
  run: cargo fmt

- name: Check for Changes
  id: check_changes
  run: |
    if git diff --quiet; then
      echo "has_changes=false" >> $GITHUB_OUTPUT
    else
      echo "has_changes=true" >> $GITHUB_OUTPUT
    fi
```

### 3. **Auto-Commit**
```yaml
- name: Commit Changes
  if: steps.check_changes.outputs.has_changes == 'true'
  run: |
    git config user.name "github-actions[bot]"
    git config user.email "github-actions[bot]@users.noreply.github.com"
    git add .
    git commit -m "chore: apply rust fmt fixes [skip ci]"

- name: Push Changes
  if: steps.check_changes.outputs.has_changes == 'true'
  run: git push origin
```

## Benefits

### 1. **Consistent Formatting**
- All code follows the same formatting standards
- No manual formatting required
- Reduces code review time

### 2. **Automated Quality**
- Ensures code meets Rust standards
- Catches formatting issues early
- Maintains project quality

### 3. **Developer Experience**
- No need to remember formatting commands
- Automatic feedback on code quality
- Streamlined development workflow

## Setup Requirements

### 1. **Repository Permissions**
The workflow needs write permissions to push to PR branches:

```yaml
- name: Checkout code
  uses: actions/checkout@v4
  with:
    token: ${{ secrets.GITHUB_TOKEN }}
    ref: ${{ github.head_ref }}
```

### 2. **Branch Protection**
Consider configuring branch protection to:
- Require status checks to pass
- Allow auto-format workflow to push changes
- Prevent direct pushes to main branch

## Workflow Jobs

### Auto-Format Job
```yaml
auto-format:
  name: Auto-format Code
  runs-on: ubuntu-latest
  if: github.event_name == 'pull_request'
  
  Steps:
  1. Checkout code with write permissions
  2. Install Rust toolchain
  3. Cache dependencies
  4. Format code with cargo fmt
  5. Check for formatting changes
  6. Commit and push changes (if any)
```

### Format Check Job
**Note:** Format checking is handled by the main CI workflow (`ci.yml`) to avoid conflicts with the auto-format job.

The main CI workflow includes:
- Format checking (cargo fmt --check)
- Linting (cargo clippy)
- Type checking (cargo check)
- Building and testing
- Security auditing

## Validation Job (Enhanced CI)

### Project Validation
```yaml
validation:
  name: Project Validation
  runs-on: ubuntu-latest
  
  Steps:
  1. Check for required files
  2. Validate Cargo.toml
  3. Check documentation quality
  4. Verify run.sh permissions
```

### Required Files Check
The validation job checks for essential project files:
- `Cargo.toml` - Project configuration
- `README.md` - Project documentation
- `LICENSE` - Project license
- `src/main.rs` - Main application entry
- `run.sh` - Build and execution script

## Usage Examples

### 1. **Normal Development Flow**
1. Create a feature branch
2. Make code changes
3. Create a pull request
4. Auto-format workflow runs automatically
5. Formatting changes are committed back to PR
6. Review and merge

### 2. **Manual Trigger**
1. Go to Actions tab
2. Select "Auto-format Code" workflow
3. Click "Run workflow"
4. Select branch and run

### 3. **Formatting Issues**
If formatting fails:
1. Check the workflow logs
2. Fix any formatting issues locally
3. Push changes to trigger re-run
4. Workflow will auto-format and commit

## Configuration

### 1. **Rust Formatting**
The workflow uses default `cargo fmt` settings. To customize:

Create `.rustfmt.toml` in project root:
```toml
edition = "2021"
max_width = 100
tab_spaces = 4
newline_style = "Unix"
```

### 2. **Clippy Configuration**
Create `.clippy.toml` for custom linting rules:
```toml
# Custom clippy settings
```

### 3. **Workflow Triggers**
Modify the `on` section to change when workflows run:
```yaml
on:
  pull_request:
    branches: [ main, master, develop ]
  push:
    branches: [ main, master ]
  workflow_dispatch:
```

## Troubleshooting

### Common Issues

1. **Permission Denied**
   - Ensure workflow has write permissions
   - Check branch protection settings
   - Verify token permissions

2. **Formatting Conflicts**
   - Pull latest changes from main
   - Re-run auto-format workflow
   - Resolve any merge conflicts

3. **Workflow Not Triggering**
   - Check branch name matches triggers
   - Verify workflow file is in correct location
   - Check for syntax errors in workflow

### Debug Steps

1. **Check Workflow Logs**
   - Go to Actions tab
   - Click on failed workflow
   - Review step-by-step logs

2. **Local Testing**
   ```bash
   # Test formatting locally
   cargo fmt --check
   
   # Apply formatting
   cargo fmt
   
   # Check for changes
   git diff
   ```

3. **Manual Formatting**
   ```bash
   # Format specific files
   cargo fmt src/main.rs
   
   # Format with specific options
   cargo fmt -- --config-path .rustfmt.toml
   ```

## Best Practices

### 1. **Pre-commit Hooks**
Consider setting up pre-commit hooks locally:
```bash
# Install pre-commit
pip install pre-commit

# Create .pre-commit-config.yaml
repos:
  - repo: https://github.com/rust-lang/rustfmt
    rev: v1.5.1
    hooks:
      - id: rustfmt
```

### 2. **IDE Integration**
Configure your IDE to format on save:
- **VS Code**: Install Rust extension
- **IntelliJ**: Enable "Format on Save"
- **Vim/Neovim**: Use rustfmt plugin

### 3. **Team Workflow**
- Use consistent formatting settings
- Review auto-format commits
- Document any custom formatting rules

## References

- [Rust Formatting Guide](https://rust-lang.github.io/rustfmt/)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Cargo Book](https://doc.rust-lang.org/cargo/)
- [Clippy Documentation](https://rust-lang.github.io/rust-clippy/) 