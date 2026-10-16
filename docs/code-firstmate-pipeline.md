# code-firstmate: firstmate's coding pipeline on the check contract

Source of truth for behaviour: ~/Desktop/firstmate-workflow (design/design.md, skills/*). This document maps it onto Studio nodes, checks ([check-contract.md](check-contract.md)), policies and hooks. D = deterministic check, J = judged check, H = human card, A = agent node.

## Roles

| v1 actor | v2 node |
|---|---|
| captain | H nodes. A policy can auto-answer some card kinds inside an authorization window. |
| firstmate | `coordinator` A node: drafts specs, answers plan questions, diagnoses red CI, enriches briefs, triages follow-ups |
| worker | `worker` A node in its own worktree; one round = one Round |
| reviewer | `reviewer` A node, fresh context, diff + CI + fail-first report only |
| designer reviewer | `designer` A node; required by policy when the diff touches UI paths |
| autopilot | the runtime itself |

## Graph

```
intent ─▶ spec ─▶ dispatch(H) ─▶ door ─┬─ one-way ─▶ plan ─▶ plan-accept ─┐
                                       └─ two-way ──────────────────────┴▶ build ─▶ pr-open ─▶ ci ─▶ review ─▶ remote-ready ─┬─▶ gates ─▶ merge(H) ─▶ merge ─▶ after-merge
                                                                         ▲                       │
                                                                         └──── fix (refine loop) ◀┘
```

## Nodes and their checks

### 1. spec (A: coordinator; output artifact type `spec`)

| check | kind | blocking | what it proves | v1 origin |
|---|---|---|---|---|
| spec-schema | D | yes | what/why/done lines, scope, door, explain block in en and zh-TW, and `zh` (the title and why in zh-TW, which the cards show) | fm-spec checks |
| done-lines-provable | D+J | yes | every done line names a test and a fail-first marker that can run in CI. D checks the names; J checks that the test can observe the behaviour | "done lines must be provable" |
| caller-coverage | D | yes | every caller and mirror of a changed shared script is in scope (grep) | "spec lists every caller" |
| overlap | D | yes | the scope does not overlap a pinned in-flight scope | "check overlap before dispatch" |
| ste-wording | D | yes | plain-English rules (banned words, sentence length); a zh-TW text (zh title, zh why, zh explain) is a real Chinese translation, not English behind a Chinese word, not a stock placeholder | fm_ste |
| no-impl-detail | J | warn | no line numbers or implementation steps in the spec | "specs: what, why, done" |
| env-preflight | D | yes | the environment the build needs, read from the base: the lockfile's package manager is installed, the test command resolves (`.crew/gates.json` `test`, else package.json `scripts.test`), and every done-line test path matches the repository's test globs. A gap is a typed record (`env.test-command`, `env.test-path`, `env.tool-missing`) sent to Firstmate's spec repair turn; only `env.permission` (dependencies that need a registry host the round sandbox may not reach) raises a captain card. Never a HOLD inside the build round (R-028) | "local deps and fresh worktrees", "done lines must be provable" |

The refine loop runs on the coordinator until the blocking checks pass, and only then is the dispatch card raised.

### 2. dispatch (H)

- The card shows the spec, door and rollback, and runs ste-wording on itself.
- Policy `auth.window`: kinds `[dispatch, merge, repin]` until a time; when the window is open, the runtime answers A and records who granted it.

### 3. door (D: door-classify)

- scope ∩ `policy.sensitive_paths` → `one-way`, otherwise `two-way`. The result picks the outgoing edge.
- A diff that later touches a sensitive path re-routes at the gates (see 8), never mid-round.

### 4. plan (A: worker, one-way only) and plan-accept (A: coordinator, escalates to H)

| check | kind | blocking |
|---|---|---|
| plan-covers-done-lines | D | yes. Every done line has a row (v1 refused the T-307 plan for two missing rows) |
| questions-listed | D | yes. All questions in one block |

- The coordinator answers the questions. A question that changes scope escalates to a scope card (H).
- Plan acceptance is signed evidence bound to the round and the head.

### 5. build (A: worker; output `code-diff` on a branch)

The runtime guarantees, before the agent starts:

- the brief is bound to the exact round and head;
- the worktree starts at the remote head;
- the dependencies are installed.

Round-local checks, run before a push:

| check | kind | blocking |
|---|---|---|
| scope | D | yes. Diff ⊆ scope |
| lints (shellcheck, option-loop, trap, `shift 2` guard) | D | yes |
| file-size-cap (1200 lines under tests/) | D | yes |
| covering-suites | D | yes. The suites that cover the changed files run locally |
| fixture-modules | D | yes. A new shared module is in every fixture list |
| report-schema | D | yes. WORKER_COMPLETE, the SWEPT block, the class list |

- A report-only failure keeps the code and re-runs only the report (v1 T-304).
- A round killed at `policy.round_timeout_s` is classed `timeout`, not report-only, so the next round can still change code (the v1 gap).

### 6. ci (D: ci, sharded; D: shard-budget; D: fail-first; D: ui-captures)

- ci: `adapter: exitcode` around the repo's CI. The runtime waits for the whole verification before compiling a brief, so every red goes into one brief.
- fail-first: new tests are red on the base and green on the head; `proves` maps to done lines.
- flaky policy: only a tool error (browser protocol, network) is retried, once, logged by name. An assertion failure is never retried.
- shard-budget: no shard over `policy.shard_budget_s`.
- ui-captures (non-blocking): when the diff touches the paths the repo's app declares (`.crew/app.json`: build argv with `{out}`, pages, paths), the app is built on the base and the head in the check sandbox; Studio reads only a copy of the build's regular files (symlinks, hard links and devices refused, never followed) and shoots each page served from that copy over a local http origin, scripts off, every other request (file://, other hosts) refused; the visible text that changed is recorded. The merge card carries `captures: [{label, before, after, changed}]`, the before / after lines and an "Open the app" link to the head's build (served sandboxed); the task page links it too. No app path changed: pass, nothing captured. No headless browser: warn, text only.

### 7. review (A: reviewer, then J: verdict)

- The output is APPROVE or REJECT with numbered findings carrying `file` locators, plus follow-ups.
- Reviewer modes (v1's `reviewer: mode: diff|run`): policy `reviewer.mode`, default diff. Diff: the spec, the diff, the CI and check results, the fail-first report and read-only, type-aware reads of a fresh checkout of the head (text by ranges, lockfiles too; images as pictures the model sees; PDFs as page text and page 1 as a picture; other binaries as type, size, sha256, hex head and the base version's metadata); nothing runs. Run: also run_tests and run_command on a throwaway copy of the head in the sandbox, no network, no credentials; the copy first gets its dependencies the way a round does (the project's `install` policy, else bun install --frozen-lockfile, in the round sandbox, the network only to the hosts `egress.allow` grants), and every command resolves on a fixed PATH inside the copy (its node_modules/.bin, then the system's and bun's), never widening the sandbox's reads. review-depth (D, blocking): every changed file read (within `reviewer.read_budget`: over it, the done lines' files plus a sample, the rest recorded "not read: budget"; a file over the read cap is "not readable" with its reason), and in run mode one executed verification unless it cannot run (no test command, the sandbox refuses: recorded "not executed: <reason>"). The ledger records the mode and what was read or run; the merge card says "Reviewed in diff mode" or "run mode" and lists what the review did not cover under needs your eye. A verdict before that is refused with a brief; still refused after the retry, review-depth fails with class review-unverified and the refine loop routes to the step-back card (another model as provider/model, rescope, drop), never a failed task; "another model" goes back through fix (pass) to CI and a review on that model.
- The designer reviewer (J, screenshot compare per page) is added by policy when the diff touches UI paths; it reads ui-captures' before / after pages when the head has them.
- Off-list findings after CRITERIA-COMPLETE are accepted, but labelled as off-list.

### 8. fix (the refine loop over build → ci → review)

- Brief = compiled findings from ci, fail-first and review, plus the coordinator's root cause. A docker repro is required for a Linux-only red.
- brief-quality (D): each item has a locator, a concrete expected change (never only "<check> passes") and a class. A failing brief goes to a coordinator root-cause turn, never to a placeholder.
- Stop conditions:
  - all blocking checks pass → go to gates;
  - the same class fails twice → step-back card (H): question the design;
  - the round cap is reached → round-budget card (H).

### 9. gates (D, on the edge into merge)

| gate | proves |
|---|---|
| branch | the head is pushed on the task branch |
| rebase | up to date with the base. BEHIND+MERGEABLE → auto update-branch (policy) |
| scope | the final diff ⊆ scope; a sensitive path in the diff forces one-way |
| fail-first | as in 6, on the final head |
| ci | green on the final head |
| approval | signed APPROVE for this head or patch-id; carries over a clean rebase |

### 10. merge (H)

- The card has the intent, the before/after and the check ledger: proved done lines and the human acceptance list.
- A one-way merge needs the walk and the explicit door confirmation. Answers can come from the auth window.

### 11. after-merge (hooks)

| hook | what it does |
|---|---|
| self-update (firstmate pack only) | back up local specs, fast-forward, reapply local config, reload autopilot |
| main-ci | the first main run after the merge is green; shard times are reported |
| follow-up-triage (J) | each reviewer follow-up becomes a task proposal or is dropped with a reason |
| retro-trigger | periodic; feeds M6 |

## Policies (project or org level, overridable per workflow version)

- `sensitive_paths`, `round_cap`, `round_timeout_s`, `shard_budget_s`
- `auth.window`
- `ste.rules`
- `branch_prefix`
- `ui_paths` (designer reviewer)
- `flaky.retry`

## Where a human is still needed

- the dispatch card;
- scope, step-back and round-budget escalations;
- the merge card.

Everything else is an agent node with checks. With an auth window open, only the escalations reach a human.

## External repos (pull request feature work)

The same graph runs against an external repo. What changes is the pack and the policies, not the nodes.

| concern | v2 form |
|---|---|
| GitHub access | the GitHub adapter: built-in REST and a token, `gh` optional. It pushes branches, opens and updates PRs, reads checks, logs and review threads, and runs update-branch |
| registration | an external project is a clone plus worktrees under Studio's data, never in firstmate's state |
| conventions | auto-detected, org level first, then repo level: PR and issue templates, CONTRIBUTING, CODEOWNERS, branch and CI-trigger prefixes, required checks, commit style. The result is a generated `conventions` pack (policies + checks), editable in the UI |
| ci-trigger-prefix | D check before the PR opens: the branch name matches a prefix the repo's CI workflows trigger on |
| catch-up | rebase plus `--force-with-lease` on the same PR, never merge commits (policy `external.catch_up: rebase`) |
| company reviewers | bot and human review comments become findings with `file` locators. They feed the refine loop and drive the next round, and are watched even when the branch is not mapped |
| approval | Studio's APPROVE stays local signed evidence and is never posted as a GitHub review |
| privacy | D check on every artifact, card and committed Studio file: no external repo, org, private path or reviewer name leaves Studio |
| merge | only through the merge card, with the repo's allowed merge method |
| PR body and issue | rendered from the detected templates; a template-fields check proves every required section is filled |

Acceptance: an end-to-end run against a simulated GitHub (a local bare repo plus a stub REST server written from GitHub's documented responses), covering:

- a CI prefix that does not trigger;
- a bot review requesting changes;
- a BEHIND branch.

A real run needs a sandbox repo named by the captain. Until then, nothing is created or pushed on real GitHub.

## Remote read unit (A4/A5/C1)

Explicit granted GitHub projects publish on pr-open, then persist waiting(external) for required remote checks. Local projects keep the original immediate local review request and local CI. Required classic branch-protection identities are name/app_id or exact legacy context; checks/statuses paginate on the recorded PR head. Unsupported policy sources, authentication failures and incomplete pages cannot become green. The absolute deadline and policy/grant hashes survive restart. Skipped/neutral/cancelled checks fail. Final evidence enters firstmate/remote-ci; gate-ci requires that bound remote evidence plus fresh policy/PR/ref reconciliation.

Every remote node start and merge presentation reconciles PR repository/number/open state/base/head and its authoritative ref. A change stops on a captain-only bilingual card. Remote writes require a separate exact repository operation grant. Without it, a healthy read-only remote candidate presents a stop/close card. With a grant, remote-ready updates only BEHIND+MERGEABLE branches and rebinds CI to the new head before the six gates. A conflict asks the captain for a native task-only rebase resolution round, followed by fresh CI/review. Final merge uses the repository-allowed method and exact head CAS; a durable attempt prevents same-head retries. Local merge behaviour is unchanged. One owned poller per exact granted repository serves all task waits and idempotently records changed evidence. Cancellation/deletion clear its callbacks/timers and abort active requests.

Job logs use a bounded 64 KiB byte range. The authenticated API redirect is inspected manually; a validated GitHub-owned HTTPS blob download receives only Range, never authorization. Simulator downloads are restricted to the exact granted loopback origin. 206 Content-Range and raw byte length are checked; 416/ignored Range/redirects are classified. Tokens and signed URLs are redacted from log evidence. No real remote merge, review, comment or rerun endpoint is introduced.

Native admission pins the captain-accepted code scope, spec digest, canonical repository/project and dependency task identities before the worker starts. A dependency needs measured signed local merge evidence on the authoritative base, not a terminal/parked status. The same reservation remains while the worker has finished and the captain is deciding; closing or cancelling unmerged work does not erase it. Legacy in-flight work without a signed binding refuses and asks for fresh preparation, preserving historic cards and review records. Bounded queue deadlines survive event replay; the answer API schedules owned continuation instead of awaiting a held round.
Remote naming/gates/merge state and upgrade semantics are defined in [remote-gates-merge](units/remote-gates-merge.md). A signed approval carries only with a real clean integration trial, matching tree and stable patch-id, and no later reject/unverified verdict. Legacy unbound approvals cannot carry. Real writes remain disabled absent the separately approved named repository/operation grant and verified strict no-bypass protection.

Remote naming is a full-grant/branch/exact-head capability. Outside-prefix update results wait on an explicit new-head captain card before import, clean carry and fresh CI; the durable signed pending descriptor prevents replay after restart. Shared operation claims under trusted Studio data retain same-head finality independently of task deletion. Legacy histories can persist a denial, never authorize a retry. See the versioned recovery contract in [remote-gates-merge](units/remote-gates-merge.md).
