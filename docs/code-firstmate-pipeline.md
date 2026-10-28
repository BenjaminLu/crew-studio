# code-firstmate: firstmate's coding pipeline on the check contract

Source of truth for behaviour: ~/Desktop/firstmate-workflow (design/design.md, skills/*). This document maps it onto Studio nodes, checks ([check-contract.md](check-contract.md)), policies and hooks. D = deterministic check, J = judged check, H = human card, A = agent node.

## Roles

| v1 actor | v2 node |
|---|---|
| captain | H nodes. A policy can auto-answer some card kinds inside an authorization window. |
| firstmate | `coordinator` A node: drafts specs, answers plan questions, diagnoses red CI, enriches briefs, triages follow-ups |
| worker | `worker` A node in its own worktree; one round = one Round |
| reviewer | `reviewer` A node, fresh context, diff + CI + fail-first report only |
| designer reviewer | `designer` A node, fresh context; runs after the reviewer whenever the diff touches UI paths, and gate-design needs its APPROVE on the exact head (src/domain/code-design.ts) |
| autopilot | the runtime itself |

## Graph

```
intent ─▶ spec ─▶ dispatch(H) ─▶ door ─┬─ one-way ─▶ plan ─▶ plan-accept ─┐
                                       └─ two-way ──────────────────────┴▶ build ─▶ pr-open ─▶ ci ─▶ review ─▶ [designer] ─▶ remote-ready ─┬─▶ gates ─▶ merge(H) ─▶ merge ─▶ after-merge
                                                                         ▲                       │
                                                                         └──── fix (refine loop) ◀┘
```

A second way in, **From existing branch** (docs/units/branch-intake.md): Send for review on a finished web terminal copies
the branch into a worktree, the spec is drafted from its diff, and after the spec card and the door the first build visit
runs no round (`adopted`): the branch's diff is checked against the spec on the edge to pr-open, and on as above.

## Nodes and their checks

### 1. spec (A: coordinator; output artifact type `spec`)

| check | kind | blocking | what it proves | v1 origin |
|---|---|---|---|---|
| spec-schema | D | yes | what/why/done lines, scope, door, explain block in en and zh-TW, and `zh` (the title and why in zh-TW, which the cards show) | fm-spec checks |
| done-lines-provable | D+J | yes | every done line names a test and a fail-first marker that can run in CI. D checks the names; J checks that the test can observe the behaviour | "done lines must be provable" |
| caller-coverage | D | yes | every caller and mirror of a changed shared script is in scope (grep) | "spec lists every caller" |
| overlap | D | no | notes other in-flight Tasks that edit the same paths (informational: Tasks run concurrently and rebase each round) | "check overlap before dispatch" |
| ste-wording | D | yes | plain-English rules (banned words, sentence length); a zh-TW text (zh title, zh why, zh explain) is a real Chinese translation, not English behind a Chinese word, not a stock placeholder | fm_ste |
| no-impl-detail | J | warn | no line numbers or implementation steps in the spec | "specs: what, why, done" |
| env-preflight | D | yes | the environment the build needs, read from the base: the lockfile's package manager is installed, a declared test command resolves (`.crew/gates.json` `test`, else package.json `scripts.test`); absent/explicit-null commands and the exact npm-init placeholder are recorded as testing `not-run` and allowed, while malformed declarations remain typed gaps, and every done-line test path matches the repository's test globs. A gap is a typed record (`env.test-command`, `env.test-path`, `env.tool-missing`) sent to Firstmate's spec repair turn; only `env.permission` (dependencies that need a registry host the round sandbox may not reach) raises a captain card. Never a HOLD inside the build round (R-028) | "local deps and fresh worktrees", "done lines must be provable" |

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
| lints (the repository-declared lint command) | D | yes when declared; absence is an optional adapter result with `data.status: not-run`, not lint execution evidence |
| file-size-cap (1200 lines in tracked test files selected by the base configuration) | D | yes. An explicit `glob_prefix` applies to matching source paths; binary files are recorded, not decoded as text lines |
| covering-suites | D | yes. The suites that cover the changed files run locally |
| fixture-modules | D | yes. A new shared module is in every fixture list |
| report-schema | D | yes. WORKER_COMPLETE, the SWEPT block, the class list |

The host supplies `repo_cfg.testFiles` from `git ls-files -z`, matched with the base configuration's test globs. Covering suites and the default line cap consume that inventory; they do not approximate glob prefixes or walk documentation and screenshots. Missing inventory is a typed blocking configuration finding. Covering suites retain changed-test and importer selection.

Test selection for a `.crew/gates.json` test command is one contract everywhere (fail-first, covering suites, the worker's and the reviewer's `run_tests`): `CREW_TEST_FILES` is a comma-separated list of test file basenames (what `templates/sandbox-repo/scripts/test-shard.ts` matches) and `CREW_TEST_PATHS` the same files as repo-relative paths. Role tools accept only repo-relative paths. A run that exits 0 while its output shows no tests ran (`no test files`, `Ran 0 tests`, `# tests 0`, `0 passing` …, and no line showing a test ran) is reported as `no-tests`, never as a pass, and does not use up a run; a nonzero exit is always a recorded result.

When no test command is declared, CI, covering suites and fail-first allow their gate with `data.status: not-run`, an explicit reason, and empty evidence/proves. This is not a passing test result. When a command exists, assertion failures, runner errors and fail-first evidence requirements still block normally.

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
- Reviewer modes (v1's `reviewer: mode: diff|run`): policy `reviewer.mode`, default run (diff is opt-in). Diff: the spec, the diff, the CI and check results, the fail-first report and read-only, type-aware reads of a fresh checkout of the head (text by ranges, lockfiles too; images as pictures the model sees; PDFs as page text and page 1 as a picture; other binaries as type, size, sha256, hex head and the base version's metadata); nothing runs. Run: also run_tests and run_command on a throwaway copy of the head in the sandbox, no network, no credentials; the copy first gets its dependencies the way a round does (the project's `install` policy, else bun install --frozen-lockfile, in the round sandbox, the network only to the hosts `egress.allow` grants), and every command resolves on a fixed PATH inside the copy (its node_modules/.bin, then the system's and bun's), never widening the sandbox's reads. review-depth (D, blocking): every changed file read (within `reviewer.read_budget`: over it, the done lines' files plus a sample, the rest recorded "not read: budget"; a file over the read cap is "not readable" with its reason), and in run mode one executed verification unless it cannot run (no test command, the sandbox refuses: recorded "not executed: <reason>"). An APPROVE is refused when the worker's report says its tests were not run or not green, unless the reviewer ran the covering tests (the whole declared command, or every changed test file) green itself; diff mode cannot, so it rejects instead. The ledger records the mode and what was read or run; the merge card says "Reviewed in diff mode" or "run mode" and lists what the review did not cover under needs your eye. A verdict before that is refused with a brief; still refused after the retry, review-depth fails with class review-unverified and the refine loop routes to the step-back card (another model as provider/model, rescope, drop), never a failed task; "another model" goes back through fix (pass) to CI and a review on that model.
- The designer round (`design-scope` → `designer`): a diff touching UI paths (policy `ui_paths`, plus the paths `.crew/app.json` declares) goes to a fresh-context designer agent on the staffed designer role and its skill. It sees each page's before / after capture from ui-captures as a picture (`design_view`; a verdict before every capture is seen is refused), with the spec, the captain's notes, its earlier REJECT and the UI diff, and gives APPROVE or REJECT with findings (page, element, problem, change). design-verdict (D, blocking) turns a REJECT into blocking findings, so the fix loop sends them to the worker like a reviewer REJECT. No verdict after the retry is `design-unverified`: the step-back card says the designer gave no verdict, and its "another model" (provider/model) reruns the designer on that model, never the review. Captures: when the repository declares an app, every page needs its pictures; design-scope recaptures once, and a page still without its after picture (or its before, when the base built it) is a typed env gap (`env.design-captures`, an env_gap event, route `gap`) that goes to Firstmate first (`design-gap`, the coordinator: recapture, or escalate to the captain's capture-gap card: recapture, rescope, park). It never reaches the worker's brief and never becomes a diff-only verdict; the card says "no captures". When no app is declared and only `ui_paths` matched, the designer reviews the diff only, recorded `diffOnly`, and the card says "diff-only, no pictures". Any other diff skips the round; design-scope records why it is not applicable. designer-compare (J, non-blocking SSIM judge) runs on the designer node. gate-design (the seventh gate, on remote-ready → merge-card, and required signed on the exact head by the GitHub merge too) reads the verified ledger and needs design-scope's none or a design APPROVE on the exact head (or an APPROVE carried to it on a proven-identical patch). The merge card shows the designer's verdicts, what it saw (seen / no captures / diff-only), the open findings, designer-compare's warnings and the design gate.
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
- One curated commit lands per Task, never the round commits: a Conventional subject within 72 characters (never cut mid-word, no "(round N)"), and a body with the spec's what and why and each done line with the checks that proved it, never the worker's raw report. A repository's CONTRIBUTING commit rules win, including a DCO Signed-off-by. The author is the repository's own user.name and user.email, else the captain's git identity (read, never written); Crew Studio is the committer. Locally it is the reviewed head's exact tree on the base tip; on GitHub a squash or merge commit carries the same title and message (GitHub's rebase method lands every round commit instead, and the merge card says so: squash is the preferred method). The rounds stay on the Task branch and in the ledger (src/domain/commit-message.ts).

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
| merge | only through the merge card, with the repo's allowed merge method; squash preferred (one curated commit), rebase lands every round commit |
| PR body and issue | rendered from the detected templates; a template-fields check proves every required section is filled |

Acceptance: an end-to-end run against a simulated GitHub (a local bare repo plus a stub REST server written from GitHub's documented responses), covering:

- a CI prefix that does not trigger;
- a bot review requesting changes;
- a BEHIND branch.

A real run needs a sandbox repo named by the captain. Until then, nothing is created or pushed on real GitHub.

## Remote read unit (A4/A5/C1)

Explicit granted GitHub projects publish on pr-open, then persist waiting(external) for required remote checks. A repository with a pull request template instead publishes once, at remote-ready while no pull request exists (after CI, review and design): the coordinator fills the template from the spec, the captain's changes and Studio's evidence, Studio keeps every heading and checkbox (ticked only by evidence) and the captain-only card "Open this pull request?" shows the exact title and body; only its Open answer pushes and opens it, then remote-ready waits for its required remote CI before the merge card (src/domain/code-publish.ts). Local projects keep the original immediate local review request and local CI. Required classic branch-protection identities are name/app_id or exact legacy context; checks/statuses paginate on the recorded PR head. Unsupported policy sources, authentication failures and incomplete pages cannot become green. The absolute deadline and policy/grant hashes survive restart. Skipped/neutral/cancelled checks fail. Final evidence enters firstmate/remote-ci; gate-ci requires that bound remote evidence plus fresh policy/PR/ref reconciliation. When GitHub will not show the base branch's protection (403 "Upgrade to GitHub Pro" on a private free-plan repository, or 404 "Branch not protected"), the policy is *observed*: every check run and status reported on the PR head is required (latest run per name/app, none reported yet is pending), a `remote-policy-notice` is recorded and the merge card says so; any other read failure raises a typed stop card (pull request closed or moved, refused access, GitHub unreachable, checks failed). The test table renders each done line as plain text: the test file moves to its own column and the spec's planned fail-first clause is dropped (the Fails-on column carries the proof). When later rounds move an opened template pull request's head, remote-ready fills the template again at the new head and raises the captain card "Update the text of pull request #N?" with a diff against GitHub's text; only Update PATCHes it, Keep leaves it. The text describes the final state at its head, never the rounds: the diff at that head, the binding done lines and the captain's changes, only the evidence recorded at that head, and the door as facts (two-way 雙向門 and why, or one-way 單向門 with what makes it one-way and "Captain confirmation: pending" until the captain's signed answer carries it). Studio's part sits between hidden markers naming the head it describes; whether a text is current is decided by Studio's signed record of what it wrote for that head (the hash of its part in `pr-opened` / `pr-text-updated`), never by the marker alone. Text outside the markers (a reviewer's note) stays verbatim, and a round's push PATCHes the base alone. Before the merge card (merge on GitHub or in Studio) Studio reads the text on GitHub: a part that lags the head, carries no markers, or that Studio has no record of is written again and a captain-only card stands in for the merge card (Update; no merge offered, no Keep); an edit of Studio's text of this very head is shown as a diff to keep theirs or replace. Every edit reads GitHub's text right before its PATCH and goes ahead only if it is still the text the card showed (`pr-text-refresh`, `pr-text-updated`, `pr-text-kept` in the ledger). Every GitHub pull request Studio opened takes part (fail closed: an older release's, one opened after its template vanished, any shape; only a test-only engine switch leaves one out). A pull request without a template takes part too: on GitHub it opens with Studio's part (spec, door, rollback) between the markers, recorded as Studio's own, and a rescope or door change that alters those facts brings the text card back before any merge option. The text is current only while it states the current facts Studio owns (the door line and its confirmation; without a template, the whole part). A one-way door's confirmation is bound to the head and to the door's paths and reasons (`door-confirmed`): a new head or another door needs a new one. It is confirmed by the captain on the merge card on both paths (merge on GitHub asks for it before saying the pull request is ready there); Studio writes the confirmation into its part before saying so, and before Studio's merge runs it reads the text again and goes back to the text card if it changed. On restart an open merge card over a text Studio has no current record of is replaced by the stand-in (`card-upgraded`), never answered; its "Write the text again" shows the change before any edit.

Every remote node start and merge presentation reconciles PR repository/number/open state/base/head and its authoritative ref. A change stops on a captain-only bilingual card. Remote writes require a separate exact repository operation grant (merge, update-branch); the Task branch push after a per-round rebase goes through the publication grant with its lease, authorized by the concurrent-Tasks rule. Without it, a healthy read-only remote candidate presents a stop/close card. With a grant, remote-ready updates only BEHIND+MERGEABLE branches and rebinds CI to the new head before the six gates. A conflict asks the captain for a native task-only rebase resolution round, followed by fresh CI/review. Final merge uses the repository-allowed method and exact head CAS; a durable attempt prevents same-head retries. Local merge behaviour is unchanged.

On an *observed* policy (GitHub does not show branch protection, e.g. a free private repository) GitHub enforces no required check, so Studio's merge rests on its own verification: with an operations grant and all seven gates signed at the pull request's head (CI on the head, fail-first, review, design among them), remote CI green and the text current, the merge card offers a captain-only **Merge** (`merge-observed`) beside "Close here (I merge on GitHub)". The card carries an acknowledgement the captain ticks ("GitHub does not enforce required checks on <repo>; Studio verified them itself at <head>"); its id is bound to the head and the policy hash, the card refuses the answer without it, and the answer guard refuses anyone but the captain (Firstmate, an authorization window). The answer records `merge-ack` (captain, head, observed policy), the text is read again, and `git.merge` checks the answer, the ack, the signed merge request (with its observed policy) and that protection is still unreadable before the read-only merge checks (`mergeReady`: head, base, CLEAN, method) — all before a merge attempt is recorded, so a refusal never locks a head. The PUT names the head's sha (a moved head is GitHub's 409), and `merged` records the merge commit. Without an operations grant, or with a gate missing at the head, the card stays merge-on-GitHub and says why (the missing merge permission: an operations grant on the project's GitHub grant, with a **Grant Studio merge for <owner/repo>…** link to the project's GitHub settings).

**Grant Studio merge** (`src/github-merge-grant.ts`, workflow `firstmate-grant-merge`) is the only writer of the operations grant. The project's GitHub settings propose it (`POST /api/projects/<id>/github/merge`, `…/merge/revoke`), and so may Firstmate (`studio_connect_github` with `merge: true`); only the captain answers the card (the answer guard refuses Firstmate and authorization windows, even for close). Before the card, one read-only `GET /repos/<owner/repo>` with the grant's token (`mergeAccess`) checks the role (push, maintain or admin), a classic token's `repo` scope and the merge methods the repository allows; anything missing gets a card that names it, with Check again and close, and nothing is written. The grant card says what Studio then does (merge pull requests it opened in that repository, after all gates at the head and the captain's confirmation on each merge card), what it never does (merge without that confirmation, push the base, change branch protection), offers one button per allowed method (squash first when allowed) and says it is revocable. A fine-grained token or an app shows its role, not its own permissions; the card says GitHub enforces Contents and Pull requests write at the merge. The captain's grant re-signs the project's grant with the operations (`grantSignature`, as Connect signs it), compare-and-set on the registry the card was proposed from, and records `grant-merge` (repository, method, card, answer seq); revoking re-signs it without them and records `revoke-merge`. Neither changes the project's staffing identity or its read authority (both read the grant without its operations). Afterwards each open merge card on the project has its remote checks verified again, read only, under the new grant, and is prepared again: granted, an observed-policy Task with every gate green offers the acknowledged **Merge**; revoked, merge on GitHub (a card that still offered Merge is replaced even when the checks cannot be verified again). Every write on the grant verifies its signature first (`projects.assertExecutable`): `pr.open` on every path, the merge card (a grant that does not verify offers no Merge and says the grant is not valid), `git.merge` right before the PUT and the refresh after a grant change, so a hand-edited operations grant never merges. Firstmate's proposal never replaces the captain's open grant card.

While any merge card is open, Studio polls the pull request with the remote watchers' owner (and again for every open card after a restart): merged on GitHub records `detected-merge` (the merge commit, the head GitHub merged, the head Studio verified), cancels the card unanswered and ends the Task through the merge hook as merged (the hook fetches the base branch so GitHub's merge commit is local and on the base before the steps after the merge read it); closed unmerged records `detected-close` and ends it closed. Merged without a merge commit named yet is read again; retargeted to another branch and closed or merged there records `detected-close` with that branch and ends the Task closed, saying so. A pull request unchanged for an hour is read every five minutes. Nothing is answered for the captain. Nodes after a merge do not reconcile the (now closed) pull request as an open one. One owned poller per exact granted repository serves all task waits and idempotently records changed evidence. Cancellation/deletion clear its callbacks/timers and abort active requests.

Job logs use a bounded 64 KiB byte range. The authenticated API redirect is inspected manually; a validated GitHub-owned HTTPS blob download receives only Range, never authorization. Simulator downloads are restricted to the exact granted loopback origin. 206 Content-Range and raw byte length are checked; 416/ignored Range/redirects are classified. Tokens and signed URLs are redacted from log evidence. No real remote merge, review, comment or rerun endpoint is introduced.

Code Tasks on the same repository run concurrently, like pull requests: a scope overlap never blocks or serializes a Task; every build/fix round first rebases the Task branch onto the current base head and the worker resolves its own conflicts; no Task stays pinned to the base it started on. Only declared dependencies gate. The `firstmate/overlap` spec check is non-blocking: it notes the other in-flight Tasks writing the same paths (a Task closed without merging, cancelled, or failed and then parked or archived is not one of them; a failed Task kept for captain recovery is, marked as such), and the build brief repeats the note. The rebase runs at round start before dependencies install, so the install sees the rebased lockfile; while conflicts are pending the install waits for the rebase to complete. A conflict leaves the rebase in progress; the brief lists the files under REBASE CONFLICTS right after its header. Studio continues the rebase only when no still-unmerged text file carries a full conflict block (`<<<<<<<`, `=======`, `>>>>>>>` in order; a lone `=======` such as a Markdown setext underline, or a file git merged on its own, does not count); otherwise the next round gets the file again. After `round_cap` consecutive rounds that leave the same unmerged files at the same head, the build reports SCOPE-BLOCKED and the scope card goes to the captain. A binary conflict is never resolved automatically (staging would keep one side and drop the other): the brief lists it as binary with both sides' blobs, the rebase stays pending and the build reports SCOPE-BLOCKED for the captain. A rebase intent recorded just before a crash, with no git rebase state and HEAD still at the recorded start, is cleared and redone at the next round. The merge stays strict: when the base moved since the gates ran, the merge routes back to a build round that rebases, then through the checks, the designer route (design-scope, designer) and all seven gates and the merge card again.

Code workers get the rule in their system prompt under its own "## Studio runtime rules" heading, outside the captain's operating rules; reviewers, designers and non-code workflows do not.

Remote (GitHub) Tasks rebase every round too, under the same rule (the captain's standing authorization for this one write). Before each build round Studio fetches the granted base into the local object store; once the Task has a PR, the same fetch proves the remote Task branch is still at the last pushed head (the lease). The round rebases onto the fetched origin base with the same conflict handling as a local Task (REBASE CONFLICTS brief, full ordered conflict blocks, binary conflicts and rounds without progress go to the captain, crash recovery). The publication step after the round pushes only the Task's own branch, with `--force-with-lease=refs/heads/<branch>:<last pushed head>`; never any other ref and never the base. Each rebase (`remote-rebase`: branch, from/to base, heads, lease) and each push (`remote-push`: branch, from, to, lease, whether history was rewritten) is a signed ledger record. If someone else pushed to the Task branch, Studio never overwrites it: before the round the node-start reconciliation stops on a card, and at the push the lease refuses and a card says the branch moved. The PR head moves, so required CI and review re-bind to the new head through the existing remote gates (a review carries only where the patch is proven identical, otherwise the fresh review runs). The captain's rebase card at remote-ready remains for conflicts GitHub reports there.

Native admission pins the captain-accepted code scope, spec digest, canonical repository/project and dependency task identities before the worker starts. A dependency needs measured signed local merge evidence on the authoritative base, not a terminal/parked status. Legacy in-flight work without a signed binding refuses and asks for fresh preparation, preserving historic cards and review records. Bounded queue deadlines survive event replay; the answer API schedules owned continuation instead of awaiting a held round.
Remote naming/gates/merge state and upgrade semantics are defined in [remote-gates-merge](units/remote-gates-merge.md). A signed approval carries only with a real clean integration trial, matching tree and stable patch-id, and no later reject/unverified verdict. Legacy unbound approvals cannot carry. Real writes remain disabled absent the separately approved named repository/operation grant and verified strict no-bypass protection.

Remote naming is a full-grant/branch/exact-head capability. Outside-prefix update results wait on an explicit new-head captain card before import, clean carry and fresh CI; the durable signed pending descriptor prevents replay after restart. Shared operation claims under trusted Studio data retain same-head finality independently of task deletion. Legacy histories can persist a denial, never authorize a retry. See the versioned recovery contract in [remote-gates-merge](units/remote-gates-merge.md).

### Worker questions

A build worker's `ASK` uses the runtime agent-question path before build checks. Firstmate answers through `studio_answer_agent_question`, or explains why a captain decision is required. The captain can answer the resulting failure card. Both paths resume the same build with the original spec, workflow, dispatch and scope admission. The answer is saved in the actual build brief, the round record and signed failure-answer evidence. New question notices include the exact visit; Firstmate must echo it, so an old notice cannot answer a newer question on the same step. Historical questions without a visit remain answerable. Blank answers and repeated reports are refused. Repeated questions stop at the existing `round_cap` policy instead of repeatedly reopening the build. While a question waits for Firstmate the Task's status is `waiting`, not `failed` (the board reads it as waiting for Firstmate, never "needs you"); only an escalation to the captain shows the failure card. After a restart Studio sends the pending question to Firstmate again, and a question Firstmate leaves unanswered for 15 minutes goes to the captain as the same failure card.

A captain's "Request changes" note (any card answered `changes`, `request` or `rescope` with a note, such as the merge card) and the captain's answer or rescope on a failure card are captain amendments: they are kept on the run cumulatively (`ctx.amendments`, A1, A2, …, each bound to its signed card-answer or failure-answer ledger entry; one that no longer matches its entry is dropped and logged) and outrank the approved spec. Between two that conflict, the later one wins. Every later spec draft, plan, build brief, fresh-review brief, root-cause brief and merge card shows the amendments above the spec as the captain's binding changes. The reviewer judges against spec plus amendments, never rejects an implementation of the captain's latest word, and names a done line an amendment supersedes (`review_verdict.superseded`); the merge card marks that line as the reviewer's judgement ("reviewer: superseded by A1"). A worker `ASK` that would undo or change an amendment names it (`worker_report.amendment`) and goes straight to the captain, never to Firstmate; Firstmate's question notice also lists the amendments and tells it to escalate any answer that would undo one (R-058).
