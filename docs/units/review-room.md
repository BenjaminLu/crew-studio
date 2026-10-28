# Unit review-room: learn a pull request before you merge it

What: every merge card carries the same prominent "Open review room" (開啟審查室) entry. The room (`#/review/<merge card>`,
`public/review-room.js`) is one page per pull request with two panes:

- **Board**: what the tutor draws, step by step. A flowchart is a series of steps (one `group`, steps 1, 2, 3), each
  redrawing the last and adding one part, which the page marks as new; Studio draws mermaid's `flowchart` subset itself
  (no library, text only through text nodes) and shows any other diagram kind as its source. A `diff` item is a changed
  file's real hunks, a `code` item real lines at the head (highlighted lines marked), a `compare` item the same range at
  the base and at the head, a `note` a short text. The tutor names the path and the lines; Studio fills every excerpt from
  the commits, so no excerpt is text the model wrote.
- **Chat**: the captain asks anything, or presses How, Why, Teach me, Before merging or Check me. Each turn is answered in
  the captain's language.

Beside them: the **understanding check** (2 to 4 short questions on what the change does differently and where its risk
is; the tutor grades each answer and re-explains a missed one) and the **sources** (every web query and page, refused
ones with the reason).

The merge card shows a summary: questions asked in the room, the check score, sources consulted. Display only: the room
never answers the merge card, never holds or releases it, and never changes merge readiness. The card's stored file, its
options and its evidence are untouched (`cards.view` adds `reviewRoom`).

Why: the captain wants to understand a pull request (how it works, why it is built this way, what to check) before
deciding its merge, without anything leaving Studio.

## The tutor

- Its own read-only role (`workflows/skills/review-room-tutor.md`), with pstack's `how`, `why` and `teach` skills adapted
  under `workflows/skills/pstack/` (MIT; `NOTICE.md` there and `THIRD_PARTY_NOTICES.md`). The adaptation: one round
  instead of subagents, no model settings file, no MCP or Cursor discovery, Studio's tools instead of a shell and `gh`,
  `why` on local history only (the issue tracker, documents, chat, observability, error tracking and analytics categories
  are recorded as gaps, per its own contract), `why`'s confidence tiers kept end to end, and the board's build-up instead
  of image generation. The four texts are pinned by sha256 (`ROOM_SKILLS`); a changed text refuses the turn.
- Not Firstmate, not the worker, not the reviewer. It is staffed on the reviewer seat's member (the Task's own pick for
  its review node, approved staffing included), so it inherits the reviewer-differs-from-maker rule; Studio also refuses
  a tutor whose provider and model equal the maker's (the build node's pick, or the model its latest build round ran).
- Rooms are per pull request and run concurrently: no driver lock. One turn at a time per room.

## A turn

- Paid, and only on the captain's action: `POST /api/review-room/<card>/turn {action, text, lang, confirm}`, the desktop
  captain only (a phone reads the room, it cannot start a turn). The room offers the tutor's provider, model and effort
  with a hash; the turn starts only when `confirm` carries it (the page shows "This starts a paid model round on …"
  first). A refused or changed offer is answered with the current one.
- One fresh provider session per turn, as Firstmate's status chat does (`src/chat.ts`): the prompt carries the room's
  history (the last six turns in full, older ones as one line each), the board so far and the open check, plus the
  pull request context: the spec and its done lines, the pull request text (untrusted), the merge card's text, the
  check results at the head with their ledger numbers, the changed files and the diff (the first 30000 characters;
  `git_diff` reads the rest). No vendor session is kept alive, so a turn survives a restart or a model change.
- Read-only. The round runs in the round sandbox with nothing to write (`writes: []`) and no host beyond its model
  (`allow: []`, `egress.allow` is not carried); a sandbox-off grant or local unrestricted mode refuses the turn. Its tools
  (`ROOM_TOOLS`): `fs_list`, `fs_search`, `fs_read` (the head commit, through `git ls-tree`, `git grep`, `git show`),
  `git_diff`, `git_log` (with pickaxe), `git_show`, `git_blame`, `board_draw`, `check_ask`, `check_grade`, `web_search`,
  `web_fetch`. Nothing reads or writes the worktree's files, index or refs. Nothing goes to GitHub: no comment, review or
  request of any kind.
- Recorded like any round: `data/runs/<task>/nodes/<merge node>/room-<card>-<n>/` (`prompt.md` with the skill pins in its
  header, `system.md`, `stream.jsonl`, `report.json`), and a signed `review-room-turn` ledger entry (action, job, provider,
  model, the confirmation, the skill pins, board, sources and check counts). The room itself is
  `data/runs/<task>/review-room/<card>.json`.

## Grounding

Every explanatory claim, in the chat and on the board, cites its basis: `[diff:path:L10-24]` (a hunk at the head),
`[ledger:#12]` (an entry of the Task's signed ledger), `[commit:abc1234]`, `[source:3]` (a web source of this room) or
`[board:B2-1]` (an excerpt on the board). Studio splits each answer into blocks and checks every citation (a changed file,
an entry of this Task, a commit in the repository, a source that was fetched, a grounded board item); a block with no
valid citation, or tagged `[inference]`, `[Inferred]` or `[Speculative]`, is shown as **Inference**. Headings and offers
("Want me to go deeper?") are not claims. A mermaid or note item carries its citations in `cites`. On the page a
citation is a link that opens what it rests on (`GET /api/review-room/<card>/cite?ref=…`): the diff hunk, the ledger
entry (with a link to the Task), the commit, the web page.

## Web research (filtered)

`web_search` and `web_fetch` are served by Studio (`src/review-web.ts`), never the round's own network. Studio refuses a
query, or an address, that carries a code-like identifier or a 24-character stretch of the diff, code punctuation, a path
or file name of the tree, the repository, owner, project or folder name, a private host or address, a home path, a
session link, a denylisted name (policy `privacy.denylist`, `data/privacy-denylist.txt`) or anything that looks like a
credential. A page is fetched only by host name, http or https on its standard port, without credentials, through
Studio's egress proxy with a one-host credential: the resolved-address guard refuses loopback, private, link-local and
metadata addresses, and each redirect hop is checked again. Search needs `CREW_REVIEW_SEARCH_URL` (a URL with `{q}`); with
none the tool says so plainly and the room works offline. Every call, refused or not, is a source the room lists.

## The per pull request record

`data/review-room-stats.json`, one entry per Task: card, project, pull request, head, when the room was first opened (the
desktop page), done turns, the check (asked, graded, correct). Kept for a later comparison with reverts and reopens; no
analysis here.

Done when (each line proved by the named test; all three suites are new and fail on the base, where the module, routes
and page do not exist):

1. Only merge cards have a room; any other card has no summary and its room and turns are refused. — review-room
   "a dispatch card has no review room …", "a turn on a card that is not a merge card is refused"; review-room-ui "a card
   that is not a merge card has no review room".
2. A turn needs the captain's confirmation of the exact provider and model; a tutor on the maker's model and a sandbox-off
   grant refuse it; one turn at a time. — review-room "a turn without the confirmation …", "a tutor on the maker's model
   is refused", "with a sandbox-off grant …", "a confirmed turn starts at once, and a second one waits …"; review-room-ui
   "a quick action first asks to confirm …", "Start sends the turn …".
3. The round is read-only with no write tools, sandboxed with no host beyond its model, with the pinned skills, and leaves
   its round record and ledger entry. — review-room "the round gets only the room's … tools", "… nothing to write and no
   host beyond its model", "a write tool the tutor asks for does not exist", "each room skill is pinned …", "the round's
   instructions carry …", "the turn leaves a round record …", "the turn is on the Task's signed ledger …", "a skill whose
   text no longer matches its pin refuses the turn".
4. History is carried to the next turn. — review-room "the next turn's prompt carries the conversation, the open check
   and the board".
5. Board items are the real excerpts and render, a flowchart as a build-up sequence. — review-room "a diagram is built
   up …", "a code item holds the real head lines …", "a diff item holds the real hunks …"; review-room-ui "the flowchart
   shows its latest step …", "Back shows step 1 …", "Next part adds it again …", "a code excerpt names its path …".
6. An uncited claim is shown as an inference; a citation opens its basis. — review-room "claims with a valid diff or
   ledger citation are cited", "a claim with no citation is shown as an inference", "a citation Studio cannot verify …",
   "a citation opens what it rests on …"; review-room-ui "a cited claim shows its citation; an uncited claim is shown as
   Inference", "a citation opens the diff hunk it rests on".
7. The web tools refuse filtered queries and private hosts and log every call. — review-web (every refusal and the
   fetcher's guards); review-room "every web call is logged as a source …", "refused: …", "only the clean query and the
   public page reach the web backend".
8. The merge card shows the summary while readiness is unchanged; the room never answers the card. — review-room "the
   merge card shows the room's summary …", "the stored merge card is unchanged …", "the card's options, evidence and every
   other field are what they were …", "the captain's merge answer goes through as before …", "after the card is answered
   the room stays readable and takes no turn"; review-room-ui "the card shows the room's summary …".
9. No GitHub write path, no repository write. — review-room "no request left Studio …", "the worktree, its index and its
   refs are untouched by the room".
10. The per pull request record is kept. — review-room "the per pull request record keeps …".

Tests: `tests/review-web.ts`, `tests/review-room.ts` (a real code-firstmate Task to its merge card, a scripted stub
tutor, a stubbed web backend), `tests/review-room-ui.mjs` (1440 en and 390 zh-TW; screenshots in `tests/out/review-room`
or `ROOM_SHOTS`). `bun run test:review-room` runs all three.

Not in this unit: Firstmate offering to open a room from its chat; a per-room model switch (the tutor is the reviewer
seat's member); a server-side vendor web search (the backend is Studio's own, so every query is filtered and logged the
same way for every vendor).
