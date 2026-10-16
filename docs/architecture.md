# Crew Studio v2: backbone architecture

Status: binding. A change to this document goes through the same adversarial review as code (see §11). [v2-spec.md](v2-spec.md) holds the priorities. The detailed contracts are in [check-contract.md](check-contract.md), [code-firstmate-pipeline.md](code-firstmate-pipeline.md) and [pack-genesis.md](pack-genesis.md).

## 1. Principles

1. **Generic runtime, domain packs.** The runtime knows five node kinds and nothing about code, video or images. All domain knowledge lives in packs.
2. **One contract per seam.** Providers, hosts, checks, hooks, locators and packs each have exactly one interface. A new vendor, domain or script plugs in through that interface; no special case goes into the runtime.
3. **Humans decide; checks prove.** Every done line binds to a check, or appears on the human acceptance list. A human sees escalations and the final acceptance, never the inner loop.
4. **Same feedback type for machine and human.** Check findings and human annotations share one locator schema, so an agent acts on both alike.
5. **Vendor-neutral.** claude CLI, codex CLI, direct HTTP (Anthropic, OpenAI, compatible) and a stub sit behind one provider interface. No feature may require a particular vendor.
6. **Out of the box.** Studio ships as one binary with no required external tools. An unavoidable dependency has a one-click installer on the Doctor page and degrades gracefully when missing.
7. **Durable and replayable.** All state is append-only events plus snapshots on local disk. A killed server resumes every task from its last durable step.
8. **Least authority.** Agents and checks run sandboxed. Only the runtime writes cards, evidence and merges. Skins and packs cannot answer cards.
9. **Private by default.** Nothing that names an external repo, org, private path or person leaves Studio in shared or committed content. License attribution of public open-source works that Studio ships is required, and is not private content (for example a built-in skill's NOTICE.md).

## 2. Layers

```
UI                            backbone: Board (home: every task in flight, the decisions waiting, answered in place) · Firstmate · Inbox (decisions only) · Crew · Tasks (live graph; review loops open as Rounds) · Workflows (editor, checks, gates) · Library · Settings (gear: Doctor, keys, roadmap). Labs, behind a flag: improve · retro · packs · docs · file org · skins · changes · phone pairing
───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
API + SSE                     one HTTP server; every mutation is an event; SSE streams events and snapshots
───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
Runtime                       scheduler · task state machine · refine loop · brief compiler · card service · evidence ledger · policy resolver
───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
Contracts                     provider · host · check/hook · locator · pack · artifact · adapter (GitHub, firstmate)
───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
Packs                         firstmate (code) · video · image · web · documents · file-org · conventions (generated per external repo)
───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
Storage                       data/: events.jsonl · runs/ · workflows/ · artifacts/ · evidence/ · cards/ · packs/ · policies/ · handoff/
```

## 3. Runtime

### 3.1 Node kinds (closed set)

| kind | does | output |
|---|---|---|
| `agent` | runs a provider with a role, skill, brief and inputs in a sandbox or worktree | an artifact version and a report |
| `check` | runs a check per [check-contract.md](check-contract.md) | a verdict, findings and evidence |
| `card` | asks a human (or an auth-window policy) a question | an answer |
| `loop` | a refine loop over a subgraph: produce → checks → brief → produce | the subgraph's last output |
| `hook` | a lifecycle action (after_merge, after_round, on_cancel) | a report; it never moves the task backward |

Branching is an edge condition over earlier outputs, for example `door == "one-way"`. Parallelism comes from the edges.

### 3.2 Task state machine

**Workflow** is the template. **Task** (任務) is one piece of work through that template; **Round** (回合) is one agent/check launch or answered card within it. Task ids remain R-NNN; stored `run` fields, `data/runs/`, `#/runs` and `/api/wruns` remain compatible. `#/tasks` and `#/tasks/<id>` serve the same pages as the legacy URLs. `/api/tasks/<id>` derives ordered Rounds from the stored steps; no data migration or v1 projection occurs.

- Task: `queued → running ⇄ waiting(card|external) → succeeded | failed | cancelled`, plus `paused`.
- Round: `pending → running → passed | failed | error | skipped | superseded`.
- Every transition is an event `{ts, run, node, from, to, cause}`. The snapshot is a fold of the events. Recovery replays events, keeps finished nodes and restarts interrupted ones from their last durable output.
- Hot swap: changing a running node's provider or model stops it, writes data/handoff/<run>/<node>.md (inputs, progress, open findings) and starts the new agent from that handoff.
- Timeout: a Round killed at its cap ends `failed(cause=timeout)`. It is never classed as report-only.
- How a task ends, as the captain reads it: one word per state (Running, Waiting for you, Merged, Done, Closed without merging, Cancelled, Failed). A task that ends at a "closed" end node is `succeeded` with result `closed` and reads "Closed without merging", never in the success style. Cancel works from any live state and takes an optional reason. It withdraws the task's open cards and runs `on_cancel`.
- An ended task can be archived, which hides it from the default lists, or deleted. Delete needs the typed task id. It removes the task's folder, captures and cards, plus the domain's own traces (`onDelete`; the code pack removes the worktree and branch, never a commit in main). The evidence ledger keeps its entries and gains one signed deletion entry. Both actions are events. The server refuses them for a live task. Unit spec: [units/run-end-and-remove.md](units/run-end-and-remove.md).

External hook waits persist a version-1 descriptor under NodeRun.data.external before registration. The engine owns each callback and rejects it after cancellation or deletion. Restart keeps the original visit/deadline and re-registers the known handler. Unknown handlers fail closed; a known GitHub handler raises a bilingual stop card for an unsupported/malformed descriptor. Existing local/card waits retain their prior replay contract. GitHub waits share one grant-bound repository timer/request owner; the last subscription aborts the request and clears both poll and deadline timers. Required policy content/hash, app identity and PR head are rechecked; local CI never substitutes for remote CI.

### 3.3 Refine loop and brief compiler

- Stop conditions:
  - all blocking checks pass → continue;
  - the same finding class fails twice → step-back card;
  - no score improvement for 2 rounds → card;
  - round cap → round-budget card.
- Brief = a fixed template over the findings (locator, message, expected, class, "fix the whole class"), plus an optional coordinator root cause. Each item carries its evidence: the ±10 source lines around a file:line locator from the exact round head, and the relevant lines of the check's log with a pointer (file, lines, bytes), redacted. The brief-quality check must pass before the brief is sent; a failing brief goes to a coordinator root-cause turn, never to a placeholder. A round that needs a brief and has none bound to its round and head says so in its prompt; a brief carries across a base-only head change only with a recorded proof (brief-carry ledger entry: base, stable patch id, files).
- A brief is bound to the exact round and input head, and an agent reads only the brief bound to its round.

### 3.4 Cards

- Card kinds: dispatch, plan, scope, step-back, round-budget, merge, promote, acceptance, retro, permission, question.
- Every card is STE-checked in en and zh-TW, carries its intent sections (intent, why, scope in/out, done, before/after, how, glossary) and is answered exactly once.
- A one-way merge requires the walk and an explicit door confirmation.
- Policy `auth.window` may answer listed kinds as A until a deadline, and records the grant.
- Studio's own cards show in the Inbox beside firstmate's, labelled with task, workflow and node, answered there with the same buttons and door confirmation as on the task page; the sidebar Inbox count includes them.
- One card component (public/scard.js, `crewCard.mountCard`) renders a Studio card on the task page, in the Inbox and in the Board's Needs you, where it is answered in place. The Board keeps each card's state (ticks, note, door tick, refusal, an answer in flight) until the card is answered. One answer is in flight per card, and a card already answered with the same choice shows as answered. An authorization window never answers a merge card. A merge card carries a structured detail in en and zh-TW (intent, why, scope, done lines with their proof, before/after, how, a walk of the diff mapped to done lines, door and rollback, reviewer verdict, gates, cost); the server takes a merge only when every intent line is ticked or a note is written (docs/units/intent-merge-card.md).
- firstmate's own cards stay on the v1 board. Studio renders them and forwards the captain's answers to the board endpoint, and never answers them by itself.

### 3.5 Evidence ledger

Every check result, review verdict, plan acceptance and card answer is stored with the input hash, head, check or skill version and actor, and is signed with Studio's local key. The final acceptance card shows the ledger split into "proved by checks" and "needs your eye".

## 4. Contracts

| contract | where | essentials |
|---|---|---|
| provider | src/providers | `run(role, prompt, tools, sandbox) → stream of events`; claude, codex, http, stub |
| host | src/host | attach to or fork a main session, driver lock, input queue with wakes, permission bridge (any failure denies) |
| check / hook | check-contract.md | manifest + executable; stdin JSON → stdout JSON; sandbox; deterministic or judged (locators required, quorum to block) |
| locator | check-contract.md | file · web · image · timeline · text · card |
| skill | src/skills.ts, data/skills | a role skill per workflow role, plus library skills imported from a folder, a skills home or a public https git URL (or built into a pack); every version immutable, pinned by `v<N>` and sha256. A skill is text for the prompt: it never changes a node's tools, sandbox, network or credentials, and import never runs anything from it |
| artifact | data/artifacts | immutable versions `v<N>`, type, lineage, approval state |
| pack | data/packs | manifest, node templates, checks, policies, workflow templates, eval set; versioned and hash-pinned |
| adapter | src/adapters | GitHub (REST + token), firstmate (read-only state + board endpoint) |

## 5. Workflows

- A workflow is a versioned file: nodes, edges, node config, attached checks and policy overrides.
- Editing creates a new version with a diff. A task pins its version.
- An agent node keeps its role skill and carries an ordered list of enabled skills, each pinned by version and hash. Turning a skill on or off, reordering, or moving to a newer version is an edit (a new version whose diff names the skills). The agent's instructions are Studio's safety rules, then the role skill, then each enabled skill under its own heading, in order, within a per-node size cap.
- The editor is a draggable SVG graph: move, pan, zoom, connect, a palette of node kinds and checks, a params form generated from schema, try-on-sample and validation (no orphans, a reachable end, gates attached). The live task overlay uses the same graph.

## 6. Policies

Resolution order: org → project → workflow version override → task override (only by a card).

Keys in use: `sensitive_paths`, `round_cap`, `round_timeout_s`, `shard_budget_s`, `auth.window`, `ste.rules`, `branch_prefix`, `ui_paths`, `flaky.retry`, `external.catch_up`, `privacy.denylist`, `egress.allow` (a task's extra hosts, per round), `worktree.keep_days`, `install` (a project's dependency install argv), `install_scripts` (lifecycle scripts run at install, in the round sandbox), per-check `promote.quorum`.

### Operating rules

`operating_rules` is the captain's standing text: one Studio-wide (`data/policies/org.yaml`) and one per registered project (`data/policies/project-<id>.yaml`). It never resolves through packs or workflows, and the generic policy route refuses it at any depth. Only the captain edits it, in Settings (the page's own session on a same-origin request from this Mac); scripts, phones, the policy API and model tools cannot. First run seeds a short generic Studio-wide default; a cleared text stays cleared and an unreadable file is never overwritten.

Every model job gets both texts in one labelled section with BEGIN/END lines: agent rounds, judges and designers, the merge-card coordinator, gate fix and review, evals, docs, skill edits, pack genesis, the status chat, artifact work runs and Codex image jobs. An empty level says `None set.`; an unreadable one says `RULES UNREADABLE` (Doctor shows it too). Rules are read when a job really starts (after its queue slot), and each job, round record and task job entry keeps the section's hash. Firstmate's seed carries them; a takeover, a restart or resume and any later edit send the section again with the next turn (the driver remembers the hash the live session last got).

Exempt: the Claude and Codex capability probes (a fixed one-line "reply OK" verification with no tools and no work) and sign-in flows.

## 7. Session takeover

- Studio is the captain's single entry point.
- Take over forks the firstmate session (`--resume <id> --fork-session`). It never resumes the live id, so the live session is never driven twice.
- Studio then holds the driver lock and writes a handoff. Release returns a resume command.
- firstmate's wakes are delivered into the input queue. The fork keeps firstmate's own hooks, so its Stop hook usually delivers a wake first; Studio shows every wake, drops the ones firstmate's acknowledgement record marks delivered, and sends the rest after a grace period. A rehearsal fork runs with `FM_IN_ROUND=1` and only shows wakes. Permission prompts and questions surface in Studio. Unit spec: [units/takeover.md](units/takeover.md).

## 8. External repos

Covered by the same graph plus a generated conventions pack: GitHub adapter, conventions detection (org first, then repo), the ci-trigger-prefix check, rebase with `--force-with-lease`, company review comments as findings, approval kept local, a privacy check, merge only by card. The sandbox is Studio's demo repo, published by the captain.

## 9. Pack genesis and self-improvement

- Packs are authored by the pack-genesis workflow: interview, samples, label, draft, check-the-checks, refine, shadow, promote, publish.
- Captain overrides at acceptance become labelled samples.
- The retro proposes measured changes, and a rejected proposal is never re-proposed.

## 10. Security

- Agent sandbox: worktree-only writes, no credentials in rounds, network by policy.
- Check sandbox: read-only inputs, `out/` only, no network by default.
- Skins are sandboxed iframes with a read-only snapshot.
- Secrets are 0600 files.
- Board calls carry Bearer plus Origin.

## 11. How Studio itself is developed

All Studio development follows firstmate's adversarial loop:

1. **Spec first.** Each unit of work has what/why/done lines in docs/ or a task file. Each done line names the test that proves it, and that test must fail before the change (fail-first).
2. **Builder.** An agent implements on a branch and runs `bun test` green before each commit.
3. **Adversarial review.** A reviewer with a fresh context and a different session from the builder runs firstmate's reviewer protocol (skills/reviewer/SKILL.md: closed numbered list, APPROVE or REJECT, follow-ups, evidence). It reads only the spec, the diff, the test output and the fail-first report, never the builder's reasoning. It runs through `scripts/adversarial-review.sh`, and its verdict is stored in data/reviews/.
4. **Fix rounds.** firstmate turns every finding into one brief per round, covering the whole class.
5. **Merge.** A unit lands on main only with APPROVE on its exact head.
6. **Dogfood.** Once code-firstmate runs end to end, Studio's own changes go through Studio's code-firstmate workflow on Studio's repo.

External completion recovery uses additive version-1 NodeRun.data.externalCompletion (visit/result) and externalHookReport (visit/signed check sequence ids). A descriptor is validated before cached completion is accepted. Completed hook checks run once per indexed check and current visit; replay can reconstruct a partially persisted report context from signed ledger evidence. Cancelling owns both subscription and any pending presentation/check work, so deletion waits for quiescence rather than accepting later card or ledger writes.

### Native owned-round admission and capability verification

The native runtime owns an event-driven queue of actual round jobs: explicit organization global capacity and per-project capacity default to three; eligible projects fill by fewest live owned rounds, then project name. Cards and finished jobs consume no live slot. Each wait persists an absolute deadline and visit identity; replay cannot renew an expired wait. Cancellation removes only the task-owned wait, and an older still-owned process must finish before a replayed round acquires its replacement slot.

Code-specific readiness belongs to the installed code domain adapter, not generic node execution. Accepted scope/spec/repository/dependency identities are signed at captain dispatch or fresh preparation; reservations persist until signed exact-head native merge evidence is still an ancestor of the authoritative local base ref. Closed/parked/cancelled status and unsigned merged flags provide no merge proof. Ordinary artifact workflows use bounded jobs and their existing acceptance contracts without requiring a Git merge.

Native vendor admission preserves the captain's per-vendor model and effort, requires fresh verified auth/quota/catalog evidence and records canonical resolved provider identity. Explicit judges do not use worker fallback; an optional explicit diversity requirement distinguishes actual vendors from fresh contexts on one vendor. A disposable Codex profile contains only validated model/effort and retains existing safety flags. Copied auth contains no refresh credential, endpoint, hooks or tool configuration. Unsupported or unverified native capability produces a real captain recovery card; separate web authentication proof cannot certify a native round.
Remote operation ownership (A3/B1/B2/B3): `remote-ready` precedes the six-gate edge. Its typed repository grant, native task lock/CAS and signed clean carry proof bind the final head. Edge checks own an explicit run/node/visit/head token while their source is passed; cancellation or head drift withdraws write/routing authority. Merge/update attempts persist before submission and remain final on the same head after failure, uncertainty or restart. Conflicted native rebases preserve versioned task-only state across worker resolution rounds; no approval carries through a conflict. See [remote-gates-merge](units/remote-gates-merge.md) for protection and upgrade limits.

### Independent Codex account and fresh host work

The desktop owns one bounded Codex public browser-login operation through `CodexAccount` (`account/login/start` with `type:chatgpt`). A matching completion triggers public account/model/quota verification; unknown requests are declined. OAuth URLs remain transient in the originating desktop response/browser, never events, installer logs or durable records. Cancel, expiry, exit and shutdown join the verified owned process-group cleanup. An owned Studio main session blocks account replacement; unrelated discovered terminal sessions do not. No external-token shortcut, API-key/billing switch or model fallback is used.

The Firstmate entry obtains project/config/account state without terminal discovery. Explicit optional history remains available for takeover. An independent start re-verifies configured account/model/quota, then calls `thread/start` with no origin ID and preserves the captain's Codex model/effort/approval/sandbox configuration. The exact configured project and its AGENTS instructions remain authoritative; creating a fresh vendor thread does not release another agent's project lock, certify native Engine workflow completion or migrate v1 state. CLI presence, account readiness and actual repository tool health stay separate. Backend usage/spend denials and unknown quota cannot authorize readiness.

This Codex unit does not implement Claude independent login or native Claude capability. See the separate read-only Claude proposal; the previous Doctor Terminal `/login` launcher is not represented as complete web-native login.

### Native startup and primary Firstmate

Source and binary use the same default Studio-owned store (`~/.crew-studio/data`); explicit stores are not migrated. The local launch client accepts only private owned runtime files plus an instance challenge proof before handing a session to the OS browser. HTTP never grants session credentials to an unauthenticated page. Browser dispatch acceptance is not visible-window proof.

A default fresh primary runs in data/workspace without a legacy handoff or firstmate repository requirement. Only this context advertises source-installed Codex dynamic native tools. The host checks thread/turn ownership, MainSession checks live generation and authenticated captain-input source, and the controller permits read-only registry/status access or a pinned native proposal. No model session secret, generic HTTP, grant, answer or execution tool exists. The source-bound firstmate-proposal workflow raises a captain-only dispatch card; actual captain answer starts the exact target version/parameters through existing Engine admission. Source-turn and child-run bindings are durable and idempotent; project or definition drift refuses continuation. Legacy/takeover contexts retain their original behavior and no native bridge.


### Native primary local-project recovery

The main host exposes source-owned read-only project/workflow lookup and `studio_prepare_project_work`. Unknown local repositories produce a captain-only local registration card; its approval registers the exact canonical Git identity. Native coding without approved staffing retains a signed pending intent and returns to the Firstmate conversation for role configuration; it does not consume dispatch finality. After configuration approval, a separate ordinary dispatch card starts the pinned workflow only on captain approval through normal Engine admission. Raw repo/base/branch/worktree remain forbidden in `studio_propose_work`. Versioned registration records bind local identity/head, workflow hash, source turn, actual confirmation card and project/result; restart cannot duplicate or silently repair uncertain records. This is local registration, not a GitHub grant or verified worker staffing. Structured native errors distinguish invalid parameters, absent/disabled/revoked projects, target drift and owner loss without publishing private exceptions. Private data/credential/runtime roots remain protected; source repository location alone does not make it a protected root.

### Project staffing authority

The primary Firstmate account is separate from workflow role selection. The native
staffing interview persists signed decision rounds: vendor choices unlock verified
model choices, then explicit reasoning effort. Recommendations never activate a
configuration. An authenticated captain-only staffing card writes immutable
project-local configuration versions and exact native role skill snapshots, then
atomically advances a signed activation pointer. Older pointers, altered snapshots,
unknown fields and stale compare-and-swap proposals hold without repair or fallback.

The source installs optional domain-free Engine callbacks before loading runs.
Native coding requires a verified configuration before allocation and signed task
staffing lineage before a paid role or fresh judge can run. Actual instruction
receipts bind configuration, skill body, provider, model, effort, node, visit,
attempt and head. Generic workflows retain their existing contract. Source provider
admission independently verifies fresh capability; login, adapter support, quota
and model availability remain separate facts.

Existing readiness-held Tasks can receive a captain-approved staffing upgrade
bound to their exact node, visit, attempt, head and prior configuration. The upgrade
preserves the original Task and leaves its fresh-preparation card unanswered. The
captain must approve preparation separately. No global vendor settings or account
files are written. Canonical registered-project identity resolves root, common directory, base and grant
from strict source-owned registry and bounded Git metadata reads. Coffee-workflow
integration is separate; absent source authority fails closed. The Firstmate chat is the primary entry; the
editable configuration panel is a secondary view of the same decision state.

### Claude native admission

Claude metadata uses official local CLI auth status without making a model request. Authentication, quota exhaustion and unknown quota remain distinct. Only explicit desktop Verify for an exact selected model/effort may create a private, short-lived execution admission after an isolated tool-free request exits successfully with matching actual model identity and verified process-group cleanup. Quota stays unknown; this Claude-only receipt does not weaken other providers or certify remaining balance. Runtime authentication, quota, model or execution failures invalidate it. Native worker execution preserves the existing round OS sandbox and source MCP allowlist; successful stream results wait for successful exit and group cleanup. See [the unit contract](units/claude-native-capability.md) for limitations and retained offline evidence.


Claude staffing keeps quota unknown. Only a source-owned callback holding the actual, unexpired, exact-model/effort Claude execution receipt may satisfy the unknown-quota exception during staffing confirmation and pre-allocation admission. Public copied facts cannot grant this authority; metadata lookup never performs Verify or chooses a replacement model. Codex retains its available-quota requirement.

Direct owned Codex primary imageGeneration items are staged by thread/turn/item and
verified as bounded PNGs, then published to the shared MediaLibrary before successful
turn completion. Interrupted/failed turns, stale items and unsafe saved paths cannot
publish. Managed drafts grant no approval; direct audio/video and historical output
backfill are outside this host contract.
