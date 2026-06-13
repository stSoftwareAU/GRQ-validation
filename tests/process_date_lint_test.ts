// Regression tests for process_date.sh ShellCheck cleanliness (Issue #176).
//
// The baseline carried three ShellCheck findings against process_date.sh:
//   - SC2181 at line 28 (indirect exit-code check after `cargo build`)
//   - SC2086 at line 35 (unquoted $DATE argument)
//   - SC2181 at line 37 (indirect exit-code check after the processor run)
//
// These guards inspect the committed script and fail if any of the
// antipatterns reappear, mirroring this repo's convention of statically
// asserting script/workflow posture (see shellcheck_workflow_test.ts).

import { assert } from "@std/assert";

const SCRIPT_PATH = "process_date.sh";

async function readScript(): Promise<string> {
  return await Deno.readTextFile(SCRIPT_PATH);
}

Deno.test("process_date.sh checks exit codes directly, not via $? (SC2181)", async () => {
  const text = await readScript();
  // SC2181 fires on `if [ $? ... ]` / `if [[ $? ... ]]` indirect checks.
  const indirectCheck = /\bif\s+\[\[?\s+\$\?/;
  assert(
    !indirectCheck.test(text),
    "process_date.sh must check command exit status directly " +
      "(e.g. `if ! mycmd; then`), not indirectly via $?",
  );
});

Deno.test("process_date.sh double-quotes the $DATE argument (SC2086)", async () => {
  const text = await readScript();
  // The processor invocation must quote $DATE to prevent globbing/splitting.
  const quotedDate = /--date\s+"\$DATE"/;
  assert(
    quotedDate.test(text),
    'process_date.sh must pass the date as a quoted "$DATE" argument',
  );
  const unquotedDate = /--date\s+\$DATE(?!")/;
  assert(
    !unquotedDate.test(text),
    "process_date.sh must not pass an unquoted $DATE argument",
  );
});
