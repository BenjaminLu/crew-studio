# Unit review-room: learn a pull request before you merge it

What: every merge card carries the same prominent "Open review room" (開啟審查室) entry. The room (`#/room/<room>`,
`public/review-room.js`, `src/domain/review-room.ts`; `#/review/<artifact>/<n>` stays the Library's artifact review,
`tests/route-names.ts` keeps the two apart) is one change explained by a skill's page, baton (built in) by default, and the
room's own questions about that page, answered by the room's tutor in a chat beside it (`public/review-explain.js`,
`src/domain/review-explain.ts`).

- **A room is the whole screen** (focus mode, `body[data-focus="room"]` on `#/room/<id>`, app.js `pageFocus`, shared with the
  terminal page): the sidebar folds to its 64px rail and Firstmate closes; the header's Firstmate button opens it as a sheet
  over the room, never a column beside it. Neither is saved as the captain's preference (`crew.side`, `crew.chatOpen` stay as
  they were; a fold the captain makes on purpose with the sidebar's own toggle is saved and wins), the onboarding journey and
  the chat button step aside, and leaving the room gives the sidebar and Firstmate back as they were.
- **The header** is one row: back (to the Task, the Library or the room list), the merge card (a merge card's room), where you
  are ("Review room › the room", the first a link to the list), the subject in one line, its state as pills (the pull request
  on GitHub with each reviewer's latest verdict, newer commits Studio could not fetch, a branch's review state, new commits
  since the last page, a directory's pinned commit, the change's line counts, the tutor and its independence), Check for new
  commits and Open on GitHub (a pull request; a directory opens its pinned commit), the room's Library link, archive or
  restore, the "Explain with" picker at its right end, and Firstmate.
- **The body** is the page on the left (one line over the output: the version menu, Generate again, Full screen, New tab
  and the isolation tag) and the chat on the right. A splitter between them is a focusable separator: dragged, or moved with
  the arrow keys (Shift for bigger steps, Home and End for the bounds), Enter or a double-click goes back to the default width;
  the width is kept per view on this browser. The chat is 440 px or more at 1440 and wider on a wide screen; long chat scrolls
  inside the pane, never the page. A phone and a narrow window never scroll sideways and show no splitter.
- **The chat keeps the captain's place.** A redraw (a poll every 2.5 s while a run works, a live update, a whole-page redraw)
  patches the chat in place by each message's key and never draws a message already read again. Scrolled up to read, the
  chat stays exactly where it is; a new answer then shows "↓ New messages" / 「↓ 新訊息」 at the list's foot instead of moving
  it; pressed, it goes to the end and the focus lands on the newest message, and a polite live region says a new message
  came. The captain's own messages (the question being sent or waiting, its paid confirmation, a refusal) are brought into
  view instead, never announced as new. At (or within 48 px of) the end, it stays at the end as an answer comes in. A room opens at its newest message beside
  the output; a phone, where the whole room scrolls as one column, opens at the output and keeps its place the same way. The
  version menu's list, the progress card and the skill's live log keep their place across redraws too.
- **On a paired phone** the room reads only: the chat has no ask box (a note says to ask on the Mac), the picker is hidden
  (760 px and narrower), and every route that changes a room or starts a run is the desktop captain's (`desktopOnly`).
- **Model text only in text nodes.** The chat's answers are a small Markdown (paragraphs, lists, tables, **bold**, `code`)
  built element by element, never HTML from the model; a skill's own page is shown only in its isolated frame (below).
- **Leaving the room** stops its polling, and nothing the room finishes later (a poll, a live event, a run it started)
  redraws the page the captain moved on to.

The merge card shows a summary in one sentence: how many versions of the page there are and what the room cost (its runs
and an old whiteboard's turns); that the first page, or a new version, is being made; or, with money spent and no page yet,
"No page yet · US$x spent" (`summary`: `href`, `opened`, `versions`, `questions`, `usd`, `running` (any run), `generating`
(a page being made: a question the tutor is answering is not one, and leaves the line as it was), `latest`;
`public/scard.js` `reviewRoomView`). Display only: the room never answers the merge card, never
holds or releases it, and never changes merge readiness. The card's stored file, its options and its evidence are untouched
(`cards.view` adds `reviewRoom`).

Why: the captain wants to understand a pull request (how it works, why it is built this way, what to check) before deciding
its merge, without anything leaving Studio.

## Subjects

A room has one subject and keeps one identity across that subject's heads (`ROOM_ID`):

- **A merge card** (`#/room/SC-n`). Only a merge card has a room: any other card has no summary, and its room and runs are
  refused (`not_merge`).
- **A Task's local branch** (`#/room/R-n`), once Studio's internal review passed at the Task's head (its signed
  `firstmate/review-verdict` pass at that head, or a tainted Task's `tainted-ready` end on the ledger). The Task page shows
  "Open review room" then (`taskEntry`): on the way to the merge card, and on a tainted Task that ends "ready on branch, not
  published" (its room reads the local branch only; nothing goes to GitHub). Before the review passes the room is refused
  (`not_reviewed`); a branch whose head later moves keeps its room, and a paid run needs the review passed at the new head.
- **A pull request on GitHub** (`#/room/PR-<12 hex of the repository>-<n>`), opened by pasting its URL on the Review Room's
  home (`#/room`) or a connected project's page (`POST /api/review-room/open-pr {url}`, the desktop captain only). Only
  `https://github.com/<owner>/<repo>/pull/<n>` (no other host, scheme, path, query or fragment), and only a repository that a
  registered, enabled project is connected to (its grant's repository; the grant is verified as for any GitHub use): anything
  else is refused with the reason (`bad_url`, `not_connected`) before GitHub is read.
- **A directory of any GitHub repository** (`#/room/DIR-<12 hex of the repository>-<12 hex of its ref and path>`), opened by
  pasting its address on the Review Room's home (`POST /api/review-room/open-dir {url}`, the desktop captain only). Below.

The paste box says, before anything is pasted, what opening the room starts: baton, by itself, one paid run on the room's
tutor model, once per head; Studio only reads GitHub. Open sends the address only.

**Reading a pull request.** Studio reads the pull request with GET only, through the project's own adapter (`remoteRead`:
the pull request, its reviews, review comments, issue comments and files, at most three pages of 100 each, `PR_PAGES`; at
most 300 files kept; `truncated` says when a list had more), and fetches `refs/pull/<n>/head` (a fork's head too) and the
base branch into a bare repository Studio owns, `data/review-room/cache/<hash>.git` (`GitHubPrAdapter.fetchPull`: the
grant's credential path, no hooks and no templates, a time limit, no gc, full history for merge base, log and blame, one
fetch at a time per room). Its size on disk is capped (`CREW_REVIEW_PR_CACHE_MB`, default 1024): watched while the fetch runs
(an asynchronous scan of the pack folder; the fetch always keeps a pack, `fetch.unpackLimit=1`, so nothing it receives
escapes the scan as loose objects; over the cap it is stopped) and checked after it, success or not; a stopped fetch leaves
no temporary pack. Over the cap the read is refused and the cache removed, unless a run of a room of that repository is
reading it. An empty cache is first seeded from the project's own clone: its `origin/<base>`, else `<base>`, else the grant's
base branch, fetched into `refs/crew/seed/base` (`seedPull`; the local file protocol is allowed for that one fetch only, the
clone is only read, the seed counts toward the cap, a failure falls back to fetching everything), so GitHub sends only what
the clone lacks and a large repository's history does not outrun the time limit. The project's checkout is never written, no
worktree, nothing pushed. The room's base is the merge base of the head and the base branch.

When the commits cannot be fetched (the cap, the network, a head that moved during the read: Studio reads once more, and a
head still different is not this head's commits), what GitHub showed (state, text, files, reviews, comments) is still kept
and the room is marked stale (`pr.stale`): it reads the last head it has and takes no paid run until a check fetches the new
one (`stale`). Every text GitHub returns (title, body, branch names, file paths, reviews, comments) is untrusted: cleaned
like issue text (`cleanText`) with every angle bracket turned into a glyph (‹ ›), so nothing in it can open or close a fence.
A login that is not a GitHub login reads "someone"; a link that is not the repository's own on github.com is dropped.

**The reviewers' notes.** Reading a pull request keeps every review, inline comment and comment as a note (`r<id>`,
`c<id>`, `i<id>`: its author, its words cleaned as above, its time and link, a review's state and commit, an inline
comment's path and line and whether it is outdated), oldest first; a bot's plain comment is marked. The view carries the
newest 200; a skill's run and a question read them all in `reviews.md`, each fenced as untrusted and cited `review:<id>`.

**A pull request's state.** The room shows it as GitHub does (`prState`): open, draft, each reviewer's latest verdict and at
which head (approved counts only at the current head and with no changes requested), merged or closed, and when it was
read. A merged or closed pull request's room stays readable and takes no paid run. An open pull request whose commits Studio
has not fetched yet takes no paid run either; the room says so with the reason (never that it is closed), and Check for new
commits tries again, unless the repository is over the cache's cap.

**Following the head.** The room keeps every head it saw (`heads`) and the head its last page was made at (`seen`: set when
the room is made, and again whenever a page finishes at the room's head). When the subject's head moved past it, the header
says "N new commits since the last page" (or that the branch was rewritten) (`moved`). On re-entry the desktop page reads the
pull request again in the background, at most once a minute from the last attempt (`PR_RECHECK_MS`); "Check for new commits"
(`POST …/check`, the desktop captain only, at most once every five seconds a room, else 429 `rate_limited`) reads it at once;
a branch's head is read from its Task. No background loop. Before any paid run on a pull request read more than five minutes
ago (`CREW_REVIEW_PR_FRESH_MS`), Studio reads it again first (`beforePaid`): merged or closed since, the run is refused; a
read that fails refuses it too (`stale`).

**A directory of any GitHub repository.** `https://github.com/<owner>/<repo>` (its default branch's root) or
`…/tree/<branch, tag or commit>/<path>`; no other host, scheme, file (`/blob/`), query or `..` (`bad_url`). Any repository:
Studio lists its refs anonymously (a public one), else with the captain's GitHub login (`gh auth token`, only in that git
process's environment, never stored, never on a command line or in a message); one neither can read is refused, saying which
(`no_access`). The ref is the longest leading part of the path that is a branch or a tag (a branch's name may hold a slash),
else a commit's full id; a ref the repository does not have (`bad_ref`) or a file (`not_a_directory`) is refused. The ref is
resolved once and the room **pinned at that commit**: its objects are fetched into Studio's own cache
(`data/review-room/cache/dir-<hash>.git`, history to depth 200, the cache's size cap and time limit as for a pull request,
`too_large` over the cap), and pasting it again opens it as it was, even after its branch moved. The room
(`data/review-room/dir/<id>.json`) knows the directory's parts (each folder and file right under it, with how many files and
bytes, at most 40) and its README. What only a pull request has is not there: its state on GitHub, new commits, a diff and
its line counts. Its header says where it is pinned (`[data-dir-pin]`) and opens that commit on GitHub. A skill's materials
in a directory room are the directory's own files at the pinned commit (`head/`), and `pull-request.md` says it is a
directory with no diff.

**Who hosts a room's paid runs.** A merge card's runs belong to the merge card's live node. A branch's or a pull request's
run on the reviewer seat of the Task that made it (a pull request: the newest Task whose recorded pull request is that URL):
the Task's review node, held through an **auxiliary owner** (`engine.auxOwner`): `owns()` accepts it while the Task is kept
(also once it ended) and the node's record and visit are unchanged; it never starts or finishes a step, edge, card or check,
and the job queue admits its job on a Task that ended only for an auxiliary owner of that same Task.

A pull request no Studio Task made (a contributor's, a fork's) runs on the **project's approved crew reviewer**: the
reviewer role of the project's approved staffing of a code workflow (code-firstmate, else the first code workflow with a
reviewer role; a Studio team that covers it derives the staffing first). The room offers that member; the captain's first
confirmed paid run makes a **host Task** once for that pull request (`ensureHost`), from the source-owned `review-room-host`
workflow (`workflows/v2/review-room-host.wf.yaml`, internal, one hook node and no edges: it runs no agent and writes nothing).
The host is bound at start to the project's crew (refused before it starts when the project has none), and its runs are
admitted exactly like the other rooms': an auxiliary owner of its node, the native selection as the reviewer, the staffing
receipt naming the crew reviewer, the round record and the ledger on the host. With no tutor picked by the captain, a host
room stays on the crew reviewer even with another vendor usable: not adaptive, no independence level. Later runs use the same
host. A project with no approved
crew is refused with "Approve this project's crew first" (`no_crew`) and no host is made. The offer is read only: it reads
the project's approved staffing, else what the Studio team would give the reviewer (`teamReviewerPreview`, nothing written);
the team's staffing version is written only when the captain's confirmed run makes the host, which is started as that
captain (`by`). The host Task's page links back to the pull request's room.

A directory's runs run on a host Task Studio makes on the first confirmed (or first opening's) run: the internal workflow
`review-room-dir-host` (one hook node, no agent, nothing written), with no project and no crew. The tutor is the model the
captain picked (the room's or Studio's default), else Studio's Automatic pick for a directory (a model this machine runs now
and has verified, its default first; a directory has no author, so independence does not apply and is not claimed). Staffing
admits only the room's own seats there, on that member: its receipt (`directory: true`) names it; any other instructions get
no receipt. The host Task's page links back to the room.

Making a host is refused while a sandbox-off grant is open (for the project; any for a directory) or Studio is in local
unrestricted mode (`sandbox`), and while the same room's host is being made (`busy`). A host is one hook node: it ends at once,
and its end aborts what listens to its signal, so `ensureHost` waits (up to 30 seconds) for the host Task to end before the
run is admitted, and refuses with `busy` when it has not; the first run is never cancelled by its own host finishing.

## Coming back

Every room is listed on the Review room's home (`#/room`, `GET /api/review-room`: open rooms first, then the most recent; a
link back into each), which the sidebar's own **Review room** item opens (on the rail too when it is folded). The list is in
four zones (`roomZone`, `ROOM_ZONES`), each grouped by repository (letter case does not split one; rooms with none last):

- **等我看**: the next move is the captain's: a merge card still open, a head with no finished page yet (also when its page
  failed, and when GitHub shows newer commits Studio could not fetch), or a page the captain has not opened since it came.
- **審查中**: a page or a question is running, or the captain has read the page at this head and the change is still open.
  A question that failed leaves the room here: only a page waits for the captain.
- **已結論**: the merge card is answered, the pull request is merged or closed (its state decides: reopened on GitHub, it
  leaves), the Task ended, or a directory's pinned commit has its page and the captain read it (a directory has no result of
  its own).
- **封存**: the captain archived it (`POST /api/review-room/<room>/archive {archived}`, on the row and in the room's header;
  `{archived: false}` restores it to the zone it belongs in; anything but a boolean is refused). Only by hand: a merge never
  archives a room, because merged is not deployed. It is `room.archived`, in the room's own file, so it survives a restart and
  a redeploy; it is not a Task's archive (a pull request's room may have no Task, and archiving a Task leaves its room where it
  is). A room with no file yet gets one when archived. An archived room keeps working, but opening it starts nothing by itself.

A room's zone is read from what Studio holds (`zoneFacts`: the explainer's runs and versions, `explain.brief`, the captain's
read mark `room.read`, the card, the Task, the pull request as last read), never from an old whiteboard and never from
GitHub: listing reads nothing there, so a pull request that ended on GitHub moves when the captain next enters its room or
checks it. The captain opening the room (`?open=1`, the desktop page) marks its latest page read; any other read changes
nothing. A new signal (a deployment) is one more fact in `ZoneFacts` and one more rule in `ZONE_RULES`.

Each row (`list`) carries the room's kind, its title (a merge card's in both languages), whether it is open and running, how
many page versions and questions it has, what it cost (`usd`, an old whiteboard's turns included), its old whiteboard if any
(`oldBoard`), its repository (the subject's; a merge card's or branch's from its Task's pull request, else its project's
repository or name) and its time (its latest ended run, a failed one included; with no run, its file's: a re-read of GitHub is
not news). The server lists every room, with no cap, and a merge card's room with no file (no page yet) is not listed. The
search box covers every zone (the repository too, and a Simplified query finds a Traditional title) and opens 封存, which is
otherwise folded; no match says so. The zones redraw on the live stream (`review-room` events), the search box left alone;
coming back from a room reads the list again. A run that ends while the captain is on the room is read as an arrival, so it
does not wait for them on the list; one that ends while the window is hidden is read when the captain comes back.

The browser's back walks Studio's own pages (each is a route). Studio runs in an app window without a back button, so a link
that leaves Studio (GitHub, a cited page, anything not Studio's origin) always opens in a new window (`target=_blank`,
`noopener`): the links Studio draws say so, and a document-level handler opens any other external link the same way, never
in place (a link whose own handler takes the click, or that is not http(s), is left to it).

## The page and its questions

- **The room is a skill's page and its questions.** The page has one line over the output: the version menu (each
  version's head and cost), what the shown version was made from, Generate again, Full screen, New tab, Download and the
  isolation tag.
  A new head's run keeps the version shown, with one progress strip above it. Nothing sits left of the output.
- **Questions** are the room's own: the chat is answered by the room's tutor (the header's tutor pill: this room's pick,
  Studio's default, or Automatic), on Studio's question frame (`QA_FRAME`, pinned by sha256 on its own seat `review-room-qa`),
  never by the skill. The question run reads the version shown as `materials/version/page.txt` and `version/files/` (that
  version's files, hash-checked: a version whose files are gone or changed is refused, not answered without its page), the
  change's materials, and the room's last six answered questions (`qaHistory`, fenced as `<previous>`). `page.txt` is the
  version's visible text and the context it embeds for a reader's agent (a script of type `text/markdown` or
  `application/json`, as baton's packet carries), never its code: `shownHtml` drops `<template>`, `<noscript>` and every
  element hidden by the `hidden` attribute or an inline `display:none` / `visibility:hidden` (a stylesheet's class is not
  read), in one pass over the page; the text is fenced as untrusted. The frame tells the tutor to ground on the code first
  and say plainly when the page and the code disagree, to answer in the captain's language, to cite (`path:L12-30`,
  `commit:<sha>`, `review:<id>`, `page:<heading>`), and to say when the materials do not say. Its tools read and answer only
  (`mat_list`, `mat_read`, `mat_search`, `explain_progress`, `explain_answer {answer, cites}`): no output folder, no skill
  files, no script. An answer is kept on its run with the version it was about (`run.from`); it never makes a version and is
  never anchored to a region. Switching versions keeps the conversation; the next question is about the version then shown.
- **A question is paid and confirmed.** Its offer (`kind=ask&v=<n>`) names the room's tutor, who pays and the safety limit;
  its hash covers the room, the tutor's offer hash, Studio's question frame and the limit, so a new version of the skill that
  made the page changes nothing to confirm, and a question asks no script decision. The first question asks for its
  confirmation in the chat, with "Ask the next questions here on this tutor without confirming each" (`consent`, kept per
  room, bound to that hash: a new tutor or limit asks again). Pressing Ask puts the question (and the version it is about) in
  the chat at once: "Sending…", then "Starting…" while `POST …/explain/ask` waits for the run's admission (a model verified
  again can take a minute), "Waits for your confirmation" while the paid confirmation is open (Cancel puts it back in the ask
  box). The server's run takes its place, whether `/ask` answers first or a push or poll brings the run first: never twice.
  Refused, it stays with why (`[data-explain-error]`), Retry (the same text, about the version shown now; off while the skill
  works) and "Back to the ask box". The pending question lives in the page only: a reload before the server answers does not
  show it. A question asked while the first output is being made waits for it, and is asked (and confirmed) once the output is
  there; one waiting for a run that stopped goes back into the ask box. While a page is being made the tutor takes no question
  in that room (one run at a time).
- **A room from before** keeps its whiteboard on disk: see Old rooms below.

The room is explained by one of the skills in Studio's skill library (`src/domain/review-explain.ts`, `public/review-explain.js`).
Quality first: a skill's run is not one model round.

- **baton is the default** (`src/domain/review-baton.ts`, `packs/core/skills/studio-baton/`). Studio ships upstream baton byte
  for byte as a built-in library skill, with a subset of diagram-design's guidance beside it (credit and licenses in its
  NOTICE.md and THIRD_PARTY_NOTICES.md), pinned by both of the library's hashes and each script's sha256, OpenCC's lockfile
  included. It has its own library id, `studio-baton` (shown "baton (built in)"), so a baton the captain imported from a skills
  home stays the captain's `baton`, picked per room and confirmed like any skill, and the room's default never resolves to it. A
  room the captain never picked for is explained with the Studio-wide `defaultSkill` (`data/review-room-explain.json`,
  `studio-baton` unless set; `CREW_REVIEW_EXPLAIN_DEFAULT_SKILL` sets it for a test). With `defaultSkill: null` a room with no
  pick has no skill: the stage asks for one ("Pick the skill that explains this room", `[data-explain-noskill]`) and the picker
  says so. A room once set to the old tutor's board (`state.tutor`) is explained with the default skill like any other. baton
  (the built-in, or the captain's own copy by the id `baton`) runs with Studio's adapter (`BATON_ADAPTER`), pinned with it: the
  room's materials are its record (never git, gh or a session transcript), diagram-design is read from the skill's folder, and
  its render, verify and snapshot scripts run through `skill_run`.
- **Opening a room starts it** (the captain's decision): when `autoRun` is on (default) and the room is explained with the
  default skill, opening it (`POST …/explain/auto`, sent once per room and head by the page; never from a paired phone)
  starts that skill's generation for the room's head without a paid confirmation, on the room tutor's model and the skill's
  default instructions. Only the built-in baton exactly as pinned starts by itself: another default skill, or a changed baton
  (the captain's own copy), shows Generate and its confirmation (`why: unpinned`). The pinned baton's scripts are approved in
  advance: one signed decision bound to both pinned hashes, `via: builtin-pin`, recorded when Studio starts, when the captain
  picks baton or when a room starts it (never by a read). Once per head: a run Studio started or tried to start for this head
  (`autoTried`, `run.head`, `run.opened`), whatever its end, means a reload, a second tab or a revisit starts nothing more, and
  a failure is never retried by itself; the stage shows why and "Try again" (`{retry: true}`) starts it once more, still
  without a paid confirmation (a start that never reached Studio is sent again the same way). It starts nothing in a room
  that is closed, archived, busy, or explained with a skill the captain picked. A new head starts a new version on the next
  opening; the older version stays on the stage while it is made, with one progress strip above it (model, who pays, head,
  Stop). The run is marked on its ledger entries as started on opening (`opened`). `POST /api/review-room/explain/settings
  {autoRun}` turns it off.
- **The picker** (`[data-explain-picker]`, "Explain with" / 解釋用, at the right end of the header of every room that is not a
  Library snapshot; hidden at 760px and narrower, where a paired phone reads only): the built-in baton first, then the
  captain's own skills (a folder, a skills home, a git URL; a skill in `~/.claude/skills` or `~/.codex/skills` is imported on
  the Skills page first), then the skills Studio ships for its own workflows, folded under "More from Studio's library". Each
  option says what it made in this room (HTML page, video, … and how many versions). The menu and the confirmation take the
  focus, keep Tab inside, and give it back to what opened them on Esc or Cancel. Picking is free: a skill that already has an
  output in this room switches at once (`POST /api/review-room/<room>/explain/select {skill}`); a skill with none asks for its
  first run. A skill not in the library is refused (`bad_skill`).
- **A run is paid and confirmed**: the offer (`GET …/explain/offer?skill=&kind=generate|ask`) names the room tutor's provider,
  model and effort (the same pick and independence label as the header), who pays (that provider's account Studio runs it with
  on this Mac), what this room's runs cost so far and an estimate (the median cost of this skill's earlier finished runs here,
  else "no estimate yet"), the skill and its version, the materials it gets, "no round cap", the expected time (the median of
  this skill's earlier finished runs here, else "not known yet"), the safety limit, and the isolation. `POST …/explain/generate
  {skill, confirm, prompt}` starts only with that offer's hash; a changed tutor, skill version, limit, scripts plan, decision or
  instructions asks again (`confirm_required`, 409, with the new offer). A pull request or directory room no Task hosts yet
  makes its host Task once, after this confirmation (`ensureHost`). The server answers once the run is admitted (a model it
  verifies again can take a minute): until then Confirm reads "Starting…" / 開始中… (`aria-busy`), a line says Studio is
  checking the model and starting the run (`[data-explain-starting]`), and the dialog is not dismissed (Esc, Cancel, the
  backdrop) nor sent twice. Its answer acts on that dialog only: started, it closes, and a push or poll never brings it back;
  refused, it stays with why (`[data-explain-note]`, an alert) and Confirm on again; gone meanwhile, the room says why. Both
  lines sit in the dialog's sticky footer beside Confirm, in view however long the dialog. A limit saved or an offer read after
  the dialog closed opens nothing.
- **What it should produce** (the confirmation's first field, `[data-explain-prompt]`, "What should it produce?" / 要產出什麼？):
  the captain's own instructions for this generation, multi-line, at most 2000 characters (`PROMPT_MAX`, a counter under it,
  warning past 90%); empty is the skill's own default. It is prefilled with the skill's **default instructions** when the
  captain set them, else the last instructions this skill was run with (remembered per skill, Studio-wide, in
  `data/review-room-explain-prompts.json`, written when a run starts), or with a version's own when the captain generates again
  from it; a line under the field says which (your default · what you last asked · edited for this run · empty). "Save as
  default for this skill" keeps the text as that skill's default ("Clear the default" when the field is empty), "Reset to
  default" brings it back after an edit, and "Insert a review checklist" adds Studio's built-in example below the text, never
  by itself (`PROMPT_EXAMPLE`, en and zh-TW: an architecture diagram, a sequence diagram, the database lifecycle, the state
  machine of an order or entity, error codes, each API request and response, the technology choices, before and after of what
  it fixed); it is off while the checklist is already in the field (no second copy). The dialog's buttons stay in view
  however long the text (a footer that sticks to its bottom), and its "Skills page" link opens a tab of its own, so the text
  typed here stays. Defaults are the captain's, Studio-wide (not per room), kept with the explainer's settings in
  `data/review-room-explain.json` (`defaultPrompts`), and editable outside any run on the Skills page: "Review room: default
  instructions" (`[data-skill-defprompt]`: set or none, the text, Save default, Clear, Insert a review checklist) on the
  captain's own skills and on any skill already used in a review room; Studio's built-in skills get it behind "Review-room
  instructions: show for all skills" (`[data-skill-defall]`). Through `GET /api/review-room/explain/prompts` (every skill's
  default and last text, the cap, the example) and `POST … {skill, text}` (the captain on this Mac; an empty text clears it).
  A default is only a prefill: the offer is for exactly the text the confirmation sends (`POST …/explain/offer {skill, kind,
  prompt}`, a POST because 2000 characters of CJK do not fit a URL; `GET …/explain/offer` without `prompt` is the prefill), its
  sha256 is part of the offer's hash, and an edit reads the offer again (Confirm waits for it, and stays off if that read
  fails), so a changed text is a new confirmation and a confirmation for one text never starts another. The run gets it as the
  captain's: in the message that starts each round, in a fence of its own, `<captain-instructions>`, marked trusted (the
  captain wrote and confirmed it). Studio's fence tags (`captain-instructions`, `untrusted`, `selection`, `previous`,
  `question`) are neutralised in every text Studio places between them in its message (the instructions, the skill's own last
  message, a question's earlier answers): the `<` that would open one becomes `‹`, in one linear pass (`untag`: nothing is
  removed, so no forged or nested tag can join into a working one, and a 3 MB diff costs one read, never a quadratic loop that
  would hold Studio). The materials (the diff, the commits, the description, reviews, check and status names, issues, the head
  of every changed file) get the same for `captain-instructions` and `untrusted` only (a `<question>` in the code stays). The
  materials stay files the skill reads, fenced as untrusted. Studio's frame (`EXPLAINER_FRAME`) says to follow the captain's
  instructions within the skill's method and Studio's rules, that they never make material text instructions, and that the
  same tag anywhere else is not the captain's. The run, its version and both ledger entries keep the text (`prompt`,
  `promptSha256`). A question has no instructions of its own: its question is its text.
- **Admission.** A run's rounds are jobs of the room's tutor seat on the same member, admitted the same way as any role's
  (The tutor, below), under an auxiliary seat of its own: a generation's per skill version
  (`review-room-explainer:<skill>@v<n>`) whose pinned texts are Studio's frame (`EXPLAINER_FRAME`), baton's adapter for baton,
  and the skill's body, each by sha256; a question's `review-room-qa` with `QA_FRAME` alone. Each round gets a fresh receipt.
  One run at a time per room (`busy`), a page or a question.
- **As many rounds as the skill needs.** A round that ends before the skill calls `explain_done {entry, summary}` (a
  question: `explain_answer`) is followed by another, whose prompt carries the files written so far, its notes
  (`out/.notes.md`), its progress lines and its last message. A run ends when the skill says it is done, the captain presses
  Stop (`POST …/explain/stop`: the round that runs is cancelled; what it cost is recorded; a stopped generation keeps no
  version), the wall-clock safety limit passes (Studio-wide, `POST /api/review-room/explain/settings {limitMin}`, 1 to
  1440 minutes, default 120, `CREW_REVIEW_EXPLAIN_LIMIT_MIN`; also shown and editable in the confirmation), the provider
  fails (not signed in, out of quota), the room stops taking paid runs (its card answered, its pull request closed: `closed`),
  or three rounds in a row leave the output folder exactly as it was, its notes included, whatever tools they call (stalled:
  never an endless paid loop; `CREW_REVIEW_EXPLAIN_STALL_ROUNDS`). There is no cost cap. A round's own time is 25 minutes
  (`CREW_REVIEW_EXPLAIN_ROUND_MS`) and 400 tool calls (`CREW_REVIEW_EXPLAIN_ROUND_TOOLS`); running out of either only starts the
  next round. A round whose reply was cut at the model's output limit (the provider's `outputLimit`, no refusal: readiness
  stays) is no provider failure either: the next round is told its last call was lost and to write big files in parts
  (`out_write` with `append: true`); two such rounds in a row stop the run (`why: outputLimit`). A Claude round runs with a
  64000-token output cap (`CREW_CLAUDE_MAX_OUTPUT_TOKENS`, 4000 to 128000, handed to the CLI as `CLAUDE_CODE_MAX_OUTPUT_TOKENS`).
- **Materials, read once, read-only**, into the run's workspace (`materials/`): the pull request's title and description,
  the diff base..head (3 MB at most), the diffstat, the commits with their messages, the head of every changed text file
  (300 KB each, 3 MB in all), reviews and comments, check runs and commit statuses at the head and the issues the description
  links (GitHub GET only, when the room's repository is a connected project; the adapter's `issue` read is one issue by
  number, at most eight). A README lists them and says which text is untrusted; untrusted text is fenced. The skill reads them
  with `mat_list/mat_read/mat_search`, its own supporting files with `skill_*` (a copy), and writes only `out/` (`out_*`;
  `out_write` with `append: true` adds to the end of a text file, `out_write_base64` for a picture or a video; every write
  counts against one 60 MB cap, `CREW_REVIEW_EXPLAIN_OUT_BYTES`, a script's included). The diff is fenced as untrusted; the
  head files are kept as the author wrote them, line for line (citations need their lines), except that a
  `<captain-instructions` or `<untrusted` in them is neutralised (above), and the README names them untrusted. No shell of
  its own, no web tools; a skill with scripts runs them through `skill_run` (below).
- **The skill's own scripts.** A library skill whose package has scripts (`render.py`, `verify.py`, a `.sh`: what
  `src/skillpkg/analyze.ts` finds) runs them with `skill_run {script, args, timeout_s}`, the same tool a workflow round's
  script skill uses (`src/skillpkg/run.ts`), in the round sandbox (`roundExec`: `sandbox-exec`, default deny). A question
  never runs one.
  - *What runs*: one of the package's detected scripts, on a read-only copy of the whole package (`SKILL.md` and every
    file, hashed again against the version's `sha256` and `filesSha256`, or refused): python with the host's `python3`,
    node with the host's `node` (else Studio's bun), shell with `/bin/bash`; a version approved with scripts runs on its
    prepared env (its lockfiles' dependencies, docs/units/skill-packages.md §4). Package managers are shims that refuse;
    nothing is installed or fetched at run time.
  - *Where*: its working folder is the output folder, under another path while it runs: `out/` is renamed to `live/` for
    the call (`$OUT_DIR`) and back after it, and the call's profile names `live/` only. Seatbelt checks paths, so a leftover
    of the call (a process that double-forked, called setsid() and dropped its environment, escaping the group kill) can no
    longer write, link or swap anything in `out/` once the call ended; Studio also kills every process still sitting in or
    holding a file of `live/` or the call's temp folder (`sweepHolders`, lsof) before the rename back, and reads and copies
    regular files only, never following a link. It writes only there and in its own temp folder (`$TMPDIR`, its `$HOME`
    in there, removed after the call); it reads the materials (`$MATERIALS_DIR`), the package (`$SKILL_DIR`), the system,
    the interpreters' installs and the folders on Studio's `PATH` (the round profile's rule; the confirmation says so).
    Studio's data folder (keys, tokens, policies, other rooms) and the captain's secret folders are denied. A bun that runs
    a node script (Studio's own, or a `node` on PATH whose real file is a bun: an alias or a link) gets an empty config of
    Studio's own and `--no-env-file`, so a `bunfig.toml` preload or a `.env` written in the working folder is not honoured.
    Python runs the script file, whose folder (the read-only package) is first on `sys.path`, never the working folder.
    `PYTHONSAFEPATH` is not set: it would also drop the script's own folder and break a skill that imports a module beside
    its script. So a child interpreter a script starts itself with `python -m …` or `python -c …` in the working folder
    puts that folder first on its path and imports what is there; that folder holds what the skill and the model wrote,
    the same principal as the script, inside the same sandbox, network and caps. Studio never starts one that way.
  - *Network*: allowed, through Studio's egress proxy only (`HTTPS_PROXY`/`HTTP_PROXY`, a credential of its own per call,
    `anyHost`: any public name; `src/egress.ts`). The proxy's address guard still refuses loopback, this Mac's addresses,
    private, link-local and metadata addresses, so a script never reaches Studio or the local network. A client that
    ignores the proxy variables, or opens a raw socket, gets nothing. Every host a call reached (and any refused) is kept
    on the call.
  - *Env*: `PATH` (the shims, the interpreter, `/usr/bin:/bin:/usr/sbin:/sbin`), `HOME`, `TMPDIR`, `LANG`, `CI`,
    `GIT_CONFIG_NOSYSTEM`, `GIT_CONFIG_GLOBAL=/dev/null`, the proxy variables, `SKILL_DIR`, `MATERIALS_DIR`, `OUT_DIR`,
    `PYTHONDONTWRITEBYTECODE`, `PYTHONNOUSERSITE`, `PIP_NO_INDEX`, `npm_config_offline`, `CHROME_BIN`/`CHROME_PATH`/
    `PUPPETEER_EXECUTABLE_PATH` when a browser is there, `CREW_RUN_KILL` (the cleanup marker), and of the credentials only
    `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `OPENAI_API_KEY`, `OPENAI_BASE_URL` when the captain
    exported them in the environment Studio started from (`SCRIPT_CREDENTIALS`; the same values Studio itself uses when it
    calls those vendors), so a skill can call a model itself. Never a key Studio stores, the GitHub token, the session or
    ledger keys or a device's token: nothing else of Studio's environment is inherited. A value in a script's env is
    readable by another process of the same user (the same is true of Studio's). The values are redacted (`[redacted]`)
    from what Studio keeps or shows of a call's output: the result the model gets, the round's record, the progress line.
  - *Caps per call*: 300 s of CPU for each process it starts (soft `ulimit -t`, SIGXCPU; the hard limit 5 s above;
    `CREW_REVIEW_EXPLAIN_SCRIPT_CPU_S`), each file up to 60 MB (`ulimit -f`, `…_FILE_MB`), 600 s of wall clock (`…_WALL_S`;
    `timeout_s` lowers it), 60 calls per round (`…_CALLS`), output cut to its last 64 KiB. A limit that cannot be set stops
    the call with exit 126 and a message. What a script writes counts toward `out/`'s 60 MB: once over, the next
    `skill_run` is refused until files are removed. While a call runs Studio checks every second that `live/` and its temp
    folder together stay under twice that (120 MB) and stops it otherwise ("hit the disk limit"). One call at a time.
    Not capped: the number of processes and memory (macOS has no per-sandbox limit; `ulimit -u` counts every process of the
    user), so a fork bomb is bounded only by the call's wall clock and CPU limits.
  - *A headless browser*: a branded Chrome app does not start inside the round sandbox. Playwright's headless shell does
    (the newest under `~/Library/Caches/ms-playwright`, or `CREW_REVIEW_EXPLAIN_BROWSER`), with one more rule (it registers
    and looks up its processes' rendezvous service, `org.chromium.Chromium.MachPortRendezvousServer.<pid>`) and its inner
    sandbox off (it cannot nest; the round's holds). Studio puts a `chrome` shim for it first on `PATH` and in `CHROME_BIN`.
    Without one, the first message says so and the skill's own instructions decide how it degrades.
  - *Recorded*: every call on its round in `state.json` (the script and its hash, the arguments, exit or signal, timed out,
    milliseconds, the last 2000 characters of stdout and stderr, the hosts reached and refused, its outcome: ok, failed, a
    limit it hit, or refused before it ran and why), and in the run's ledger entry. The progress list shows each call as a
    line the page words in the captain's language, the result first ("build.py — done · 0.1 s · reached …"; "hit the CPU
    limit (300 s)"; a time limit is the call's own wall clock, its `timeout_s` when lower), paths shortened (relative to the
    output folder, `$MATERIALS_DIR`, `$SKILL_DIR`), marked ✓ done, ⚠ a limit or a refused host, ✗ failed or refused. A
    refused call shows the path as the skill wrote it and a short reason (not a script of this skill, the round's calls
    used, the output folder full, its arguments); a line opens (▸) to Studio's full message, its stderr tail and every host
    it reached or was refused.
  - *Confirmed*: the offer's `scripts` says the scripts run, sandboxed, with network, the interpreters, the credentials by
    name (endpoints apart), the caps, the browser and what is missing, each a row of the confirmation (the undecided note a
    warning line of its own); its hash covers the package's `filesSha256`, that plan and the version's decision state, so a
    changed script (a new library version), a new interpreter, credential, browser or cap, or a decision made anywhere asks
    again, and the plan is read once before admission and used for the whole run.
  - *Decided*: a script version the captain never decided is decided in this confirmation (docs/units/skill-packages.md §3):
    the offer's `decide` is `{state: "pending", facts}` with what the team-change card shows (`pendingScripts`,
    src/skillpkg/crew.ts: both short hashes, each script with its flags, the hosts approving it allows, its lockfiles and
    programs), and the confirmation carries the pick 「核准（含 script）」 Approve with scripts / 「只當文字」 Text only;
    Confirm stays off until one is picked, and a start without it is refused `confirm_required`. The pick sits at the end of
    the dialog, so until it is made the sticky footer says 「請在下面選「核准（含 script）」或「只當文字」才能開始。」 with a
    button that scrolls to it; the scripts and network rows above say they depend on that decision rather than promising a run
    or a network. The options stay at every width (390 px too). The pick (`skillDecision`) is recorded once the run is
    admitted, through the same signed ledger (`SkillPackages.decide`, `via: "review-room"`, with the room and the Task), bound
    to the hashes the confirmation showed; the run and its start record keep `decided`. Once written it is the version's
    decision: it stays if the run then fails or is stopped. A refused confirmation that brings another undecided version
    clears the pick made for the old one. A decided version shows its decision ("Approved with scripts · decided in the review
    room") and asks nothing. Text only: the run has no `skill_run` and the first message says the scripts do not run.
    Approved: before its first round the run waits for the version's prepare (or starts it: `SkillPackages.ensure`, the
    lockfile-derived egress list and the sandboxed install of §4); the stage shows "Studio is installing the skill's
    dependencies from its lockfiles (sandboxed)…", and the run's plan is read again so `skill_run` gets the prepared env. A
    prepare that fails or a runtime that is missing stops the run before any paid round, `why: "prepare"`, with the reasons in
    en and zh. Only a missing program does not stop it (the agent is told what is missing). This holds for a version approved
    elsewhere whose prepare failed too. Stop and the safety limit do not wait for a prepare (its steps can take up to 900 s):
    the run ends at once (`why: "captain"` or `"limit"`, its `prepare` `left`) and frees the tutor seat, and the prepare, the
    version's and shared with every other waiter, goes on in the background. A question's "don't ask again" given before a
    prepare moves with it when the prepare changes the plan's interpreters.
- **Live progress**: the stage shows Studio's steps (read the materials, the skill working round by round with its own
  `explain_progress` lines, its own check, the frame), done, current and upcoming, a bar of the time used of the safety limit,
  the cost and its live log (the round's tool calls and what it said); it runs in the background, the captain may leave, and
  Studio says when a run ends while the captain is not watching it (a toast with a link back to the room). Why a run stopped or
  failed is a code (`why`: captain, limit, stalled, provider, outputLimit, prepare, closed, interrupted, …) the page words in
  the captain's language, as a warning (stopped) or an error (failed) with its icon; Studio's refusals show only the captain's
  half of their "English / 中文". The explainer's live event is its own (`review-explain`): a progress line redraws the
  explainer's parts, never the whole room. A run left running by a Studio that stopped is marked interrupted when the room is
  next read, and its workspace removed.
- **Versions.** Every generation is a new version (`v1`, `v2`, …: the output's files, its working notes and dotfiles left
  out, regular files only, never changed once written), listed with its summary and where it came from in the version menu,
  and what made it: the built-in baton by its upstream commit (`baton e74aeed`, known by its two hashes for every pin Studio
  shipped, the same on every machine, so an older packet keeps naming its own after an upgrade), any other skill or a
  changed built-in by its library version (`skill v2`). Only in the menu: the button keeps the version's own number (it
  counts the room's outputs, not the skill's) and names what made the shown one in its title
  (`[data-explain-versions]`, the shown version's name on the output's one-line bar, no column of its own: the output gets
  the room's width); an older one is shown again with a click, or the arrow keys and Enter (Esc, a click elsewhere or Tab out
  closes the menu; the focus goes back to its button or on). A question never makes a version. Each version says what it was
  made from, in the menu (✎ its instructions, or ✎ the skill's default) and on the bar (`[data-explain-made]`, folded: "Made
  with your instructions: …"; opened, the whole text and "Generate again with these instructions…", which opens the
  confirmation with them, editable). "Generate a new version" in the menu starts from the shown version's instructions too.
  Showing a version another skill made changes only what the stage shows: the room's selected skill stays (no `select` is
  sent); the picker changes it.
- **Rendering.** HTML (and Markdown, rendered by Studio) is shown in an iframe with `sandbox="allow-scripts"` only (never
  `allow-same-origin`: an opaque origin), loaded from `/rrx/<capability>/<room>/<v>/<file>`: a 30-minute capability signed
  with a key the explainer holds in memory (the frame sends no cookie). Every file there is served with `OUTPUT_CSP`:
  `sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:;
  media-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; …; frame-ancestors 'self'`, so it cannot read
  Studio, fetch anything (Studio's own address included) or reach a token. Studio puts one script first in every page, before
  anything of the page's own: a storage shim (an opaque origin throws `SecurityError` on `localStorage`; the shim keeps an
  in-memory one so a page that stores its language still renders). A picture or a video is shown by Studio's own `<img>` /
  `<video>` from `GET …/explain/media/<v>/<file>` (session, ranges, the same CSP). The frame sits in a layer of its own over
  the stage, so a redraw of the room never reloads it; it is unloaded once the captain leaves. A framed page can still
  navigate its own frame (`location = …`: neither its CSP nor its sandbox stops that), so Studio's page is served with
  `frame-src 'self'; child-src 'self'` (`src/server.ts` `PAGE_CSP`): every frame Studio shows is one of its own addresses
  (artifact previews `/af/` and `/afc/`, document versions, the cards' direction thumbnails, skins `/skin/`, the explainer's
  `/rrx/`), and a frame navigating anywhere else is refused. The capability is checked before anything else, so a wrong one
  never tells whether a room or a version exists; nothing outside the version is served.
- **Full screen and a tab of its own.** "Full screen" / 全螢幕 (`[data-explain-full]`, or F while the focus is on the stage)
  puts the output's layer in full screen with the Fullscreen API (a picture or a video: that element, natively). The frame is
  not reloaded (the layer is the same element; it only leaves the stage's geometry and clipping while full). A bar names
  the version and has "✕ Exit full screen" (Esc) in a strip of its own at the top (44 px): the output starts below it, so
  the bar never covers the page's own controls (a language switch in its corner). When full screen is refused (a browser or a
  policy that does not allow it), the layer covers the whole window instead (`.rx-layer.full`, fixed, over the room) and Esc
  or ✕ closes it. Leaving (✕, Esc, the browser's own way out, another version, leaving the room) puts the layer back on its
  stage and every scroll position the stage sits in back as it was, and gives the focus back to Full screen. A question asked
  in full screen leaves it first (its confirmation is in the chat). "Open in new tab" / 在新分頁開啟 (`[data-explain-newtab]`,
  a page, Markdown or text; a video has none) asks for a fresh capability and opens `/rrxt/<capability>/<room>/<v>`
  (`noopener,noreferrer`): a page of Studio's (`TAB_CSP`: `default-src 'none'; style-src 'unsafe-inline'; frame-src 'self';
  child-src 'self'; …; frame-ancestors 'none'`, no script of its own) that frames that version's `/rrx/` page exactly as the
  room does (`sandbox="allow-scripts"`, the output CSP unchanged): an opaque origin with no network, and a page that navigates
  its frame away is refused there too. The capability is checked first; without it the tab serves nothing.
- **Recorded** like other paid rounds: each round's record under the host's review node (`room-<room>-x<n>/`, attempt k for
  round k; its header names the subject, the run and its role, `review-room-explainer` or `review-room-qa`, and the pinned
  texts), and one `review-room-explain` ledger entry per run: subject, skill pin (id, version, sha256, files hash, body and
  frame hashes), provider, model, effort, confirmation (or consent), the instructions and their hash, rounds with their jobs,
  costs and script calls, status, why it stopped, cost, time, the limit, the version it read and the one it made; and a
  `review-room-explain-start` entry when it starts, so a run a stopped Studio interrupted is still on the ledger. A round that
  throws keeps the cost its job had reported. A run that fails or stops on its own (not by the captain's Stop) sends the
  retro's `room_round_failed` signal with its `why`.

      data/…/<room>-explain/state.json      the selected skill, runs (rounds, cost, progress, answers), versions, consent, autoTried
      data/…/<room>-explain/v<n>/            a version's files
      data/…/<room>-explain/work/run-<n>/    a run's workspace (materials/, pkg/<skill>/ read-only, out/, .tmp/, .bin/), removed when the run ends
      data/review-room-explain.json         the safety limit, the default skill, autoRun; each skill's default instructions (defaultPrompts)
      data/review-room-explain-prompts.json the last instructions each skill was run with (the confirmation's prefill)

Not yet: the explainer's own web tools (beyond what a script fetches); a script's Python packages come only from the runtime
or a prepared env (the captain's user site-packages are not read); a generation stopped half-way keeps nothing; the new tab
lasts as long as its capability (30 minutes: a reload after that is refused; open it again from the room), and that capability
stays in the browser's history until it expires; instructions are remembered per skill, not per room.

## The tutor

The tutor answers the room's questions and runs its pages: every paid run of a room, a generation or a question, runs on the
room's tutor (`tutorFor`). It is the **tutor seat**: not Firstmate, not the worker, not the reviewer, but the reviewer role's
member or a stand-in for it (`TUTOR_ROLE = "reviewer"`), read-only.

**The captain's pick.** The tutor is not hard-wired to a vendor: the header's tutor pill opens a picker (`[data-tutor-open]`)
listing Studio's default (or Automatic) and every model this machine has (`view().tutors`: codex, claude, cursor, …), each with
how independent it is from the change's author, shown as information and never enforced (the author's own model can be
picked; the label says so). Every model can be picked: one not verified on this machine, held (out of quota, quota unreadable,
stale facts) or in its verification backoff shows the reason next to it as a warning. "Other model…" (in the picker and under
Studio's default) takes any model by hand: a provider Studio runs (`tutorProviders`: the ones staffing runs, codex, claude and
cursor, and any this machine lists) and a free model id (at most 120 characters, no spaces, not starting with `-`); it is
stored like any pick and listed after the machine's models as entered by hand. The room's pick (`POST
/api/review-room/<room>/tutor {pick: {provider, model} | null}`, desktop captain, refused on a room that takes no run; null goes
back to the default) wins over Studio's default (`POST /api/review-room/settings {tutor}`, the room list's select; null is
Automatic, below); only a malformed pick is refused (`bad_request`). A picked tutor that cannot run is never refused up front
nor swapped for another: the offer names it, its label and `warning` say it is held, not verified or not reported by its vendor
on this machine, and its run fails with the reason (Studio's verification for a listed model; for one entered by hand, the
vendor itself: Studio does not verify it first, and the native selection, told it is the captain's pick (`picked`), passes an
id the vendor's probe did not report to that vendor as given instead of refusing it. The vendor must still be signed in and
verified, and what runs must be that exact model; a pick Studio makes itself keeps the probe's model check). A confirmation
given before a picked model turned held starts nothing: its warning is part of the offer's hash. The offer says whose pick it
is (`picked`: room, studio or auto) and the label says "Picked by the captain for this room" or "Studio's default tutor, picked
by the captain". The approved reviewer picked runs as the seat's own member; any other model runs as the seat's adaptive
member, its receipt naming it (`adaptive.picked`: staffing admits a member the captain picked even when this machine does not
list it as runnable; one Studio chose must be). A pull request no Task made has no author to compare with: a picked tutor's
independence is unknown, said so, never claimed as another vendor.

**Automatic: adaptive and independent.** With no pick, a merge card's or a branch's tutor adapts to what this machine has
(docs/architecture.md, "Adaptive staffing"), judged against the change's author (every node that wrote it, build, fix or
rework, as staffed and as it ran). A member left to its vendor's default model is that vendor's actual default first.

1. **The approved reviewer** (the approved staffing's reviewer as admitted on the merge card's node, else the Task's own
   pick for its review node) stays the tutor whenever it can run now and differs from the author at least by model:
   another vendor being signed in changes nothing.
2. Otherwise (it is the author's own model, cannot run now, or its verification is in its backoff), **another member
   already in this project's crew** (another role, a node override), the most independent one first; only if none
   differs from the author, **a model outside the crew** that this machine can run (a verified Claude model before an
   unverified candidate; a Codex model at medium effort, Claude and Cursor at their own default), labelled "Not in this
   project's crew".
3. When nothing that differs from the author can run, the author's own model is used only when this machine has no
   other model at all ("Same model as the author: a fresh context, not an independent opinion. Only one model is
   usable…"). Another vendor that is signed in but held (out of quota, quota unreadable, stale facts) is waited for: the
   room says "The tutor waits: …" and runs nothing. Without provider facts nothing is relaxed; with nothing usable at all
   the room says so (`no_tutor`).

The offer carries the level (`independence: {level: vendor | model | same, adaptive, outside, en, zh}`) and the header shows it
as "Tutor: … — Different vendor from the author" (or "Same vendor as the author, different model", or the same-model text, with
why, and "Not in this project's crew" when it is not). With no pick, a pull request no Task made runs on the project's crew reviewer and a
directory on its Automatic pick (Subjects, above). A page's tutor is read again after what is usable is refreshed, so a tutor changed since the
offer asks to confirm again.

**Verified by Studio.** Before the paid run, Studio reads what this machine has again (the offer may change: a changed offer
is answered with the current one) and verifies the chosen member itself when it is signed in but not verified yet
(`engine.deps.ensurePick`: one bounded request per model, kept for its window), recorded on the Task's ledger
(`staffing-auto-verify`). One that is not signed in, out of quota or not offered is refused with the reason, before anything is
paid (`no_tutor`). A model entered by hand is not verified first (above).

**Admission, like any role's** (`admit`). A run belongs to the merge card's live node (a branch or pull request room: an
auxiliary owner of the review node; a host: of its node): the provider is chosen through the native selection on that node as
the reviewer (capability verified, certified for that owner), and staffing issues a receipt for the room's seat. The run
registers its seat with staffing (`engine.deps.auxiliarySeats`: the seat, the role whose approved member it runs on, the
sha256 of each pinned text, `adaptive: true`), and staffing checks the provider, model and effort against the approved
reviewer, or, for an adaptive member (`aux.member`), against that member, which must be runnable on this machine now (without
provider facts only the approved member is admitted; a seat that is not adaptive takes no member), and that the instructions
are exactly the pinned texts, in order, under the safety and operating rules (nothing added, nothing left out, nothing
reordered); the receipt records the seat and the hash of its texts (`staffing-instructions`), and names the member actually
used: its provider, model and effort, plus `adaptive: {independence, crew, approved}` when it stands in for the approved
reviewer. The native selection runs on that member (`adaptive: true` keeps it from being replaced by the role's approved
pick), and the job's admission checks the provider against it. Each round is one of the Task's jobs (`ref` is the Task): the
same queue, cancel and provider admission as other roles, which recheck the receipt, the owner and the instructions' hash at
launch. A seat staffing does not know (the old `review-room-tutor` seat too), instructions that differ from the pins, or a seat
bound to another role are refused before anything is paid (`staffing`), and a refused admission records no run and starts no
job. An open sandbox-off grant for the project, or local unrestricted mode, refuses the run (`sandbox`).

**Read-only.** Every round runs in the round sandbox with nothing to write (`writes: []`) and no host beyond its model
(`allow: []`); the only writes are the skill's own output folder through Studio's tools and a script's call folder (above).
Nothing reads or writes the worktree's files, index or refs: git objects are read from the worktree, from the repository once
the worktree is cleaned, or from the room's cache. Nothing goes to GitHub: no comment, review or request of any kind but the
GETs above.

Rooms are per change and run concurrently: no driver lock. One run at a time per room.

## Old rooms

A room from before keeps its whiteboard on disk exactly as it was: its tutor turns, scenes, drawings, translations, lesson
and the rest of its old fields stay in the room's file (`[old: string]: any`), and Studio reads none of them any more; opening
the room changes none of them (a turn left running is not even marked interrupted). The board, its translation (EN / 繁 /
简), the understanding check, the web tools, generated pictures, auto-teach on arrival or paste, starting a room over and
asking about a boxed region or a paused video were removed, with their routes (turn, cite, image, check-answer, translate,
images, reset, auto, arrive, lesson, findings, the paste offer and the voice routes).

The room's page says in one line how many whiteboard turns it has (`oldBoard`: its finished turns, its board items and what
its turns and its translation cost, never their text), that the board is gone and nothing was deleted, and offers its record
as a file: `GET /api/review-room/<room>/export` (`exportRoom`: the room's JSON exactly as kept, as an attachment, never cached;
a POST is refused, no such room is a 404). The file downloads on this Mac only: a paired phone gets 403 `desktopOnly` and the
notice says where the file downloads. The old board's cost still counts: the room list, the merge card's summary and a Library
save add it to the pages'. A Library save of an old room's board (from before) opens as its JSON too, and its pictures stay
served from the snapshot (`GET /api/review-room/library/<artifact>/<n>/asset/<name>.png`).

## The Library

**Saved to the Library.** A room's pages are saved as one Library artifact per room (`room-<room id>`, source `room`, type
`doc`, under the room's project, else `firstmate-workflow`, so it follows that project's place in the Library), a new version
per save, the history kept. The captain saves any time (`POST /api/review-room/<room>/save`, the desktop captain; a room with
no page has nothing to save, `empty`), and Studio saves a room on its own only once, at the moment it finishes: the merge
card's answer (the engine tells the room, `cardAnswered`) or a read that finds an open pull request merged or closed records
`finished` on the room. Listing rooms or opening one never saves, a room that finished earlier is never saved by itself, and a
failed save is recorded (`finished.error`) and not retried (the captain's button still saves). A room that finishes while a run
is going is saved when that run ends, never with half a version. Every save runs after the one before it, whatever its room, so
two saves never share a version number.

A version (`snapshot`, `kind: "review-room-pages"`, schema 2) is `room.json` and the room's pages byte for byte
(`pages/v<n>/…`): every file of every version is read and checked against the sha256 it was kept with, and a file missing or
changed since it was made fails the save (`integrity`: nothing is kept, and the manifest never lists a page it does not hold).
`room.json` holds each version's skill, time, entry, kind, summary, instructions, head, provider, model and cost; the room's
subject (repository, number, URL, head, title), the reason and the date; the old whiteboard's counts and cost (`oldBoard`);
and the total (`cost.usd`: the pages' runs plus the old board's, or none when any version's cost is unknown, never a partial
sum). Nothing is written to GitHub.

It reads without Studio's cache, the worktree or GitHub (`GET /api/review-room/library/<artifact>?v=<n>`, `librarySnapshot`,
with the artifact's versions and `integrity`: `store.verify`). The Library's page of a saved room offers "Open the saved room ·
vN" for its latest version and "Open" for each (`#/room/lib:<artifact>@<n>`), never review, notes, approval or compare,
and the Library refuses any write to it (`room-snapshot-read-only`) except its deletion (`DELETE /api/artifacts/room-<id>`, the
desktop captain: the artifact and all its versions; the room then no longer links it, and a later save makes it again from v1).
The room's route of a saved version is read-only: its header (the subject, "Saved … · read-only", its versions), each page
version as saved (its skill, time, head, model and cost, the old board's share of the total), a warning when files changed since
the save, and a link to read the pages in the review room itself. No paid control is there. The room's header links its
latest save ("Library vN").

### Downloading a page

Every page version downloads as a file the captain keeps, in the room and from a Library save (`src/domain/review-download.ts`).
The output's line has Download (`[data-explain-download]`) for the version shown, and the version menu one beside each version
(`[data-explain-verdl]`: Tab reaches it, the arrow keys still walk the versions); a saved room's route has one per saved version
(`[data-saved-download]`). `GET /api/review-room/<room>/page/<v>/download` (the room's version) and
`GET /api/review-room/library/<artifact>/<n>/page/<v>/download` (save n's copy, whatever the room's became) return the version's
bytes exactly as kept: nothing of Studio's is added (no storage shim). Each file is read and checked against the sha256 it was
kept with (the version's record; a save's manifest): one missing or changed refuses the download (`integrity`, 400, nothing sent;
the room says why in its chat, a saved room in a toast). A version of one file (baton's page: one self-contained HTML file) is
that file; a version of several (a page and its pictures) is a zip of them at the paths the page names them by. The file is an
attachment (`Content-Disposition: attachment; filename="<room>-v<n>-<skill id><ext>"`, `.zip` for several; each part ASCII
letters, digits, `.`, `_` and `-` only, no path), its own type (`text/html` for a page), `Cache-Control: no-store`,
`X-Content-Type-Options: nosniff` and `Content-Security-Policy: sandbox; default-src 'none'`, so it never renders in Studio's
origin. The page fetches it and saves it under that name. The room's frame keeps `sandbox="allow-scripts"` only (never
`allow-downloads`): a page's own download buttons (baton's context, a PDF) work in the file opened on its own, where its embedded
context is too, so Studio offers no separate context file. Downloading is read only and on this Mac only: a write is 405, no such
room, save or version a 404, and a paired phone gets 403 `desktopOnly`; its menu and saved room say "Page files download on the
Mac running Studio" instead of offering Download.

## The record

Every run's round record header and ledger entry carry the subject: its kind, the branch or the URL (or the directory), the
head and the base (merge cards too). A merge card's room is `data/runs/<task>/review-room/<card>.json`; a branch's
`data/runs/<task>/review-room/R-n.json`; a pull request's `data/review-room/pr/<id>.json`, its objects in
`data/review-room/cache/<hash>.git`; a directory's `data/review-room/dir/<id>.json`, its objects in
`data/review-room/cache/dir-<hash>.git`. A room's file holds its subject, the heads it saw, `seen`, a pull request's last read
or a directory's pinned snapshot, its host Task, its Library link, `finished`, the captain's tutor pick, the archive mark and
the read mark; its explainer's state is beside it (`<room>-explain/`, above). A merge card's room has no file until its first
page (or an archive, or a tutor pick) gives it one. The Studio-wide settings are `data/review-room-settings.json` (the default tutor) and
`data/review-room-explain.json` (above).

`data/review-room-stats.json`, one entry per subject (a merge card keyed by its Task, a branch as `branch:R-n`, a pull request
as `pr:<id>`, a directory as `dir:<id>`): card, kind, project, pull request, head and when the room was first opened (the
desktop page). The `turns` and `check` counts an older room recorded stay as they were. Kept for a later comparison with
reverts and reopens; no analysis here.

Studio's observability reads rooms the way the page does, never marking a room opened and never reading GitHub
(`src/observe/kinds/room.ts`, kind `room`, desktop viewer): `studio_get room:<id>` gives the subject, open or closed, running,
archived, the pull request's state and verdicts, the questions and pages with their runs (skill, status, provider, model,
rounds, cost, why, decision, prepare, version) and versions, the old board, the cost, recent errors and the reviewers' notes
(their words marked untrusted); `studio_logs room:<id>` is each run oldest first with its status, cost and why, and the room's
events. A room of a Task whose text is withheld from Firstmate is withheld too. `src/observe/now.ts` lists rooms with a new page
or a run in the last hour.

## Tests

Done when (each line proved by the named suite; `bun run test:review-room` runs them all):

1. Only merge cards have a room; any other card has no summary, and its room and runs are refused. — review-room "a
   dispatch card has no review room …", "a page on a card that is not a merge card is refused"; review-room-ui "a card that
   is not a merge card has no review room".
2. A page is a paid run the captain confirms on the room's tutor; a sandbox-off grant refuses it; one run at a time. The tutor
   keeps the approved reviewer while it can run and differs from the author, else adapts (a crew member, then a model outside
   the crew, labelled), waits for a held vendor, and is never refused for having one model. — review-room "a page without the
   confirmation is refused …", "the offer labels the tutor's independence …", "without provider facts nothing is relaxed …",
   "a vendor-default member resolves …", "with one model on this machine …", "with nothing usable at all …", "the approved
   reviewer stays the tutor when it can run …", "with a sandbox-off grant the tutor does not run"; review-room-admission "the
   approved reviewer on another model … stays the tutor …", "with the reviewer unable to run, a member already in the crew is
   preferred …", "otherwise a verified model outside the crew …", "a model in its verification backoff is skipped …", "a held
   vendor relaxes nothing …"; review-room-explain "one run at a time in a room".
3. A run is admitted like any role's: the native selection on the card's node as the reviewer, a staffing receipt for the
   run's own seat with exactly its pinned texts, one of the Task's jobs; anything else is refused before anything is paid. —
   review-room-admission "without the explainer's seat registered …", "instructions that differ from the seat's pins are
   refused", "a seat bound to another role is refused …", "a refused admission records no run …", "the explainer registers its
   own seat …", "staffing records the seat's receipt …", "the instructions sent carry every pinned text …", "a seat no run
   registered (the old tutor seat too) gets no receipt", "the chosen member is verified first …".
4. The captain picks the tutor: a Studio-wide default and a per-room choice; every model of this machine listed and pickable,
   one not verified or held with why; any model entered by hand; only a malformed pick refused; independence shown, never
   enforced; a pick that cannot run fails with the reason and is never swapped; Automatic unchanged; the receipt names the
   picked member. — review-room-admission "the room has a tutor picker …", "the picker lists every model …", "the room names
   the providers …", "a model not verified or held can be picked …", "a picked model not verified yet is verified by Studio
   first …", "a model entered by hand is accepted …", "the page runs on the model entered by hand …", "a model entered by hand
   that its vendor does not run fails visibly …", "a malformed pick … is refused …", "a picked tutor that is held is never
   swapped …", "a confirmation given before the picked model turned held starts nothing …", "Studio's default can be a model
   entered by hand …", "Automatic (no pick) never takes a held model …", "a page's tutor is read after what is usable is
   refreshed …".
5. The merge card shows the summary while readiness is unchanged; the room never answers the card; answering it saves the
   room's pages once. — review-room "the merge card's summary …", "the stored merge card is unchanged …", "the card's options
   and its evidence are unchanged …", "answering the merge card saves the room's pages to the Library once more …";
   review-room-ui "the card shows the room's summary …", "the merge card's line reads naturally in each state …".
6. No GitHub write path, no repository write. — review-room "the worktree, its index and its refs are untouched …", "no request
   left Studio …"; review-room-anywhere "GitHub is only read …", "the project's checkout is untouched …", "through all of it
   …".
7. A Task's branch has a room once Studio's review passed at its head, also a tainted Task ready on its branch; its runs are
   on the Task's reviewer seat through an auxiliary owner that never moves the Task; the review gate is per head. —
   review-room-anywhere "before Studio's review passes …", "once Studio's review passed …", "the run's round record sits under
   the review node …", "the Task did not move …", "a tainted Task ready on its branch …", "the branch's head moved past the
   reviewed one …", "a ready-on-branch head with no tainted-ready ledger entry …", "an auxiliary owner owns its node …", "the
   job queue admits a job on an ended Task only for an auxiliary owner …".
8. A pull request URL is accepted only in its exact form and only for a connected project's repository; GitHub is only read,
   the head's commits go only into Studio's cache, seeded from the project's clone and bounded by its cap. —
   review-room-anywhere "a malformed address …", "a repository no registered project is connected to …", "a refused address
   reads nothing …", "the head's commits are in a bare repository …", "the size watch stops a fetch …", "a fetch over the size
   cap is refused …", "over the cap while a run of this repository is reading the cache, the cache stays", "over the cap the
   cache goes …", "an empty pull request cache is first seeded from the project's own clone …"; review-room-ui "Open sends the
   address only …".
9. Untrusted text cannot leave its fence: reviewers' words, branch names and file paths reach the skill with glyphs, fenced. —
   review-room-anywhere "a comment is kept as its words …", "the skill reads the reviewers' words fenced as untrusted …", "a
   malicious branch name …", "a malicious file path …"; review-room-explain "Studio's fence tags written by the change's author
   … reach the skill neutralised …".
10. A moved head is announced, a stale or old read takes no paid run, and approved, merged and closed show while the room stays
    readable. — review-room-anywhere "Check for new commits reads GitHub again …", "the next page is made at the new head …",
    "once a page was made at the new head, the room no longer says new commits …", "a paid page is refused until the commits
    are fetched again …", "the next check fetches the commits again …", "an approval at the current head …", "a paid page on a
    pull request read a while ago reads it again first …", "merged on GitHub: …", "a fork's pull request …".
11. A pull request no Task made runs on the project's crew reviewer: the first confirmed run makes one host Task bound to the
    crew, whose receipt names the crew reviewer; nothing is written before; no crew is a clear refusal. —
    review-room-anywhere "an external pull request's room offers …", "without the confirmation nothing starts …", "the first
    confirmed page makes one host Task …", "the host is bound to the project's approved crew …", "the host Task gives no
    receipt for anything but the room's own seat", "the team's staffing is written only once the captain confirmed …", "the
    host Task is started by the captain who confirmed …", "a host room stays on the project's crew reviewer …", "the moved
    head's next page runs on the same host Task …", "with no approved crew for the project …", "a pull request no Task made
    has no author to compare with …".
12. The subject is on the record. — review-room-anywhere "the run's round record sits under the review node and its ledger
    entry names the branch and the head", "the run's ledger entry carries the pull request's URL …", "the run is on the host's
    ledger with the pull request and its head".
13. A directory of any GitHub repository has a room: its address checked; a public repository read anonymously, another
    through the captain's gh login, else refused with why; its ref resolved and pinned at that commit; its parts and README
    known; no diff or pull request state; its runs on a host Task with no crew, the receipt naming the confirmed member; its
    materials the pinned commit. — review-room-directory (each rule).
14. The room list: four zones grouped by repository, read from the pages, questions and read mark; archived only by hand,
    surviving a restart, separate from a Task's archive; every room listed; listing reads nothing on GitHub. —
    review-room-zones (each rule); review-room-zones-ui (each rule); review-room-ui "the Review room's home lists the rooms …",
    "each row reads the list's own fields …".
15. Ways back and focus: the sidebar's Review room, the room list and the crumb lead back; the browser's back walks Studio's
    pages; external links open in a new window; a room is a focus page that folds the sidebar and closes Firstmate without
    saving either, and gives both back on leaving. — review-room-ui "the sidebar has a Review room item …", "the room's header
    says where you are …", "the browser's back walks Studio's own pages …", "a link that leaves Studio opens in a new window
    …", "in a room the sidebar folds to its 64px rail …", "the header's Firstmate opens it as a sheet …", "leaving the room
    gives the sidebar and Firstmate back …".
16. baton is the built-in default, exactly as pinned and credited; opening a room starts it by itself once per head, a failure
    never retried by itself, Try again once more; a picked skill, an archived room, a changed baton or autoRun off start
    nothing. — review-baton (each rule); review-room-explain "the picker: baton by default …", "opening it twice at once
    starts one run …", "a failed one is never retried by itself …", "Try again starts it once more …", "reopening the room …
    starts nothing more …", "the captain picked another skill …", "off: opening the room starts nothing"; review-room-zones
    "an archived room starts no page by itself on opening"; review-room-explain-scripts "the captain's own baton, even made the
    default, never starts by itself …"; review-room-explain-ui "opening a room explained with baton starts its generation by
    itself …", "it failed: the stage says why and offers Try again …".
17. A generation: paid and confirmed on exact terms, as many rounds as it needs, materials read-only, a version per
    generation, Stop, the stall guard, the output limit, the safety limit, on the ledger. — review-room-explain "a generation
    without the confirmation is refused …", "a wrong confirmation is refused", "the skill kept going for a second round …",
    "round 2 carries the notes …", "materials and the skill's files are read-only …", "v1 is the output's files …", "the ledger
    records the run …", "Stop ends the run at once …", "three rounds in a row that leave the output unchanged stop the run …",
    "one round cut at the output limit does not end the run …", "two rounds in a row cut at the output limit stop the run …",
    "the wall-clock safety limit stops a run …", "every run that started is on the ledger twice …".
18. The captain's instructions: part of the offer's hash, in their own trusted fence every round, kept on the version and the
    ledger, prefilled from the skill's default else the last text, per skill; fence tags neutralised in one linear pass. —
    review-room-explain "the instructions are part of the paid offer …" through "1 MB of adversarial tags … is neutralised in
    under 100 ms"; review-room-explain-ui "the version view names the instructions …" through "cleared, the run is the skill's
    default …", and the Skills page's editor.
19. Questions are the room's tutor's: paid and confirmed (once, with "don't ask again"), on Studio's question frame and its own
    seat, grounded on the shown version's visible text, answered only in the chat, never a new version; no region. —
    review-room-explain "a question is a paid run too …", "the answer and its citations are kept on the run …", "the question's
    prompt: Studio's question frame …", "a question's tools …", "version/page.txt is the version's visible text …", "the page
    is unchanged and no version was made …", "an agreed question runs unconfirmed …", "while the skill works, the tutor takes no
    question …", "hidden text is dropped …"; review-room-explain-scripts "a question's plan is the tutor's, not the skill's …";
    review-room-explain-ui "the question goes with the version shown, and nothing else (no region)", "switching to v2 keeps the
    conversation …", "pressing Ask puts the question … in the chat at once …", "the push brings the real run …".
20. The output frame: sandbox allow-scripts only, the output CSP, Studio's storage shim its only script, served only by its
    capability; Studio's page frames only its own addresses; the new tab the same. — review-room-explain "a version's page
    carries the output CSP …", "the storage shim comes before anything of the page's own, and it is Studio's only script there
    …", "no capability … serves nothing …", "the new tab is a page of Studio's …"; review-room-explain-ui "v1 is shown in a
    frame with sandbox=allow-scripts only …", "the page cannot fetch …", "the output cannot carry anything out by navigating its
    frame …", "in the new tab the page is still an opaque origin …".
21. The page's line, the version menu, full screen and a tab of its own; a version another skill made never changes the
    selected skill; a paired phone reads only. — review-room-explain-ui "one line over the output …", "Enter opens the menu …",
    "Full screen: the output's layer is the screen …", "F on the stage; refused, the output fills the window instead …",
    "showing a version another skill made never changes the room's selected skill …", "a paired phone reads only …", "at 390
    the picker is not shown …".
22. The skill's own scripts run in the sandbox with network through the proxy, the captain's exported keys only, writes only to
    the output folder, under their caps, each call recorded and shown; a changed script asks again; text only stays text; an
    undecided version is decided in the confirmation, its prepare awaited. — review-room-explain-scripts (each rule);
    review-room-explain-ui "the scripts are rows of their own …", "an undecided version: the scripts and network rows say they
    depend on the decision below", "390 px: both decision options are visible".
23. The right-hand pane: wider by default, a keyboard splitter within bounds, its width kept per view, no sideways scroll. —
    review-room-pane-ui (each rule).
24. Saved to the Library: the room's pages, each file verified, a version per save, no total when a cost is unknown, an ended
    room saved once; the Library refuses writes but deletion; a saved room's route reads only. — review-room "Save to Library:
    the room's pages …", "each version's files are kept as they were …", "a version whose cost is unknown …", "a page file
    changed since it was made fails the save …"; review-room-anywhere "a merged pull request's room is saved to the Library …";
    review-room-directory "a directory's room is saved to the Library …"; review-room-ui "a saved room's route reads only …".
25. Old rooms: their whiteboard stays on disk untouched, its cost still counts, the page says so in one line and offers the
    record as a file on this Mac only; no board, board code or board route is left. — review-room "an old room: the view says
    only how many finished turns …", "the old whiteboard's cost still counts …", "its record exports exactly as kept …",
    "opening the room changes none of the old fields on disk …", "the board's calls … are gone"; review-room-ui "the merge
    card's room with an old lesson: one line …", "the board's code, styles and handwriting fonts are not loaded …", "no
    whiteboard route is left …", "no voice route is left …"; review-room-explain-ui "a room with an old whiteboard …", "a
    paired phone reads the room but its whole record is refused …".
26. The chat keeps the captain's place across polls and redraws: scrolled up it does not move (a new answer shows "New
    messages"), at the end it stays at the end; the version menu's list and a phone's room keep theirs. —
    review-room-chat-scroll-ui (each rule).
27. Every page version downloads, in the room and from a Library save: its bytes as kept and checked (a changed or missing file
    refused, `integrity`), one file or a zip, an attachment with a safe name, never cached; the frame keeps allow-scripts only; a
    write 405, nothing there 404, a paired phone 403 `desktopOnly` and no Download. — review-room-download (each rule);
    review-room-download-ui (each rule).

Tests: `tests/review-baton.ts`; `tests/review-room.ts` (a real code-firstmate Task to its merge card, a scripted stub provider);
`tests/review-room-admission.ts` (a staffed Task: the seat's receipt and native admission, the adaptive tutor on one vendor, two
vendors and one model, a member that is not usable, verification before the run, the tutor picker);
`tests/review-room-anywhere.ts` (two real code-firstmate Tasks, one tainted; the GitHub simulator with a bare repository, a
host Task, a scripted skill); `tests/review-room-directory.ts` (a local bare repository standing in for GitHub);
`tests/review-room-zones.ts`; `tests/review-room-explain.ts`; `tests/review-room-explain-scripts.ts` (a made-up skill package's
real scripts in the real sandbox); `tests/review-room-download.ts` (a room seeded on disk, `tests/lib/review-room-download-fixture.mjs`,
in a real isolated Studio); and on the page, in a real isolated Studio and Chromium, `tests/review-room-ui.mjs`,
`tests/review-room-zones-ui.mjs`, `tests/review-room-explain-ui.mjs` (1440, 900 and 390 wide, light and dark, English and
繁體中文) `tests/review-room-pane-ui.mjs`, `tests/review-room-chat-scroll-ui.mjs` and `tests/review-room-download-ui.mjs`. `tests/route-names.ts` keeps route names apart.

Not in this unit: Firstmate offering to open a room from its chat; background polling of a pull request.
