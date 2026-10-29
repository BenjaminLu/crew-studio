# Unit review-room: learn a pull request before you merge it

What: every merge card carries the same prominent "Open review room" (開啟審查室) entry. The room (`#/room/<merge card>`; `#/review/<artifact>/<n>` is the Library's artifact review,
`public/review-room.js`) works like an interactive whiteboard tutor:

- **A room is the whole screen** (focus mode, `body[data-focus="room"]` on `#/room/<id>`, app.js `pageFocus`, shared with the terminal page): the sidebar folds to its 64px rail and
  Firstmate closes; the header's Firstmate button opens it as a sheet over the room, never a column beside the board.
  Neither is saved as the captain's preference (`crew.side`, `crew.chatOpen` stay as they were; a fold the captain makes on
  purpose with the sidebar's own toggle is saved and wins), the onboarding journey and the chat button step aside, and
  leaving the room gives the sidebar and Firstmate back as they were.
- **One viewport tall**: the header (back, the subject, its state as pills: the pull request on GitHub, new commits, the
  change's line counts, the tutor and its independence), the board, the caption, the play bar and the dock are fixed rows;
  only the board flexes and nothing in the room grows the page. At 1440×900 the page never scrolls and the picture stays
  fully in view at every point.
- **The board is the stage.** Each tutor answer is one or more **scenes**: a handwritten title, a picture on the left that
  scales to its box (no sideways scroll), and the tutor's points beside it, revealed one at a time with the current point
  as the **caption** under the board. At most four points show at once: the next ones are the next page, reached like
  any other point, and a point shows at most three lines. A point that cites a board item (`[board:B1-2]`) brings that
  item into view, so a diagram builds up as the points reach its steps. The play bar: the previous point, a dot per scene
  (the current one opened into its points), the next point, play / pause (from where it stands, or from the start when the
  scene is whole), replay, the scene (« ») and the voice. The keyboard: ← → a point back or forward (past a scene's last
  point is the next scene), Space play / pause, Escape closes what is open over the room. A scene that arrives while the
  page is open plays itself; scenes already there show whole.
- **Paper, handwriting, motion.** The board is dotted paper (light `#fffcf4` with ink `#1f2a44` and a marker `#1d3f72`;
  dark `#1b1f27`, ink `#ece6d6`, marker `#9cc0ff`; the room's tokens are `--rr-*` in `public/review-room.css`, the inference
  badge at 4.5:1 or more in both themes). Titles and picture labels are handwritten in LXGW WenKai TC (first in a Chinese
  room) and Caveat (first in English), both SIL OFL 1.1, served by Studio from `public/fonts/hand/` as woff2 slices by
  unicode-range (`public/fonts/hand.css`; nothing from Google Fonts); the points stay in the UI font. Only what is new moves,
  once per viewer: a diagram's new nodes are drawn by the pen (stroke-dashoffset, 450ms), its new edges (350ms, then the
  arrowhead 120ms), 180ms apart, their labels written in (clip-path, 400ms); a scene's title gets a highlighter (450ms); a
  chart's bars grow (600ms); a check's mark is drawn (250ms); a new point slides in. A step of a diagram draws only the part
  it adds, a redraw draws nothing again, and with reduced motion the final picture shows at once. One beat a point: the
  picture's step, the point and the caption move together; a point stays max(2.6 s, 170 ms a character), or as long as
  the voice reads it. Studio lays a flowchart out left to right or top down, whichever reads larger in the box. The caption
  is a paper strip.
- **On a phone** (390×844): the room is still one screen. The picture is on top (Studio lays a flowchart out top down,
  with a larger font when it has to scale the picture down, so its labels read at 14px or more), one point card under it
  (the current point; the caption is merged into it), the play bar, and in place of the prompt a read-only note: a phone
  cannot start a paid turn (the server refuses it anyway). The header keeps back, the subject, the pull request's state
  and Firstmate.
- **The welcome scene** (scene 1, Studio's own, free): "This room is only about <the pull request or branch>", the change's
  line counts by file as a chart, three points (the size of the change and where most of it is, its state: a reviewer's
  verdict, Studio's review or checks, and how to start), and "Teach me this change" (教我這個 PR), a paid turn that asks to
  confirm first like any other. The opening illustration, when there is one, is a picture of this scene.
- **Never "no picture".** An answer that drew no picture gets one from Studio, free: the line counts of the files it cites
  (git's numbers, `view().diffstat`: `git diff --numstat` base to head, cached per head; a pull request Studio has no
  commits of yet: GitHub's file list), else a key card (the scene's title and the files it is about as sticky notes).
- **Visuals Studio draws at once** from what the tutor emits: a flowchart built up step by step (one `group`, steps 1, 2,
  3, the part each step adds marked new; Studio draws mermaid's `flowchart` subset itself, no library, text only through
  text nodes, any other diagram kind as its source), a `diff` item (a changed file's real hunks), a `code` item (real head
  lines, highlighted lines marked), a `compare` item (the same range at the base and the head), a chart from real numbers
  (`chart_draw`: git's line counts per file, or numbers the tutor cites; uncited numbers read as an inference), the app's
  **screenshots** at the base and the head with a before / after toggle (`screenshots_show`: the Task's own captures of
  this head, shot by Studio's sandboxed renderer from the app's fixture build), and a `note`. The tutor names paths and
  lines; Studio fills every excerpt from the commits, so no excerpt is text the model wrote.
- **Generated illustrations** (`illustrate`, at most two a turn; **off unless the captain turns generated pictures on with
  a confirmed paid round**: the tick box on the round's confirmation names every picture it may make and is sent only with
  the confirmed round (`images` on the turn; `POST …/images {on}` also sets it, but nothing is paid until a confirmed round).
  While off the tutor has no `illustrate` tool, its prompt says so, and `illustrate` itself refuses the moment the captain
  turns pictures off mid-turn): a whiteboard-marker sketch from Studio's image job (the
  same one image steps use, `generateImage`), made in the background (a minute or two) with a placeholder until ready,
  stored in the room's folder, labelled "illustration · generated" and "Not evidence". A citation of an illustration never
  grounds a claim. The image model gets no words of the tutor's: the tutor picks 1 to 6 concepts from a fixed list
  (`ILLUSTRATION_CONCEPTS`) and a layout, and Studio builds the prompt from them. The first confirmed paid round with pictures on
  makes one opening illustration in the background the same way (opening the room never pays for one), from the listed concepts the spec's intent
  names; it is labelled on the page as a paid generated image made once. It is made once per merge card: the room
  records that it started before anything is paid, so a reload, another device or a restart does not make it again. An
  illustration still pending when Studio stopped reads as interrupted after the restart.
- Every picture is labelled with its kind; a click enlarges it. A scene's answer lists its pictures as chips to switch to.
- **The dock** under the stage is one line: How, Why, Teach me, Before merging, Check me, a question field, Hold to talk,
  Ask and the transcript. The paid round's confirmation, a voice question heard and an error open above it, over the
  board, never pushing it; a turn being sent shows in the dock. The **transcript** is a drawer over the room, closed by
  default: each question with its scene's title (a click shows the scene and closes the drawer, nothing scrolls), the
  tutor's full answer, the understanding check and the sources. A citation's basis opens over the room too.
- **Short on the board, long in the transcript.** The tutor builds an answer as scenes with `scene_show` {title, picture,
  points: [{text, cites}]}: a title of at most 20 CJK characters or 48 Latin ones, a picture (a board item it drew), 2 to 4
  points of at most 60 CJK characters or 120 Latin ones each (citations not counted; a CJK character weighs as many Latin
  ones as the two limits trade it for, `SCENE_LIMITS`, `boardLength`), at most twelve scenes a turn. Over a limit the tool
  refuses the scene and says which part, so the tutor rewrites; the longer explanation is its final answer, which the
  transcript shows. An older answer (no scenes) is split on the page, sentence by sentence, into points of at most 120 (a
  CJK character counting two), each citation staying with its sentence; its markdown tables become a `table` picture and
  its code a picture labelled as the tutor's own code, shown with the point after them. A `table` board item (`rows`, the
  header first, 2 to 8 rows of at most 5 cells of at most 60 characters) is drawn by Studio as text; a markdown table in an
  answer is a `table` block, not a claim.
- **Labels in the captain's language**: a scene's title is the tutor's (or its heading), else the question itself, never
  "Question: …" beside the same question; Studio's own titles ("This change at a glance", "What changed since you last
  looked", …) and every picture's kind read in Chinese in a Chinese room; an inference shows one badge (its `[inference]`
  tag is not shown again).
- **The explanation's language, switched live** (the header's EN / 繁 / 简). A room explains in the language of its answers
  until the captain switches: the titles, points, captions and the transcript change at once when that language is kept;
  简体 is always the 繁體 text through OpenCC, nothing paid. A language not kept yet is made by a **translation turn** on the
  room's own tutor (`POST /api/review-room/<card>/translate {lang, confirm}`, `lang` en or zh-TW; the desktop captain, the
  same admission as a turn: the round sandbox, the pinned skills, the staffing receipt): text only, no tool and no code read;
  the citations, board items and pictures stay the original's. It is a small paid round, so it asks once per room
  ("Translate this room's explanation (~US$x)", a fifth of the room's mean turn cost); after that, translating the room's
  new answers runs without asking again. Each translation is checked like the original (`translationErrors`: the same
  scenes, points and blocks, every citation kept, a scene within the board's limits); one that fails is not kept and the
  original shows. Translations are kept per turn and language in the room (`translations`), so switching back costs
  nothing; a `review-room-translate` ledger entry records each one (the turns kept and dropped, the job, the cost).
  Studio's own scenes (the welcome scene, what reviewers asked, what changed) switch for free from Studio's own strings
  (their Chinese lines are kept beside the English, `zh`); a reviewer's quoted words are never translated. The voice follows
  the language shown: this Mac's voice in that language, or the vendor's narration of the translated text.
- **Regenerate with another tutor** ("Regenerate with…" / 換一位導師重講, on any finished tutor scene): the models this
  machine can run, from the facts adaptive staffing uses (`usableModels`: codex, claude, cursor, …), each with how independent
  it is from the change's author (another vendor; "same vendor as the author"; the author's own model; "unknown" when the
  author is outside Studio, a pull request no Task made, and never claimed as another vendor), the current tutor
  marked. A held model (out of quota, its quota unreadable, its verification being retried) is listed with the reason and
  cannot be picked; the author's own model only when nothing else can run, as for the room's own tutor. A pick is a paid
  turn on that model (`POST …/turn {regenerate: n, pick: {provider, model}, confirm}`; a pick is refused on anything but a
  regeneration, `bad_pick`): its own offer and confirmation hash,
  then the same admission as any turn (the staffing receipt names the picked member, `adaptive`), and the same question
  asked again. Both answers are kept: the scene shows the latest with a switcher naming each model ("codex gpt-x · claude
  y"). The turn records `regenOf` and `picked`; its `review-room-turn` ledger entry carries `regenerate: {of, provider,
  model, by: "captain"}`.
- **Saved to the Library, replayed read-only.** When the room ends (its merge card answered, its pull request merged or
  closed on GitHub) Studio saves it, and the captain can save it any time ("Save to Library" / 存到成品庫,
  `POST /api/review-room/<card>/save`, the desktop captain). It is one Library artifact per room (`room-<room id>`, source
  `room`, type `doc`, under the room's project, so it follows that project's place in the Library), a new version per save,
  the history kept. Studio saves a room on its own only once, at the moment it finishes: the card's answer (the engine tells
  the room) or a read that finds an open pull request merged or closed records `finished` on the room; listing cards or
  opening a room never saves, so a room that finished before this version is never saved by itself, and a failed save is
  recorded (`finished.error`) and not retried (the captain's button still saves). A room that finishes while a turn or a
  translation still runs is saved when that ends, never with a half-finished scene; a save already in flight is followed, not
  dropped. Every save runs after the one before it, whatever its room, so two saves never share a version number. A version is `room.json` and its
  `assets/`: the room's view with its scenes in every language made, the board, its pictures (the illustrations, the app's
  screenshots and cached narration copied in), every citation resolved to the text it pointed at (diff hunks, ledger
  entries, commits, sources, reviewers' notes), the check with the captain's answers and results, the transcript, the cost,
  (never a refused text: an illustration prompt the privacy filter refused is left out, a refused or failed web source keeps
  only that it was refused, in Studio's own fixed words, never its query, its address or the proxy's message),
  the subject (repository, pull request or branch, head and base), the tutors and the date. It reads without Studio's cache,
  the worktree or GitHub (`GET /api/review-room/library/<artifact>?v=<n>`, its files under `…/<n>/asset/<name>`). The
  Library's page of a saved room offers "Replay in the review room" for each version (`#/room/lib:<artifact>@<n>`), never
  review, notes, approval or compare, and the Library refuses any write to it (`room-snapshot-read-only`) except its
  deletion (`DELETE /api/artifacts/room-<id>`, the desktop captain: the artifact and all its versions; the room then no
  longer links it, and a later save makes it again from v1). The replay is
  the same room, read-only: no prompt, no paid action (no turn, regeneration, translation or vendor voice); captions, this
  Mac's voice and the language switch over the languages saved with it still work. Nothing is written to GitHub.
- **Voice** (off by default; captions are always on): the tutor vendor's own neural voice when it has one (an OpenAI or
  Codex tutor with an OpenAI key: `POST /api/review-room/<card>/speech`, generated once per scene, cached in the room's
  folder, a ledger entry `review-room-voice`; the narration goes only to the vendor that answered that scene, as the
  scene recorded it, and only while the seat still runs on that vendor; one request per scene at a time; never on an
  answered card), or one of this Mac's on-device voices, the best first (Premium, Enhanced, Siri and neural voices, the
  compact ones last; the captain's own language and region first among equals). A voice the browser would send to a
  server is never offered, nor is any of macOS's novelty voices (Albert, Bad News, Bahh, Bells, Boing, Bubbles, Cellos,
  Good News, Jester, Organ, Superstar, Trinoids, Whisper, Wobble, Zarvox, …). Its robotic legacy voices (MacinTalk's
  Fred, Junior, Ralph, Kathy, …; the Eloquence voices Eddy, Flo, Grandma, …) are left out too, unless this Mac has
  nothing else in the captain's language. Voices are told apart by name: an older macOS gives every voice, the good
  ones too, the same `com.apple.speech.synthesis.voice.` address. A Mac voice picked before it was dropped falls back to
  the best one there is. While a voice plays, the points appear as it reaches them. Leaving the room stops its playback
  and its mic at once, and nothing the room finishes later (its poll, a live update, playback, a turn or a citation it
  sent, the mic) redraws the page the captain moved on to.
- A picture's chip shows its title cut at a word, with an ellipsis, and the whole title on hover.
- **Voice questions**: push to talk, only where the browser recognises speech on this device
  (`SpeechRecognition.available({processLocally: true})`); the transcript fills the question field and is sent only when
  the captain presses Ask. Without on-device recognition the mic stays off and says why.

The **understanding check** is multiple choice: `check_ask` takes 2 to 4 questions, each `{q, options, answer, why, cites}`
(a question at most 80 characters, 2 to 4 different options of at most 40, `answer` the right option's index, `why` at most
120 characters with its citations; `QUIZ_LIMITS`; over a limit the tool says which). The answer, why and its citations stay
in Studio: the page gets the question and its options only (`checkView`) until the captain picks. The check is a scene of
its own, one question a page with big option buttons (playback never runs through it); a pick is
`POST /api/review-room/<card>/check-answer {n, choice}` (the desktop captain, the same gates as a turn; once per
question), and Studio grades it from the tutor's answer, no model and nothing paid: the right option and a wrong pick are
marked by colour and a drawn mark, why is shown with its citation, a `review-room-check` ledger entry records it. A missed
question offers "Re-explain with the board", a normal paid turn (confirmed like any other) that names the question and the
pick. The tutor's prompt lists each question's options, the right one and the captain's pick; `check_grade` grades only an
older free-text question (shown read-only in its scene). Answers are as long as the question needs: to the point, no
filler, not limited to one line.

The merge card shows a summary: questions asked in the room, the check score, sources consulted. Display only: the room
never answers the merge card, never holds or releases it, and never changes merge readiness. The card's stored file, its
options and its evidence are untouched (`cards.view` adds `reviewRoom`).

Why: the captain wants to understand a pull request (how it works, why it is built this way, what to check) before
deciding its merge, without anything leaving Studio.

## Subjects

A room has one subject and keeps one identity across that subject's heads:

- **A merge card** (`#/room/SC-n`), as above. Unchanged.
- **A Task's local branch** (`#/room/R-n`), once Studio's internal review passed at the Task's head (its signed
  `firstmate/review-verdict` pass at that head, or a tainted Task's `tainted-ready` end on the ledger). The Task page shows
  "Open review room" then: on the way to the merge card, and on a tainted Task that ends "ready on branch, not published"
  (its room reads the local branch only; nothing goes to GitHub). Before the review passes the room is refused
  (`not_reviewed`); a branch whose head later moves keeps its room, and a turn needs the review passed at the new head.
- **A pull request on GitHub** (`#/room/PR-<12 hex of the repository>-<n>`), opened by pasting its URL on the Review
  Room's home (`#/room`) or a connected project's page (`POST /api/review-room/open-pr {url}`, the desktop captain only).
  Only `https://github.com/<owner>/<repo>/pull/<n>` (no other host, scheme, path, query or fragment), and only a repository
  that a registered, enabled project is connected to (its grant's repository; the grant is verified as for any GitHub use):
  anything else is refused with the reason (`bad_url`, `not_connected`) before GitHub is read. Studio reads the pull
  request with GET only, through the project's own adapter (`remoteRead`: the pull request, its reviews, review comments,
  issue comments and files, at most three pages of 100 each), and fetches `refs/pull/<n>/head` (a fork's head too) and the
  base branch into a bare repository Studio owns, `data/review-room/cache/<hash>.git` (`GitHubPrAdapter.fetchPull`: the
  grant's credential path, no hooks and no templates, a time limit, no gc, full history for merge base, log and blame, one
  fetch at a time per cache). Its size on disk is capped (`CREW_REVIEW_PR_CACHE_MB`, default 1024): watched while the fetch
  runs (an asynchronous scan of the pack folder; the fetch always keeps a pack, `fetch.unpackLimit=1`, so nothing it receives escapes the scan as loose objects; over the cap it is stopped) and checked after it, success or not; a stopped fetch leaves no temporary pack. Over the
  cap the read is refused and the cache removed, unless a turn of a room of that repository is reading it. An empty cache
  is first seeded from the project's own clone: its `origin/<base>`, else `<base>`, else the grant's base branch, fetched
  into `refs/crew/seed/base` (`seedPull`; the local file protocol is allowed for that one fetch only, the clone is only
  read, the seed counts toward the cap, a failure falls back to fetching everything), so GitHub sends only what the clone
  lacks and a large repository's history no longer outruns the time limit. The project's checkout is never written, no
  worktree, nothing pushed. The room's base is the merge base of the head and
  the base branch. When the commits cannot be fetched (the cap, the network, a head that moved during the read), what
  GitHub showed (state, text, files, reviews, comments) is still kept and the room is marked stale: it reads the last head
  it has, and takes no paid turn until a check fetches the new one. Every text GitHub returns (title, body, branch names,
  file paths, reviews, comments, commit messages) is untrusted: cleaned like issue text (`cleanText`) with every angle
  bracket turned into a glyph (‹ ›), so nothing in it can open or close a fence, and fenced in the tutor's prompt in fences
  named afresh each turn (`<untrusted-pr-text-<nonce>>`, `<untrusted-review-comments-<nonce>>`), data, never instructions.

A branch's or a pull request's turns run on the reviewer seat of the Task that made it (a pull request: the newest Task
whose recorded pull request is that URL): `tutorPick` on the Task's review node, admitted like the merge card's (native
selection as the reviewer, the staffing receipt for the tutor seat, one of the Task's jobs). The node is held through an
**auxiliary owner** (`engine.auxOwner`): `owns()` accepts it while the Task is kept (also once it ended) and the node's record
and visit are unchanged; it never starts or finishes a step, edge, card or check, and the job queue admits its job on a
Task that ended.

A pull request no Studio Task made (a contributor's, a fork's) takes turns too, on the **project's approved crew reviewer**:
the reviewer role of the project's approved staffing of a code workflow (a Studio team that covers code-firstmate derives it
first). The room offers that member; the captain's confirmed first paid turn (the same confirmation hash) makes a **host
Task** once for that pull request, from the source-owned `review-room-host` workflow (`workflows/v2/review-room-host.wf.yaml`,
internal, one hook node and no edges: it runs no agent and writes nothing). The host is bound at start to the project's crew
(a signed `staffing-start`, refused before it starts when the project has none), and its turns are admitted exactly like the
other rooms': an auxiliary owner of its node, the native selection as the reviewer, the staffing receipt for the tutor seat
naming the crew reviewer, the round record and the ledger on the host. Later turns, and the "what changed" scene, use the same
host. A project with no approved crew is refused with "Approve this project's crew first" (`no_crew`) and no host is made.
The offer is read only: it reads the project's approved staffing, else what the Studio team would give the reviewer
(`teamReviewerPreview`, nothing written); the team's staffing version is written only when the captain's confirmed turn makes
the host, which is started as that captain (`by`). The host Task's page links back to the pull request's room.

**What reviewers did.** Reading a pull request gives the room one short Studio card per head (free, no model): how many
reviews, inline comments and comments, from how many people (bots' plain comments counted apart, an AI reviewer's account
counted as a reviewer), each reviewer's latest verdict and whether it is on this head, how many notes are on the current head
and how many inline comments are outdated. Nobody's words are on the board: the notes themselves are in the transcript,
newest first, folded until the captain opens them (each a gist with its original folded, cited `[review:<id>]`; a citation
opens the note). Re-reading GitHub, re-opening the pull request or re-entering the room updates that card in place and never
adds a scene; an older room's repeated dumps become one card per head (the rest kept, hidden). **The digest is the tutor's**:
its prompt carries the notes newest first, at most 40, a repeated note once, outdated inline comments marked, fenced as
untrusted, and asks it, when the captain asks to be taught the change or presses **Digest reviews** (a quick action of a
room with notes, a paid turn confirmed like any other), to show a "What reviewers raised" scene with scene_show: the concerns
still open and the ones resolved, each point cited to the notes. Nothing is paid without the captain's confirmation.
The "what changed since last time" scene names a reviewer's inline comment whose lines changed, not its words.

**Coming back.** Every room is listed on the Review room's home (`#/room`, `GET /api/review-room`: open rooms first, then
the most recent; a link back into each), which the sidebar's own **Review room** item opens (on the rail too when it is
folded). The room's header shows where you are ("Review room › the room", the first a link to the list). The browser's back
walks Studio's own pages (each is a route). Studio runs in an app window without a back button, so a link that leaves
Studio (GitHub, a cited page, anything not Studio's origin) always opens in a new window (`target=_blank`, `noopener`): the
links Studio draws say so, and a document-level handler opens any other external link the same way, never in place.

**Answers stay in view.** Coming back while a turn runs, the stage shows that turn: the scenes it already made and what it
has said so far and how many tools it used (`progress`, read back from its round record, so it survives a reload, and a
restart shows what an interrupted turn had said). When it finishes the stage moves to its answer, unless the captain moved
elsewhere meanwhile: then "The answer is ready — show it" waits on the board. Asking a quick action again on a head that
already has its finished answer (or the same question) first offers "Show the existing explanation" or "Explain again
(paid)", the latter confirmed as usual. Every finished answer is a scene of its own, reachable from the transcript (its
button shows how many answers the room holds).

**A lesson, chapter by chapter: a report.** Asked to teach the change, the tutor builds a lesson laid out the way baton
lays out a packet (baton, MIT, credited in THIRD_PARTY_NOTICES.md; its rules, drawings and shapes adapted in `workflows/skills/baton/`,
pinned in `ROOM_SKILLS`, credited in its NOTICE.md and THIRD_PARTY_NOTICES.md). Its chapters, shown in this order whatever order the tutor makes them in: what this is;
what talks to what (an `arch` drawing: components by kind, the new or changed ones marked on the node, connections each
citing what shows them; inferred unless a design document or the record is cited); the decisions (one `decision` drawing
each: the question, the option taken and why, a rejected option only with a commit, review note or source showing it); the
change itself (one `item` drawing per changed item, one layout for every item); its life, state by state (one `states`
drawing: every state and transition, each numbered, citing its code and saying what it writes); one request, in order
(one `sequence` drawing, its loops, alternatives and options as frames); what reviewers raised; roads not taken (only as
commits, the pull request or review threads show them, cited); what to watch (risks only, each cited and verified); open
questions. Studio enforces the shape: `what` and `change` (at least one item) are always there; `talks`, `lifecycle` and
`sequence` are there unless the tutor leaves one out with `chapter_skip` and a verified reason (the report shows that line
where the drawing would be; a skip counts toward the turn's scenes); chapters come in any order, so a chapter missed earlier
can still be added; one drawing a chapter except the change and the decisions; the drawing chapters show their own kind; a risk, a road not taken and a rejected option need a verified
citation of their kind. `lesson_check` tells the tutor what is still missing, and a lesson that ends missing a chapter it
owes is refused: the turn fails, saying which (the paid round is still recorded). Other answers (a question, how, why,
a quiz, the merge check) are scenes on the board and may name a chapter in any order, or none.

A finished lesson reads as a **report** in the room (the default for teach): a header (the subject, the room's title), then
one section a scene, numbered, its chapter and title, its points as prose (what this is) or as findings with a tone stripe
(reviewers, roads, risks, questions) and Studio's drawing in a figure card under them, its kind and basis beneath it. Every
drawing is laid out by Studio from the tutor's data (text nodes only, sizes checked; no image model): an architecture as a
layered flowchart sized for its labels, edges leaving and entering a box spread along its side, every label placed clear of
boxes, lines and other labels (and masked by the paper), a cycle's way back bowed under the boxes, a second transition the
same way bowed apart, a state's way back to itself a loop beside it; a decision as the question over the
option taken and the ones turned down, dashed, each listed under it with the record that shows it (its citation is the
decision's own, so the Library resolves it); the state map with every transition numbered, a row per transition that
opens its code and shows what it writes. The report scrolls inside the room (the page never does), a strip under the
chapters on a phone. The chapters rail lists every answer's scenes; a chapter of several items (the change, the
decisions) is one heading with its items under it; a click scrolls the report to it, and the section in view is marked.
"Step through on the board" shows the lesson scene by scene on the stage, "Read as a report" goes back. A translation
covers the report's text and its drawings' words (`figures`, per board item in a fixed order, kept only when every word
came back as short as the drawing holds: the drawing's title, its labels, an item's name and mechanism; 简体 from 繁體 through OpenCC). The report replays from the Library snapshot, offline.

**Figures, drawn as diagram-design draws them.** A lesson's figures follow diagram-design (MIT, credited in
THIRD_PARTY_NOTICES.md; adapted in `workflows/skills/diagram-design/`, pinned in `ROOM_SKILLS`), as baton's do: a semantic
pattern first, the type's reference, orthogonal connectors with rounded corners, each on its own attach point, labels off
their lines, the 4px grid, the budgets, and colour by meaning from one palette (`--fig-accent` this change, `--fig-ok` new or
ended well, `--fig-amber` needs attention or a way back, `--fig-seal` cannot be undone, `--fig-muted`/`--fig-soft` context),
which the room maps to its light and dark themes. Two ways in. The tutor draws a figure itself with `figure_svg` (kinds
state, sequence, architecture, flow, decision, item): Studio parses the SVG into a tree of allowed elements and attributes
(`src/domain/figure-svg.ts`: svg g rect path line polyline polygon circle ellipse text tspan marker defs title desc; no
script, style, foreignObject, image, use, link, href, class, filter, on* handler or outside url(); colours only the
palette's tokens; at most 80 000 characters, 900 elements, 2400 × 2400) and runs a geometric gate: no label on another, no
label on a line, no connector through a box that is not one of its ends, no label outside the viewBox, no Chinese under
12px, every label with `data-en`, `data-hant` and `data-hans`. A figure that fails is refused with each problem, and the
tutor redraws (at most eight tries a turn). The page rebuilds the tree element by element (createElementNS, setAttribute,
textContent; never markup, from the client's own allowlist too, so a tampered room file adds nothing), its ids kept to the
figure, each text in the room's language (a label of several lines keeps its tspans, each line in the room's language). The
gate is bounded: every coordinate within the viewBox (plus 40), at most 40 000 sample points a figure, the label-on-line scan
only where boxes meet; it measures what the page draws (each tspan at its own x/y/dy; a path is a connector unless it is a
closed filled shape). A `data-cite` is checked like any citation: kept and added to the figure's cites when it resolves,
dropped when it does not. Or the tutor gives the structure
and Studio lays it out, baton's way. A lifecycle puts the way it should go on one row, left to right (the longest path from
where it starts to an end that went well); its ways back and its skips over a state are arcs above the row, nested by span
(the shorter inside); the states that end badly or need attention sit in the lane below, the others in the lane above,
each under the median of the states it meets, in the order that crosses fewest connectors; the state this change adds or
changes (`mark`) in the accent, the ends coloured by how they end. The architecture runs in
layers left to right, the stores and queues last, drawn as cylinders. Every connector is a straight line or one smooth
curve, bowed only as far as it must to clear the boxes, or under them, crossing as few others as it can and never along one (two between the same boxes bow
apart, a state's way back to itself a small loop); its numbered chip sits on it near its middle, and a picked chip opens the
transaction panel right under the map. The sequence is one event a band, each fragment's tab on its own band, calls,
returns and async calls in their own colours.

**A database lifecycle per entity; every call.** A lifecycle is owed only for a real state write: UPDATE … SET status/state,
INSERT INTO … (status), an ORM write with a status/state key, setState / setStatus / transition(), or an entity's status
assigned; never a comparison, an HTTP response's status, a local named state or an object literal. A lifecycle names its entity and gives each transition its database
transaction (`tx`: the tables written, INSERT, UPDATE, DELETE or UPSERT, each field was → now, the guard, and what is written
outside the transaction). The report's statemap numbers every transition; picking a state shows the transaction that brings
the entity into it, picking a transition shows its own, the writes outside set apart dashed. A lesson shows one lifecycle for
each entity (the chapter takes several), each transition cited; when the diff writes a state or status column the
lifecycle is owed (chapter_skip refuses it, lesson_check names the lines). A `calls` item shows every API call: request,
response, the errors a client sees, the transaction it runs.

**A pasted pull request teaches itself.** When the captain pastes a pull request (`POST …/open-pr`) and its room has no
lesson for the current head (none done or running), the lesson starts by itself: the paste is the consent, so there is no
click and no confirmation. So the paste box says what a paste starts before it is pasted (`GET …/paste-offer?url=`: auto-teach
on or off, and the tutor, model and paid round the room's offer would name), and the lesson says it started on paste, with
the tutor it ran on and the room's switch beside it. It is an ordinary paid turn on the room's tutor, marked `auto` on the
ledger; it keeps the room's own pictures setting (a new room's is off). It starts once per head: the head is recorded before anything starts, so a reload, a revisit or a second
paste starts nothing. The Studio-wide setting (`GET/POST /api/review-room/settings {autoTeach}`, on the room list's page,
default on) and the room's own switch (`POST …/auto {on}`, in its drawer) turn it off. When it cannot start (no tutor can
run, admission refuses) nothing runs, the reason is kept and the welcome scene shows it above the ordinary teach button;
a Library snapshot never carries that notice. Starting the room over keeps its switch and the heads it already taught by
itself, so pasting the same head again after a reset starts nothing.
Merge-card rooms and Task rooms never start by themselves; only a pasted pull request does.

**Start this room over / 清空重來.** In the transcript drawer, the captain on this Mac can start a room over (`POST
…/reset`, the same session, origin and desktop gates as the room's other writes; refused with 409 while a turn or a
translation runs). It asks first, saying what goes (the answers, the board, the translations, the generated pictures) and
what stays (the Library's snapshots, the Task's ledger). Studio moves the room's file and its pictures' folder into
`.archive/<room>-<time>/` beside it (never deleted), drops every copy it keeps in memory and bumps the room's generation,
so a background job still holding the old room (a picture being drawn, a voice, a Library save) writes nothing back; the
next view is a fresh room (a pull request's at once, from the pull request as Studio last read it, its Library link kept).
A `review-room-reset` ledger entry records who and when, with no content; a pull request room with no Task behind it
(no paid turn yet, so no ledger to write to) records the same fields in its archive's `reset.json`. A Task's room keeps its
archive in the Task's own folder, so the archive goes if the Task is deleted (the confirmation says so). A translation
admitted while the room is started over is refused and releases its seat. The page forgets what it kept for the room and
opens it on its welcome scene.

**Following the head.** The room keeps the head the captain last looked at (`seen`) and every head it saw (`heads`). On
re-entry (the desktop page, at most once a minute from the last attempt) or "Check for new commits" (`POST …/check`, the
desktop captain only, at most once every five seconds a room) Studio reads the pull request again; a branch's head is read
from its Task. No background loop. A paid turn on a pull request read more than five minutes ago reads it again first: merged
or closed since, the turn is refused. When the head moved, the room says "N new
commits since you last looked" (or that the branch was rewritten), and the next turn's first scene is Studio's **what
changed since last time**: the diff old head..new head on the board, the new commits (their messages as text), the files,
and for each inline reviewer comment whether the lines it points at changed since (the captain judges whether that answers
it). The tutor's prompt carries that diff and starts from it. A room with no host yet (before its first paid turn) makes that scene at the check itself.
Studio's scenes cost nothing: no model, git and GitHub's answer only.

**Approved, merged, closed.** The room shows the pull request's state as GitHub does: open, draft, each reviewer's latest
verdict and at which head (approved counts only at the current head and with no changes requested), merged or closed. A
merged or closed pull request's room stays readable (its scenes, board and citations) and takes no turn. An open pull
request whose commits Studio has not fetched yet takes no turn either; the room says so with the reason (never that it is
closed), and "Check for new commits" tries again, unless the repository is over the cache's cap.

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
- Not Firstmate, not the worker, not the reviewer. It is the **tutor seat**, and it adapts to what this machine has
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
  The offer carries the level (`independence: {level: vendor | model | same, adaptive, outside, en, zh}`), the room shows
  it as "Tutor: … — Different vendor from the author" (or "Same vendor as the author, different model", or the same-model
  text, with why, and "Not in this project's crew" when it is not), and each turn records it: on the turn, its
  `review-room-turn` ledger entry and the room's stats (`review-room-stats.json`, with the tutor's provider and model).
- **Verified by Studio.** Before the paid turn, Studio reads what this machine has again (the offer may change: a changed
  offer is answered with the current one) and verifies the chosen member itself when it is signed in but not verified yet
  (`engine.deps.ensurePick`: one bounded request per model, kept for its window), recorded on the Task's ledger
  (`staffing-auto-verify`). One that is not signed in, out of quota or not offered is refused with the reason, before
  anything is paid.
- **Admission, like any role's.** A turn belongs to the merge card's live node: the provider is chosen through the native
  selection on that node as the reviewer (capability verified, certified for that owner), and staffing issues a receipt
  for the tutor seat. Staffing knows the seat (`engine.deps.auxiliarySeats`: the seat, the role whose approved member it
  runs on, the sha256 of each pinned text, `adaptive: true`) and checks the provider, model and effort against the approved
  reviewer, or, for an adaptive member (`aux.member`), against that member, which must be runnable on this machine now
  (without provider facts only the approved member is admitted; a seat that is not adaptive takes no member), and
  that the instructions are exactly the pinned texts, in order, under the safety and operating rules (nothing added,
  nothing left out, nothing reordered); the receipt records the seat and the hash of its texts
  (`staffing-instructions`, with `seat: review-room-tutor`), and names the member actually used: its provider, model and
  effort, plus `adaptive: {independence, crew, approved}` when it stands in for the approved reviewer. The native selection runs
  on that member (`adaptive: true` keeps it from being replaced by the role's approved pick), and the job's admission
  checks the provider against it. The round is one of the Task's jobs (`ref` is the Task): the
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
  `git_diff`, `git_log` (with pickaxe), `git_show`, `git_blame`, `board_draw`, `scene_show`, `chapter_skip`, `lesson_check`, `screenshots_show`, `chart_draw`, `illustrate` (only with generated pictures on), `check_ask`, `check_grade`, `web_search`,
  `web_fetch`. Nothing reads or writes the worktree's files, index or refs. Nothing goes to GitHub: no comment, review or
  request of any kind.
- Recorded like any round: `data/runs/<task>/nodes/<merge node>/room-<card>-<n>/` (`prompt.md` with the skill pins in its
  header, `system.md`, `stream.jsonl`, `report.json`), and a signed `review-room-turn` ledger entry (action, job, provider,
  model, the confirmation, the skill pins, board, sources and check counts). The room itself is
  `data/runs/<task>/review-room/<card>.json`.

## Grounding

Every explanatory claim, in the chat and on the board, cites its basis: `[diff:path:L10-24]` (a hunk at the head),
`[ledger:#12]` (an entry of the Task's signed ledger), `[commit:abc1234]`, `[source:3]` (a web source of this room) or
`[board:B2-1]` (an excerpt on the board). The answer is the tutor's final message only: what it says before a tool call
or before its final message (a codex tutor's "I'll use the how guidance to…") is progress, never part of the answer, on
every vendor (`src/agent.ts`, the job's `answer`). A tutor that ends after its tools with no final message has no
answer: the turn fails with "the tutor ended without an answer", never a blank scene. Studio splits each answer into blocks and checks every citation (a changed file,
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
2. A turn needs the captain's confirmation of the exact provider and model; a sandbox-off grant refuses it; one turn at a
   time. The tutor keeps the approved reviewer while it can run and differs from the author, else adapts (a crew member,
   then a model outside the crew, labelled), waits for a held vendor, and is never refused for having one model. —
   review-room "a turn without the confirmation …", "the offer labels the tutor's independence …", "without provider
   facts nothing is relaxed …", "a reviewer seat on the author's model moves to a model outside the crew …", "a
   vendor-default member resolves …", "with one model on this machine …", "another vendor signed in but held for now …",
   "the approved reviewer stays the tutor when it can run …", "the turn's independence level is on the ledger …";
   review-room-admission "the approved reviewer on another model … stays the tutor …", "… a member already in the crew is
   preferred …", "otherwise a verified model outside the crew …", "a model in its verification backoff is skipped …";
   review-room "with a sandbox-off grant …", "a confirmed turn starts at once, and a second one waits …"; review-room-ui
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

Tests: `tests/review-web.ts`, `tests/review-room-admission.ts` (a staffed Task: the tutor seat's receipt and native admission, the adaptive tutor on one vendor, two vendors and one model, a member that is not usable, verification before the turn), `tests/review-room.ts` (a real code-firstmate Task to its merge card, a scripted stub
tutor, a stubbed web backend), `tests/review-room-ui.mjs` (1440 en and 390 zh-TW; the room and the Library review each on its own route, `tests/route-names.ts` keeps route names apart; screenshots in `tests/out/review-room`
or `ROOM_SHOTS`). `tests/review-room-anywhere.ts` covers the branch and pull request subjects. `bun run test:review-room` runs all six.

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
    question …", "without on-device recognition the mic stays off …", "a saved voice no longer offered falls back …",
    "once the captain leaves a room, its poll and its playback no longer redraw …", "on an older macOS the good voices are
    offered …", "when this Mac has only legacy voices …", "leaving the room stops its playback and its mic at once", "what
    the room finishes after the captain left …"; the answer is the final message only — review-room "only the tutor's
    final message is the answer …", "text streamed without a closing message counts as one message …", "a tutor that ends
    after a tool call with no final message fails the turn …"; a chip's title — review-room-ui "a long picture title in
    the strip is cut at a word …".

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
21. A pull request no Task made takes turns on the project's crew reviewer: the first confirmed turn makes one host Task bound
    to the crew, whose receipt names the crew reviewer; nothing is written; no crew is a clear refusal. — review-room-anywhere
    "an external pull request's room offers …", "without the confirmation nothing starts …", "the first confirmed turn makes one
    host Task …", "the host is bound to the project's approved crew …", "the moved head opens the next turn …", "no writes
    anywhere …", "with no approved crew for the project …"; review-room-ui "a Task whose branch passed …", "a project connected
    to GitHub offers the pull request box …".
22. Untrusted text cannot leave its fence; the cache is bounded; a stale or old read takes no paid turn; the review gate is per
    head. — review-room-anywhere "a comment is kept as its words …", "the tutor reads the reviewers' words in a fence named
    afresh …", "a malicious file path and a malicious branch name …", "a fetch over the size cap …", "over the cap the cache
    goes …", "the next check fetches the commits again …", "a paid turn on a pull request read a while ago …", "the branch's
    head moved past the reviewed one …", "a ready-on-branch head with no tainted-ready ledger entry …", "an auxiliary owner
    owns its node until it is released"; smoke "even allowed to drive, a phone cannot open a pull request's review room …".
23. A room is one viewport: focus mode folds the sidebar to its rail and closes Firstmate without saving either, opens
    Firstmate as a sheet over the room and gives both back on leaving; at 1440×900 the page never scrolls and the picture
    stays fully in view at every point; at most four points show; ← → and Space drive it; an answer with no picture gets
    Studio's. — review-room-ui "at 1440×900 the page never scrolls …", "in a room the sidebar folds to its 64px rail …",
    "the header's Firstmate opens it as a sheet …", "leaving the room gives the sidebar and Firstmate back …", "a click in
    the transcript jumps to its scene and closes the transcript …", "← goes back a point …", "Space plays and pauses", "an
    answer with no picture shows Studio's key card …", "an answer that cites files but drew nothing …".
24. The board stays short: scene_show refuses a title or point over its limit (a CJK character weighing more), a picture
    not on the board and fewer than two points, saying which; a scene within the limits is kept; a table is a board item of
    text cells; a markdown table in an answer is not a claim; an older answer is split by sentence into short points, its
    table a picture; the full answer is in the transcript; a Chinese room has no English titles or badges; an inference
    shows one badge. — review-room "the board's limits …", "scene_show refuses …", "a scene within the limits is kept …",
    "a table is a board item …", "a markdown table in an answer is not a claim …"; review-room-ui "a scene the tutor
    showed …", "the tutor's full answer is in the transcript …", "an older long answer is split by sentence …", "the table
    is drawn by Studio as text cells", "a Chinese room has no English titles or badges …".
25. The check is multiple choice, graded by Studio: check_ask refuses the old free-text form and anything over its limits;
    the page never gets the answer, why or its citations before the captain picks; a pick is graded once, with no model,
    and recorded; the tutor cannot grade it; its prompt carries the picks. — review-room "the old free-text check is
    refused …", "check_ask refuses a question …", "before the captain answers, the page gets the options …", "Studio
    grades the pick …", "grading runs no model …", "once answered, the page shows …", "the tutor cannot grade a
    multiple-choice question …", "the next turn's prompt carries …"; review-room-ui "the check is a scene of option
    buttons …", "a pick is sent as {n, choice} …", "a missed question offers …", "the re-explanation asks about that
    question …", "the check's answer route is real …".
26. Paper, handwriting and motion: the pen draws only what is new, a step only what it adds, a redraw nothing; reduced
    motion shows the final state; the paper, its caption strip and the dark theme's badge contrast; the handwriting is
    Studio's own woff2 slices; a new room opens on the welcome scene, whose lesson asks to confirm. — review-room-ui "the
    pen draws only what is new …", "the board is paper …", "the handwriting is Studio's own …", "with reduced motion …",
    "dark: the paper is #1b1f27 …", "a new room opens on Studio's welcome scene …", "the welcome scene's lesson still asks
    to confirm …".
27. A phone: the picture on top, one point card under it, a top-down flowchart with labels of 14px or more, the prompt a
    read-only note, nothing scrolls. — review-room-ui "390×844: the picture on top and one point card under it …".
28. The explanation's language switches live: a kept translation at once (简體 through OpenCC), a missing one after one
    confirmation; the translation round has no tool and no code; one that loses a citation or breaks the board's limits is
    not kept; switching back runs nothing; the voice follows the language. — review-room "the room knows which answers are
    not in a language yet", "translating is a small paid round …", "the translation round gets no tool …", "a translation
    that lost a citation is not kept …", "confirmed once, the next translation runs without asking again …", "switching to
    a language already kept runs nothing …"; review-room-ui "a kept translation shows at once …", "a translation is text …",
    "the voice follows the language shown …", "简体 comes from the 繁體 text …", "a language not kept yet asks to confirm …",
    "confirmed, the translation is sent …".
29. Regenerate with another model: the room lists this machine's models with their independence, a held one not
    pickable; a pick asks to confirm its own paid round; the same question runs on that model; both answers are kept, the
    latest shown, with a switcher; the choice is on the turn and the ledger. — review-room "the room lists the models …",
    "a held model cannot be picked …", "the regeneration asks the same question on the picked model …"; review-room-ui "a
    regenerated answer is kept beside the first …", "the switcher shows the first answer again", "“Regenerate with…” lists
    this machine's models …", "picking a model asks to confirm …", "confirmed, the same question is asked again …".
30. Save to Library: a room is saved as one artifact with a version per save (on the captain's button, and when it ends;
    an unchanged ended room not again), its snapshot read-only and complete (citations resolved, pictures copied, every
    language, the check's answers, subject, tutors, cost, date); it opens offline (the worktree, the room's folder or the
    pull request's cache removed), only its own files are served, and the Library refuses writes to it; it replays in the
    room without any paid control. — review-room "Save to Library writes the room …", "the snapshot is read-only …", "every
    citation is resolved …", "its pictures are copied into it …", "when the merge card is answered, the room is saved
    again …", "an unchanged ended room is not saved again", "offline: …", "only a saved room's own id …";
    review-room-anywhere "a merged pull request's room is saved to the Library …"; review-room-ui "a saved room opens from
    the Library in the room itself, read-only …", "a citation opens from the snapshot itself …", "captions and playback
    still work", "the language switch uses the languages saved with it", "the check shows the captain's answers …", "the
    Library shows a saved room with “Replay in the review room” …", "a saved room's route reads only …".
31. Review fixes: a double click answers once; Studio saves a room by itself only when it finishes after this version, once
    (a listing, an older room or a failed save never triggers another); saves run one after another, each its own version;
    a pick only on a regeneration; independence unknown when the author is outside Studio; no refused text in the Library;
    a saved room can be deleted. — review-room-ui "a double click on two options sends one answer …", "a saved room's route
    reads only …"; review-room "two saves at once each get their own version …", "an ended room is saved once …", "a room
    that finished before this version is not saved …", "a failed Library save is recorded …", "a model is picked only to
    explain a finished answer again …", "the Library keeps no refused text …"; review-room-anywhere "a pull request no Task
    made has no author to compare with …".
32. Second review: a room finished while a turn runs is saved when the turn ends, never mid-turn; three saves at once each
    know the one before; a deleted saved room is forgotten and saved again from v1; a refusal reaches the Library only as
    Studio's fixed words. — review-room "answered while a turn still runs …", "once the turn has ended the room is saved …",
    "three saves at once …", "deleted from the Library, the room no longer links it …", "the Library keeps no refused text …".
33. Reviewers digested, ways back, answers kept in view: a busy pull request is one short card per head, updated in place
    (re-reading, re-opening, re-entering add nothing; an older room's dumps become one card); their words only in the
    transcript, folded; the tutor reads the notes newest first, deduped, outdated marked, and is asked for "What reviewers
    raised"; Digest reviews is confirmed; the sidebar's Review room, the room list and the crumb lead back; external links open
    in a new window; a running turn shows on entry with its persisted progress, its answer is shown when it ends (or waits
    behind a chip); an existing answer is offered before paying again. — review-room-anywhere "the reviewers' scene is one
    short card …", "a busy pull request … is one short card, updated in place …", "the card says each reviewer's latest
    verdict …", "“Digest reviews” is a paid turn …", "the tutor reads the notes newest first …", "an older room's reviewers'
    dumps become one card …"; review-room "a running turn's progress is persisted …"; review-room-ui "the sidebar has a Review
    room item …", "the Review room's home lists the rooms …", "the room's header says where you are …", "the browser's back
    walks Studio's own pages …", "a link that leaves Studio opens in a new window …", "the board shows Studio's short card of
    the reviews …", "their notes are in the transcript, folded …", "coming back while a turn runs …", "when it finishes, the
    room shows the answer", "asking again what this head already has …", "the captain looked elsewhere while it ran …",
    "“The answer is ready — show it” goes to the answer".
34. A lesson, chapter by chapter: chapters in their order, per-item before → after figures from one layout, a state machine
    with every transition cited and openable, a sequence with its loop; out-of-order chapters, the wrong drawing and uncited
    risks refused; the chapters rail jumps and marks the current scene; chapters kept in the Library snapshot. — review-room
    "the lesson is chapters in their order …", "Studio holds the chapter shape …", "per-item figures, a state machine …",
    "the lesson's chapters and their figures are kept …"; review-room-ui "the chapters' rail lists every answer's scenes …",
    "a click jumps to its chapter, marked current …", "every changed item is drawn from the same layout …", "the state
    machine draws every transition …", "one request in order …", "the rail sits beside the board …", "on a phone the chapters
    are a strip above the board".
35. A lesson as a report (baton's packet): what, talks and change required, lifecycle and sequence shown or left out with a
    verified reason, one drawing a chapter, roads and rejected options only from the record; a lesson missing a chapter is
    refused; generated pictures off by default; drawings' words translated; the report renders every section kind, its
    state map's transitions open their code, its architecture marks the change, it works on a phone and replays from the
    Library. — review-room-anywhere "a lesson that leaves out the change itself … is refused", "Studio holds the lesson's
    shape …", "generated pictures are off by default …", "a lesson with what, talks and change …", "with pictures turned
    on …"; review-room "generated pictures are off by default: opening the room pays for no picture", "a translation carries
    the drawings' words too …"; review-room-ui "a finished lesson reads as a report …", "the report scrolls inside the room
    …", "a chapter picked in the rail scrolls the report to it …", "a transition opens the code it rests on …", "the
    architecture marks the change …", "each changed item is drawn from the same layout …", "the lesson can still be stepped
    through …", "the report's text and its drawings' words switch language …", "on a phone the report reads …", "a room
    saved in the Library replays its lesson as the same report …".
36. Start this room over: refused while a turn or a translation runs; the file and the pictures' folder archived beside the
    room, never deleted; a picture being drawn and a Library save racing it write nothing back; the next view is fresh (a
    pull request's at once); a review-room-reset ledger entry with no content; POST only, with Studio's session, desktop
    only; the page asks first and cancel changes nothing. — review-room-anywhere "starting a room over is refused while a
    turn or a translation runs …", "starting over moves the room's file and its pictures' folder …", "the next view is a
    fresh room …", "a pull request's room started over is fresh at once …"; review-room-ui "starting a room over is a POST
    only …", "starting a room over asks first …", "confirmed, the room is started over …"; smoke "even allowed to drive, a
    phone cannot … start it over".
37. A pasted pull request teaches itself: no click, no confirmation, marked auto on the ledger, pictures off; once per head;
    never over a finished lesson at that head; the Studio-wide setting and the room's switch turn it off; when it cannot
    start, the room says why. — review-room-anywhere "auto-teach off …", "pasting a pull request starts its lesson by itself
    …", "pasting it again … starts no second lesson", "a head that already has its finished lesson starts nothing …", "the
    room's own switch turned off …", "when the lesson cannot start by itself …".
38. Figures by diagram-design: a figure the tutor draws is taken through the allowlist (script, foreignObject, style,
    links, handlers, outside references dropped; colours only the palette) and the geometric gate (overlapping labels, a
    label on a line, a connector through a box, a label outside, Chinese under 12px, a label without three languages
    refused); Studio's own layouts keep labels clear and connectors out of boxes; a lifecycle per entity with each
    transition's transaction; every call. — review-room-figures (each rule); review-room-anywhere "a figure the tutor draws
    is refused with what is wrong …", "the figure is kept as Studio's tree …", "a lifecycle names its entity …", "a lesson may
    show one lifecycle for each entity …"; review-room-ui "Studio's drawings read …", "the point stands out by colour …",
    "one lifecycle for each entity; picking a state shows …", "every call: …", "a figure the tutor drew is rebuilt …".
`tests/review-room-anywhere.ts` (two real code-firstmate Tasks, one tainted; the GitHub simulator with a bare repository,
a stub host Task, a scripted tutor) is new and fails on the base, where neither subject exists.

Not in this unit: Firstmate offering to open a room from its chat; background polling of a pull request; a per-room model switch (Studio picks the tutor); a server-side vendor web search (the backend is Studio's own, so every query is filtered and logged the
same way for every vendor); rendering fresh screenshots from the room (the room shows the Task's own captures: a new
render makes a git worktree of the base, a repository write the room never does); the vendor's speech-to-text (voice
questions are recognised on this device only); illustrations made when the merge card is created (they start when the
captain first opens the room, so no image is paid for a room nobody opens); a saved room's vendor narration that was never
generated (only narration already cached is copied into the snapshot).
