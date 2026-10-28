# Unit review-room: learn a pull request before you merge it

What: every merge card carries the same prominent "Open review room" (開啟審查室) entry. The room (`#/review/<merge card>`,
`public/review-room.js`) works like an interactive whiteboard tutor:

- **The board is the stage** and takes most of the screen. Each tutor answer is a **scene**: a visual on the left and the
  tutor's points beside it, revealed one at a time (Next point, or Play from the start), with the current point as a
  **caption** under the stage. A point that cites a board item (`[board:B1-2]`) brings that item into view, so a diagram
  builds up as the points reach its steps. Scenes are paged (← →). A scene that arrives while the page is open plays
  itself; scenes already there show whole.
- **Visuals Studio draws at once** from what the tutor emits: a flowchart built up step by step (one `group`, steps 1, 2,
  3, the part each step adds marked new; Studio draws mermaid's `flowchart` subset itself, no library, text only through
  text nodes, any other diagram kind as its source), a `diff` item (a changed file's real hunks), a `code` item (real head
  lines, highlighted lines marked), a `compare` item (the same range at the base and the head), a chart from real numbers
  (`chart_draw`: git's line counts per file, or numbers the tutor cites; uncited numbers read as an inference), the app's
  **screenshots** at the base and the head with a before / after toggle (`screenshots_show`: the Task's own captures of
  this head, shot by Studio's sandboxed renderer from the app's fixture build), and a `note`. The tutor names paths and
  lines; Studio fills every excerpt from the commits, so no excerpt is text the model wrote.
- **Generated illustrations** (`illustrate`, at most two a turn): a whiteboard-marker sketch from Studio's image job (the
  same one image steps use, `generateImage`), made in the background (a minute or two) with a placeholder until ready,
  stored in the room's folder, labelled "illustration · generated" and "Not evidence". A citation of an illustration never
  grounds a claim. The image model gets no words of the tutor's: the tutor picks 1 to 6 concepts from a fixed list
  (`ILLUSTRATION_CONCEPTS`) and a layout, and Studio builds the prompt from them. The first time the captain opens the
  room, one opening illustration is made in the background the same way, from the listed concepts the spec's intent
  names; it is labelled on the page as a paid generated image made once. It is made once per merge card: the room
  records that it started before anything is paid, so a reload, another device or a restart does not make it again. An
  illustration still pending when Studio stopped reads as interrupted after the restart.
- Every picture is labelled with its kind; a click enlarges it. A scene's answer lists its pictures as chips to switch to.
- **The prompt bar** under the stage is slim: How, Why, Teach me, Before merging, Check me, a question field, Hold to talk
  and Ask. The **transcript** is a drawer, closed by default: each question with its scene's title (a click jumps to the
  scene), the understanding check and the sources.
- **Voice** (off by default; captions are always on): the tutor vendor's own neural voice when it has one (an OpenAI or
  Codex tutor with an OpenAI key: `POST /api/review-room/<card>/speech`, generated once per scene, cached in the room's
  folder, a ledger entry `review-room-voice`; the narration goes only to the vendor that answered that scene, as the
  scene recorded it, and only while the seat still runs on that vendor; one request per scene at a time; never on an
  answered card), or one of this Mac's on-device voices, the best first (Premium, Enhanced, Siri). A voice the browser would send
  to a server is never offered. While a voice plays, the points appear as it reaches them.
- **Voice questions**: push to talk, only where the browser recognises speech on this device
  (`SpeechRecognition.available({processLocally: true})`); the transcript fills the question field and is sent only when
  the captain presses Ask. Without on-device recognition the mic stays off and says why.

The **understanding check** (2 to 4 short questions on what the change does differently and where its risk is) appears in
the scene that asks it; the tutor grades each answer and re-explains a missed one. Answers are as long as the question
needs: to the point, no filler, not limited to one line.

The merge card shows a summary: questions asked in the room, the check score, sources consulted. Display only: the room
never answers the merge card, never holds or releases it, and never changes merge readiness. The card's stored file, its
options and its evidence are untouched (`cards.view` adds `reviewRoom`).

Why: the captain wants to understand a pull request (how it works, why it is built this way, what to check) before
deciding its merge, without anything leaving Studio.

## Subjects

A room has one subject and keeps one identity across that subject's heads:

- **A merge card** (`#/review/SC-n`), as above. Unchanged.
- **A Task's local branch** (`#/review/R-n`), once Studio's internal review passed at the Task's head (its signed
  `firstmate/review-verdict` pass at that head, or a tainted Task's `tainted-ready` end on the ledger). The Task page shows
  "Open review room" then: on the way to the merge card, and on a tainted Task that ends "ready on branch, not published"
  (its room reads the local branch only; nothing goes to GitHub). Before the review passes the room is refused
  (`not_reviewed`); a branch whose head later moves keeps its room, and a turn needs the review passed at the new head.
- **A pull request on GitHub** (`#/review/PR-<12 hex of the repository>-<n>`), opened by pasting its URL on the Review
  Room's home (`#/review`) or a connected project's page (`POST /api/review-room/open-pr {url}`, the desktop captain only).
  Only `https://github.com/<owner>/<repo>/pull/<n>` (no other host, scheme, path, query or fragment), and only a repository
  that a registered, enabled project is connected to (its grant's repository; the grant is verified as for any GitHub use):
  anything else is refused with the reason (`bad_url`, `not_connected`) before GitHub is read. Studio reads the pull
  request with GET only, through the project's own adapter (`remoteRead`: the pull request, its reviews, review comments,
  issue comments and files, at most three pages of 100 each), and fetches `refs/pull/<n>/head` (a fork's head too) and the
  base branch into a bare repository Studio owns, `data/review-room/cache/<hash>.git` (`GitHubPrAdapter.fetchPull`: the
  grant's credential path, a time limit, no gc, a size cap, `CREW_REVIEW_PR_CACHE_MB`, default 1024, over which the cache
  is removed and the read refused). Never the project's checkout or its object store, no worktree, nothing pushed. The
  room's base is the merge base of the head and the base branch. Every text GitHub returns (title, body, branch names,
  reviews, comments) is untrusted: cleaned like issue text (`cleanText`, nothing that could close its fence) and fenced in
  the tutor's prompt (`<untrusted-pr-text>`, `<untrusted-review-comments>`), data, never instructions.

A branch's or a pull request's turns run on the reviewer seat of the Task that made it (a pull request: the newest Task
whose recorded pull request is that URL): `tutorPick` on the Task's review node, admitted like the merge card's (native
selection as the reviewer, the staffing receipt for the tutor seat, one of the Task's jobs). The node is held through an
**auxiliary owner** (`engine.auxOwner`): `owns()` accepts it while the Task is kept (also once it ended) and the node's record
and visit are unchanged; it never starts or finishes a step, edge, card or check, and the job queue admits its job on a
Task that ended. A pull request no Studio Task made (a contributor's, a fork's) opens readable, with its reviewers' scene and
what changed, but takes no paid turn (`no_host`): there is no approved reviewer seat to host a tutor.

**What reviewers asked.** Each read of a pull request turns the reviewer notes not shown yet (reviews with a body or a
verdict, inline comments, comments) into a Studio scene: each note is a point labelled "Reviewer's words", Studio's own
line (who, where, which verdict) cited `[review:<id>]` (`r…` a review, `c…` an inline comment, `i…` a comment), and the
words themselves as plain text beside it (`quote`: never parsed for citations or markup). A citation opens the note.

**Following the head.** The room keeps the head the captain last looked at (`seen`) and every head it saw (`heads`). On
re-entry (the desktop page, at most once a minute) or "Check for new commits" (`POST …/check`) Studio reads the pull
request again; a branch's head is read from its Task. No background loop. When the head moved, the room says "N new
commits since you last looked" (or that the branch was rewritten), and the next turn's first scene is Studio's **what
changed since last time**: the diff old head..new head on the board, the new commits (their messages as text), the files,
and for each inline reviewer comment whether the lines it points at changed since (the captain judges whether that answers
it). The tutor's prompt carries that diff and starts from it. A room no Task hosts makes that scene at the check itself.
Studio's scenes cost nothing: no model, git and GitHub's answer only.

**Approved, merged, closed.** The room shows the pull request's state as GitHub does: open, draft, each reviewer's latest
verdict and at which head (approved counts only at the current head and with no changes requested), merged or closed. A
merged or closed pull request's room stays readable (its scenes, board and citations) and takes no turn.

**The record.** Every `review-room-turn` ledger entry and round record header carries the subject: its kind, the branch or
the URL, the head and the base (merge cards too). A "what changed" scene is a `review-room-scene` entry (from, to, the
number of commits). A pull request room is `data/review-room/pr/<id>.json`; a branch's `data/runs/<task>/review-room/R-n.json`;
the per-subject record (`review-room-stats.json`) keys a branch as `branch:R-n` and a pull request as `pr:<id>`.

## The tutor

- Its own read-only role (`workflows/skills/review-room-tutor.md`), with pstack's `how`, `why` and `teach` skills adapted
  under `workflows/skills/pstack/` (MIT; `NOTICE.md` there and `THIRD_PARTY_NOTICES.md`). The adaptation: one round
  instead of subagents, no model settings file, no MCP or Cursor discovery, Studio's tools instead of a shell and `gh`,
  `why` on local history only (the issue tracker, documents, chat, observability, error tracking and analytics categories
  are recorded as gaps, per its own contract), `why`'s confidence tiers kept end to end, and the board's build-up instead
  of image generation. The four texts are pinned by sha256 (`ROOM_SKILLS`); a changed text refuses the turn.
- Not Firstmate, not the worker, not the reviewer. It is the **tutor seat**, staffed on the reviewer role's member (the
  approved staffing's reviewer as admitted on the merge card's node, else the Task's own pick for its review node), so it
  inherits the reviewer-differs-from-maker rule; Studio also refuses a tutor whose provider and model equal the maker's
  (every node that wrote the change, build, fix or rework, as staffed and as it ran; a model left to the vendor's default
  counts as possibly the same).
- **Admission, like any role's.** A turn belongs to the merge card's live node: the provider is chosen through the native
  selection on that node as the reviewer (capability verified, certified for that owner), and staffing issues a receipt
  for the tutor seat. Staffing knows the seat (`engine.deps.auxiliarySeats`: the seat, the role whose approved member it
  runs on, the sha256 of each pinned text) and checks the provider, model and effort against the approved reviewer and
  that the instructions are exactly the pinned texts, in order, under the safety and operating rules (nothing added,
  nothing left out, nothing reordered); the receipt records the seat and the hash of its texts
  (`staffing-instructions`, with `seat: review-room-tutor`). The round is one of the Task's jobs (`ref` is the Task): the
  same queue, cancel and provider admission as other roles, which recheck the receipt, the owner and the instructions'
  hash at launch. A seat staffing does not know, or instructions that differ from the pins, are refused before anything
  is paid.
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
  `git_diff`, `git_log` (with pickaxe), `git_show`, `git_blame`, `board_draw`, `screenshots_show`, `chart_draw`, `illustrate`, `check_ask`, `check_grade`, `web_search`,
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

`web_search` and `web_fetch` are served by Studio (`src/review-web.ts`), never the round's own network. The boundary is
the destination and the shape, decided before any DNS lookup:

- A query is plain words: after NFKC it is ASCII letters, digits and `.,'?+-` only (no other script, lookalike or
  fullwidth letter, no code, path or address), at most twelve words, none of them encoded-looking (hex, base64, letters
  and digits or cases switching back and forth, long consonant runs) and no run of single letters. It may not spell out
  an identifier or file stem of the change, the repository, owner, project or folder name, or a denylisted name (policy
  `privacy.denylist`, `data/privacy-denylist.txt`), compared with every separator stripped and the case folded (a short
  name as a whole word), nor a 20-character stretch of the diff, a private host or address, or a credential.
- A page is read only when its address came back in this turn's search results (exactly that page), or its host is a
  documentation host (`DOCS_HOSTS`, plus policy `review_room.docs_hosts`). It is http(s), by host name (no IP, no
  punycode, short human-looking labels), on its standard port, with no credentials and no query string; its path is at
  most eight short human-looking segments, not one letter at a time, with nothing still percent-encoded after one decode,
  and it passes the same name and identifier checks. A redirect stays on the host it started from.
- A host of user content (`USER_CONTENT_HOSTS`: github.com and its user-content hosts, gists, pastebins, request
  catchers, app hosting) is never read: its owner sees who reads it. GitHub's own documentation (docs.github.com) stays
  a documentation host. A `review_room.docs_hosts` policy that names such a host refuses every turn with that reason
  until it is removed.
- A turn makes at most eight web calls (`WEB_CALLS_PER_TURN`).
- Known false positives, by design (the filter errs on the side of refusing): a query is refused when, with separators
  stripped, it contains a file stem of the tree of six or more letters ("tax table" for `tax-table.ts`), any repository,
  owner, project, folder or denylisted name of five or more letters anywhere ("ledgers" when the repository is `ledger`),
  an identifier of the change of eight or more letters spelled out in words, or a CamelCase word with two inner capitals
  (`WebSocketServer`). The tutor then rephrases in general words.
- Follow-up: a search endpoint that answers with an HTML page has its markup stripped before the tutor reads it, so the
  result links (`href`) are lost and only addresses written out in the text can be read next; a JSON search endpoint
  keeps them.
- The fetch goes through Studio's egress proxy with a one-host credential; the resolved-address guard refuses loopback,
  private, link-local and metadata addresses.
- Search needs `CREW_REVIEW_SEARCH_URL` (a URL with `{q}`) on a public host by name: a search server on this machine or
  the LAN (a local SearXNG, say) is refused as a private host. With none the tool says so plainly and the room works
  offline.
- Every call, refused or not, is a source the room lists. A source's address is kept as an address only when it was
  fetched and parses as http(s); a refused or unparsable one is kept as plain text, and the page renders a link only for
  a fetched http(s) address. A citation Studio could not verify is plain text, not a link.

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

Tests: `tests/review-web.ts`, `tests/review-room-admission.ts` (a staffed Task: the tutor seat's receipt and native admission), `tests/review-room.ts` (a real code-firstmate Task to its merge card, a scripted stub
tutor, a stubbed web backend), `tests/review-room-ui.mjs` (1440 en and 390 zh-TW; screenshots in `tests/out/review-room`
or `ROOM_SHOTS`). `tests/review-room-anywhere.ts` covers the branch and pull request subjects. `bun run test:review-room` runs all five.

11. Pictures: screenshots come only from Studio's captures of this head (before / after toggle); a diffstat chart is
    counted by git; an uncited chart is an inference; illustrations are made in the background (the turn does not wait),
    labelled generated and never evidence, their prompts filtered (a refused prompt never reaches the image model), at
    most two a turn, stored in the room and served from it; opening the room makes its opening picture. — review-room
    "screenshots come from …", "a diffstat chart is counted by git …", "the turn ends without waiting …", "two
    illustrations are on the board …", "an illustration prompt naming a repository file never reaches …", "opening the
    room makes its opening picture …"; review-room-ui "a chart is drawn by Studio …", "a generated illustration is
    labelled …", "the opening picture still being drawn shows a placeholder", "Before shows the base's screenshot".
12. The stage: scenes paged, points revealed with the visual and caption following them, the transcript drawer closed by
    default, the prompt bar slim. — review-room-ui "the stage opens on the latest scene …", "the board takes most of the
    screen …", "the transcript lists each question …", "Play starts the scene again …", "the next point brings the next
    step …".
13. Voice and voice questions: off by default; on-device voices only; the vendor's voice once per scene, the points
    following it; push to talk on-device only, the transcript shown before it is sent. — review-room-ui "voice is off by
    default …", "with this Mac's voice each point is spoken …", "the vendor's voice is asked for the whole scene once …",
    "the points appear as the narration reaches them", "the mic is offered only after …", "holding the mic fills the
    question …", "without on-device recognition the mic stays off …".

14. A Task's branch has a room once Studio's review passed at its head, also a tainted Task ready on its branch; its turns
    run on the Task's reviewer seat through an auxiliary owner that never moves the Task. — review-room-anywhere "before
    Studio's review passes …", "once Studio's review passed …", "the turn's round record sits under the review node …",
    "the Task did not move …", "a tainted Task ready on its branch …", "its turn runs on the ended Task's reviewer seat …".
15. A pull request URL is accepted only in its exact form and only for a connected project's repository. — review-room-anywhere
    "a malformed address …", "a repository no registered project is connected to …", "a refused address reads nothing";
    review-room-ui "the Review Room's home takes a pull request's URL …".
16. GitHub is only read (GET), the head's commits go only into Studio's cache, the checkout is untouched, nothing is pushed.
    — review-room-anywhere "GitHub is only read …", "the head's commits are in a bare repository …", "the project's
    checkout is untouched …", "through all of it …".
17. Reviewers' comments are a scene of their words as text, cited to the comment, fenced for the tutor. — review-room-anywhere
    "the reviewers' review, inline comment and comment …", "a comment is kept as its words …", "the tutor reads the
    reviewers' words fenced …"; review-room-ui "what reviewers asked: …", "the citation opens the comment …".
18. A moved head is announced and the next turn opens with what changed since last time. — review-room-anywhere "Check for
    new commits reads GitHub again …", "the next turn's first scene …", "its picture is the diff …", "it names the reviewer
    comment …", "the tutor starts from that diff …"; review-room-ui "it says how many commits came …".
19. Approved, merged and closed show, and the room stays readable. — review-room-anywhere "an approval at the current head …",
    "merged on GitHub: …", "a fork's pull request …"; review-room-ui "the room shows the pull request's state …", "Check for
    new commits reads it again: merged …".
20. The subject is on the record. — review-room-anywhere "… its ledger entry names the branch and the head", "the turn's ledger
    entry carries the pull request's URL …", "each head's comprehension is on the ledger …".

`tests/review-room-anywhere.ts` (two real code-firstmate Tasks, one tainted; the GitHub simulator with a bare repository,
a stub host Task, a scripted tutor) is new and fails on the base, where neither subject exists.

Not in this unit: Firstmate offering to open a room from its chat; a paid tutor for a pull request no Studio Task made (no
approved reviewer seat hosts it); background polling of a pull request; a per-room model switch (the tutor is the reviewer
seat's member); a server-side vendor web search (the backend is Studio's own, so every query is filtered and logged the
same way for every vendor); rendering fresh screenshots from the room (the room shows the Task's own captures: a new
render makes a git worktree of the base, a repository write the room never does); the vendor's speech-to-text (voice
questions are recognised on this device only); illustrations made when the merge card is created (they start when the
captain first opens the room, so no image is paid for a room nobody opens).
