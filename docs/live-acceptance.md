# Live acceptance

A workflow is done only after a live acceptance run on the live board, with real models, after the
change is merged and Studio is restarted (captain rule, 2026-10-16). `scripts/live-acceptance.ts`
makes that run repeatable and its report honest.

## When to run it

1. The change is merged to `main`.
2. The live Studio is restarted on the merged code (its board answers on `http://127.0.0.1:4210`).
3. The vendors the workflow uses are signed in. Check this in Studio's Doctor. The script only
   reads login state. It never starts a sign-in.
4. Run it from a checkout of the merged `main`:

```sh
bun scripts/live-acceptance.ts --workflow documents
bun scripts/live-acceptance.ts --all                  # every scenario in workflows/acceptance/
bun scripts/live-acceptance.ts --workflow file-organization --params params.json   # captain input
```

Options: `--base http://127.0.0.1:<port>` (default 4210), `--topic "..."` (replaces the
scenario's brief), `--max-minutes N` and `--max-rounds N` (override the scenario's budget),
`--scenario <file>` (one scenario file), `--scenarios <dir>`.

Real models cost money. Run one workflow at a time unless you mean `--all`.

## What it does

- **Finds Studio** the way `bun src/main.ts open` does: the registered instance record and its
  session (`src/instance.ts`), matched to `--base` by port. The session goes only into the
  `x-crew-session` header. It is never printed or written.
- **Checks login state** (GET `/api/doctor`) for every vendor the scenario lists. When the workflow
  has agent nodes, it also checks the provider the Task will use. A vendor that does not report
  signed in stops the run before any Task starts. The Studio stub provider is refused: live
  acceptance needs real models.
- **Starts a Task** with exactly the body the board's Start form sends: `{text, workflow, params}`.
  The brief starts with `ACCEPT <date>`. If Studio asks for a staffing confirmation, the script
  confirms it only when the scenario allows staffing approvals.
- **Follows the run** over Studio's event stream (`/api/stream`) and reads the Task
  (`/api/tasks/<id>`) on every change.
- **Answers captain cards** only when the scenario lists them as safe. Any other card stops the run.
  Some cards are never answered, whatever the scenario says: merge and promote cards, cards with a
  remote GitHub target, one-way door confirmations, and nodes named for merge, publish, push, PR,
  GitHub, deploy or release. Dispatch and staffing approvals are answered only when the scenario
  allows them. A captain-only card is answered only when its rule says `captain_only: true`.
- **Enforces a budget**: a maximum wall time and a maximum number of Rounds. A run over budget is
  cancelled, so it spends nothing more.
- **Writes a report** to `data/acceptance/<date>/<workflow>.md` and `.json` in the target Studio's
  data folder, and prints both paths. A second run on the same day gets `<workflow>-2`.

A STOP leaves the Task as it is (waiting on its card), so the captain can look at it and answer it on
the board.

## Reading the report

The top lines give the verdict, the Task link, the exact start body, the provider login states, the
budget used and the event-stream counts. Then:

- **STOP**: why the run stopped and which card.
- **Run error**: the run's own error, verbatim.
- **Unmet expectations**: each way the run differs from the scenario.
- **Nodes**: one row per node the run reached. Each row has its status, outcome class (`pass`,
  `fail`, `error`, `interrupted`, `skipped`, `incomplete`), provider and model, Rounds, duration, a
  log link and the first error. An agent node's log link opens its transcript on the board
  (`#/runs/node/<task>/<node>/<round>`). Other nodes link to the Task.
- **Captain cards**: every card the script answered, left for a person, or stopped on.
- **First errors (exact text)**: the first error of each failing node, verbatim, with its log link.

The JSON file holds the same data for tools.

## What counts as pass

| Verdict | Exit | Meaning |
|---|---|---|
| PASS | 0 | No card stopped the run, the budget held, every agent Round ran on a real model (Claude or Codex), and the run ended as the scenario expects (`expect.status` and `expect.result`, or reached `expect.stop_at`) with its expected artifacts. |
| FAIL | 1 | The run ended, but not as expected: wrong status or result, a missing artifact, a Round on a non-real model, or the Task could not start. |
| STOP | 2 | A card that is not safe to answer, a vendor that is not signed in, missing captain input (`required_params`), or a staffing or dispatch approval the scenario does not allow. |
| BUDGET | 3 | The wall time or Round budget ran out. The Task was cancelled. |
| (setup) | 4 | No verified Studio at `--base`, a bad scenario file, or bad arguments. No report is written. |

Only PASS counts as an acceptance. A STOP at an expected point counts only when the scenario says
`stop_at`, because the steps after that card belong to the captain (merge, pull requests, paid
generation the captain must confirm). A report marked **OFFLINE FIXTURE** comes from the offline test
(`--offline-fixture`, stub providers) and never counts.

## Scenario files

There is one reviewed file per bundled workflow on the Start form: `workflows/acceptance/<id>.yaml`.
`scripts/acceptance/scenarios.ts` validates them and makes the card decisions.

```yaml
schema: 1
workflow: documents
topic: "..."                       # the brief after "ACCEPT <date>"
start:
  provider: null                   # the board's provider select: null (Studio's default), claude, codex
  params: {}                       # only params the board's form for this workflow sends
  required_params: [folder]        # captain input; missing ones STOP before start (pass --params)
providers: [codex]                 # vendors that must report signed in
approvals: { staffing: false, dispatch: false }
cards:                             # safe cards; anything else STOPs
  - { node: accept, answer: approved, note: "..." }
  - { node: hold, action: wait }   # leave it for a person on the board; the run keeps following
  - { node: escalation, action: stop }
  - { node: choose, answer: template, captain_only: true }
expect:
  status: succeeded                # or failed / cancelled; or instead: stop_at: <card node>
  result: done                     # optional; a run that ends on a plain hook reports done
  artifacts: [{ deliver: 1 }]      # {deliver: n} | {outputs: n} | {file: <path in the run folder>}
budget: { wall_minutes: 30, max_rounds: 14 }
```

A file that tries to answer an irreversible or external card is refused when it loads.

### Shared with the stub-CLI harness

The stub-CLI acceptance harness (branch `workflow-acceptance-20261016`) is meant to read this same
list. When this was written, that branch had not landed, so this format is the first definition.
The coupling is:

- the harness imports `loadScenario` and `decideCard` from `scripts/acceptance/scenarios.ts`;
- it answers cards with the same rules;
- it checks the same `expect`.

If that harness lands with its own list, merge the two into this format rather than keeping two.

## Offline test

`bun tests/live-acceptance.ts` runs the script against a throwaway Studio on a free port, with
throwaway data and stub CLI vendors. It covers a passing workflow, a failing one (exact error and
log link), a STOP on an unsafe card, a vendor that is not signed in (no sign-in started), both
budgets, and checks that no output or report holds the session.
