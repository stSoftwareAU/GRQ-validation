## Summary

Re-pinned the Semgrep job's container image from the tagless
`semgrep/semgrep@sha256:f4791a54…` to
`semgrep/semgrep:1.165.0@sha256:f4791a54c891eabe1188248135574e6e03dfc31dfd3f3b747c7bec7079bfed1b`.
The digest is unchanged, so the scanner runs the identical image. The release
tag gives Dependabot's `github-actions` manager something to key future bumps
off. Closes #872.

## Evidence

- Docker Hub confirms the tag and digest match:
  `hub.docker.com/v2/repositories/semgrep/semgrep/tags/1.165.0` returns digest
  `sha256:f4791a54c891eabe1188248135574e6e03dfc31dfd3f3b747c7bec7079bfed1b`.
- The new test failed against the tagless pin (10 passed, 1 failed) and passes
  after the re-pin (11 passed).
- `./quality.sh` passes.
- This is a CI-only change with no web interface, so there is no screenshot.

## Test Plan

- Added `tests/semgrep_workflow_test.ts::Semgrep container image pin carries a release tag beside its digest`,
  which requires the image to match `semgrep/semgrep:<X.Y.Z>@sha256:<64-hex>`.
- Existing Semgrep workflow tests still pass, including the sha256 digest pin
  test.
- `./quality.sh < /dev/null`
