# Unit board: one page for every run in flight and every decision waiting

What: a Board page, the home of the backbone sidebar (Board, Firstmate, Inbox, Crew, Runs, Workflows, Library), ported from the approved prototype's Board view (`.need`, `.rrow`, `.pipe`, `.crewline`). Three sections:

- **Needs you**: only the decisions waiting for the captain, Studio cards and firstmate cards alike: run or task, kind, a one-line why, age and an Answer button. The button expands the card in place (`crewBoard.mountDecision(el, decision)`: a Studio card is the shared `window.crewCard.mountCard` from public/scard.js, a firstmate card the Inbox's card view): options, note, intent ticks and the one-way confirmation, answered there with no navigation; the result ("… ✓", or the server's refusal) shows inline.
- **Runs**: every run in flight, one row each, Studio runs (`/api/wruns`) and firstmate tasks (the fm state readers): title and workflow, a stage pipeline bar (one segment per stage from `crewLayout.stagesFor`; done green, running blue and pulsing, waiting on the captain purple, failed red), "3/7 Build loop · round 2/3", a status badge, the crew working on it (vendor and model on hover), spend, elapsed. Rows update live from the page's one stream (`window.liveListen`); a click opens the run.
- **Crew on duty**: the live agents across all runs.

The subtitle reads "N runs, M crew on duty, $X today", from recorded job costs only.

The Inbox becomes decisions only: the captured-intents progress trail goes; a firstmate card is sent from the card itself (no confirm dialog) and its result shows on the card.

Why: the captain could not see the parallel workflows' progress (「看不到並行的workflow當前進度」), found the Inbox's status trail useless (「inbox裡的狀態進度沒有任何用處」), and could not answer a decision where it was shown (「也不能直接點擊確認互動」).

Done when (`tests/board-ui.mjs`, a fixture of three Studio runs in parallel, running in build round 2, waiting on its merge card, failed at CI, plus firstmate tasks; red on 17576c4, where #/board is the old task table and home is the Inbox):

1. Board is the home and the first backbone item. — "home is the Board, first in the sidebar".
2. The Board lists every parallel run with the correct segment states. — "the Board lists every parallel run with the correct segment states".
3. The label shows stage and round. — "the label shows stage and round".
4. Each row shows a status badge, the crew with vendor and model on hover, spend and elapsed; the subtitle has real counts and today's spend. — "row details and subtitle".
5. Needs you lists exactly the waiting decisions. — "Needs you lists exactly the waiting decisions".
6. A Studio card is answered inline from Needs you; the result shows inline and the row leaves Needs you. — "a Studio card already answered with the same choice shows as answered: Merge ✓ inline, and the row leaves Needs you", "a one-way Studio card in Needs you answers with the door tick".
7. A refusal shows inline. — "a refusal shows inline".
8. A firstmate card is answered inline from Needs you and from the Inbox (no dialog), through the board. — "a firstmate card is answered inline from Needs you", "a firstmate card is answered inline from the Inbox".
9. A live event updates one row without a reload. — "a live event updates one row without reload".
10. There is one stream connection. — "one stream connection".
11. The Inbox has no progress trail. — "the Inbox has no progress trail".
12. Screenshots at 1440 and 390, light and dark, beside the prototype's Board rendered at the same sizes, in tests/out/board/; no sideways scroll at 390. — "screenshots …".

Touches outside the unit's own files (public/board.js, public/board.css): backbone.js (nav order, home, the Inbox's intents embed removed), takeover.js (confirmSend sends in place), index.html (round 4: scard.js gains `opts.state`, one answer in flight and the same-choice answer), and the tests whose expectations moved (backbone-ui, smoke, takeover-ui).

## Round 2 (review board-r1)

Done when (`tests/board-ui.mjs`; red on a6578b8):

13. One answer in flight per card: two quick clicks post one answer (firstmate card on the Board, Studio option), the card's controls are disabled while it runs, and a late refusal never overwrites a recorded answer; a Studio card already answered with the same choice counts as answered. — "two quick clicks on a Studio option post one answer …", "the firstmate answer went through the board once, after two quick clicks".
14. Today's spend sums today's job costs over every run that ran today, finished ones included; a job is dated by its step, else its node; "—" when no cost is recorded at all. — "row details and subtitle … (R-091 finished today: its $1.00 counts)".
15. An expanded card keeps its note, door tick and refusal across re-renders, keyed by card id until answered; a live update that changes nothing on the Board does not redraw it. — "an expanded card keeps its note and its door tick across a re-render (an scard event)".
16. The one-way confirmation on the Board, for a Studio card and a firstmate card; the firstmate row's round; a firstmate row updating live. — "a one-way Studio card in Needs you …", "a one-way firstmate card in Needs you answers with the door confirmation", "the firstmate label shows its round", "a firstmate row updates live, without a reload".
17. Against the real runtime routes (no mock): a stub-provider run reaches its dispatch card, shows on the Board, is answered inline from Needs you and advances. — "the real run detail carries what the Board reads", "the real card is answered inline from Needs you", "the real run advances past Intake on the Board, live".

## Round 3 (review board-r2): every clause proved through its own code

New assertions (`tests/board-ui.mjs`): "an expanded card keeps its note, tick and refusal when it is mounted again" (closed and reopened, so mountCard runs afresh); "a Studio card already answered with the same choice shows as answered"; "a Studio card's options are disabled while its answer is in flight" and "a firstmate card's controls are disabled while its answer is in flight, and it says Sending…" (the request held by route interception); "a late refusal does not overwrite a recorded answer"; "a live update that changes nothing on the Board does not redraw it"; "a live redraw keeps the open Studio card's own elements (mid-typing, mid-click)"; "no cost recorded at all: today's spend reads —".

The clock: the Board reads one seam (`clock()`, `window.crewClock` when set) for "today" and elapsed. The test pins it and the page's `Date` to noon tomorrow, local time, and builds the fixture from the same instant, so the result never depends on when the suite runs.

Mutation check: each change applied alone, board-ui run, then reverted.

| mutation | where | caught by |
|---|---|---|
| card state not restored | the Studio card view (since round 4: scard.js `opts.state`) | "… when it is mounted again", "… across a re-render (an scard event)" |
| "already answered with the same choice" branch removed | the Studio card view (since round 4: scard.js answer) | "a Studio card already answered with the same choice shows as answered" |
| Studio options not disabled in flight | the Studio card view (since round 4: scard.js render) | "a Studio card's options are disabled while its answer is in flight" |
| firstmate controls not disabled in flight | board.js cardView wrapper | "a firstmate card's controls are disabled while its answer is in flight …" |
| late-refusal guard removed | board.js onCardAnswered | "a late refusal does not overwrite a recorded answer" |
| unchanged live update redraws | board.js soft wrapper | "a live update that changes nothing on the Board does not redraw it" |
| open card rebuilt on a live redraw | board.js needRow | "a live redraw keeps the open Studio card's own elements (mid-typing, mid-click)" |
| spend over in-flight runs only | board.js counts | "row details and subtitle …" |
| job not dated by its node | board.js spendToday | "row details and subtitle …" |
| "$0.00" instead of "—" with no cost | board.js counts | "no cost recorded at all: today's spend reads —" |
| page clock not pinned | board-ui.mjs open() | "row details and subtitle …", "a Needs you row shows … its age" |

Not caught alone, by design: the `inFlight` early return in takeover.js confirmSend. While an answer runs the controls are disabled, so a second click never reaches it. The return is defence in depth. Removing both the return and the disabling makes the "went through the board once, after two quick clicks" check fail.

## Round 4 (landing after intent-merge-card)

Needs you mounts the shared card component (public/scard.js, `window.crewCard.mountCard`) for Studio cards; the Board's own Studio card shell is gone. Two additions to the component, through its options and its own guard, serve every host:

- `opts.state`: the host's per-card state object (ticks, note, door tick, refusal, answer in flight). The Board keeps it by card id until the card is answered.
- One answer in flight per card. A card already answered with the same choice shows as answered.

The firstmate card stays the Inbox's card view, with the in-flight guard (takeover.js) and the late-refusal guard (board.js).

New assertions: "a live redraw keeps the open firstmate card's own elements"; "the open Studio card stays one mounted component across the Board's own redraws". The two-click check now counts every answer to SC-201, the second one included.

The mutation check, run again after the rebase. Each change was applied alone, board-ui was run, and the change was reverted.

| mutation | where | caught by |
|---|---|---|
| no host state (`opts.state` ignored) | scard.js mountCard | "… when it is mounted again", "… across a re-render (an scard event)" |
| "already answered with the same choice" removed | scard.js answer | "a Studio card already answered with the same choice shows as answered …" |
| options not disabled in flight | scard.js render | "a Studio card's options are disabled while its answer is in flight" |
| in-flight return and disabling both removed | scard.js | the above and "two quick clicks on a Studio option post one answer …" |
| firstmate controls not disabled in flight | board.js cardView wrapper | "a firstmate card's controls are disabled while its answer is in flight …" |
| late-refusal guard removed | board.js onCardAnswered | "a late refusal does not overwrite a recorded answer" |
| unchanged live update redraws | board.js soft wrapper | "a live update that changes nothing on the Board does not redraw it" |
| firstmate card rebuilt on a live redraw | board.js needRow | "a live redraw keeps the open firstmate card's own elements" |
| Studio component remounted on the Board's own redraw | board.js needRow | "the open Studio card stays one mounted component across the Board's own redraws" |
| spend over in-flight runs only / job not dated by its node / "$0.00" with no cost / page clock not pinned | board.js, board-ui.mjs | as in round 3 |

## Round 5 (follow-ups after the round 4 approval)

18. A decision that is no longer open leaves nothing behind on the Board. That covers a card answered here or elsewhere, a cancelled card, and a card whose run ended. Its open flag, its Studio card state and its mounted card go. The open card list (`/api/scards?open=1`) and firstmate's pending list decide this (board.js `prune`). — "a Studio card answered elsewhere leaves Needs you and the Board drops its open flag, state and mounted card", "a Studio card cancelled elsewhere leaves Needs you …". Red on efbbc99: the entries stayed. Firstmate side (follow-up 11 of r5): "a firstmate decision that leaves firstmate's pending list elsewhere leaves Needs you and the Board drops its open flag and mounted card". A guard: green on 92642da, where prune already reads `S.pending`; red under a mutation where prune keeps ids that are not Studio cards.

This doc was also swept for code and assertion names that rounds 4 and 5 removed or renamed.

## Round 6: task overview (captain-approved redesign)

Why: Needs you repeated the Inbox's cards in full, every workflow drew a full graph ("Live workflows") so several parallel Tasks tangled into one picture, and the task table sat at the bottom of the page. The approved prototype (Main.dc.html at 1440, Phone.dc.html at 390) replaces all three sections with one task overview. Needs you, Live workflows (public/workflow-overview.js, removed), Ended and Crew on duty are gone; the subtitle keeps the counts and today's spend.

What the Board shows:

- **Filter tabs** with counts: All, Waiting for you, Running, Stuck, Done today (全部 / 等你 / 進行中 / 卡住 / 今天完成).
- **One row per Task**, Studio runs and firstmate tasks alike, ordered Waiting for you, Stuck, Running, Done today (newest first within a group): status; title with run, workflow and project; the milestone track with the current milestone marked, its round and position ("Build loop · round 2/3 · 4/7"); **Now**; the overlap badge; elapsed.
- **Now**: on a running Task, who works: the node, its crew seat and the provider and model. The seat comes from the Task's own crew resolution: `/api/wruns/<id>` carries `crew`, read from the signed crew-resolved record the Task started with (src/crew-guard.ts). Each staffed node has its resolved seat (a team's workflow-node override included), named as that team names it, and its pick. A Task without a record (a staffed code workflow, a Task started before the team) names no seat; the Board never guesses one from the definition. The model is the round's own (the captain's pick for the node, else its latest step), else the resolution's. On a waiting Task, "Waiting for you: <card title>" and a "Go to Inbox →" link to `#/inbox/<card>`; the card is the run's oldest open card of the node's current visit (a card from an earlier visit never counts). On a stuck Task, why it is stuck, with a link to its card when it has one (a failure card). On a Task done today, its run state's word (Merged, Done, Closed without merging, Cancelled), in that word's tone.
- **Overlap badge** "↻ will rebase" / "↻ 會 rebase": another open Task's `ctx.spec.scope` meets this one's (one path holds the other, a glob by its static prefix, test paths never count; the same reading as src/runtime/queue.ts scopesOverlap). Its title names the other Tasks.
- **Detail panel** for the selected row, and nothing else: this Task's visited path from its steps (vertical; a revisit reads "round N ↺"; a step retried within one visit is one stop; bookkeeping hooks without a role are left out unless they failed or are current), every current node ringed (parallel branches each ringed; Firstmate when it is deciding an escalation), the four latest events in the Task page's own words (runtime.js `crewTimeline`), and **Full graph** (`#/run/<id>?graph=1`, the Task page scrolls its graph into view) and **Open task**.
- No card body and no workflow graph on the Board. A footnote says so.
- While the operator's .env sets CREW_LOCAL_UNRESTRICTED=1 (`/api/policies` `execution: "local-unrestricted"`), the Sandbox off notice (ootb.js `crewUnrestrictedNotice`) sits under the header, above the filters and the rows. — board-overview-ui "the Sandbox off notice shows at the top of the Board …", "no Sandbox off notice while the sandbox is on".

Milestones (board.js `milestones(def)`, deterministic per definition):
1. the definition's stages when it has any (`crewLayout.stagesFor`: the nodes' own `stage`, else the built-in grouping, e.g. code-firstmate's seven stages);
2. otherwise its main path: from the entry node (the first with no incoming edge), follow at each node the first outgoing edge to a node not yet on the path, an unconditioned or forward edge (ok, pass, go, approve, accept, merge, done, yes, dispatch, next, continue) before any other, in definition order. The milestones are the path's work nodes: agents, checks, cards, loops, and hooks that run a role. A node off the main path belongs to no milestone; the track marks the milestone after the last one reached.

Groups, from the run's own state:
- **Stuck**: the run failed (a run ended by its round cap fails too, result `cap`). Or its latest round-cap step (`outcome: "cap"` in `steps`) has nothing after it, except the one card the cap raised, still open (the round-budget card). Or Firstmate is deciding an escalation first (`ctx.firstmateQuestion`: an agent's question, or a card Firstmate diagnoses before the captain). A node keeps `outcome: "cap"` after the Task moved on: a rescope on the budget card runs the spec again and raises the dispatch card. Only the steps say whether anything ran after the cap, so that Task waits for you, not stuck. A firstmate task: `failed`.
- **Waiting for you**: not stuck, and the run has an open card or a node waiting on one. A firstmate task: `needs-you`.
- **Done today**: ended today and not failed (succeeded, closed, cancelled). A firstmate task: merged today.
- **Running**: the rest (queued, running, paused, waiting on an external event).
- Failed runs stay on the Board for a day, as before; archived ones never show.

Layout follows the main column's width (the Firstmate panel takes room from it), re-chosen when that width crosses a threshold: ≥ 1080 px a table with the panel beside it; 640–1080 px compact rows with the panel beside it; < 640 px (a phone) cards with the panel opened under the chosen card (tapping it again folds it) and a top bar "N tasks waiting for you · Go to Inbox →" linking to `#/inbox`. No sideways scroll at any width.

The round shown with a milestone counts as src/runtime/refine.ts does. The cap is the loop's own `round_cap` plus the run's added rounds, else the run's effective policy: `/api/wruns/<id>` `roundCap`, which is `engine.policy(run, "round_cap")`, workflow and project over org, added rounds included. Rounds a budget card extended are added on top.

Live: rows follow the page's one stream as before (the same membership and stale-detail rules). A redraw keeps the selected Task, the focused row and the scroll, including the panel's own.

Keyboard and roles: the filter tabs are one tablist. Only the chosen tab is in the tab order, ←/→ (Home/End) move to a tab and show its rows, and the list is its tabpanel. The rows are a `list` of `listitem`s. The selected row carries `aria-current`. Its links stay ordinary links, never inside an option. Exactly one row is in the tab order: the selected one, else the one the keys last reached, else the first. Beside the list, a selection the filter hides (or none) moves to the first row shown, and the panel follows. On a phone, the panel sits inside its card's list item; a filter that hides the card closes it. ↑/↓ (Home/End) move the selection beside the list, and only the focus on a phone. Space opens or folds a card's panel on a phone. Enter opens the Task.

Data: the existing APIs (`/api/wruns`, `/api/wruns/<id>`, `/api/scards?open=1`, `/api/policies`, firstmate's summary). No endpoint was added. The run detail gained two fields, `crew` (the resolved seats) and `roundCap` (the effective round cap); tests/board-crew.ts covers both, with a workflow-node seat override and a workflow's own round cap policy.

Tests:
- tests/board-overview-ui.mjs (new): 1440 with the Firstmate panel closed (table) and open (compact list, panel beside), and 390 in zh-TW (cards). No card body, no workflow graph, row order and groups, every filter with its count, the milestone track and label, Now (seat and model; the card and its Inbox link; why stuck), the overlap badge, the detail path with "round 2 ↺" and the current node ringed, Firstmate ringed on an escalation, recent events, Full graph and Open task, ↑/↓ and Enter, a live update keeping the selection, focus and scroll, the Inbox deep link, the phone bar, the main-path milestone rule, no sideways scroll. Screenshots in tests/out/board-overview (or `BOARD_SHOTS`).
- tests/board-ui.mjs: the parallel runs and their milestone states, labels, subtitle and spend, live updates and one stream, and the waiting decisions' links. The answering checks that ran in Needs you (refusal inline, one answer in flight, the door tick, note and tick kept across a re-render, a late refusal, the firstmate door confirmation, answers through the board) now run in the Inbox, where the cards are answered. The Board's per-card state checks (`crewBoard.held`) went with the code they tested.
- tests/workflow-overview-ui.mjs, -races.mjs, -fold-ui.mjs: ported from the graph to the rows on the real engine. They cover card identity per Task, a stale-visit card, failure cards, parallel waits ringed, done today, archive/unarchive/delete live, stale details that cannot bring back a left card, the first viewport, a live move with the viewer's scroll and selection kept, storage blocked, and the live cue captures.
- run-end-ui, smoke, inbox-live-ui, studio-agents-ui, task-round-ui, crew-visibility-ui: their selectors follow the new rows.

## Issues: open GitHub issues as work packages

Issues belong to their project: a project connected to GitHub has a "GitHub issues" section on its page
(`#/project/<id>`, `public/issues.js`); the Board shows Tasks only. The section has two parts:

- **The batch form.** How many issues the next triage takes (1 to 50, 15 by default) or which issue numbers, and the two
  investigators' models as a triage of this project would run them (the team's seats in this project, else the
  workflow's Claude and Codex roles). Triaging posts `POST /api/issue-triage/<project>/start` (the desktop captain only)
  and opens the Task, which reads the issues and waits at its start card before any model runs. When both investigators
  would run on one model the form says so and cannot start.
- **The latest triage** (`src/domain/issue-triage.ts`, stored by `src/issue-triage-store.ts` under
  `data/issue-triage/<project>.json`, read through `GET /api/issue-triage` and `GET /api/issue-triage/<project>`, which
  also names the investigators): work packages and what the investigators disagreed on. With categories, each
  category shows the triage of its own issues (its packages, the open one's detail, what waits for judgement) and its
  issue lines name their package; the triage of issues no category holds, with the batch form, follows the categories.
  There is no project-wide list of issues nobody investigated: a category's triage button takes its untriaged issues.
  A package kept as a proposal (its approval card closed with "Keep as proposals") is approved later right there:
  `POST /api/issue-triage/<project>/approve {packages}` (the desktop captain only) reads the issues again first; a
  package whose issue changed is stale, never approved, and an approved one records who approved it and when.
  A package not worked yet (waiting for approval, or stale) can be declined there:
  `POST /api/issue-triage/<project>/decline {packages}` (the desktop captain only) drops it, never gives its id out
  again, and releases its issues, so a later triage investigates them again.

**Matching across batches.** A batch's packages are matched against the earlier ones by a fixed rule, never by a
model: a new package with an issue at the same file and symbol as an earlier package (waiting for approval or approved)
is not added as its own. If the earlier package's work has not started, the match waits under "For you to judge"
(`rec.cross`, `X-n`): the captain joins it to that package (which then waits for approval again; `dedup` counts a repeat
fix avoided) or keeps it apart (`POST /api/issue-triage/<project>/cross {id, action: join|apart}`, the desktop captain
only). If that work has started, the new package is a recheck naming the earlier package and the function (`match`):
that work may already have fixed it. A waiting match whose earlier package starts becomes such a recheck; one whose
earlier package is dropped or stale becomes a package of its own, so no issue is lost. The rule is conservative: the file
and symbol must be equal as written (two investigators naming one function differently do not match), a recheck package
is never matched, and a package matching several earlier ones is matched to the first. Nothing joins a recheck; joining
an ordered package appends to its order, any other join makes a set its owner orders, and each join is recorded on the
package (who, when, whether it withdrew an approval). Each batch's brief lists the earlier packages and where they are,
as data cleaned of markup and line breaks.
In Chinese the work is called 分診 (triage): its product is work packages, not categories.

The page's Crew section lists each team seat the way this project runs it (`GET /api/team?project=<id>`): provider,
model and effort, marking a change this project makes to the team.

- A triage is two independent investigators' reports on one snapshot of the open issues, read against the code at one
  commit. Studio checks every finding mechanically: the issue is in the snapshot and every file exists inside the
  checkout; a finding that needs code (`present`, `fixed?`) also states a line range (`a-b`; all its ranges in one file
  at most 200 lines together) and a symbol that is one name (its last part at least 3 characters, not a keyword) written,
  whole or by its last part as a whole word, from 200 lines above that range (the function it sits in) to 15 lines after
  it (a name check, not a definition check),
  quotes at least one distinctive line (16 characters or more, whitespace, commas and semicolons aside, naming something
  besides keywords: `} catch (e) {` alone is not evidence), and every quoted line is in its file within 15 lines of the
  stated range and inside what `fs_read` returned to that investigator in its round. It compares the two reports: the
  same state and, when that state needs code, a shared file. Two `not-found` (or two `not-code`) answers agree.
- A work package is what both reports agree on and every member passes the check: an ordered set (worked in that order,
  one pull request each), an unordered set (its owner picks the order), a one-change group, a single issue, or a recheck
  (both find it already fixed: a person rechecks it, it is never closed on that evidence). Sets match by overlap: when
  the two reports' sets (or one-change groups at one file) differ by one issue, the issues both name are the package (a
  single when one is left), marked as an overlap, and the other issue goes to "For you to judge"; a larger difference all
  goes there. An issue one report leaves out anywhere but last in an order sends the whole set there: the order without it
  is not one both gave. A set both find partly fixed goes there too (a person decides what is still work); a set both
  find wholly fixed is a recheck.
  Everything else is listed under "For you to judge" with the reason.
- Issues both reports find `not-found` (it needs more information) or both `not-code` are their own agreed outcome
  (`rec.noCode`, one entry per state), listed as "Agreed: nothing to change in the code": neither a package nor a
  disagreement. Both reports must pass the check for that too; otherwise the issue goes to "For you to judge". It is
  shown only in Studio, never written to GitHub.
- Security comes from the issue's labels or either report (one report's `yes` is never a disagreement); a security
  package says its issues are referenced, not closed, by a pull request and close only after a recheck.
- A package is waiting for approval, approved, or stale (an issue's title, text or labels changed since it was
  investigated: any label, `good first issue` too, since a label can change how its pull request names it).
- The stored triage keeps each issue's title, labels and content hash, never its body. Titles are untrusted text and
  only ever go into text nodes.

### Issue categories

A connected project's issues are filed into categories kept in Studio (`data/issue-categories/<project>.json`), never
written to GitHub as labels: the lead's own view to hand work out one category at a time. A category is one product area
or one kind of work; its issues may have different root causes. Security is a flag on an issue, never a category.
Planned work (roadmap and program tasks, plans, process work) is tagged `PLANNED` in Studio and set aside: it is not
handed out by category. A run only proposes the tag: an issue is set aside once the captain approves it on the run's
card, so an issue's own text ("this is a roadmap tracking issue") never sets it aside alone: until the captain answers it
is in no category and the page shows it as waiting, and declined, the next run files it into a category. A model's
`PLANNED` from before runs waited for the captain (no `decidedBy`) counts as waiting too; a security issue among those
is filed again by the next run. A security issue
is never tagged planned by a run: one with a security label (`security` or `sec`, as triage reads it) or security words
in its title (`SECURITY_TITLE` in `src/domain/issue-categories.ts`: security, vulnerability, exploit, CVE, XSS, CSRF,
SSRF, RCE, injection or SQLi, DoS or ReDoS, path traversal, an open redirect, prototype pollution, a sandbox escape, an
auth or permission bypass, privilege escalation, a leaked secret, token, credential or key,
資安, 安全, 漏洞) must be filed into a category, and the brief names such issues. The page lists planned work apart, each
issue with why, and what a run proposed as waiting for approval; the captain tags an issue planned (move to `PLANNED`,
which also approves a proposed one) or takes it off (`unplan`: the next run files it into a category, and no run tags it
planned again; the brief names such issues).

`workflows/v2/issue-categories.wf.yaml` (`src/issue-categories-workflow.ts`, `src/domain/issue-categories.ts`, internal;
started from the project page's Build categories / File new issues button, `POST /api/issue-categories/<project>/start`):

1. **Snapshot.** Studio reads the open issues (GET only) and takes the ones no category holds yet, at most 200. A
   project with no list builds it; every later run files: the list is never built again from scratch.
2. **Start card.** Captain-only: how many issues, build or file, the categorizer's model. Refused before it is shown when
   the categorizer would not run in the round sandbox with no network beyond its model.
3. **Categorizer** (the maker seat; Claude without a team) follows `workflows/skills/issue-categorizer.md`. It reads issue
   text only through `issues_read` (untrusted) and submits once with `categories_submit`. Studio refuses a report that
   files an issue twice or leaves one out, names a category that is not open, gives a category no scope, or makes
   security a category. Building: every category has a name and a one-sentence scope. Filing: into an existing category,
   or `NEW` with a name, a scope and why none fits. Either way an issue may instead be planned work, with why, unless it
   is a security issue (refused: file it into a category).
4. **Record.** Issues filed into existing categories take effect at once. New categories (all of them, on a build) and
   planned work are proposals; the record keeps each issue's title and the open issues of that read for the page. The list may have
   changed while the categorizer ran: an issue filed into a category the captain merged follows the merge, one into a
   category gone since stays unfiled for the next run, and a new name that exists by now files into that category.
5. **Approval card.** Captain-only, only when there are proposals (new categories, planned work, or both): approve keeps
   them; decline releases the categories' issues to be filed again next run, and makes each proposed planned issue the
   captain's "not planned" (the next run files it into a category). It lists each proposed planned issue with its title
   and the categorizer's why, as data. Proposals left by a run that ended (cancelled at the card) are approved or declined on the
   page instead (a planned one: Set it aside, or Not planned). A declined name is listed in later briefs and refused if proposed again, unless a live category holds it again. Names and scopes are one line of
   plain text; security (資安, CVE and the like included) is never a category. Every step is on the run's ledger (`categories-snapshot`, `categories-report`,
   `categories-written`, `categories-decided`).

The page's Categories card lists each category with its scope and issues. The captain renames a category, moves an issue
and merges a category into another there (`POST /api/issue-categories/<project>/edit`, desktop only); a run never
overwrites those edits, even for an issue it was filing at the time. Counts are of the issues open at the last read.
"Triage this category" starts an issue triage of its issues not triaged yet, up to 50 at a time, so the investigators see
the category together instead of a batch by age, and a large one is worked through in turns.

Tests: `tests/issue-categories.ts` (the reports, build and file, approval, the captain's edits, the store, the routes),
`tests/issue-categories-workflow.ts` (the workflow end to end with a scripted categorizer), `tests/issues-ui.mjs` (the
Categories card), `tests/acceptance/issue-categories.yaml`.

### The issue-triage workflow

`workflows/v2/issue-triage.wf.yaml` (`src/issue-triage-workflow.ts`, internal: Firstmate starts it with
`studio_triage_issues`) triages one batch of a connected project's open issues:

1. **Snapshot.** Studio reads the open issues through the project's GitHub grant (GET only) and pins the code: the commit
   the base branch is at, cloned read-only under `data/work/issue-triage/<task>/checkout`, never touching the project's
   own repository. The batch is the issues named, else the oldest open issues not investigated at their current text
   (15 by default, at most 50).
2. **Start card.** Captain-only: the batch, the commit and both investigators' models. Nothing paid runs before it;
   closing it removes the checkout. It is refused before it is shown when both investigators would run on one model, or
   when their rounds would not be in the round sandbox with no network beyond the model (a sandbox-off grant, an
   `egress.allow` policy, local unrestricted mode).
3. **Two investigators** on the maker and reviewer seats (Claude and Codex without a Studio team; the team decides otherwise; always two different models) follow `workflows/skills/issue-triager.md`.
   They read issue text only through `issue_read` (this batch only, marked untrusted) and the code only through
   `fs_list`, `fs_search` and `fs_read` on the checkout, in the round sandbox with no network and no token. They submit
   with `triage_submit`: Studio refuses a report for another commit or one that does not cover the batch exactly once,
   and answers with every finding that fails the check (a file, symbol, line range or quote it cannot find, or a quote
   `fs_read` never showed that investigator), so the investigator can correct it. The ledger records a digest of what
   `fs_read` returned next to each report; a report whose reads are missing or changed is refused, and one from a round
   that ran before Studio recorded reads is refused by name (triage those issues again).
4. **Record.** Studio checks both reports (refused when both ran on the same model), reads the issues again (a package
   with an issue edited meanwhile goes to "For you to judge"), joins the batch to the stored triage (a closed issue's
   package is dropped, an edited issue's package becomes stale and the issue is taken again by a later batch) and
   removes the checkout.
5. **Approval card.** Captain-only, naming the security packages and that whoever owns security must agree. Approving
   reads the issues once more: a package whose issue changed is stale, never approved. Every step is on the Task's
   signed ledger (`issue-triage-snapshot`, `issue-triage-report`, `issue-triage-written`, `issue-triage-approved`).

### Working a package

`studio_work_package {project, package}` (Firstmate, in a captain's turn) proposes the next issue of an approved package
on code-firstmate, through Studio's own proposal path: the captain approves the Task on its dispatch card, and the
code-firstmate definition is unchanged. One person works a package one issue at a time: an ordered package in its
order, the next issue only once the one before is merged; a one-change group is one Task for all its issues; an issue
whose Task ended without a merge is offered again; a recheck package is not code work. Studio reads the issues again
first: one edited since it was investigated (its title, text or any label) makes the package stale and nothing is
proposed; one missing from that read (closed, or moved between pages while read) is refused once, the package unchanged.

The Task's request is built only from what Studio derived or checked (`issueBrief`): the issue numbers, each title quoted
on one line as untrusted text, the files both investigators named (each exists at the triaged commit; `triageRecord`
keeps only those), a symbol only when it is a code name that file contains, line numbers, the step in the package, a
done line that must fail before the change and pass after, the rule that the Task stops on its local branch and its
commits name no issue and mention no one, and, for a security issue, no exploit detail there either. It names each issue
as "issue n", never `#n`. Model-written text never goes in: not the repro, not the
tag, not a package's why. The investigators read the issue's untrusted text, and two models can be steered by it alike,
so their agreeing on a function does not make their words safe for a worker that runs commands; the page still shows
the repro to the captain. The issue's body never goes in.

The Task is **tainted**: Studio marks it (`_tainted`, a parameter no model can set: `proposeTainted` in
`src/firstmate.ts`; a held proposal proposed again and a new Task from its failure card keep it). A tainted Task never
touches GitHub: its review-request adapter is the local one whatever the project's grant (`selectedAdapter` in
`src/domain/code.ts`), so nothing is pushed, no pull request is opened and nothing on GitHub is read for it. Reviewed and
past CI, it does not reach the merge card: it ends at Remote readiness, ready on its local branch (`taintedReady`: the
branch, its head and its base on the run's ledger as `tainted-ready`, the Task closed with "ready on branch …, not
published"), and its merge step refuses it. The diff and the evidence stay on the Task's page in Studio. Studio offers no
way to publish such a branch yet; a later, explicit captain action may. Which issue a Task works on stays in Studio (the
package's work record, the run's ledger). As defence in depth its commit messages name no issue and mention no one:
GitHub links any `#n`, `GH-n`, `owner/repo#n`, issue, pull request or discussion URL (with or without `https://` or
`www.`, or a relative `issues/n` path) back to that issue, and notifies an `@user` or `@org/team`, so each reference
becomes "an issue" and each mention loses its `@` (`withoutGitHubLinks`, `src/domain/pull-template.ts`; an HTML entity,
a CSS color, a URL's anchor and code spans stay as written). Its reviewer always works in run mode (the tests run),
whatever `reviewer.mode` says. And it runs only in the OS sandbox: while Studio is in local unrestricted mode
(`CREW_LOCAL_UNRESTRICTED`) or a sandbox-off grant is open for its project, no step of it starts, no agent turn opens, no
check runs (a node's, an edge's, a card's or one a domain runs after an answer) and no card answer carries it on, though
holding it is always allowed (one rule, `taintRefusal` in `src/runtime/engine.ts`). The package records each issue's
proposal; the Board shows where its Task stands (in progress, ready on its branch, merged, ended without either) and how
to start the next one: an issue whose Task is ready counts as done for the package's order.

Tests: `tests/issue-triage.ts` (snapshot, checks, comparison, packages, batches, merging, approval, declining, next issue, brief, store, routes),
`tests/issue-triage-workflow.ts` (the workflow end to end against a local GitHub stand-in with scripted investigators:
both cards, the tool limits, refused reports, changed issues, one model, Firstmate's tool), `tests/issues-ui.mjs` (the
project page at 1440 and 390 zh-TW: the batch form and what it sends, one model refused, packages, order and locations,
links, a title with markup, status and Task progress, each package and match in its category and the rest after them, approve and decline, the empty state, the Crew section's seats; the
Board has no Issues view), `tests/tainted-task.ts` (a tainted Task: only Studio marks it and the dispatched Task keeps it,
no GitHub call through the whole code-firstmate flow and an end on its local branch, no issue reference or @mention in
its commits, run-mode review, no step, agent turn, check or carrying answer outside the OS sandbox). Both workflow tests
check that GitHub is only ever read (no POST, PATCH, PUT or DELETE).

### Measuring triage and categories

A gold set per project (in the data directory only) and an offline scorer that replays the stored investigator reports
through the current rules: `bun scripts/issue-eval.ts mine|label|import|score <project>` (docs/units/issue-eval.md).

## The merge card's review room

Every merge card, wherever it is shown (the Inbox, the Task page), carries the same "Open review room" entry and the
room's summary (questions asked, the understanding check, sources). The room is its own page (`#/review/<card>`): a tutor
on the reviewer seat explains the pull request on a board and in a chat, read-only, each turn a paid round the captain
confirms; it never answers the card or changes merge readiness. Unit spec: [review-room.md](review-room.md).

### A reviewed branch, and a pull request by its URL

The review room is not only the merge card's. A Task page shows "Open review room" once Studio's review passed at the
Task's head (`#/review/R-n`): on its way to the merge card, and on a tainted Task that ends ready on its local branch,
never published ("· new commits" when the head moved since the captain last looked). The Review Room's home (`#/review`)
and a connected project's page take a pull request's URL (`https://github.com/<owner>/<repo>/pull/<n>`, a repository of a
registered project connected to GitHub only; anything else is refused with the reason) and open its room
(`#/review/PR-…`): its state on GitHub (open, draft, approved at this head and by whom, merged, closed, from a fork), how
many commits came since the captain last looked, "Check for new commits" (an explicit read, never a polling loop), what
reviewers asked as a scene of their words, and what changed since last time as the next turn's first scene. Merged or
closed, the room stays readable and takes no turn. A pull request no Studio Task made asks on the project's approved crew reviewer (its first confirmed turn makes a small host Task; no approved crew: "Approve this project's crew first"). Unit spec: [review-room.md](review-room.md), "Subjects".
