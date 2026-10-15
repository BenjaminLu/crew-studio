# The reviewer runs the tests and reads the changed files

R-002's reviewer made one tool call and approved from the diff. v1's reviewer protocol (skills/reviewer/SKILL.md, run mode): claims are checked by running; the review ends with **Executed** and **Read, not run**.

Done when (`tests/review-depth.ts`; red on 5f07cdb, where the reviewer had no file or test tools):
1. A verdict from a reviewer that only read the diff is refused, and the refusal names what is missing (run the tests; read each changed file in full). — "a verdict from a reviewer that only read the diff is refused …".
2. The retry gets the refusal as its brief; with no verified verdict there is no review verdict, no approval and no merge card. — "the reviewer's retry is given that refusal as its brief", "with no verified verdict there is no review verdict …".
3. A reviewer that runs the repository's tests in its sandbox and reads every changed file in full: firstmate/review-depth (blocking, on the review node) passes and records the commands with their exits and the files read; its verdict stands. — "a reviewer that ran the repository's tests (exit 0) and read every changed file in full …", "its verdict stands and the run reaches the merge card".
4. firstmate/review-depth fails a verdict recorded without either (defence behind the tool). — "firstmate/review-depth fails a verdict that has neither …".
Borrowed from v1: skills/reviewer/SKILL.md (run mode, Executed / Read, not run). Stub: the reviewer runs the tests and reads the changed files; STUB_SHALLOW_REVIEW on an added line makes it a diff-only reviewer.
