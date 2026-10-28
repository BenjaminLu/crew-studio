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
  session **cookie** (the HttpOnly SameSite=Strict one the page holds) on the loopback listener, plus the server's one write
  guard (same origin, JSON). A script's `x-crew-session` is refused (`pageOnly`): a script on this Mac already has a shell,
  and the input surface stays the human's. A paired phone is refused (`desktopOnly`) even when it may drive Firstmate.
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
- At most `CREW_TERMINAL_MAX` running (default 8). Ended terminals stay listed (with their replay) until removed; at most 20.
- Studio stopping kills every terminal's process group. Nothing is re-attached on restart: a record left open is closed as
  `studio-stopped` on the next start, and the list starts empty.
- Each terminal's record is `data/terminals/<id>.json` (who started it, project, command, start, end, exit code or
  signal, `sandboxed: false`, `evidence: false`) and its transcript `data/terminals/<id>.log` (0600, capped at
  `CREW_TERMINAL_TRANSCRIPT`, default 5 MiB, with a note where it stopped). Studio's activity log (`data/events.jsonl`) gets
  `terminal.start` and `terminal.exit`. The 100 newest records are kept. **A log only**: a transcript is never evidence for
  a gate, a review or a merge.

## State

`detectState` reads the text the program wrote (no screen emulation), per known agent:

- working: output in the last `CREW_TERMINAL_IDLE_MS` (default 2.5 s), or the last chunk ended on the agent's busy line
  ("esc to interrupt", "Working (8s • …") and the pause is still short;
- waiting for you: output stopped and the screen shows a question (`Do you want to…`, `(y/n)`, `[y/N]`, `(Y)es/(N)o`, a
  numbered `❯ 1. Yes` menu, `Proceed?`): `question`, with the question shown; or the agent's own prompt (Claude's input box
  and `? for shortcuts`, Codex's composer, aider's `>`, a shell prompt): `prompt`; or anything else that went quiet: `quiet`;
- done: exit code 0; exited: anything else (non-zero, a signal).

"Waiting for you" shows on the terminal's badge, the list, the Firstmate panel's Terminals tab and as a count on the
sidebar's Firstmate item; a change into it raises a toast, and a system notification when the page is in the background
and the captain allowed notifications. A phone sees the same states.

## Claude Code Remote Control

For the Claude Code preset, Remote Control is on by default (a toggle on the page). Studio asks the installed CLI how:
`claude --help` (no model call; cached per binary and modification time) lists `--remote-control`, so the session starts
with that flag. A CLI whose help does not list it gets `/remote-control` typed once, the first time the session sits idle at
its prompt (not at a question). When Claude Code prints its session link (`https://claude.ai/code…`), the terminal's
header shows it with a QR code drawn on the page (the vendored qrcode library). The link lets anyone signed in to the
account drive the session, so it is treated as a secret: removed from the stored transcript, the phone's stream and replay
(`[remote-control link removed]`), never in the record, the activity log or the list a phone receives. Other agents have
no such feature and show nothing.

Not verified against a live Claude Code here (that would register a real session); the tests use a stub CLI that prints a
fake link, with and without the flag in its help.

## Phone

View only: the page lists terminals and states and draws the output with xterm.js created with `disableStdin`, and the
input element xterm makes is removed, so a tap never opens a keyboard. No launcher, no Stop or Restart, no Remote Control
link. A revoked phone's streams end.
