# Setup and reference

Build and run AI workflows, coordinate parallel agents, review changes, and approve results—all in one local-first workspace.

## Fresh clone: prerequisites and first start

A source checkout needs **Git to clone and Bun to run/build**. The current root
`package.json` declares no npm dependencies or install scripts: **do not run
`npm install` or `bun install` as a prerequisite for basic Studio**. Optional tools
below are separate installs. A compiled Studio binary needs neither Bun nor Node
to serve its basic pages.

### macOS quick start

Install Bun using its [official installation instructions](https://bun.sh/docs/installation):

```sh
curl -fsSL https://bun.com/install | bash
# Open a new terminal, then verify:
bun --version
```

If Git is missing, install Apple's command-line tools with `xcode-select --install`
or, with Homebrew already installed, `brew install git`. Clone the repository
using its Clone URL, then run these commands **from the clone's root**:

```sh
cd crew-studio
bun run start
```

Keep that terminal open. In a second terminal, in the same checkout, open Studio's
authenticated browser session:

```sh
bun src/main.ts open
```

Studio listens on `http://127.0.0.1:4210`. The `open` command establishes the local
session required for writes; merely navigating to the URL is not a replacement.
No firstmate v1 checkout, migrated state, `.env` file or GitHub connection is
required. Do not set `CREW_FM_STATE` unless you explicitly want the legacy adapter.
If port 4210 is already occupied, use the same `CREW_PORT` for **both** commands.

Source runs store data in `./data`; compiled runs default to
`~/.crew-studio/data`. To share a store, set the same absolute `CREW_DATA` on both
server and `open` commands. Run only one server against that store.

### Dependencies by capability

| Capability | Required before use | Installation / setup |
| --- | --- | --- |
| Source web server or build | Bun; Git for clone | Bun command above; `git --version` |
| Compiled binary: pages, native cards, workflows, skills, storage | Binary and supported OS | No npm packages, provider, database or v1 install |
| Coding workflows | Git, selected authenticated provider, supported OS sandbox, Node.js for built-in script checks, Python 3 for wording checks | macOS with Homebrew: `brew install git node python`; configure one provider below |
| Screenshot / browser acceptance | Node.js, npm, Playwright and its Chromium browser | Renderer commands below |
| Film rendering | Screenshot dependencies plus ffmpeg | With Homebrew: `brew install ffmpeg` |
| GitHub integration | Explicit repository permissions and configured token | Configure in Studio; `gh` is optional, installing it grants no repository authority |
| Remote phone access | Pairing; Tailscale for access beyond the local network | Optional; basic local Studio does not need Tailscale |

The currently implemented check sandbox uses macOS `/usr/bin/sandbox-exec`.
Verify it with `test -x /usr/bin/sandbox-exec`. If confinement is unavailable,
checks are refused; a cross-compiled Linux/Windows binary is not proof of coding
sandbox support. Each target project's own dependencies are additional to Studio's.

Choose a provider only if you need model-backed work. Installing a CLI is not
proof that Studio's isolated worker login, model access, quota or tools work:
verify those in Settings / Doctor and a bounded actual task before relying on it.
The current default chat provider is Claude; select Codex explicitly in Studio if
that is the provider you installed. An API provider needs its own configured key.

```sh
# Codex CLI (requires npm; alternatively use brew install --cask codex)
npm install -g @openai/codex
codex login
codex login status

# OR Claude Code (native installer; complete its interactive login)
curl -fsSL https://claude.ai/install.sh | bash
claude
```

See the official [Codex installation guide](https://developers.openai.com/codex/cli),
[Codex authentication guide](https://developers.openai.com/codex/auth) and
[Claude Code quickstart](https://code.claude.com/docs/en/quickstart). Studio's native
coding capability and Firstmate web takeover are separate checks; successful web
attachment alone does not certify native worker execution.

Install the optional renderer into Studio's managed tool directory, not the
source package. These commands require Node.js/npm and network access:

```sh
mkdir -p "$HOME/.crew-studio/tools"
npm install --prefix "$HOME/.crew-studio/tools" playwright@1
"$HOME/.crew-studio/tools/node_modules/.bin/playwright" install chromium
```

This is the directory Doctor discovers. Installing Playwright without Chromium is
insufficient. For UI tests or another explicit install location, set
`PLAYWRIGHT_MODULE` to the absolute path of `playwright/index.mjs`. See
[Playwright's browser installation guide](https://playwright.dev/docs/browsers).

### Hooks and first-run checks

**Basic Studio requires no manual hook installation.** There is no Husky/npm
postinstall step and no need to copy firstmate v1 hooks into a new Studio clone.
Native workflow checks/hooks are shipped application definitions and are loaded
by Studio, rather than installed into your global CLI or `.git/hooks`.

An explicitly attached firstmate project is different: its CLI may load that
project's existing hooks/MCP configuration, subject to the CLI's own trust and
approval controls. Follow that project's setup instructions; Studio does not
establish hook trust or delivery merely because files exist. Do not copy global
settings, disable hooks or use bypass-permission flags to make setup pass.

After opening the authenticated page, visit **Settings → Doctor**. Check basic
web readiness first, then the provider/login, coding sandbox and optional renderer
capabilities you intend to use. Provider installation detection is not a passing
execution test. No installer below is run automatically by cloning or starting
Studio.

## Download → run → open http://127.0.0.1:4210

```sh
./crew-studio                       # the single binary: no Bun, Node, gh or CLI needed
CREW_FM_STATE=/path/to/firstmate/state ./crew-studio   # optional explicit legacy history adapter
```

In a second terminal, run `./crew-studio open` with the same data/port settings to open the authenticated browser session at http://127.0.0.1:4210. Basic native pages, workflows, cards, skills and local storage require only the binary. Studio creates its own data and a safe workspace; it does not discover a v1 checkout. Set `CREW_MAIN_PROJECT` to explicitly select another project. `CREW_FM_STATE` enables an optional legacy read adapter; it does not migrate or project state.

Coding requires Git, the selected provider and verified login/tool execution, a supported OS sandbox, Node for built-in firstmate script checks, and Python 3 for `core/ste-wording`. The Doctor separates basic web readiness from coding/check requirements and optional integrations. It offers supported installers; Git and Python setup are manual. Source development/build requires Bun. Rendering remains optional and requires Node, Playwright/Chromium and ffmpeg for films. It discovers only managed tools, an explicit `PLAYWRIGHT_MODULE`/`CREW_PLAYWRIGHT_MODULE`, or Studio’s own package.

Optional integrations:

| Optional | Adds | Without it |
| --- | --- | --- |
| Claude Code or Codex CLI | driving the firstmate main session (a fork or a new Codex thread seeded from a handoff), CLI chat providers | the status chat still works with an API key or a local model |
| Anthropic / OpenAI API key, or an OpenAI-compatible endpoint (LM Studio, Ollama) | the status chat with no CLI at all | use a CLI provider |
| GitHub token (pasted in Studio, or `GITHUB_TOKEN`; an installed `gh` is used if present) | PR and CI columns, merged work in the Library | Studio shows "GitHub not connected" with a Connect button |
| Phone on the same Wi-Fi (built in) | phone access, paired with a code | — |
| Tailscale | encrypted phone access from anywhere | use LAN mode at home |

**Installs, one click, official only.** For a missing CLI or Tailscale the Doctor
shows the exact command, its source URL and where it installs, asks you to confirm,
then runs it in its own process with the log streamed into the page and a Cancel
button, and checks again afterwards. It uses each vendor's official installer
(Claude Code's `claude.ai/install.sh` or its npm package, Codex's npm package or
Homebrew cask, Tailscale's Homebrew cask or download page); never `sudo`, never
without your click. Logins (Claude Code, Codex, Tailscale) open the vendor's own
flow. Studio can reuse narrowly scoped copies of existing provider credentials
for isolated workers; it does not collect your password in its own login form.
The installer table is per OS in
`src/doctor.ts` (macOS, Linux, Windows rows).

**Phone, same Wi-Fi (LAN mode).** Off by default and off again after a restart.
Turn it on in the Phone page: Studio adds a second listener on this Mac's LAN
address (`http://<LAN-IP>:4210/remote/`). It is **plain HTTP on your local
network, protected by pairing**: anyone on the Wi-Fi can load the page, only a
paired phone can see or do anything, and requests on that listener are always
treated as a phone (a phone cannot pose as the Mac). Tailscale adds encryption
and access away from home.

**Build it yourself.** `bun run build` writes `dist/crew-studio` for this machine
with every web asset (fonts included, OFL) embedded; `bun run build:all` also
cross-compiles `darwin-x64`, `linux-x64` and `windows-x64`. The binary starts its
own helpers (`crew-studio mcp`, `crew-studio permission-mcp`), so it needs nothing
else installed. Data lives in `~/.crew-studio/data` for the binary and `./data`
in a checkout (`CREW_DATA` overrides both).

A window onto a running firstmate: the board, the inbox of captain cards, the
crew working right now with their live logs, the event log, and today's code
workflow as a graph, plus a chat with firstmate, the captain's intents and a
Library of delivered work; self-improvement (retros, skill edits, replay evals), doors and script gates, domain packs (file organization, documents) and skins.

It reads a firstmate state directory and never writes to it. The one action it
takes, answering a card, goes through the firstmate board's own write route
(`POST /decisions` with the board's secret and Origin), so the board validates
and records the answer exactly as when you click it there.

## Run

```sh
bun run dev        # from a checkout: http://127.0.0.1:4210, live reload of the server
bun run start      # same, without watch
bun run build      # dist/crew-studio, the single binary
bun run test       # contract, host, out-of-the-box and smoke suites (installs mocked)
bun run test:binary  # the built binary, run with no Bun on PATH
```

| Variable | Default | What it does |
| --- | --- | --- |
| `CREW_FM_STATE` | unset | explicit optional legacy read adapter |
| `CREW_MAIN_PROJECT` | Studio-owned data/workspace | explicitly selected native project; a legacy adapter retains its project default |
| `CREW_PORT` | `4210` | port to serve on (the board uses 4173) |
| `CREW_BOARD_URL` | `http://127.0.0.1:4173` | firstmate board that records answers |
| `CREW_BOARD_SECRET` | `~/.config/firstmate/board-<port>.secret` | the board's secret file |
| `CREW_READONLY` | unset | `1` never sends an answer |
| `CREW_GH` | on | `0` stops polling GitHub |
| `CREW_GITHUB_TOKEN` / `GITHUB_TOKEN` / `GH_TOKEN` | unset | GitHub token; else one pasted in Studio (`data/github-token`, 0600); else an installed `gh`'s |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `CREW_COMPAT_BASE_URL` | unset | direct-API chat providers (or paste keys in Doctor → API keys; `data/keys.json`, 0600) |
| `CREW_INSTALL_RUNNER` | real | `mock` records installs instead of running them (tests); `CREW_NO_REAL_INSTALL=1` refuses real installs |
| `CREW_GH_REPO` | the firstmate checkout's GitHub origin | repository for PR and check status |
| `CREW_RECENT_DAYS` | `3` | how far back the board lists tasks |
| `CREW_DATA` | `./data` | Studio's own store: intents, intent links, artifacts, settings |
| `CREW_FILE_ALLOW` | `~/Desktop/firstmate-film` | colon-separated folders artifact files may be served from |
| `CREW_CHAT_PROVIDER` | `claude` | chat model provider: `claude`, `codex` (or `stub` for tests); the chat header's settings save a choice that wins |
| `CREW_CLAUDE_MODEL` / `CREW_CODEX_MODEL` | `claude-sonnet-5-5` / codex's default | model per provider |
| `CREW_CLAUDE_BIN` / `CREW_CODEX_BIN` | `claude` / `codex` | CLI per provider (tests point these at stubs) |
| `CREW_CHAT_TIMEOUT_MS` | `120000` | time limit per question |

Cards that need the board's own confirmation steps (a merge card with a door
check, a retrospective card) show a link to the board instead of options.

## Pages

- **Board** (home): the decisions waiting on you, Studio's and firstmate's, each answered in place; every task in flight (Studio tasks and firstmate tasks) with its stage pipeline, stage and round, status, crew, spend and elapsed, live; the crew on duty.
- **Inbox**: decisions only: each pending card in full (intent, why, how, options, questions), answered from the card itself, the result shown on it.
- **Crew**: every round from the last two days, live ones first, each with a readable tail of its log; click one for a larger live view.
- **Activity**: the event log, filtered by task, type or actor, updating live.
- **Workflow**: `workflows/code.flow.yaml` drawn as a graph, with each active task placed on its step.
- **Chat** (every page): ask firstmate how things stand. Answers come only from Studio's read-only tools over the event log, with links to the task, event, card or PR they came from; each lookup shows as a chip. Saying what you want done records an intent.
- **Intents**: what you asked for, with a trail Received → Spec drafted → Dispatch card → Running → Merged.
- **Library**: artifacts (web pages, films, images, links) with their versions and approvals, and merged PRs with their lineage (dispatch card → rounds and reviews → CI → merge card → commit).
- **Artifact** page: every version with who made it (captain, an agent with its provider and model, or an import), its parent, the notes behind it, the spend the agent reported, the sha256, the render state, the approval; the lineage v1 → notes → v2; the agent rounds; where it went in repositories.
- **Review** (`#/review/<id>/<n>`): web pages pin-review (click an element, comment); films timeline-review (drag a range, optionally draw a box, comment). "Request changes" runs a designer or film-editor agent; "Feedback brief" shows what the agent gets; "Approve" pins the version.
- **Compare** (`#/compare/<id>/<a>/<b>`): side by side (web: the old pins on both versions; video: A/B players that seek together to a note), with each note's "addressed?" claim from the agent and your "Verified" tick.
- **Changes**: the trivial lane. Approved artifacts go into a repository by a recipe, with script checks, one card, one click to merge.
- **Task** and **Event** pages: where chat citations land.

## The chat is vendor-neutral

Every provider sits behind one interface (`src/providers/types.ts`):
`start(systemPrompt, tools, ctx) → session`, `session.send(text) → async stream of
{delta, toolStart, toolEnd, message, turnEnd}`, `session.interrupt()`.

- **claude**: `claude -p --output-format stream-json`, all built-in tools removed (`--tools "" --restricted --strict-mcp-config`).
- **codex**: `codex exec --json`, shell and image tools disabled, web search off, user config and rules ignored, read-only sandbox. `codex exec --json` delivers a whole message at once, so Codex replies appear in one piece rather than token by token.
- **stub**: no model; used by the tests.

Both real providers get the same plain-text instructions and only Studio's tools,
served by `src/mcp.ts` (a stdio MCP server registered for that one process). It
calls Studio with a token issued for that question. The tools are `runs_list`,
`task_get`, `events_query`, `pending_list`, `crew_list`, `crew_tail`, `pr_get`
and `library_list`, all read-only, plus one write, `intent_capture`, which
appends to Studio's own `intents.jsonl`. The guardrails are the same for every
provider: a time limit, at most 8 lookups per question, a clear error when a CLI
is missing or logged out, and no firstmate, board or crew variables in the
model's environment. Nothing in the chat can dispatch, answer a card or merge.

## Intent hand-off contract (Studio → firstmate)

Studio never writes specs or cards. It records intents; firstmate (the main session) picks them up.

- `data/intents.jsonl`: Studio appends one line per captured intent:
  `{"id":"I-001","ts":"<ISO>","goal":"<one sentence>","details":"…","constraints":null|"…","deadline":null|"…","budget":null|"…","text":"<captain's words>","status":"received","source":"chat"}`
- `data/intent-links.jsonl`: firstmate appends one line when it drafts a spec for an intent:
  `{"intent":"I-001","task":"T-307","ts":"<ISO>","by":"firstmate"}`. To decline one, it writes
  `{"intent":"I-001","status":"declined","reason":"…","ts":"<ISO>","by":"firstmate"}`.
- After the link, the task's own events drive the trail: a `decision_requested` dispatch card → **Dispatch card**; the captain's A on it → **Running**; `merged` → **Merged**.

## Artifacts and review loops (M3)

Artifacts live in `data/artifacts/<id>/` (`artifact.json`, then `v<N>/manifest.json`, `v<N>/files/…`, `v<N>/notes.json`).
A version's files never change after it exists: the manifest keeps a sha256 per file, `verify()` recomputes them, and
approving a changed version is refused. Changes always make v(N+1). A film's shared `cast/` folder is linked, not copied.

- **Web loop.** `POST /api/artifacts {id, title, type:"web", html}` makes v1. The review page frames it at 1280 px with
  scripts off and no network (CSP `connect-src 'none'`, `frame-ancestors 'self'`); a click pins `{selector, bbox, comment}`
  and a crop is rendered when the renderer is installed. "Request changes" copies the version to a work folder and runs
  the designer through the chat's vendor-neutral providers (claude, codex, anthropic, openai, openai-compatible) with ONLY
  the work tools: `work_list`, `work_read`, `work_search`, `work_replace`, `work_write`, `work_report`. No shell, no web,
  no path outside the copy, text files only, shared assets read-only. Guardrails: `CREW_WORK_TIMEOUT_MS` (15 min),
  `CREW_WORK_MAX_TOOLS` (80), and the spend the provider reports (claude: USD and tokens; codex: tokens). An agent round that
  changes nothing makes no version.
- **Video loop.** Notes are `{t0, t1, box?, comment}`. For an HTML film (the promo film's contract: `DUR`, `render(t)`,
  scene functions, `#stage`), the brief maps each note's time to the scene functions active then (read from the source,
  film time). The film editor edits `film.html`; Studio then renders `render.mp4` (headless Chromium frames by `render(t)`,
  WebAudio rendered offline, ffmpeg) with 4 parallel pages. A plain MP4 without source takes notes and exports a brief;
  it cannot be regenerated. First start imports the M2 Library: the film MP4 (plus its source from `CREW_FILM_SOURCE`)
  and the prototype link become v1; a file outside `CREW_FILE_ALLOW` is listed but never copied.
- **Renderer** (optional): node + Playwright (Chromium) + ffmpeg. Doctor shows each and installs it with one click
  (Playwright into `~/.crew-studio/tools`, ffmpeg and node via Homebrew or the official download). Without it, notes and
  briefs still work and a regenerated film waits for a render.

## The trivial lane: "Use in repo"

`data/repos.json` lists repositories Studio may write branches to (`POST /api/lane/repos {path, name?, base?, github?}`,
Mac only). From an APPROVED image artifact, the recipe "Add image to README top" copies it to `assets/<name>` and puts
one markdown image line at the top of `README.md`, in a temporary worktree, as one commit on `crew/<artifact>-v<N>`.
No agent, no model. Checks, all scripts:

| check | passes when |
| --- | --- |
| paths | only `README.md` and `assets/**` change (an update: only the one image) |
| size | at most `CREW_LANE_MAX_LINES` (20) text lines change |
| sha | the committed image's sha256 equals the approved version's |
| README | it renders, and every local link and image resolves in the commit (external links are not fetched) |
| CI | GitHub check runs on the commit, once the PR exists (failing = fallback; running = no merge yet) |

Any failed check makes the card a **fallback**: "needs the normal two-way path", and it never merges. A ready card on a
GitHub repo opens its PR and merges through the REST API (`PUT /pulls/:n/merge`, squash, at the reviewed sha) only on
the captain's click; a local-only repo fast-forwards its base. Each merge is recorded in `data/repo-refs.jsonl`; approving
a newer version of that artifact proposes an "update" card (draft) for every repo holding an older one, and "Prepare"
runs the replace recipe.

## Library files (M2)

`data/artifacts.json` lists non-code deliverables: `{id, type: "video"|"web"|"doc", title, path?|url?, created, approvedBy, approvedAt, note, intent?}`.
A `path` is served read-only at `/files/<id>` (with byte ranges, so video seeks) only when it sits under `CREW_FILE_ALLOW`.

Updates arrive over server-sent events (`/api/stream`) as firstmate appends to
`events.jsonl`, adds or removes pending cards, or a crew log moves.

## The main session (M2.5): Studio as the entry point to firstmate

The chat has two modes. **Status (read-only)** is the M2 agent. **firstmate** drives the real
firstmate main session: the same conversation, memory and context as the terminal, through a
vendor-neutral host interface (`src/host/`):

| | Claude Code | Codex |
|---|---|---|
| discover | `~/.claude/projects/<encoded cwd>/*.jsonl` (subagent files skipped) | `codex app-server` → `thread/list` |
| attach | one long-lived `claude -p --resume <id> --input-format stream-json --output-format stream-json --verbose --include-partial-messages --permission-prompt-tool mcp__studio_permission__approve --mcp-config …` | `codex app-server` → `initialize`, `thread/fork`; fallback `thread/start` seeded from read-only `thread/turns/list` and the newest handoff |
| one turn | a stream-json user message on stdin | `turn/start` |
| interrupt | `control_request {subtype: interrupt}`, kill after 5 s | `turn/interrupt`, kill after 8 s |
| permissions | the permission MCP (`src/permission-mcp.ts`) asks Studio over a 0600 unix socket in a 0700 folder, with a token | approval requests are answered by Studio; anything else is declined |
| hand back | `claude --resume <id>` | `codex resume <id>` |

Codex firstmate requires an installed, logged-in Codex CLI with the stable app-server protocol: `initialize`, `thread/list`, `thread/start`, `turn/start`, `turn/interrupt`, and command/file approval requests. `thread/fork` is preferred; when unavailable, Studio reads recent turns with `thread/turns/list` if supported and seeds a new thread with the newest `state/HANDOFF-*.md`. The protocol fixture was generated from codex-cli 0.162.1; older releases are not asserted compatible. Studio never resumes the original live thread. The Firstmate page can also start a fresh Codex firstmate. Model, reasoning effort, approvals and sandbox come from Codex configuration and server responses. No separate OpenAI API key is required for this CLI host.


Never `--dangerously-skip-permissions` or a bypass mode. The host process gets no `FM_`, `HERDR`,
`CREW_`, Claude-session or secret variables. A session the CLI re-identifies is followed to its new id.

- **Driver lock** (`data/driver.json`, `{holder: studio|terminal, host, sessionId, pid, since}`):
  Studio attaches only when no terminal is driving the session. Driving means a claude/codex
  process names the session id, an interactive claude/codex runs in the project folder (for the
  newest session), or the session file was written in the last 3 minutes. While Studio holds the
  lock, a write to the session file outside Studio's own turn **pauses** Studio (nothing more is
  sent) and alerts the captain, instead of forking the conversation.
- **One input queue**: captain chat, card answers (as notices) and firstmate wakes, one item per
  turn, never a BUSY refusal. Wakes are read (never written) from firstmate's
  `state/session/wake.jsonl` from the moment Studio attaches, turned into the stop-hook's own lines
  (a port of `fm_watch.wake_line`), and folded into one waiting wake while a turn runs.
- **Permission bridge**: each tool request shows as an approval card in the chat and a bar on every
  page (desktop and a paired phone that may drive). No answer in time (`CREW_PERMISSION_TIMEOUT_MS`,
  default 120 s) is a deny. These are separate from firstmate's decision cards; merge cards stay
  board-only.

## Phones over Tailscale

Studio keeps listening on `127.0.0.1` only. When the captain enables phone access, `tailscale serve
--bg --https=8443 http://127.0.0.1:4210` forwards the tailnet name to it (MagicDNS + HTTPS
certificates). Requests are told apart by their Host header: loopback is this Mac, the tailnet name
is a phone, anything else is refused (421, DNS rebinding).

- **Pairing**: the Phone page shows a 6-digit code and a QR link (`https://<tailnet>:8443/?pair=<code>`),
  valid 5 minutes, 5 tries, compared timing-safe. The phone gets a 32-byte bearer token; only its
  SHA-256 is kept, in `data/remote-devices.json` (0600, atomic). Revoking a device refuses its token
  and cuts its open stream.
- **Drive gate**: a paired phone may always read and interrupt. Sending to firstmate, attaching,
  approving tool requests and answering cards need "Allow phones to drive firstmate", which only the
  Mac can switch on. Pairing, revoking and Tailscale changes are Mac-only.
- **This build does not change Tailscale.** "Enable phone access" shows the exact command and, after
  a confirm, hands it to a stub runner that only records it. `CREW_TAILSCALE_LIVE=1` switches to the
  real runner; do that only at the cutover below.

## Vendor-neutral memory

`src/memory.ts` reads and writes one plain folder of Markdown notes plus a `MEMORY.md` index
(`CREW_MEMORY_DIR`, default `data/memory/`, empty), so a Codex main session can use the same memory
as Claude. Nothing is migrated yet: `bun scripts/migrate-memory.ts --dry-run` prints the plan and
refuses to run without `--dry-run`.

## Cutover checklist (for the captain)

Nothing below has been done. Do it in this order, at a quiet moment (no round running).

1. **firstmate writes its handoff.** In the terminal, ask firstmate to write a handoff note
   (`state/session/HANDOFF-<date>.md`) and to say which background waiters it is running; those die
   with the terminal and Studio's wake queue replaces them.
2. **Exit the terminal session.** Quit `claude` (or `codex`) in the firstmate-workflow folder. Wait
   ~3 minutes, or until the Attach dialog stops marking the session "terminal driving".
3. **Attach in Studio.** Chat → firstmate → Attach main session… → pick the newest session → Attach.
   The banner says "Studio is driving" and `data/driver.json` says `studio`.
4. **First wake check.** Send "status?" and see firstmate answer. When the next firstmate wake lands
   (a round finishing, a CI result), it must appear in the chat as a `firstmate wake` turn. Approve or
   deny the first tool request that comes up and check the session reacts.
5. **Hand back** any time: banner → Hand back to terminal → copy `claude --resume <id>` and run it in
   the firstmate-workflow folder. Studio releases the lock first, so the two never write at once.
   If Studio ever shows **Paused**, a terminal touched the session: hand back, don't resume, unless you
   know the write was harmless.
6. **Enable Tailscale (optional).** Restart Studio with `CREW_TAILSCALE_LIVE=1`, then Phone → Enable
   phone access… → Run (it runs the command shown). Pair the phone with the code or QR. Leave "Allow
   phones to drive firstmate" off until you have read from the phone once.
7. **Memory migration (optional, later).** Run `bun scripts/migrate-memory.ts --dry-run`, read the
   plan, then copy the folder yourself and point the host's memory setting / AGENTS.md at
   `CREW_MEMORY_DIR`. Keep the Claude folder as a read-only backup for a week.

## Self-improvement (M6): Improve page

- **Skills.** Every workflow role has a skill. Studio keeps its own versioned copy (`data/skills/<workflow>/<role>/vN.md`); v1 is imported from the role's source (`fm:` = the firstmate checkout, read only; `pack:` = a domain pack; `bundled:` = shipped with Studio). An adopted edit makes v(N+1) and a **patch** you can hand to the source's owner. Studio never writes firstmate's files.
- **Chat-driven edits.** On a skill page ("Edit with chat") or in the status chat (its `skill_edit` tool): an editor agent changes a copy with `skill_*` tools only.
- **Replay evals before every offer.** Cases are situations replayed from recorded events, graded by regex checks, run on the skill before and after. *Static replay* needs no model (the skill's own lines on the case's key terms); *model replay* runs one turn per case on any provider (the stub in tests). A card shows its own class's cases and any regression on the others.
- **Retro.** Per workflow (`workflows/<id>.retro.yaml`, or inline in a pack's flow): triggers (every N days, N events of a type, a class repeating), metrics from the event log, and repeat-class detectors (regex over an event field, or a duration band). Report viewer `#/retro/<id>`. Each class found with a remedy becomes a **proposal**: the rule, the expected metric (baseline per week → target), its replay cases. A rejected proposal is never proposed again (class + role); an adopted one is tracked before/after. `bun scripts/retro-acceptance.ts` runs the code retro over the live firstmate log (read-only).

## Doors and gates: Gates page

- **Door classifier** (`src/doors.ts`): org defaults in `workflows/doors.yaml` (CI config, migrations, SQL, env and secrets, auth and permissions, public interfaces) plus a project's own list in `data/projects.json`, which counts only after you approve the proposed list. Tiers: **one-way** (a revert will not undo it), **two-way**, **trivial** (docs and assets, small), **undecided** (a new top-level path or a rename: you pick). Every reason names the path, list and glob.
- **Script gates per workflow node** (`src/gates.ts`): builtins (no conflict markers, no secrets, max file lines, max diff lines, JSON parses, commit mentions a rollback, paths allowed) or an argv run in the change's worktree; `when: {door: [...]}` limits a gate to a path; a project can add its own.
- **Studio's change workflow** (`workflows/change.flow.yaml`): "Check a branch" copies it to `crew/<id>` in a worktree, classifies it, runs the gates node by node, and a failing gate or a reviewer's REJECT starts a worker round (fs tools on the worktree only) and a fresh review, up to the round budget. You merge (a local fast-forward; one-way needs a tick). Nothing is pushed.
- The door and gate results show on change cards, on the trivial lane's cards, and in the workflow view (`#/workflow/<id>/<change>`), which now draws every workflow.

## Domain packs (M7): Packs page

A pack is a way of working as data: `manifest.yaml` (id, name, version, description, engine, skills per role, gates, artifact types, workflow templates, evals, permissions) and its files. Built-in packs live in `packs/`; installed ones are copied to `data/packs/installed/` and **pinned by sha256** (a changed file and the pack is refused). **Workflow genesis**: describe a new way of working (Packs page, or the chat's `pack_draft` tool); the pack author agent drafts the pack and its evals; Studio validates it and runs the evals; you install it.

**File organization pack** (`#/fileorg`): a dry run sorts a folder's loose files into folders by kind (hidden files and folders stay; a taken name gets " (2)", never an overwrite); three gates; you untick moves; Apply writes each undo line before its move and skips files changed since the plan; Undo puts everything back. The firstmate checkout, Studio's data, your home folder itself and system folders are refused.

## Documents (M8): Documents page

A document is an artifact whose versions hold `doc.md` and Studio's rendering `doc.html` (one id per block, so pins follow unchanged blocks). It reuses the M3 loop: pin a block, "Request changes" runs the writer (the documents pack's writer skill), compare, approve. A new document can be drafted by the writer from a sentence. Approval passes the pack's gates (a title; no open note). Exports, all written by Studio: Markdown, HTML, Word (.docx), PDF (built-in fonts: non-Latin text becomes "?" and Studio says so; use HTML → print for it).

## Skins (M4/M5): Skins page

A skin is another face, never more power: a folder with `manifest.json` and an HTML entry, run in a sandboxed iframe (scripts only) with **no network** (CSP `connect-src 'none'`; origins a manifest lists need your explicit grant at install). It gets a read-only snapshot (only what its permissions name) and events, and may only ask the host to **open** a card, which Studio shows in pro mode; anything else it posts is ignored and counted. Files are pinned by sha256 (built-ins at start, installs at install). Built in: **Voyage** (tasks as ships on the workflow's route, cards as flags) and **Terminal**. The compatibility kit (`skins/kit/`, served at `/skin/_kit/skin-kit.js`, checks on the Skins page) documents the API. **Pro mode always works**: the bar's button, Escape, `/#/pro` or `/?pro=1`, and a skin that never says it is ready is closed after 5 seconds.

## Tests

```sh
bun run fixture    # rebuild tests/fixture/state from the live state (read-only, no secrets copied)
bun run test       # the provider contract test, the host test, then Playwright smoke tests on a temporary copy of the fixture and a mock board
bun run test:host  # both hosts through stub CLIs (attach, send, stream, interrupt, permissions, fork-follow, detach), the driver lock, the queue and wakes, pairing
bun run test:contract   # every chat provider (claude, codex, stub) through the same checks: stream order, tool events, timeout, interrupt, tool limit, logged out
bun run test:m6    # retro (the four firstmate repeat classes on a recorded log), proposals and replay evals (stub), chat edits, triggers, then the pages
bun run test:gates # the door classifier, builtin gates, the change workflow on a local repo with the worker/reviewer cycle, then the pages
bun run test:m7    # the pack validator, file organization (plan, apply, undo), genesis, hash-pinned installs, then the pages
bun run test:m8    # documents: blocks, the review loop on a doc, drafting, gates, md/html/docx/pdf exports, then the pages
bun run test:skins # skins: kit checks, pins, no network, read-only snapshot, open-card only, a hostile skin, pro mode
bun run test:m3    # artifacts and integrity, the work tools' guard, both review loops with a stub agent and a stub renderer (CREW_RENDER_STUB=1), the lane against a local bare repo and a mock GitHub, then the M3 pages in Playwright
```

The tests never touch live state, never answer a real card, never call a model, never attach to a
real session (HOME points at a temporary folder; the host CLIs are `tests/stub-host-*.mjs`) and never
change Tailscale (they check `tailscale serve status` is unchanged): the
claude and codex providers run against stub CLIs (`tests/stub-claude.mjs`, `tests/stub-codex.mjs`)
that print each vendor's real output format and call Studio's tools for real. Playwright comes
from the firstmate checkout's `node_modules`; set `PLAYWRIGHT_MODULE` to use
another copy.

Codex tool execution belongs to the CLI's native runtime and keeps its configured model, effort, approvals and sandbox. Studio removes parent Codex thread IDs and runtime sandbox/CI flags from the child environment while retaining `CODEX_HOME`. Client-owned dynamic tools from another harness are declined; Studio does not interpret their JavaScript. A code-mode host failure is reported as a failed turn when the vendor sends its error output. A completed assistant message or a passing vendor Doctor is not proof of a repository read: verify a real native tool result. No global Codex configuration or feature setting is changed.
