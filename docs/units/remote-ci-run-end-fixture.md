# Cancelled presentation ownership fixture

This unit changes tests only. Remote cancellation withdraws the card raising owner immediately; it does not end an underlying native check promise. Archive and delete remain blocked by the owned node/native work until that promise settles. The old run-end fixture expected the obsolete raising-card label after cancellation and waited for card existence rather than check execution.

The replacement uses an explicit native-check start barrier and held promise. It verifies raising ownership before cancellation, immediate card withdrawal, archive/delete refusal while the underlying promise remains held, no ordinary late check result/node movement/replacement card after release, and deletion as the final ledger record with no recreated directory or cards. Production cancellation guards remain unchanged.

Historical dc776e run-end evidence is retained at `/tmp/remote-ci-r4-run-end-failfirst.log` and `.exit`: 35 passed, 1 failed. This is an expectation correction, not a new production feature fail-first claim. A repository-wide search of TypeScript tests found no other post-cancellation raising-card expectations; the lifetime PID proof already captures evidence before terminal cancellation.

Focused final evidence (all exit 0): run-end 39/0, lifetime 6/0, remote lifecycle 34/0, runtime 56/0, remote reconcile/cancel proof 48/0. Logs and durable exits are `/tmp/remote-ci-r4-{run-end,lifetime,lifecycle,runtime,cancel-proof}.log` and `.exit`. No worker full-suite run; independent review and frozen full-suite acceptance belong to the coordinating firstmate.
