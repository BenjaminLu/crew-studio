# Retro 2026-10-17: workflows end to end

Target: a clean clone runs the shipped workflows end to end (code-firstmate local and GitHub PR, hello-crew onboarding, web-prototype, file-organization, video, images, documents). Every role applies the right skills for its node and delivers a quality artifact. Agents ask Firstmate first; a human card appears only when Firstmate cannot decide, and it answers the stuck question. Every node is configurable (model, effort, several skills), logged, resumable and hands off correctly.

Evidence: live runs R-003 to R-061, two live E2E runs of code-firstmate on money-kit (R-058, R-061), the full test suite on 2026-10-17, a clean clone with an empty data folder, and operator handoff notes. Run ids refer to the operator's data folder.

## Already fixed today

Captain change notes bind every later round. Worker and reviewer `run_tests` select files correctly and refuse vacuous passes. One role-skill source, pinned and enforced, shown per round. Designer runs as a blocking round with captures, plus a design gate. Firstmate follows the captain's script; readable staffing and dispatch cards; short Task titles. Code Tasks on one repository run concurrently and rebase every round, locally and on GitHub. Main's test suite is green apart from the items below.

## Findings and where each fix belongs

### Briefs, manual and Firstmate (manual, runtime, skill)

1. No operating manual Firstmate can look up. Procedure lives in code strings (build system prompt, deliver renderer contract) or in operator notes. Fix: bundled manual per workflow and role (environment, tools, tests, dependencies, deliverable, renderer contracts) and a Firstmate lookup tool.
2. Briefs have no fixed skeleton. R-058 build had no test or lint command, no dependency state, no deliverable; deliver briefs say only "Write film.html". Fix: every agent brief has BRIEFING, ENVIRONMENT, TOOLS, TESTS, DEPENDENCIES, DELIVERABLE, generated from the preflight and the graph.
3. Operator rules live outside the repository (merge flow, core suites, git prohibitions, no session links on GitHub, never print tokens). Fix: operating rules for agents, a contributor guide for developers, gates where enforceable.

### Skills (skill)

4. A role takes one skill file, so coffee-kit skills paste the generic worker contract above the domain profile. Fix: several named skills per role (contract plus profile); move detail to the manual.
5. The video editor runs on the web designer skill; images have no role, so no skill. Fix: a short film-editor skill; an image role and skill.
6. worker.md says "missing pins mean HOLD" while the two-way brief overrides it. Fix: remove lane rules from the skill; the brief carries lane facts.
7. Review and build nodes lack plain-writing; the documents writer leaks run instructions into the deliverable (R-032). Fix: pin plain-writing; writer skill line "never quote the run instructions".
8. Firstmate skill lacks: when to escalate (one-way, credential, preference nobody can infer), never invent a requirement (R-058 "EUR without conversion"), brief each role from the manual.

### Firstmate first and cards (runtime, card)

9. SCOPE-BLOCKED, budget and step-back go straight to the captain with the raw worker brief (R-041 SC-072/075/079/085, SC-102/106/112). Fix: Firstmate diagnoses first; a card states the decision in captain terms.
10. Cards that cannot answer the question: readiness cards with empty body and internal reasons (R-045, R-047, R-048); workflow-builder cards without fields or note boxes (R-044); escalation cards that name no check and offer only close. Fix: a card contract enforced by a gate: the stuck question, the needed input (choices, and a note box where an answer is text), localized labels, no null fields.
11. Accept cards can show "Proved by checks: None", and reject ends a run as succeeded (R-047). Fix: at least one readiness check per deliver workflow; reject closes.

### Deliverable quality (runtime, gate, script)

12. Generic deliver (video, web, documents) passes only the latest round's notes (R-051, R-054 lost earlier notes). Fix: the cumulative lineage images already use, for every producer; the brief names the parent version to edit.
13. Web prototypes are never interaction-tested (R-053 "submit does nothing" for three rounds). Fix: a headless smoke gate that runs the primary action, with the captain's note as the assertion.
14. Video acceptance checks only readiness, not duration or fades; Doctor has no film-renderer row; video gate skips the renderer. Fix: deterministic duration and dimension checks; Doctor row; gate stage check.
15. Documents: title from the raw prompt, readability findings invisible. Fix: title from the H1; wording findings on the accept card.
16. Custom workflows pass the design interview as each worker's intent and assign mismatched skills (R-044). Fix: per-node assignment and a skill catalogue the builder checks.
17. Routing: a website request went to startup-recursion (R-045). Fix: route by deliverable.
18. Coffee page node's first round hit a sandbox refusal (R-014). Fix: round folder inside the allowed write roots, with a regression test.

### Code workflow (runtime, policy)

19. Commits: subject cut mid-word, "(round N)" suffix, raw worker report as body, every round commit lands on main. Fix: one curated commit per Task on merge; round history stays in the ledger.
20. Reviewer defaults to diff mode and approved a change whose worker said tests were unverified. Fix: run mode by default, or refuse an APPROVE that ignores an unverified report.
21. Staffing is enforced by workflow id, so other code workflows skip it. Fix: enforce by kind.
22. github-review cannot run (activation held) and its graph has drifted from code-firstmate. Fix: keep it out of the end-to-end set until derived from code-firstmate.

### Clean clone (docs, build, gate)

23. Docs say not to run `bun install`, but the build needs it.
24. The compiled binary loads `.env` from the working directory, which can switch off the sandbox.
25. Shipped workflows fail their own readiness gate on an empty install (hello-crew, images, file-organization, code-firstmate false positives).
26. file-organization has never run live and has a required folder with no default or sample.
27. Catalog: empty descriptions, an operator's personal workflow in the defaults, coffee-kit pack reported as an error; Doctor wording that misreports GitHub and Claude state.
28. Today's live evidence ran unsandboxed with a full tool cache; nothing proved the sandboxed default path. Fix: acceptance in a sandboxed, empty-home run.

### Configurability (runtime, UI)

29. Per-node provider, model and effort show only for draft workflows; approved staffing is per role and overrides nodes; roles have no effort; loop nodes cannot set model or skills. Fix: per-node overrides on bundled workflows and loops.
30. A node interrupted mid-run restarts from scratch. Fix: documented, tested resume semantics per node kind.

## Plan

Fix in seven reviewed streams (manual and briefs; skills; Firstmate-first and cards; deliverable quality; code workflow; clean clone; configurability), then run every workflow end to end from a clean clone with real models and record the results here.
