# Web terminals

Any agent CLI plugs in: Claude Code, Codex, cursor-agent, aider, opencode, Gemini CLI, Amp, a login shell, or any command,
in a real terminal, in a registered project's folder, started from Studio with one click. Inspired by herdr and Orca: one
pane per agent, and its state (working, waiting for you, done, exited) at a glance.

Code: `src/terminals.ts` (service and routes), `src/terminal-state.ts` (state heuristics), `public/terminals.js` and
`public/terminals.css` (page, panel tab, sidebar count), `public/vendor/xterm-*` (xterm.js 5.5.0 and its fit addon 0.10.0,
pinned, copied by `scripts/vendor-xterm.ts`). Tests: `tests/terminal-state.ts`, `tests/terminals.ts`,
`tests/terminals-ui.mjs` (`bun run test:terminals`).

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
  listed (with their replay) until removed; at most 20.
- Studio stopping kills every terminal's process group (SIGHUP then SIGKILL; `tests/terminals.ts` checks a grandchild goes
  too). Nothing is re-attached on restart: a record left open is closed as `studio-stopped` on the next start, and the list
  starts empty. What can survive: a process that left the group on purpose (`setsid`, `nohup … &` with its own process group,
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
