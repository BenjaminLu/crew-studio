# What Firstmate can see: Studio's read tools (P1, P2)

Firstmate used to see Studio through one tool, `studio_work_status` (the newest 50 Tasks), and the live status line on each
captain turn. It could not read a review room, the pull request list, a card's choices, or what the captain was looking at.
P1 gave it four read tools over one registry of entity kinds; P2 adds `studio_logs` and `studio_events` and a kind for
every other board page. Every one is read only: none answers a card, starts a paid
run, writes to GitHub or touches a secret.

Code: `src/observe/registry.ts` (kinds, refs, trust, budgets, the envelope), `src/observe/kinds/*.ts` (one file per kind),
`src/observe/events.ts` (`studio_events`),
`src/observe/now.ts` (`studio_now`), `src/observe/tools.ts` (the four tools), `src/observe/focus.ts` (what the captain is
looking at), `src/observe/catalog.ts` (the index of Firstmate's native tools), `src/observe/instructions.ts` and
`src/observe/guide.ts` (the index, below). The tools join Firstmate's native tools in
`src/runtime/index.ts`; the `/api/focus` routes are in `src/server.ts`. Tests: `tests/observe-registry.ts`,
`tests/observe-kinds.ts`, `tests/observe-focus.ts`, `tests/observe-index.ts`, `tests/observe-ui.mjs`. Real-model eval: `scripts/observe-eval.ts`.

## The tools

| Tool | What it returns |
| --- | --- |
| `studio_now` | where the captain is (each window's page, item and dialog, how long ago; over 10 minutes it is "last seen"), the cards waiting for them, most urgent first, what runs with its progress and cost, what changed in the last hour |
| `studio_find {query, kinds?}` | refs whose id or Studio/captain words match, each with a `resource_link` (`studio://kind/id`) |
| `studio_list {kind, filter?, cursor?, depth?}` | one kind's entities with each one's summary, paged |
| `studio_get {ref, depth?}` | one entity |
| `studio_logs {ref, tail?, since?}` | a Task's steps and events, a room's tutor rounds and Explain-with runs (cost, why each stopped), a pull request's go-live timeline, a terminal's state; oldest first, with a cursor |
| `studio_events {since?, kinds?, ref?}` | Studio's event log (`data/events.jsonl`) read on with a cursor: the pull form of a subscription |

The same six, with the same names and input schemas, reach Claude (its MCP helper, `src/mcp.ts`, over Studio's private
socket) and Codex (dynamic tools). Claude's list also carries each tool's `outputSchema` and `annotations`
(`readOnlyHint: true`); its results come as `structuredContent` with the same JSON as text, the trust note as `_meta`.
`studio_work_status` stays, as the task kind's listing in its older shape (`src/observe/kinds/task.ts workStatus`). The live
status line (`src/firstmate-turn.ts liveStatus`) is a rendering of `studio_now`'s summary. The fresh primary's list of
tools comes from `src/observe/catalog.ts`.

## Kinds

| Kind | Ref | Board page | Read from |
| --- | --- | --- | --- |
| `task` | `task:R-162` | `#/run/<id>` | the Tasks list row (`src/runtime/task-row.ts`, the route's own function) and the Task's state |
| `card` | `card:SC-248` | `#/inbox/<id>` | `engine.cards.view` (the Inbox) |
| `room` | `room:PR-<hash>-1645` | `#/room/<id>` | `reviewRoom.list / view(id, false) / explain.view` (the room page's own reads; never opens the room, never reads GitHub) |
| `pr` | `pr:owner/repo#1645` | `#/prs` | the pull request list's `view()` (the last snapshot) |

| `workflow` | `workflow:code-firstmate` | `#/workflow/<id>` | `WorkflowDefs.list()` (the rows `GET /api/wf` returns); an imported package's words untrusted |
| `project` | `project:harbor-app` | `#/project/<id>` | the Projects page's `sidebar()` and `page(id)` (`src/project-overview.ts`) |
| `skill` | `skill:baton@v2` | `#/skills/<id>@<n>` | `Skills.library()` (`GET /api/skills`) and, for a script skill, `SkillPackages.status`: the captain's decision and the prepared environment |
| `crew` | `crew:worker` | `#/crew` | the approved team (`CrewStore.current()`, `teamBody`) |
| `terminal` | `terminal:T-…` | `#/terminals` | `Terminals.list()`, state only (never the screen, never the question it shows) |
| `artifact` | `artifact:<id>` | `#/artifact/<id>` | `ArtifactStore.view()` (`GET /api/artifacts`) |
| `doc` | `doc:<id>` | `#/doc/<id>` | `docRows` (`GET /api/docs`); at depth full the latest text, untrusted |
| `doctor` | `doctor:<item>` | `#/doctor` | Doctor's rows (`diagnose`), home paths as `~` |
| `settings` | `settings:studio` | `#/settings` | the non-secret settings only: chat provider, which keys are present, sharing, phone driving |
| `peer` | `peer:lan-…`, `peer:phone-…` | `#/lan` | LAN peers and paired phones, redacted: never a key, an address or what a peer calls itself |

Every board route is a kind's (its page, its list or one of the pages it names in `pages`) or a read tool's (`TOOL_PAGES`:
the board and the Firstmate panel are `studio_now`'s, the activity log, an event and the retro `studio_events'`, the roadmap
the manual's). `tests/observe-registry.ts` fails on a route that is neither: there is no pending list any more.
`settings`, `peer` and `terminal` are never grantable (`NEVER_GRANTABLE`, with the grant list and focus, which are no kind);
the registry refuses a never-grantable kind that says otherwise.

## Logs and events

`studio_logs` reads a kind's `logs` (declared with `logFields`, trust as for `fields`). A terminal's log is its state; the last
lines of its screen come only when the captain's own message in this turn names a terminal and its output
(`captainAskedForScreen`, read from the captain's words, never from the tool's arguments); never on a card, a wake, another
question or for a grant. The screen and the question it shows come as untrusted.

`studio_events` reads Studio's event log oldest first after `since` (the `nextCursor` of the last call, `seq:N`, or a time);
with no `since` it reads the latest. Each event names the refs it is about (`refsOf`), so `ref` and `kinds` follow some. The
retro's signals (`run_failed`, `room_round_failed`, `pr_*`, `captain_note`) carry codes and refs at Studio's trust; a
`captain_note` brings the note's text at captain trust and the page text selected with it as untrusted. Studio's audit lines
(grants, skill imports) keep their summary; any other line's summary comes as untrusted and none of its data. A withheld
Task's events show none of their untrusted parts.

## The envelope

`{ref, kind, route, updatedAt, data, untrusted, nextCursor, truncated}`, and `items: [{ref, kind, route, title, updatedAt}]`
for a list or a search. `depth: "summary"` (default) fits 4 KB, `depth: "full"` 24 KB; what does not fit is cut (arrays
halved from the end, the newest kept first) and says `truncated`. A mistake is a tool error that says how to fix it (the
valid kinds, the ref format, the list to call, the cursor to drop).

## Trust

Each kind declares every field it emits and that field's trust: `studio` (Studio's own state), `captain` (the captain's own
words) or `untrusted` (a pull request's text, a reviewer's comment, a tutor's or model's answer, an error that quotes a tool).
An untrusted value comes as `{untrusted: true, source, text}` and its path is listed in `untrusted` and `_meta["studio/trust"]`.
A field nobody declared is never emitted. A Task whose text is withheld from Firstmate (a peer's Studio, issue text) shows its
state and none of its untrusted fields. Everything goes through Studio's redaction. This is spotlighting, not the boundary:
the boundary is that none of these tools can do anything.

## Focus: what the captain is looking at

The board reports, debounced, the page, item and dialog each window shows: `POST /api/focus {route, ref?, selection?:
{kind, id, label}, dialog?, label?, tab, visible}`. Only the captain's own page on this Mac reports it: the session cookie on a
same-origin request on the loopback listener; a script's header, a tool token and a paired phone are refused. A report carries
ids and the labels Studio itself shows, capped at 80 characters, never what is being typed and never a picture. Studio keeps
the last 20 in memory, with when each window was last seen. `POST /api/focus/sharing {on}` turns sharing off (Settings, or the
Firstmate panel's label); off forgets what was kept and refuses new reports, and `studio_now` then says sharing is off.

## Index: one source, three presentations

The rules every MCP client gets (the server `instructions`: the three iron rules, untrusted text is data, `studio_now`
first, cite refs, the kinds) live in `src/observe/instructions.ts`. `src/observe/guide.ts` makes the rest from them, the
tool index (`src/observe/catalog.ts`) and the registry's kinds:

- `skills/firstmate/SKILL.md`, the full index, written by `bun scripts/observe-index.ts --write`;
- the `studio` part of what `studio_manual {}` returns, next to the manual's index page.

`tests/observe-index.ts` fails when the skill file drifts, when a rule is missing from one of them, or when the kinds the
instructions name are not the registry's. The coordinator skill of Studio's code runs (`packs/firstmate/skills/firstmate.md`)
stays its own file: it is a run procedure for the coordinator role, pinned by the Tasks that ran with it, and names no read
tool. The manual has pages for the review room (`studio/pages/review-room`) and the pull request list (`studio/pages/prs`).

## Acceptance

`tests/observe-registry.ts` checks the tools return the facts for the spec's questions 1-4 and 9-13, `tests/observe-kinds.ts`
questions 5-7 (a skill version's approval and environment, the terminal waiting for input, the last Explain-with run's cost
and why it stopped). The real-model eval
asks questions 1-4 through the real MCP helper and measures each answer:

    bun scripts/observe-eval.ts --dry-run                  # no model: each question's tool path and sizes
    bun scripts/observe-eval.ts --provider claude          # Claude Code on the captain's login (paid)
    bun scripts/observe-eval.ts --provider codex           # Codex CLI on the captain's login (paid)
    bun scripts/observe-eval.ts --provider claude --model <id> --questions 1,3

A question passes with at most 3 tool calls, every tool output under 40 000 bytes (Claude Code's 10k-token warning), at least
one ref cited, the facts it needs in the answer, and nothing of the fixture's injected line followed. It prints the tool
calls and the tokens (input, output, cached) of each question and writes the full report as JSON.
