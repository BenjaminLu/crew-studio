# Fix round 1, class sandbox: the check sandbox is an allow-list (runtime brief item 2; legacy A2)

Answers: check-runtime#4 (deny-list sandbox), check-runtime#3 (timeout with child processes: the group kill and the pipe race), legacy gates#1 / brief A2 (`run` gates outside the contract and the sandbox), check-runtime#1 (Doctor shows the sandbox), check-runtime#10 (no more `ok(true)` off macOS).

Done when (each line is proved by `tests/sandbox.ts`, red on the base, where the profile allows everything not denied and `run` gates spawn unconfined):

1. A check reads only the system, the interpreters on PATH, its own directory and the paths its input names; it cannot read Studio's `ledger.key` (or keys, tokens, policies, the user's secret folders) even when its input names one, and cannot read a file its input does not name. — "a check reads the input …", "a check cannot read Studio's ledger key …", "a check cannot read a file its input does not name".
2. A check writes only to its `out/` folder; it reaches neither the network nor a unix socket; it cannot launch an app through LaunchServices. — "a check writes only to its out/ folder", "a check reaches neither the network nor a unix socket", "a check cannot launch an app …".
3. At its time limit the whole process group is killed and the call returns even when a grandchild holds the pipe. — "at its time limit a check returns …", "and the whole process group is gone".
4. A legacy `run` gate is an exit-code adapter check executed by the same sandboxed executor (one interface): it cannot write the worktree or reach the network, gets a scrubbed HOME, and leaves no process after its timeout. — "a run gate cannot write the worktree", "… cannot reach the network", "… gets a scrubbed HOME", "a timed-out run gate leaves no process behind".
5. Without an OS sandbox a check is refused, never run unconfined, and the Doctor shows the sandbox status. — "without an OS sandbox a check is refused …", "the Doctor shows the sandbox status", "on macOS the Doctor shows the sandbox as ok".

Off macOS there is no equivalent sandbox in this build: checks are refused there (proposed doc note for architecture §10: "checks need macOS sandbox-exec; elsewhere they are refused until a Linux sandbox lands").
