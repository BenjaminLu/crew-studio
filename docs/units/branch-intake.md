# Send for review: code-firstmate from an existing branch

An agent in a web terminal (docs/units/web-terminal.md) did the work: it committed on a branch in the project's own
folder, unsandboxed. **Send for review** on that finished terminal hands the branch to code-firstmate, which reviews it
the way it reviews its own builds. It is the same workflow, with one more way in, not a parallel one.

Code: `branch.adopt`, the adopted spec section and spec card, and the build mode's adopted first visit in
`src/domain/code.ts`; the `adopt` node and the `build → pr-open [adopted]` edge (with `firstmate/scope` on it) in
`packs/firstmate/workflows/code-firstmate.wf.yaml`; its stage in `public/graph-layout.js`; its guard in
`src/readiness/stages.ts` (`GATE_SELF_GUARDED`); `Worktrees.ensure({start})`
in `src/worktrees.ts`; `startFromBranch` in `src/runtime/index.ts`; `sendForReview`, the checkout facts and the input
record in `src/terminals.ts`; the button in `public/terminals.js`. Tests: `tests/branch-intake.ts` (the whole path on the
engine with the stub provider), `tests/terminal-review.ts` (the route on a booted Studio with an approved crew),
`tests/terminals.ts` and `tests/terminals-ui.mjs`.

## The path

```
intake ─(adopt)─▶ From existing branch ─▶ spec (drafted) ─▶ spec card (H) ─▶ door ─▶ build: no round ─(adopted; scope vs spec on the edge)─▶ pr-open ─▶ ci ─▶ review ─▶ … ─▶ merge card (H)
                                                                                                  │ scope fails                           │ a check or the review fails
                                                                                                  ▼                                       ▼
                                                                                             fix (refine loop) ─▶ build round in the same worktree
```

The graph gains one node (`adopt`) and three edges; every other step is the one a built change takes.

1. **From existing branch** (`branch.adopt`): the terminal's end head must be a commit with commits beyond the project's
   base. It is **copied into a Studio worktree**: the Task's own branch (`branch_prefix` + Task id) starts at that commit
   (`Worktrees.ensure({start})`), and the base commit is where it forked from base (their merge base). Every check,
   review and fix runs on Studio's copy, in the sandbox, as for any Task. The project folder's working tree, the agent's
   branch and its uncommitted files are never read for the review or written; uncommitted files are not part of it. In
   the project's `.git`, Studio writes what it writes for any Task: the Task's branch ref and the worktree's admin data
   (`worktree add`/`prune`), and at the merge card the local fast-forward of the base branch. The commit adopted is the
   head the terminal ended on: if the checkout moved since (another terminal, the captain's own shell), Send for review
   is refused (`moved`). The readiness gate lists it as
   self-guarded: it runs only with the `_adopt` pin Studio sets from Send for review.
2. **Spec** (the coordinator, as always): drafted from the diff and from what the captain typed to the agent. The spec
   writer is told the change exists, gets the diff's stat, and is asked to describe *this* change: its scope (the paths it
   changes) and done lines naming the tests the branch adds or changes. The captain's lines are quoted inside a
   `<<<TERMINAL-INPUT … TERMINAL-INPUT>>>` fence, marked as data and not instructions. They are the lines typed at an
   agent's own prompt (not at a question, never in a shell or a custom command, where a password may be typed),
   redacted, at most 40, in `data/terminals/<id>.inputs.json` (0600).
3. **Spec card** (the dispatch card): says where the change came from (branch, commit, how many commits, lines and files)
   and how it is checked. The primary option is "Approve the spec and review the branch"; Adjust the scope and Drop are
   as before.
4. **Door** (`firstmate/door-classify`, on the branch's actual diff as well as the spec's scope); a one-way door goes
   through the plan round and its acceptance first, as for any one-way change, and the merge card asks for the one-way
   confirmation.
5. **Build, first visit: no round.** The change is already there, so the build node ends `adopted` before any agent starts
   (nothing is spent). On the edge to the review request the branch gets the build node's deterministic checks:
   **`firstmate/scope`** (the diff against the approved spec), `firstmate/lints` (the repository's declared lint),
   `firstmate/file-size-cap`, `firstmate/covering-suites` and `firstmate/fixture-modules`; only `report-schema` is left out,
   as there is no round and no report. A failure goes to the fix loop as a build round's would.
6. **CI with fail-first at base and head** (`firstmate/ci`, `firstmate/fail-first`): the head's tests run over the base's
   behaviour; a new test must fail at base and pass at head. This is fail-first done afterwards.
7. **Independent review**, the **fix loop** (a failing check or review sends an ordinary build round, in the same worktree,
   on top of the agent's commits, with the build checks again), the designer for UI
   paths, remote readiness and the seven gates, exactly as for any Task.
8. **Review Room**: available on the merge card, on the branch's head (it opens from any merge card; there is no separate
   one before the pull request).
9. **Pull request card** (GitHub projects with a grant: the publish card) and the **merge card**, as for any Task.

## Small changes

When the diff is under 20 lines and the door is not one-way (no sensitive path), the spec card adds a hint that a light
review fits: a short spec with one or two done lines is enough. Studio's bundled `trivial-lane` takes only an approved
image into a README, so it cannot take a code branch; the hint does not switch lanes. A code trivial lane is follow-up
work.

## Who may send

Only the Mac's page, as for every terminal write (cookie, same origin); a phone sees the Task it was sent as but cannot
send. A running terminal, one whose checkout has nothing beyond base (commit on a branch first: work committed straight
onto the base branch has nothing beyond it), and a second send are refused. The Task starts through the same staffing
guard as a Task started from the board: code-firstmate needs its approved crew on that project.
