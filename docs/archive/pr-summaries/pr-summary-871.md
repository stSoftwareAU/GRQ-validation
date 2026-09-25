## Summary

Re-pinned the actionlint container in `.github/workflows/actionlint.yml` from
the bare digest `docker://rhysd/actionlint@sha256:a0383f60…` to
`docker://rhysd/actionlint:1.7.9@sha256:a0383f60…`. The digest is unchanged, so
the image is identical; the `1.7.9` tag gives Dependabot's `github-actions`
manager something to track, so future linter releases arrive as normal
Dependabot PRs. Closes #871.

## Evidence

Backend/CI-only change — no web interface to screenshot.

- The digest was checked against Docker Hub: the manifest-list digest of
  `rhysd/actionlint:1.7.9` is
  `sha256:a0383f60d92601e2694e24b24d37df7b6a40bed7cedbc447611c50009bf02d94`,
  the same as the existing pin.
- The new test failed against the tagless pin and passes after the re-pin
  (`deno test tests/actionlint_workflow_test.ts`: 12 passed).
- `actionlint .github/workflows/actionlint.yml` reports no findings.

## Test Plan

- Added `tests/actionlint_workflow_test.ts::actionlint docker image pin carries
  a release tag beside its digest`, which requires every `docker://` image in the
  actionlint job to match `image:<X.Y.Z>@sha256:<64 hex>`.
- Existing actionlint workflow tests (immutable-pin test included) still pass.
- `./quality.sh` passes.
