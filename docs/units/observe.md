# What Firstmate can see: Studio's read tools (P1)

Firstmate used to see Studio through one tool, `studio_work_status` (the newest 50 Tasks), and the live status line on each
captain turn. It could not read a review room, the pull request list, a card's choices, or what the captain was looking at.
P1 gives it four read tools over one registry of entity kinds. Every one is read only: none answers a card, starts a paid
run, writes to GitHub or touches a secret.

Code: `src/observe/registry.ts` (kinds, refs, trust, budgets, the envelope), `src/observe/kinds/{task,card,room,pr}.ts`,
`src/observe/now.ts` (`studio_now`), `src/observe/tools.ts` (the four tools), `src/observe/focus.ts` (what the captain is
looking at), `src/observe/catalog.ts` (the index of Firstmate's native tools), `src/observe/instructions.ts` and
`src/observe/guide.ts` (the index, below). The tools join Firstmate's native tools in
`src/runtime/index.ts`; the `/api/focus` routes are in `src/server.ts`. Tests: `tests/observe-registry.ts`,
`tests/observe-focus.ts`, `tests/observe-index.ts`, `tests/observe-ui.mjs`. Real-model eval: `scripts/observe-eval.ts`.

## The tools

| Tool | What it returns |
| --- | --- |
| `studio_now` | where the captain is (each window's page, item and dialog, how long ago; over 10 minutes it is "last seen"), the cards waiting for them, most urgent first, what runs with its progress and cost, what changed in the last hour |
| `studio_find {query, kinds?}` | refs whose id or Studio/captain words match, each with a `resource_link` (`studio://kind/id`) |
| `studio_list {kind, filter?, cursor?, depth?}` | one kind's entities with each one's summary, paged |
| `studio_get {ref, depth?}` | one entity |

The same four, with the same names and input schemas, reach Claude (its MCP helper, `src/mcp.ts`, over Studio's private
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

`tests/observe-registry.ts` keeps a list of the board's routes no kind covers yet; it shrinks each phase.

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

`tests/observe-registry.ts` checks the tools return the facts for the spec's questions 1-4 and 9-13. The real-model eval
asks questions 1-4 through the real MCP helper and measures each answer:

    bun scripts/observe-eval.ts --dry-run                  # no model: each question's tool path and sizes
    bun scripts/observe-eval.ts --provider claude          # Claude Code on the captain's login (paid)
    bun scripts/observe-eval.ts --provider codex           # Codex CLI on the captain's login (paid)
    bun scripts/observe-eval.ts --provider claude --model <id> --questions 1,3

A question passes with at most 3 tool calls, every tool output under 40 000 bytes (Claude Code's 10k-token warning), at least
one ref cited, the facts it needs in the answer, and nothing of the fixture's injected line followed. It prints the tool
calls and the tokens (input, output, cached) of each question and writes the full report as JSON.
