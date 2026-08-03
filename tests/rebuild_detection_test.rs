//! Behaviour tests for `run.sh`'s rebuild decision (issue #816).
//!
//! The old check diffed `HEAD~1..HEAD` only, so a sync that fast-forwarded
//! several commits at once — or that landed a docs commit on top of a `src/`
//! change — kept the previously built binary. #803 changed the caller and the
//! binary together, so GRQ-3 ended up running a pre-#803 binary against a
//! post-#803 caller and died on `unexpected argument '--market-data-path'`.
//!
//! These tests drive the real `run.sh` inside a sandbox: a stub `cargo` on
//! `PATH` records its arguments, and a stub binary stands in for the release
//! build. They assert on observable behaviour — was `cargo build --release`
//! invoked, did the run continue, did a build failure stop it — never on the
//! script's text.

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::process::Command;
use tempfile::TempDir;

/// Writes `body` to `path` as an executable script.
fn write_executable(path: &Path, body: &str) {
    fs::create_dir_all(path.parent().expect("script has a parent")).expect("create parent dir");
    fs::write(path, body).unwrap_or_else(|error| panic!("write {}: {error}", path.display()));
    fs::set_permissions(path, fs::Permissions::from_mode(0o755)).expect("chmod script");
}

/// Runs `git` in `dir`, failing loudly so a broken fixture never masquerades as
/// a passing test.
fn git(dir: &Path, args: &[&str]) {
    let output = Command::new("git")
        .args(args)
        .current_dir(dir)
        .env("GIT_AUTHOR_NAME", "test")
        .env("GIT_AUTHOR_EMAIL", "test@example.com")
        .env("GIT_COMMITTER_NAME", "test")
        .env("GIT_COMMITTER_EMAIL", "test@example.com")
        .output()
        .unwrap_or_else(|error| panic!("git {args:?}: {error}"));

    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

/// A copy of the entry points in a throwaway directory, with stubs for `cargo`
/// and the release binary.
struct Sandbox {
    dir: TempDir,
}

impl Sandbox {
    /// Copies `run.sh` and its guard, and installs a stub `cargo` that records
    /// each invocation and exits with `cargo_exit_code`, plus a stub release
    /// binary that records its own invocation.
    fn new(cargo_exit_code: u8) -> Self {
        let dir = tempfile::tempdir().expect("create sandbox");
        let root = dir.path();
        let repo_root = Path::new(env!("CARGO_MANIFEST_DIR"));

        for relative in ["run.sh", "scripts/require_data_roots.sh"] {
            let destination = root.join(relative);
            fs::create_dir_all(destination.parent().expect("script has a parent"))
                .expect("create script dir");
            fs::copy(repo_root.join(relative), &destination)
                .unwrap_or_else(|error| panic!("copy {relative}: {error}"));
        }

        // `run.sh` prepends `$HOME/.cargo/bin`, so the stub must live there to
        // shadow any real cargo on the host.
        write_executable(
            &root.join(".cargo/bin/cargo"),
            &format!(
                "#!/bin/bash\nprintf '%s\\n' \"$*\" >> \"$SANDBOX/cargo-invocations\"\nexit {cargo_exit_code}\n"
            ),
        );
        write_executable(
            &root.join("target/release/grq-validation"),
            "#!/bin/bash\nprintf '%s\\n' \"$*\" >> \"$SANDBOX/binary-invocations\"\n",
        );

        fs::create_dir_all(root.join("docs")).expect("create docs dir");
        fs::create_dir_all(root.join("market-data")).expect("create market data dir");
        fs::create_dir_all(root.join("dividend-data")).expect("create dividend data dir");

        Self { dir }
    }

    fn path(&self) -> &Path {
        self.dir.path()
    }

    /// Builds a history whose newest commit touches docs only, so the deleted
    /// `HEAD~1..HEAD` check would have seen no source change — the exact shape
    /// of a multi-commit fast-forward that stranded a stale binary.
    fn with_source_change_before_head(self) -> Self {
        let root = self.path();
        git(root, &["init", "--initial-branch=main"]);
        fs::create_dir_all(root.join("src")).expect("create src dir");
        fs::write(root.join("src/main.rs"), "fn main() {}\n").expect("write source");
        git(root, &["add", "src/main.rs"]);
        git(root, &["commit", "-m", "add source"]);
        fs::write(root.join("docs/index.html"), "<html></html>\n").expect("write docs");
        git(root, &["add", "docs/index.html"]);
        git(root, &["commit", "-m", "docs only"]);
        self
    }

    /// Runs the sandboxed `run.sh` and returns `(success, combined output)`.
    fn run(&self) -> (bool, String) {
        let root = self.path();
        let output = Command::new("bash")
            .arg(root.join("run.sh"))
            .current_dir(root)
            .env("HOME", root)
            .env("SANDBOX", root)
            .env(
                "PATH",
                format!("/usr/bin:/bin:{}", root.join(".cargo/bin").display()),
            )
            .env("GRQ_MARKET_DATA_PATH", root.join("market-data"))
            .env("GRQ_DIVIDEND_DATA_PATH", root.join("dividend-data"))
            .output()
            .expect("run run.sh");

        let mut combined = String::from_utf8_lossy(&output.stdout).into_owned();
        combined.push_str(&String::from_utf8_lossy(&output.stderr));
        (output.status.success(), combined)
    }

    /// Everything the stub `cargo` was asked to do, one invocation per line.
    fn cargo_invocations(&self) -> String {
        fs::read_to_string(self.path().join("cargo-invocations")).unwrap_or_default()
    }

    /// Everything the stub release binary was asked to do.
    fn binary_invocations(&self) -> String {
        fs::read_to_string(self.path().join("binary-invocations")).unwrap_or_default()
    }
}

#[test]
fn rebuilds_when_the_source_change_predates_head() {
    let sandbox = Sandbox::new(0).with_source_change_before_head();

    let (success, message) = sandbox.run();

    assert!(success, "run.sh must succeed, got:\n{message}");
    assert!(
        sandbox.cargo_invocations().contains("build --release"),
        "run.sh must rebuild when the source change is older than HEAD, got cargo invocations:\n{}\nand output:\n{message}",
        sandbox.cargo_invocations()
    );
}

#[test]
fn runs_the_binary_after_rebuilding() {
    let sandbox = Sandbox::new(0).with_source_change_before_head();

    let (success, message) = sandbox.run();

    assert!(success, "run.sh must succeed, got:\n{message}");
    assert!(
        sandbox.binary_invocations().contains("--market-data-path"),
        "run.sh must still pass the data-root flags after rebuilding, got:\n{}",
        sandbox.binary_invocations()
    );
}

#[test]
fn rebuilds_outside_a_git_checkout() {
    // A tarball or rsync deployment has no git history at all; the rebuild
    // decision must not depend on one.
    let sandbox = Sandbox::new(0);

    let (success, message) = sandbox.run();

    assert!(success, "run.sh must succeed, got:\n{message}");
    assert!(
        sandbox.cargo_invocations().contains("build --release"),
        "run.sh must rebuild without a git checkout, got cargo invocations:\n{}\nand output:\n{message}",
        sandbox.cargo_invocations()
    );
}

#[test]
fn build_failure_fails_loud_and_skips_the_binary() {
    let sandbox = Sandbox::new(1).with_source_change_before_head();

    let (success, message) = sandbox.run();

    assert!(
        !success,
        "a failed build must exit non-zero, got:\n{message}"
    );
    assert!(
        message.contains("Build failed"),
        "a failed build must say so, got:\n{message}"
    );
    assert!(
        sandbox.binary_invocations().is_empty(),
        "a failed build must not run the binary, got:\n{}",
        sandbox.binary_invocations()
    );
}
