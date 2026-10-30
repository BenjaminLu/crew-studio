# Web terminals

Any agent CLI plugs in: Claude Code, Codex, cursor-agent, aider, opencode, Gemini CLI, Amp, a login shell, or any command,
in a real terminal, in a registered project's folder, started from Studio with one click. Inspired by herdr and Orca: one
pane per agent, and its state (working, waiting for you, done, exited) at a glance.

Code: `src/terminals.ts` (service and routes), `src/terminal-state.ts` (state heuristics), `public/terminals.js` and
`public/terminals.css` (page, panel tab, sidebar count), `public/vendor/xterm-*` (xterm.js 5.5.0 and its fit addon 0.10.0,
pinned, copied by `scripts/vendor-xterm.ts`). Tests: `tests/terminal-state.ts`, `tests/terminals.ts`,
`tests/terminals-ui.mjs`, `tests/terminal-focus-ui.mjs`, `tests/terminal-keys.ts`, `tests/terminal-launch.ts`,
`tests/terminal-panes-ui.mjs`, `tests/terminal-input-ui.mjs`, `tests/terminal-theme.ts`, `tests/terminal-reattach-ui.mjs` (`bun run test:terminals`); the launch's argv also in `tests/open.ts`. Keys: `public/term-keys.js`. Colours: `public/term-theme.js`.

## Focus mode

The sidebar has a **Terminals** item (its own icon, right after Firstmate, also in the 64 px rail); it is current on
`#/terminals` and carries the "waiting for you" count. `#/terminals` is a focus page, as an open review room is
(docs/units/review-room.md): one mechanism, `pageFocus` in `public/app.js`. A route's view declares `.focus`, a name
(`viewTerminals.focus = "terminal"`) or a function of the route's argument (a room: only once it has loaded), and
`render()` asks on every draw:

- on entering, it notes whether the sidebar was collapsed, the chat open and the saved `crew.side`, then folds the sidebar
  to the rail, closes the chat panel and sets `body[data-focus="<name>"]`. `styles.css` hides the chat button (and the
  tour) on every focus page and makes Firstmate, opened from the page, a sheet over it; the page's own CSS takes the window.
  Nothing is written: `openChat` saves no `crew.chatOpen` during focus, and `crew.side` stays the captain's;
- on leaving for a page that is not one, it gives back what it noted and removes `data-focus`, except a sidebar the captain
  folded or opened on purpose while there (`setSide` saved it): that choice wins.

The state is on `<body>` and in `PAGE_FOCUS`, outside `#view`, so a `render()` changes nothing.

With a terminal shown, the page is the terminal: a row of tabs and tools, the focused terminal's header on one line (state,
command, Stop, Restart, Remove, Send for review, Remote Control), the tab's panes filling the rest, width and height, and a
line of key hints. Each pane's fit addon follows every resize, and its PTY gets the new size (`…/resize`). **Launch…** opens
the launcher (agent presets, a command, every terminal listed) above the panes; starting a terminal closes it; it starts
open while nothing is running. A phone sees the same tabs with a "View only" badge in place of the tools that start
terminals; at 760 px and below the sidebar stays the top bar (its theme and gear row is hidden on this page) and the panes
take the screen's width. With no tab at all, the page is the launcher and the list, as before.

## Tabs, panes and keys

The page holds tabs; a tab is a binary tree of splits (row or column, with a ratio) whose leaves are panes; a pane is one
terminal, its own PTY on the service above. A new tab or a split starts a login shell (the Shell preset) in the focused
terminal's project, as a terminal app opens one in its folder; Launch… starts anything else in a new tab. The arrangement is
this viewer's own, in `localStorage` (`crew.term.layout`): a reload keeps it, another browser has its own, and losing it
loses no terminal. **Closing a pane or a tab never stops its terminal**: it leaves the screen and stays in the list, in Go to
and on the Firstmate panel; Stop stops it. The last pane of a tab closes the tab, as in iTerm2. A terminal that is removed
(or gone after a restart) leaves its pane. Dividers drag; a click in a pane focuses it without rebuilding the page; the
address names the focused terminal (replaced in place, so moving between panes adds no history).

The keys are the platform's own terminal's (`public/term-keys.js`, the prototype's table, kept whole):

| | Mac (iTerm2) | Windows and Linux (Windows Terminal) |
|---|---|---|
| New tab | ⌘T, in a browser tab ⌥T | Ctrl+Shift+T, in a browser tab Ctrl+Alt+T |
| Tab 1–9, next, previous | ⌘1–9, ⇧⌘] / ⇧⌘[ (⌥⇧] / ⌥⇧[) | Ctrl+Alt+1–9, Ctrl+Tab / Ctrl+Shift+Tab (Ctrl+Alt+PgDn / PgUp) |
| Rename tab | double-click it | double-click it |
| Split right, down | ⌘D, ⇧⌘D | Alt+Shift+=, Alt+Shift+- |
| Move, next pane, swap | ⌥⌘arrows (⌃⌥arrows), ⌘] / ⌘[, ⌥⇧⌘arrows | Alt+arrows, Ctrl+Alt+] / [, Ctrl+Alt+Shift+arrows |
| Resize, zoom | ⌃⌘arrows, ⇧⌘↩ | Alt+Shift+arrows, Ctrl+Shift+Enter |
| Close pane (last: the tab) | ⌘W, in a browser tab ⌥W | Ctrl+Shift+W, in a browser tab Ctrl+Alt+W |
| Clear, go to, sidebar, keys | ⌘K, ⇧⌘O, ⌘B, ⌘/ | Ctrl+Shift+K, Ctrl+Shift+P, Ctrl+Shift+B, Ctrl+Shift+/ |

Chords are matched on `KeyboardEvent.code` (the physical key: an input method or a keyboard layout does not move them),
in the capture phase ahead of xterm, with `preventDefault`, so a chord that is Studio's never also reaches the shell.
Everything else (plain keys, Ctrl+C, the browser's copy and paste, F1 to F12, which full-screen programs such as htop and mc
use) goes to the terminal as before. So does a chord with nothing to do (no such tab, one pane, no split that way), and
AltGr: Windows reports it as Ctrl+Alt, so a Ctrl+Alt keydown that says AltGraph or types a character other than its key's
own ({ [ ] ~ | \ # on German and French layouts) is text. The second chord of an action counts only in a browser tab; in a
Studio window ⌥T, ⌥W and ⌥⇧] are Option-as-Meta and the shell's. The hints and the key table (⌘/, Ctrl+Shift+/ or the Keys
button; both platforms one click apart) show the chord that works where the page is, and strike out the other. The table
also lists copy mode and a new workspace (⇧⌘C, ⌘N on a Mac): this page has no workspaces and xterm selects and copies by
itself, so those chords are not taken and reach the terminal.

## Typing

An input method (Zhuyin, Pinyin, Japanese, Korean) composes in xterm.js's own hidden textarea; nothing is sent while it
composes, and what it commits is sent once. One case is Studio's: an input method that commits the front of what it
composes while the rest goes on composing (compositionend, then compositionstart, in one keystroke: Zhuyin and Pinyin do
when the buffer fills or a word is confirmed) made xterm.js 5.5.0 send the committed text together with the part still
composing, and that part again once committed (中文 came out as 中文文; a longer run repeated every tail). 6.0.0 fixed
it upstream; until the pin moves, `imeOnce` in `public/terminals.js` sends, when a new composition starts, what the last
one committed up to where the new one starts, and cancels the send xterm had queued. `tests/terminal-input-ui.mjs` drives
Chromium's input-method layer over CDP (`Input.imeSetComposition`, `Input.insertText`) and reads the bytes the page posts;
it is not the operating system's Zhuyin keyboard, which no test here presses.

Tab is the shell's: xterm sends it as `\t` and keeps the focus (the login shell, `$SHELL -l` on a PTY with
`TERM=xterm-256color`, is interactive, so bash and zsh complete). A press on the pane around the terminal (its bar, the
frame's padding) used to take the focus to the page, and the next Tab moved it to the pane's × instead of completing;
such a press now keeps the focus in the pane's terminal (buttons and links in the pane keep theirs). The same test checks
`\t` reaches the PTY, the focus stays, and bash and zsh complete `ech` to `echo`.

## Colours

The terminal is drawn on Studio's `--surface-2` with `--text`, in the light theme and the dark one (read when a pane is
made). xterm.js's own palette (Tango) was made for a black background: on the dark surface bright black (hints,
autosuggestions) was 2.2:1, blue 2.8:1 and dim bright black 1.5:1; on the light one yellow, cyan and the whites were under
2:1. `public/term-theme.js` gives each side its own 16 ANSI colours, every one at WCAG AA (4.5:1) on that surface (black is
a readable grey on the dark side, white a dark grey on the light one, as their roles are swapped there); dim text (SGR 2)
is drawn in a dim form of its colour that moves toward the background only as far as AA allows (xterm's own is half
opacity, which halves the contrast). Any other colour a program asks for (256-colour, truecolor, as Claude Code's greys
are) xterm keeps at 4.5:1 itself (`minimumContrastRatio`). `tests/terminal-theme.ts` computes every ratio from the theme
object against the surfaces in `public/styles.css`; `tests/terminal-input-ui.mjs` reads the colours drawn in both themes.

## A Studio window

A browser tab keeps ⌘T, ⌘W and ⌘N (Ctrl+Shift+T, W, N; Ctrl+Tab) for itself: the page never sees them. A Chromium app
window (`--app`) keeps none, so there they reach the page (checked by hand with real keystrokes, Chrome on macOS; tests
cannot press keys the OS gives the browser). So:

- `crew-studio launch` and `open` (and the live release's open) ask for a Studio window first: on macOS
  `open -na "Google Chrome" --args --app=<the private redirect file>`, then Microsoft Edge, Brave and Chromium; on Windows
  the installed chrome.exe, msedge.exe or brave.exe; on Linux the Chromium browsers on PATH. The command line carries only
  the redirect file's `file:` URL (0600, as before); the file's link is the session link with `&w=app`, and Studio's
  `/session` then lands on `/?window=studio`. The page keeps that for the window (`sessionStorage`) and drops it from the
  address. No Chromium: the default browser as before, with the plain link. `--tab` or `CREW_APP_WINDOW=0` keeps the tab;
  `--browser <app>` is used as asked. Windows and Linux reuse the same launch, whose private runtime folder check is
  POSIX's: not exercised on those systems. The launch never blocks (the page's button runs it inside the server): an opener
  (open, xdg-open, start) is waited for without blocking, at most 5 s; a browser started directly is the window itself, so
  it is started detached, never waited for and never stopped.
- In a browser tab the terminal page shows a banner naming the chords the tab keeps and the ones to use instead, with **Open
  in a Studio window**: `POST /api/terminals/app-window` runs the same launch as an app window. The desktop page's own
  request only (its cookie, same origin, the guard of every terminal POST; a phone and a script are refused). It answers
  what opened, or 502 `noWindow` and the page stays; a second ask within 5 s is 429 `tooSoon`. A launch that opened nothing
  removes its private redirect file at once (others go after 10 minutes, as before).
- `public/manifest.webmanifest` (display standalone, start `/?window=studio`, icons) makes Studio installable; an installed
  Studio, fullscreen, or `display-mode: standalone` count as a Studio window too.

## Not sandboxed, by decision

A terminal runs as the captain's user, with that user's full permissions, in the project's folder: the same as opening
Terminal there. Studio's agent and check sandbox (architecture §10) does not apply, and the page says so before anything
starts ("Not sandboxed: runs with your user's full permissions in <path>"). What Studio still guarantees:

- Only the Mac's own page starts, types into, resizes, restarts or stops a terminal: every such POST needs Studio's
  session **cookie** (the HttpOnly SameSite=Strict one the page holds) on the loopback listener, an `Origin` equal to
  Studio's and `Sec-Fetch-Site: same-origin` (both required, not only checked when sent), plus the server's one write guard
  (JSON). A script's `x-crew-session` is refused (`pageOnly`). A paired phone is refused (`desktopOnly`) even when it may
  drive Firstmate. `pageOnly` is **not a security boundary against local processes**: any process of this user, a terminal
  started here included (it is unsandboxed), can read `data/session-token` and forge the cookie and headers. It keeps other
  sites and Studio's own scripts from typing into a terminal by accident; the boundary against other machines is loopback
  plus the phone's read-only rule.
- The child's environment is the user's own minus Studio's internals: every `CREW_*` and `FM_*` variable is dropped, and so
  is any variable whose value is Studio's session token or ledger key. `TERM=xterm-256color`, `COLORTERM=truecolor`.
- No new listener: the routes live on Studio's 127.0.0.1 port (and the LAN listener, which only a paired phone's token
  passes). The service itself never binds a socket.

## Wire

- `GET /api/terminals`: the list (and, for the page, the presets found on PATH and the registered, enabled projects).
- `POST /api/terminals` `{project, preset | command, args?, remoteControl?, cols, rows}`: a preset runs its binary with
  `args`; a custom command runs as `$SHELL -lc <command>`.
- `GET /api/terminals/<id>/stream`: server-sent events. `meta` (the summary), `replay` (the scrollback ring), then `out`
  (live output), `meta` on each state change, `exit`. The page gets raw bytes (base64) and xterm.js decodes UTF-8 across
  chunks; a phone gets text with the Remote Control link removed.
- `GET /api/terminals/mux?ids=<id>,<id>…`: the same events for several terminals on one stream, each event's data naming
  its terminal (`{"id": …}`); `gone` for one that is not there or may not be viewed. Ids are well-formed ones only, once
  each, at most 64. A replay and each `out` carry `end`, where the terminal's output stands (every byte it wrote, kept or
  dropped). The page uses only this: one stream for every terminal in its tabs, drawn or not. It keeps each terminal's
  output (its log, at most 2 MiB) and position, so a pane drawn later (another tab, after a reload, a pane unzoomed) is
  filled from it, and when the stream opens again (a pane added or closed) a terminal it already shows gets only what
  follows: no pane is reset, its scrollback and selection stay. A pane refused for too many views says so, with Retry,
  and the stream is asked for again by itself (3 s, then longer). A browser keeps at most six connections to Studio, and a
  stream per pane left none for typing once five panes were open. A stream that stops reading (8 MiB behind) is cut
  whole, with its views of every terminal.
- `POST …/input {data}`, `…/resize {cols, rows}`, `…/kill`, `…/restart`, `…/dismiss`.
- The page's own stream (`/api/stream`) carries `terminals` (the phone-safe list) so the sidebar and the panel stay live.

SSE plus POST rather than a WebSocket: every request then passes the server's existing `handle()` path (who is asking,
the session, the write guard, phone revocation) with no second authentication path to keep in step. Keystrokes are batched
for 8 ms per POST; on loopback that is below what a person notices.

## PTY

Bun's own PTY (`Bun.spawn` with `terminal`, Bun ≥ 1.3.5, POSIX): no native module and no new server dependency. It carries
full-screen TUIs, resize (SIGWINCH), UTF-8 and colour (`tests/terminals.ts` checks size, resize, `é` and SGR colour
round-trip). The child gets its own session and process group; stop sends SIGHUP to the group (what closing a terminal
window does) and SIGKILL two seconds later.

## Bounds, lifetime, record

- Scrollback: a byte ring per terminal (`CREW_TERMINAL_SCROLLBACK`, default 2 MiB); a replay says how much was dropped.
- At most `CREW_TERMINAL_MAX` running (default 8), and at most 4 open views (streams) of one terminal. Ended terminals stay
  listed (with their replay) until removed; at most 20. A shell (the Shell preset) that ends well (exit 0 with no signal, or
  the captain's Stop) is the exception: it leaves the list and closes its tab on its own, as a Terminal window does, and
  its record is marked dismissed, so a restart does not list it again either; its record and transcript stay. A shell that
  fails (an exit code, a signal, a broken rc file that exits as it starts) stays, with its exit code and last output, until
  the captain removes it. Agents and commands stay, for their output and Send for review.
- Closing the page (the app window, a browser tab, a reload) never stops a terminal: it runs on inside Studio. A page
  opened again gets its tabs back (this browser's saved layout; with none saved, another profile or cleared site data, a
  tab for every running terminal), the scrollback replayed from the ring, and its keys reach the same process
  (`tests/terminal-reattach-ui.mjs`: a marker replayed, the same `$$`). Reattaching is the same stream and input as
  opening, under the same guards (the desktop page's cookie to type; a phone watches only). A Studio restart cannot keep a
  PTY: the next page drops the tabs whose terminals no longer run, opens none in their place, and says once "Terminal
  sessions ended when Studio restarted" (工作階段在 Studio 重啟時結束), from the run's `boot` in `GET /api/terminals`
  against the one this browser saw last; a reload in the same run says nothing.
- Studio stopping kills every terminal's process group (SIGHUP then SIGKILL; `tests/terminals.ts` checks a grandchild goes
  too). Nothing is re-attached on restart: no process, no input, no Restart in place. A terminal still running when Studio
  stops gets its end and where its checkout stood (its git end) in its record, marked `studio-stopped`; a record left open
  (Studio killed with SIGKILL) is closed as `studio-stopped` on the next start, with no git end. After the restart the
  ended terminals (the 20 newest that were not removed, shells never) are listed again from their records, marked `restored` (and
  `stopped: "studio-stopped"` for one Studio stopped), with their git end, their review state and their transcript as the
  replay; Send for review works on them under the same guards (below). Remove is kept in the record (`dismissed`), so a
  removed terminal does not come back. What can survive: a process that left the group on purpose (`setsid`, `nohup … &` with its own process group,
  a daemon, a `disown`ed job that changed its group), and everything when Studio itself is killed with SIGKILL (no handler
  runs). Those are the captain's processes, as they would be after closing a Terminal window.
- Each terminal's record is `data/terminals/<id>.json` (who started it, project, command, start, end, exit code or
  signal, `sandboxed: false`, `evidence: false`) and its transcript `data/terminals/<id>.log` (plain text, 0600, in a 0700
  folder Studio makes private again at every start, capped at `CREW_TERMINAL_TRANSCRIPT`, default 5 MiB, with a note where
  it stopped). Retention: the 100 newest records, so up to about 500 MiB of plain-text transcripts; whatever the captain
  typed or an agent printed is in them, Remote Control links removed. `CREW_TERMINAL_TRANSCRIPTS=0` turns transcripts off
  (the record and the activity log stay). Studio's activity log (`data/events.jsonl`) gets
  `terminal.start` and `terminal.exit`. The 100 newest records are kept. **A log only**: a transcript is never evidence for
  a gate, a review or a merge.

## State

`detectState` reads the text the program wrote (no screen emulation), per known agent:

- working: output in the last `CREW_TERMINAL_IDLE_MS` (default 2.5 s), or the last chunk ended on the agent's busy line
  ("esc to interrupt", "Working (8s • …") and the pause is still short;
- waiting for you (agents): output stopped and the screen shows a question (`Do you want to…`, `(y/n)`, `[y/N]`, `(Y)es/(N)o`, a
  numbered `❯ 1. Yes` menu, `Proceed?`): `question`, with the question shown; or the agent's own prompt (Claude's input box
  and `? for shortcuts`, Codex's composer, aider's `>`, a shell prompt): `prompt`; or an agent that went quiet: `quiet`. A shell
  or a custom command that went quiet (a dev server, a build) stays `working` (`quiet`): no toast, no notification;
- done: exit code 0; exited: anything else (non-zero, a signal).

"Waiting for you" shows on the terminal's badge, the list, the Firstmate panel's Terminals tab and as a count on the
sidebar's Firstmate item; a change into it raises a toast, and a system notification when the page is in the background
and the captain allowed notifications. A phone sees the same states.

## Claude Code Remote Control

For the Claude Code preset, Remote Control is on by default (a toggle on the page). Studio asks the installed CLI how:
`claude --help` (no model call; cached per binary and modification time) lists `--remote-control`, so the session starts
with that flag. A CLI whose help does not list it gets `/remote-control` typed once, the first time the session sits idle at
its own prompt (`reason: prompt`; never at a question or a mere pause). When Claude Code prints its session link (`https://claude.ai/code…`), the terminal's
header shows it with a QR code drawn on the page (the vendored qrcode library). The link lets anyone signed in to the
account drive the session, so it is treated as a secret:

- Studio finds it even when the terminal wrapped it at its width (Ink breaks long links over indented lines) or put an
  escape inside it, in any letter case. Once known, the link, the link without its scheme and its session id are matched
  through escapes, line wraps, box borders and percent-encoding, in any case (`SecretWindow`, `fuzzy`).
- The transcript of a Claude Code terminal with Remote Control on is held back until the link is known, then written with
  every form of it removed (`[remote-control link removed]`). If the link never comes, the held text is written at the end
  with the generic rule only (a link Studio never recognised in any form is not known to it).
- A phone gets **no output** from such a terminal (its replay says why), only its state; the question it shows (`ask`) has
  the link and anything link-like removed, in lists, the page's stream and the phone's meta events.
- Never in the record, the activity log or the list a phone receives.

Other agents have no such feature and show nothing; their phone view shows the output with the generic link rule.

Not verified against a live Claude Code here (that would register a real session); the tests use a stub CLI that prints a
fake link, with and without the flag in its help.

## Phone

View only: the page lists terminals and states and draws the output (none for Claude Code with Remote Control on) with
xterm.js created with `disableStdin`, and the input element xterm makes is removed, so a tap never opens a keyboard. No launcher, no Stop or Restart, no Remote Control
link. A revoked phone's streams end.

## Send for review

A finished terminal whose project checkout is on a branch with commits beyond the project's base offers **Send for
review**: code-firstmate reviews the branch from a copy in a Studio worktree (docs/units/branch-intake.md). The terminal
records the checkout's branch and head at start and at end (Studio's own git: no hooks, no user config), and the lines the
captain typed at an agent's own prompt, for the spec writer, as data. A terminal listed from its record after a restart
keeps its button: its git end is the head it hands over, and a checkout that moved since is refused as for any terminal.
